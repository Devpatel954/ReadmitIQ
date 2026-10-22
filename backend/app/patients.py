"""Inpatient census + care-transition workflow (tasks, notes) with JSON persistence."""
import json
import math
import os
import uuid
from pathlib import Path

import numpy as np
import pandas as pd

from .data import NUMERIC, generate
from .pipeline import FEATURES, risk_tier

STORE = (Path("/tmp/workflow.json") if os.getenv("VERCEL")
         else Path(__file__).resolve().parent.parent / "artifacts" / "workflow.json")
PATIENTS: dict[str, dict] = {}

FIRST = ["James", "Maria", "Robert", "Linda", "Michael", "Patricia", "William", "Elizabeth", "David", "Jennifer", "Richard",
         "Susan", "Joseph", "Dorothy", "Thomas", "Karen", "Charles", "Nancy", "Daniel", "Helen", "George", "Betty"]
LAST = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Wilson",
        "Anderson", "Taylor", "Thomas", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson", "White", "Harris"]
UNITS = ["Cardiac 4E", "Medical 5W", "Telemetry 3N", "Surgical 6E"]
DOCS = ["Dr. Patel", "Dr. Nguyen", "Dr. Okafor", "Dr. Reyes", "Dr. Kim"]


def _nn(v):
    if isinstance(v, (np.floating, float)):
        return None if math.isnan(v) else float(v)
    if isinstance(v, np.integer):
        return int(v)
    return v


def save():
    STORE.parent.mkdir(exist_ok=True)
    STORE.write_text(json.dumps(PATIENTS))


def frame(feats: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(feats)
    for c in NUMERIC:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df[FEATURES]


def care_plan(f: dict, tier: str) -> list[dict]:
    plan = []
    def add(text, reason, owner, due):
        plan.append({"text": text, "reason": reason, "owner": owner, "due": due})
    if tier == "High":
        add("Schedule PCP follow-up within 7 days", "High predicted readmission risk", "Care Coordinator", "Before discharge")
    add("48-hour post-discharge phone call", "Standard transitional care", "Care Coordinator", "48h after discharge")
    if (f.get("prior_inpatient_visits") or 0) >= 2:
        add("Enroll in transitional care program", f"{int(f['prior_inpatient_visits'])} prior inpatient stays", "Care Coordinator", "Before discharge")
    if (f.get("num_medications") or 0) >= 15:
        add("Pharmacist medication reconciliation & teaching", f"{int(f['num_medications'])} active medications", "Pharmacist", "Before discharge")
    if f.get("discharge_disposition") == "AMA":
        add("Safety-net outreach within 24h (left against medical advice)", "AMA discharge", "Care Coordinator", "24h after discharge")
    if f.get("discharge_disposition") == "SNF":
        add("Warm handoff call to receiving SNF nurse", "Discharge to skilled nursing", "Care Coordinator", "Before discharge")
    if f.get("a1c_result") in (">8", "Not tested") and f.get("primary_diagnosis") in ("Diabetes", "Circulatory"):
        add("Diabetes education & endocrine follow-up", f"A1c: {f['a1c_result']}", "Physician", "7 days")
    if (f.get("creatinine") or 0) > 1.5:
        add("Repeat renal panel within 7 days", f"Creatinine {f['creatinine']:.1f}", "Physician", "7 days")
    if f.get("primary_diagnosis") == "Circulatory":
        add("Cardiology follow-up & heart-failure self-care education", "Circulatory primary diagnosis", "Physician", "7 days")
    if f.get("insurance") in ("Medicaid", "Self-pay"):
        add("Social work: transportation & medication-cost screening", f"Payer: {f['insurance']}", "Social Work", "Before discharge")
    return plan


def _new_tasks(f, tier):
    return [{"id": uuid.uuid4().hex[:8], "status": "open", **t} for t in care_plan(f, tier)]


def add_patient(bundle, feats: dict, name: str, extra: dict | None = None) -> dict:
    feats = {k: _nn(feats.get(k)) for k in FEATURES}
    prob = float(bundle["model"].predict_proba(frame([feats]))[0, 1])
    tier = risk_tier(prob, bundle["threshold"])
    rng = np.random.default_rng()
    pid = uuid.uuid4().hex[:8]
    p = {"id": pid, "name": name, "mrn": f"MRN{rng.integers(100000, 999999)}", "unit": str(rng.choice(UNITS)),
         "room": f"{rng.integers(1, 40):02d}{rng.choice(list('ABCD'))}", "attending": str(rng.choice(DOCS)),
         "discharge": "Today", "features": feats, "tasks": _new_tasks(feats, tier) if tier != "Low" else [],
         "notes": [], "reviewed": False, **(extra or {})}
    PATIENTS[pid] = p
    save()
    return p


def seed(bundle, n=48):
    if STORE.exists():
        PATIENTS.update(json.loads(STORE.read_text()))
        return
    df = generate(n, seed=777, severity=0.0)
    rng = np.random.default_rng(777)
    for i, row in df.iterrows():
        feats = {k: _nn(row[k]) for k in FEATURES}
        name = f"{rng.choice(FIRST)} {rng.choice(LAST)}"
        p = add_patient(bundle, feats, name)
        p["discharge"] = str(rng.choice(["Today", "Today", "Tomorrow"]))
    # mark a few tasks done for realism
    for p in list(PATIENTS.values())[:12]:
        for t in p["tasks"][:1]:
            t["status"] = "done"
    save()


def scored(bundle) -> list[dict]:
    ps = list(PATIENTS.values())
    if not ps:
        return []
    probs = bundle["model"].predict_proba(frame([p["features"] for p in ps]))[:, 1]
    out = []
    for p, pr in zip(ps, probs):
        f = p["features"]
        open_t = sum(t["status"] == "open" for t in p["tasks"])
        out.append({"id": p["id"], "name": p["name"], "mrn": p["mrn"], "unit": p["unit"], "room": p["room"],
                    "attending": p["attending"], "discharge": p["discharge"], "age": f["age"], "gender": f["gender"],
                    "diagnosis": f["primary_diagnosis"], "los": f["time_in_hospital"], "probability": round(float(pr), 4),
                    "tier": risk_tier(float(pr), bundle["threshold"]), "tasks_total": len(p["tasks"]),
                    "tasks_open": open_t, "reviewed": p["reviewed"]})
    return sorted(out, key=lambda r: -r["probability"])
