"""Data validation, drift detection and performance monitoring."""
import numpy as np
import pandas as pd
from scipy import stats

from .data import CATS, NUMERIC, RANGES, TARGET, generate
from .pipeline import FEATURES, evaluate

PSI_WARN, PSI_ALERT = 0.10, 0.25
MISSING_WARN, MISSING_ALERT = 0.10, 0.20


def psi_from_counts(ref, cur, eps=1e-4):
    ref = np.asarray(ref, float); cur = np.asarray(cur, float)
    r = np.clip(ref / max(ref.sum(), 1), eps, None); c = np.clip(cur / max(cur.sum(), 1), eps, None)
    return float(np.sum((c - r) * np.log(c / r)))


def psi_numeric(ref: pd.Series, cur: pd.Series, bins=10) -> float:
    ref, cur = ref.dropna(), cur.dropna()
    if len(cur) < 5:
        return float("nan")
    edges = np.unique(np.quantile(ref, np.linspace(0, 1, bins + 1)))
    edges[0], edges[-1] = -np.inf, np.inf
    return psi_from_counts(np.histogram(ref, edges)[0], np.histogram(cur, edges)[0])


def status_for(psi):
    return "alert" if psi >= PSI_ALERT else "warning" if psi >= PSI_WARN else "ok"


def validate(df: pd.DataFrame, ref: pd.DataFrame) -> dict:
    issues, cols = [], []
    for c in [c for c in FEATURES if c not in df.columns]:
        issues.append({"severity": "alert", "feature": c, "type": "schema", "message": f"Required column '{c}' is absent"})
    n = len(df)
    for c in [c for c in FEATURES if c in df.columns]:
        miss, ref_miss = float(df[c].isna().mean()), float(ref[c].isna().mean())
        info = {"feature": c, "missing_rate": round(miss, 4), "reference_missing_rate": round(ref_miss, 4), "invalid": 0, "unseen": []}
        if miss >= MISSING_ALERT or (miss >= MISSING_WARN and miss > ref_miss * 2):
            issues.append({"severity": "alert" if miss >= MISSING_ALERT else "warning", "feature": c, "type": "missing",
                           "message": f"{miss:.1%} missing (baseline {ref_miss:.1%})"})
        elif miss > ref_miss + 0.03:
            issues.append({"severity": "warning", "feature": c, "type": "missing",
                           "message": f"Missingness rose to {miss:.1%} (baseline {ref_miss:.1%})"})
        if c in RANGES:
            lo, hi = RANGES[c]
            bad = int(((df[c] < lo) | (df[c] > hi)).sum())
            info["invalid"] = bad
            if bad:
                issues.append({"severity": "alert" if bad / n > 0.02 else "warning", "feature": c, "type": "range",
                               "message": f"{bad} values ({bad / n:.1%}) outside valid range [{lo}, {hi}]"})
        else:
            unseen = sorted(set(df[c].dropna().unique()) - set(CATS[c][0]))
            info["unseen"] = [str(u) for u in unseen]
            if unseen:
                issues.append({"severity": "warning", "feature": c, "type": "category",
                               "message": f"Unseen categories: {', '.join(map(str, unseen))}"})
        cols.append(info)
    if "encounter_id" in df and df.encounter_id.duplicated().any():
        issues.append({"severity": "warning", "feature": "encounter_id", "type": "duplicate",
                       "message": f"{int(df.encounter_id.duplicated().sum())} duplicate encounter ids"})
    score = 100 - 15 * sum(i["severity"] == "alert" for i in issues) - 5 * sum(i["severity"] == "warning" for i in issues)
    present = [c for c in FEATURES if c in df]
    return {"rows": n, "quality_score": max(0, score), "issues": issues, "columns": cols,
            "avg_missing_rate": round(float(df[present].isna().mean().mean()), 4)}


def drift(df: pd.DataFrame, ref: pd.DataFrame) -> list[dict]:
    out = []
    for c in [c for c in FEATURES if c in df.columns]:
        if c in NUMERIC:
            psi = psi_numeric(ref[c], df[c])
            ks = stats.ks_2samp(ref[c].dropna(), df[c].dropna())
            out.append({"feature": c, "type": "numeric", "psi": round(psi, 4), "p_value": float(ks.pvalue),
                        "test": "KS", "status": status_for(psi),
                        "ref_mean": round(float(ref[c].mean()), 3), "cur_mean": round(float(df[c].mean()), 3)})
        else:
            cats = sorted(set(ref[c].dropna()) | set(df[c].dropna()))
            rc = ref[c].value_counts().reindex(cats, fill_value=0); cc = df[c].value_counts().reindex(cats, fill_value=0)
            psi = psi_from_counts(rc.values, cc.values)
            chi = stats.chi2_contingency(np.vstack([rc.values, cc.values]) + 1)[1]
            out.append({"feature": c, "type": "categorical", "psi": round(psi, 4), "p_value": float(chi),
                        "test": "Chi²", "status": status_for(psi),
                        "distribution": [{"category": k, "reference": round(float(rc[k] / rc.sum()), 4),
                                          "current": round(float(cc[k] / max(cc.sum(), 1)), 4)} for k in cats]})
    return sorted(out, key=lambda r: -(r["psi"] if r["psi"] == r["psi"] else 0))


def histogram_compare(ref: pd.Series, cur: pd.Series, bins=12):
    edges = np.histogram_bin_edges(ref.dropna(), bins)
    r, _ = np.histogram(ref.dropna(), edges); c, _ = np.histogram(cur.dropna().clip(edges[0], edges[-1]), edges)
    return [{"bin": f"{edges[i]:.1f}", "reference": round(float(r[i] / r.sum()), 4),
             "current": round(float(c[i] / max(c.sum(), 1)), 4)} for i in range(bins)]


def analyze(bundle: dict, df: pd.DataFrame, label: str = "") -> dict:
    """Validation + drift + prediction drift + (if labelled) performance for one batch."""
    ref, model, thr, base = bundle["reference"], bundle["model"], bundle["threshold"], bundle["metrics"]
    missing = [c for c in FEATURES if c not in df.columns]
    val = validate(df, ref)
    dr = drift(df, ref)
    # Score a sanitised copy so a dirty batch is still scored (out-of-range -> missing)
    clean = df.copy()
    for c in missing:
        clean[c] = np.nan
    for c, (lo, hi) in RANGES.items():
        if c in clean:
            clean.loc[(clean[c] < lo) | (clean[c] > hi), c] = np.nan
    scores = model.predict_proba(clean)[:, 1]
    ref_scores = bundle["reference_scores"]
    edges = np.linspace(0, 1, 11)
    rh, ch = np.histogram(ref_scores, edges)[0], np.histogram(scores, edges)[0]
    pred_psi = psi_from_counts(rh, ch)
    perf = deg = None
    if TARGET in df and df[TARGET].nunique() > 1:
        perf = evaluate(df[TARGET], scores, thr)
        deg = {"roc_auc_delta": round(perf["roc_auc"] - base["roc_auc"], 4),
               "recall_delta": round(perf["recall"] - base["recall"], 4),
               "precision_delta": round(perf["precision"] - base["precision"], 4),
               "brier_delta": round(perf["brier"] - base["brier"], 4)}

    alerts = []
    for i in val["issues"]:
        if i["severity"] == "alert":
            alerts.append({"severity": "critical", "category": "Data quality", "message": f"{i['feature']}: {i['message']}"})
    for d in dr:
        if d["status"] != "ok":
            alerts.append({"severity": "critical" if d["status"] == "alert" else "warning", "category": "Feature drift",
                           "message": f"{d['feature']} PSI={d['psi']:.2f}"})
    if pred_psi >= PSI_WARN:
        alerts.append({"severity": "critical" if pred_psi >= PSI_ALERT else "warning", "category": "Prediction drift",
                       "message": f"Score distribution PSI={pred_psi:.2f}"})
    if deg:
        d_auc = deg["roc_auc_delta"]
        if d_auc <= -0.02:
            alerts.append({"severity": "critical" if d_auc <= -0.05 else "warning", "category": "Performance",
                           "message": f"ROC-AUC dropped {abs(d_auc):.3f} vs baseline"})
        if deg["recall_delta"] <= -0.1:
            alerts.append({"severity": "critical", "category": "Performance", "message": f"Recall dropped {abs(deg['recall_delta']):.1%}"})
    crit = sum(a["severity"] == "critical" for a in alerts)
    health = "critical" if crit else "warning" if alerts else "healthy"

    return {
        "label": label, "rows": len(df), "health": health, "alerts": alerts,
        "validation": val, "drift": dr, "drifted_features": sum(d["status"] != "ok" for d in dr),
        "prediction": {"psi": round(pred_psi, 4), "mean_score": round(float(scores.mean()), 4),
                       "reference_mean_score": round(float(ref_scores.mean()), 4),
                       "high_risk_rate": round(float((scores >= thr).mean()), 4),
                       "distribution": [{"bin": f"{edges[i]:.1f}", "reference": round(float(rh[i] / rh.sum()), 4),
                                         "current": round(float(ch[i] / ch.sum()), 4)} for i in range(10)]},
        "performance": perf, "degradation": deg, "top_drifters": [d["feature"] for d in dr[:3]],
        "feature_histograms": {f: histogram_compare(ref[f], df[f]) for f in NUMERIC if f in df and df[f].notna().any()},
    }


_TIMELINE_SEVERITY = [0, 0, 0.05, 0.1, 0.2, 0.4, 0.7, 1.0]


def timeline(bundle: dict, n: int = 1500) -> list[dict]:
    rows = []
    for w, sev in enumerate(_TIMELINE_SEVERITY, start=1):
        rep = analyze(bundle, generate(n, seed=100 + w, severity=sev), label=f"Week {w}")
        p, perf = rep["prediction"], rep["performance"]
        rows.append({
            "week": f"W{w}", "severity": sev, "health": rep["health"],
            "roc_auc": perf["roc_auc"], "precision": perf["precision"], "recall": perf["recall"], "brier": perf["brier"],
            "max_psi": max(d["psi"] for d in rep["drift"] if d["psi"] == d["psi"]),
            "prediction_psi": p["psi"], "mean_score": p["mean_score"], "drifted_features": rep["drifted_features"],
            "missing_rate": rep["validation"]["avg_missing_rate"], "quality_score": rep["validation"]["quality_score"],
            "alerts": len(rep["alerts"]),
        })
    return rows
