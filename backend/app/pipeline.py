"""Training pipeline: preprocessing, feature engineering, model selection, calibration, validation."""
import os
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV, calibration_curve
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (average_precision_score, brier_score_loss, confusion_matrix, f1_score,
                             precision_recall_curve, precision_score, recall_score, roc_auc_score,
                             roc_curve, accuracy_score)
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import FunctionTransformer, OneHotEncoder, StandardScaler

from .data import CATEGORICAL, NUMERIC, TARGET, generate

BUNDLED = Path(__file__).resolve().parent.parent / "artifacts" / "model.joblib"
# Serverless filesystems are read-only except /tmp
ARTIFACT = Path("/tmp/model.joblib") if os.getenv("VERCEL") else BUNDLED
FEATURES = NUMERIC + CATEGORICAL
ENGINEERED = ["polypharmacy", "total_prior_visits", "meds_per_day", "labs_per_day", "elevated_creatinine", "senior"]


def add_features(df: pd.DataFrame) -> pd.DataFrame:
    d = df[FEATURES].copy()
    d["polypharmacy"] = (d.num_medications >= 15).astype(int)
    d["total_prior_visits"] = d.prior_inpatient_visits + d.prior_er_visits
    d["meds_per_day"] = d.num_medications / d.time_in_hospital.clip(lower=1)
    d["labs_per_day"] = d.num_lab_procedures / d.time_in_hospital.clip(lower=1)
    d["elevated_creatinine"] = (d.creatinine > 1.5).astype(float).where(d.creatinine.notna())
    d["senior"] = (d.age >= 65).astype(int)
    return d


def build_pipeline(estimator) -> Pipeline:
    num = NUMERIC + ENGINEERED
    pre = ColumnTransformer([
        ("num", Pipeline([("impute", SimpleImputer(strategy="median", add_indicator=True)),
                          ("scale", StandardScaler())]), num),
        ("cat", Pipeline([("impute", SimpleImputer(strategy="most_frequent")),
                          ("ohe", OneHotEncoder(handle_unknown="ignore"))]), CATEGORICAL),
    ])
    return Pipeline([("features", FunctionTransformer(add_features)), ("pre", pre), ("model", estimator)])


def _downsample(x, y, k=60):
    idx = np.unique(np.linspace(0, len(x) - 1, k).astype(int))
    return [{"x": round(float(x[i]), 4), "y": round(float(y[i]), 4)} for i in idx]


def evaluate(y, p, thr: float) -> dict:
    """Full metric bundle used for both validation and production monitoring."""
    y = np.asarray(y); p = np.asarray(p); pred = (p >= thr).astype(int)
    fpr, tpr, _ = roc_curve(y, p)
    pr, rc, _ = precision_recall_curve(y, p)
    frac_pos, mean_pred = calibration_curve(y, p, n_bins=10, strategy="quantile")
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    bins = np.linspace(0, 1, 21)
    h0, _ = np.histogram(p[y == 0], bins); h1, _ = np.histogram(p[y == 1], bins)
    return {
        "n": int(len(y)), "prevalence": round(float(y.mean()), 4), "threshold": round(float(thr), 4),
        "roc_auc": round(float(roc_auc_score(y, p)), 4),
        "avg_precision": round(float(average_precision_score(y, p)), 4),
        "precision": round(float(precision_score(y, pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y, pred)), 4),
        "f1": round(float(f1_score(y, pred)), 4),
        "accuracy": round(float(accuracy_score(y, pred)), 4),
        "brier": round(float(brier_score_loss(y, p)), 4),
        "ece": round(float(np.abs(frac_pos - mean_pred).mean()), 4),
        "confusion": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
        "roc_curve": _downsample(fpr, tpr),
        "pr_curve": _downsample(rc, pr),
        "calibration": [{"predicted": round(float(a), 4), "observed": round(float(b), 4)}
                        for a, b in zip(mean_pred, frac_pos)],
        "score_distribution": [{"bin": f"{bins[i]:.2f}", "negative": int(h0[i]), "positive": int(h1[i])}
                               for i in range(20)],
    }


def train(n: int = 12000, seed: int = 42) -> dict:
    t0 = time.time()
    df = generate(n, seed=seed)
    X, y = df.drop(columns=[TARGET]), df[TARGET]
    X_tr, X_tmp, y_tr, y_tmp = train_test_split(X, y, test_size=0.4, stratify=y, random_state=seed)
    X_val, X_te, y_val, y_te = train_test_split(X_tmp, y_tmp, test_size=0.5, stratify=y_tmp, random_state=seed)

    candidates = {
        "Logistic Regression": LogisticRegression(max_iter=1000, C=0.5),
        "Gradient Boosting": HistGradientBoostingClassifier(max_depth=4, learning_rate=0.06, max_iter=250,
                                                           random_state=seed),
    }
    cv = StratifiedKFold(5, shuffle=True, random_state=seed)
    comparison = []
    for name, est in candidates.items():
        s = cross_val_score(build_pipeline(est), X_tr, y_tr, cv=cv, scoring="roc_auc", n_jobs=-1)
        comparison.append({"model": name, "cv_auc_mean": round(float(s.mean()), 4), "cv_auc_std": round(float(s.std()), 4)})
    best = max(comparison, key=lambda r: r["cv_auc_mean"])["model"]

    model = CalibratedClassifierCV(build_pipeline(candidates[best]), method="isotonic", cv=3)
    model.fit(X_tr, y_tr)

    # Operating threshold: maximise F1 on the validation split
    p_val = model.predict_proba(X_val)[:, 1]
    grid = np.linspace(0.05, 0.6, 111)
    thr = float(grid[int(np.argmax([f1_score(y_val, p_val >= t) for t in grid]))])

    p_te = model.predict_proba(X_te)[:, 1]
    metrics = evaluate(y_te, p_te, thr)

    perm = permutation_importance(model, X_te[FEATURES].iloc[:1500], y_te.iloc[:1500], scoring="roc_auc",
                                  n_repeats=3, random_state=seed, n_jobs=-1)
    importance = sorted(({"feature": f, "importance": round(float(v), 4)} for f, v in zip(FEATURES, perm.importances_mean)),
                        key=lambda r: -r["importance"])

    bundle = {
        "model": model, "threshold": thr, "model_name": best, "metrics": metrics,
        "comparison": comparison, "importance": importance,
        "reference": X_tr.sample(4000, random_state=seed).reset_index(drop=True),
        "reference_scores": p_te, "trained_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "splits": {"train": len(X_tr), "validation": len(X_val), "test": len(X_te)},
        "train_seconds": round(time.time() - t0, 1),
        "version": time.strftime("v%Y%m%d.%H%M%S"),
    }
    ARTIFACT.parent.mkdir(exist_ok=True)
    joblib.dump(bundle, ARTIFACT)
    return bundle


def load() -> dict:
    for path in (ARTIFACT, BUNDLED):
        if path.exists():
            return joblib.load(path)
    return train()


def risk_tier(p: float, thr: float) -> str:
    return "High" if p >= max(thr, 0.3) + 0.1 else "Medium" if p >= thr * 0.8 else "Low"


def explain(bundle: dict, row: pd.DataFrame, top: int = 6) -> list[dict]:
    """Local explanation: swap each feature with its reference median/mode, measure change in risk."""
    model, ref = bundle["model"], bundle["reference"]
    base = float(model.predict_proba(row)[0, 1])
    out = []
    for f in FEATURES:
        r = row.copy()
        r[f] = ref[f].median() if f in NUMERIC else ref[f].mode()[0]
        v = row[f].iloc[0]
        v = None if pd.isna(v) else (v.item() if hasattr(v, "item") else v)
        out.append({"feature": f, "value": round(v, 1) if isinstance(v, float) else v,
                    "impact": round(base - float(model.predict_proba(r)[0, 1]), 4)})
    return sorted(out, key=lambda r: -abs(r["impact"]))[:top]
