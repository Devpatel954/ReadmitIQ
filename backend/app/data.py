"""Synthetic EHR-style encounter generator (diabetes-readmission flavoured) with drift scenarios."""
import numpy as np
import pandas as pd

NUMERIC = [
    "age", "time_in_hospital", "num_lab_procedures", "num_medications", "num_diagnoses",
    "prior_inpatient_visits", "prior_er_visits", "creatinine", "bmi", "systolic_bp",
]
CATEGORICAL = ["gender", "insurance", "discharge_disposition", "primary_diagnosis", "a1c_result", "admission_type"]
TARGET = "readmitted_30d"

CATS = {
    "gender": (["F", "M"], [0.54, 0.46]),
    "insurance": (["Medicare", "Medicaid", "Private", "Self-pay"], [0.45, 0.17, 0.30, 0.08]),
    "discharge_disposition": (["Home", "SNF", "Home Health", "Rehab", "AMA"], [0.58, 0.14, 0.15, 0.10, 0.03]),
    "primary_diagnosis": (["Circulatory", "Respiratory", "Diabetes", "Digestive", "Injury", "Other"],
                          [0.30, 0.14, 0.18, 0.10, 0.08, 0.20]),
    "a1c_result": (["Normal", ">7", ">8", "Not tested"], [0.20, 0.20, 0.20, 0.40]),
    "admission_type": (["Emergency", "Urgent", "Elective"], [0.60, 0.22, 0.18]),
}

SCENARIOS = {
    "none": "No drift - production resembles training data",
    "mild": "Mild drift - older, sicker population, a few more missing labs",
    "severe": "Severe drift - new payer mix, ETL faults, changed readmission behaviour",
}

# Valid ranges used by data validation
RANGES = {
    "age": (18, 105), "time_in_hospital": (1, 30), "num_lab_procedures": (0, 150),
    "num_medications": (0, 100), "num_diagnoses": (1, 20), "prior_inpatient_visits": (0, 50),
    "prior_er_visits": (0, 50), "creatinine": (0.1, 15), "bmi": (10, 80), "systolic_bp": (60, 260),
}


def _shift(p, delta, floor=0.01):
    p = np.clip(np.array(p) + np.array(delta), floor, None)
    return p / p.sum()


def generate(n: int, seed: int = 0, scenario: str = "none", severity: float | None = None) -> pd.DataFrame:
    """severity in [0,1] overrides the scenario preset (used for the timeline)."""
    s = severity if severity is not None else {"none": 0.0, "mild": 0.4, "severe": 1.0}[scenario]
    rng = np.random.default_rng(seed)
    df = pd.DataFrame({
        "age": np.clip(rng.normal(62 + 12 * s, 16, n), 18, 98).round(),
        "time_in_hospital": np.clip(rng.gamma(2.2, 2.0, n) + 1 + 2 * s, 1, 14).round(),
        "num_lab_procedures": np.clip(rng.normal(43, 18, n), 1, 130).round(),
        "num_medications": np.clip(rng.normal(15 + 8 * s, 6, n), 1, 60).round(),
        "num_diagnoses": np.clip(rng.normal(7, 2, n), 1, 16).round(),
        "prior_inpatient_visits": rng.poisson(0.6 + 0.4 * s, n),
        "prior_er_visits": rng.poisson(0.5, n),
        "creatinine": np.clip(rng.lognormal(0.0, 0.4, n), 0.4, 8),
        "bmi": np.clip(rng.normal(30, 7, n), 15, 65),
        "systolic_bp": np.clip(rng.normal(132, 18, n), 80, 220),
    })
    shifts = {"insurance": [-0.2, 0.15, 0.0, 0.05], "discharge_disposition": [-0.2, 0.12, 0.0, 0.0, 0.08]}
    for c in CATEGORICAL:
        vals, p = CATS[c]
        probs = _shift(p, s * np.array(shifts[c])) if c in shifts else p
        df[c] = rng.choice(vals, n, p=probs)

    z = (-3.1
         + 0.018 * (df.age - 60)
         + 0.09 * df.time_in_hospital
         + 0.03 * df.num_medications
         + 0.07 * df.num_diagnoses
         + 0.45 * df.prior_inpatient_visits
         + 0.22 * df.prior_er_visits
         + 0.35 * (df.creatinine - 1)
         + 0.012 * (df.systolic_bp - 130)
         + np.where(df.discharge_disposition == "AMA", 0.9, 0)
         + np.where(df.discharge_disposition == "SNF", 0.35, 0)
         + np.where(df.primary_diagnosis == "Circulatory", 0.3, 0)
         + np.where(df.primary_diagnosis == "Diabetes", 0.25, 0)
         + np.where(df.a1c_result == ">8", 0.3, 0)
         + np.where(df.admission_type == "Emergency", 0.25, 0)
         + np.where(df.insurance == "Medicaid", 0.2, 0))
    z = 1.7 * (z + 0.7) - 1.0
    # concept drift: prior admissions matter less and labels get noisier
    z = z - s * 1.0 * df.prior_inpatient_visits + rng.normal(0, 0.05 + 1.2 * s, n)
    df[TARGET] = (rng.random(n) < 1 / (1 + np.exp(-z))).astype(int)

    for col, base in [("creatinine", 0.02), ("bmi", 0.04), ("systolic_bp", 0.01)]:
        extra = 0.25 * s if col != "systolic_bp" else 0
        df.loc[rng.random(n) < base + extra, col] = np.nan
    if s >= 0.8:
        df.loc[rng.random(n) < 0.03, "age"] = -1
        df.loc[rng.random(n) < 0.02, "gender"] = "Unknown"
        df.loc[rng.random(n) < 0.04, "bmi"] = 400
    df.insert(0, "encounter_id", [f"E{seed:03d}{i:05d}" for i in range(n)])
    return df
