import io
import math
import threading
from contextlib import asynccontextmanager

import numpy as np
import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import insights, monitoring, patients, pipeline
from .data import CATS, SCENARIOS, generate

STATE: dict = {}
LOCK = threading.Lock()
PREDICTION_LOG: list[dict] = []


@asynccontextmanager
async def lifespan(app: FastAPI):
    STATE["bundle"] = pipeline.load()
    patients.seed(STATE["bundle"])
    yield


app = FastAPI(title="Readmission Risk & Model Monitoring API", version="1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def clean(o):
    """Make numpy / NaN values JSON-safe."""
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, (np.floating, float)):
        return None if math.isnan(o) or math.isinf(o) else float(o)
    if isinstance(o, np.integer):
        return int(o)
    return o


def B():
    return STATE["bundle"]


class Patient(BaseModel):
    age: float = 70
    gender: str = "F"
    insurance: str = "Medicare"
    admission_type: str = "Emergency"
    primary_diagnosis: str = "Circulatory"
    discharge_disposition: str = "Home"
    a1c_result: str = ">8"
    time_in_hospital: float = 6
    num_lab_procedures: float = 50
    num_medications: float = 18
    num_diagnoses: float = 8
    prior_inpatient_visits: float = 2
    prior_er_visits: float = 1
    creatinine: float | None = 1.6
    bmi: float | None = 31
    systolic_bp: float | None = 140


@app.get("/api/health")
def health():
    return {"status": "ok", "model_version": B()["version"]}


@app.get("/api/model")
def model_info():
    b = B()
    return clean({"version": b["version"], "name": b["model_name"], "trained_at": b["trained_at"], "threshold": b["threshold"],
                  "splits": b["splits"], "train_seconds": b["train_seconds"], "comparison": b["comparison"],
                  "importance": b["importance"], "metrics": b["metrics"]})


@app.get("/api/schema")
def schema():
    return {"categories": {k: v[0] for k, v in CATS.items()}, "scenarios": SCENARIOS}


@app.post("/api/predict")
def predict(p: Patient):
    b = B()
    row = pd.DataFrame([p.model_dump()])
    prob = float(b["model"].predict_proba(row)[0, 1])
    res = {"probability": round(prob, 4), "tier": pipeline.risk_tier(prob, b["threshold"]),
           "threshold": b["threshold"], "flagged": prob >= b["threshold"],
           "baseline_rate": b["metrics"]["prevalence"], "drivers": pipeline.explain(b, row),
           "model_version": b["version"]}
    PREDICTION_LOG.append({"p": prob, "tier": res["tier"]})
    del PREDICTION_LOG[:-500]
    return clean(res)


@app.get("/api/overview")
def overview():
    b = B()
    tl = monitoring.timeline(b) if "timeline" not in STATE else STATE["timeline"]
    STATE["timeline"] = tl
    last = tl[-1]
    return clean({"model": {"version": b["version"], "name": b["model_name"], "trained_at": b["trained_at"]},
                  "metrics": {k: b["metrics"][k] for k in ("roc_auc", "precision", "recall", "f1", "brier", "prevalence")},
                  "latest_week": last, "timeline": tl, "predictions_served": len(PREDICTION_LOG)})


@app.get("/api/monitoring/timeline")
def get_timeline():
    if "timeline" not in STATE:
        STATE["timeline"] = monitoring.timeline(B())
    return clean(STATE["timeline"])


@app.get("/api/monitoring/simulate")
def simulate(scenario: str = "none", n: int = 2000, seed: int = 7):
    if scenario not in SCENARIOS:
        raise HTTPException(400, "unknown scenario")
    n = max(200, min(n, 20000))
    rep = monitoring.analyze(B(), generate(n, seed=seed, scenario=scenario), label=f"Simulated batch ({scenario})")
    rep["scenario"] = {"id": scenario, "description": SCENARIOS[scenario]}
    rep["insight"] = insights.generate_insight(rep, B()["metrics"])
    return clean(rep)


@app.post("/api/monitoring/upload")
async def upload(file: UploadFile = File(...)):
    try:
        df = pd.read_csv(io.BytesIO(await file.read()))
    except Exception:
        raise HTTPException(400, "Could not parse CSV")
    if df.empty or len(df) > 200_000:
        raise HTTPException(400, "CSV must have 1 - 200,000 rows")
    rep = monitoring.analyze(B(), df, label=file.filename or "Uploaded batch")
    rep["insight"] = insights.generate_insight(rep, B()["metrics"])
    return clean(rep)


@app.get("/api/sample-csv")
def sample_csv(scenario: str = "severe"):
    from fastapi.responses import Response
    return Response(generate(1000, seed=11, scenario=scenario).to_csv(index=False), media_type="text/csv",
                    headers={"Content-Disposition": f"attachment; filename=batch_{scenario}.csv"})


@app.post("/api/retrain")
def retrain():
    if not LOCK.acquire(blocking=False):
        raise HTTPException(409, "Training already in progress")
    try:
        STATE["bundle"] = pipeline.train(seed=int(np.random.randint(1, 10_000)))
        STATE.pop("timeline", None)
        return model_info()
    finally:
        LOCK.release()


# ---------- Care-transition workflow ----------
class Admit(BaseModel):
    name: str = "New Patient"
    features: Patient


class TaskIn(BaseModel):
    text: str
    owner: str = "Care Coordinator"
    due: str = "Before discharge"


class TaskUpdate(BaseModel):
    status: str


class NoteIn(BaseModel):
    text: str
    author: str = "Care Coordinator"


def _get(pid: str) -> dict:
    if pid not in patients.PATIENTS:
        raise HTTPException(404, "patient not found")
    return patients.PATIENTS[pid]


@app.get("/api/census")
def census():
    rows = patients.scored(B())
    return clean({"patients": rows, "summary": {
        "total": len(rows), "high": sum(r["tier"] == "High" for r in rows),
        "medium": sum(r["tier"] == "Medium" for r in rows),
        "open_tasks": sum(r["tasks_open"] for r in rows),
        "expected_readmissions": round(sum(r["probability"] for r in rows), 1),
        "discharging_today": sum(r["discharge"] == "Today" for r in rows),
        "units": sorted({r["unit"] for r in rows})}})


@app.get("/api/patients/{pid}")
def patient_detail(pid: str):
    b, p = B(), _get(pid)
    row = patients.frame([p["features"]])
    prob = float(b["model"].predict_proba(row)[0, 1])
    res = {"probability": round(prob, 4), "tier": pipeline.risk_tier(prob, b["threshold"]),
           "threshold": b["threshold"], "baseline_rate": b["metrics"]["prevalence"],
           "drivers": pipeline.explain(b, row)}
    brief = insights.patient_brief(p, res, [t["text"] for t in p["tasks"] if t["status"] == "open"])
    return clean({**p, **res, "flagged": prob >= b["threshold"], "brief": brief})


@app.post("/api/patients")
def admit(a: Admit):
    p = patients.add_patient(B(), a.features.model_dump(), a.name.strip() or "New Patient")
    return {"id": p["id"]}


@app.post("/api/patients/{pid}/tasks")
def add_task(pid: str, t: TaskIn):
    p = _get(pid)
    if not t.text.strip():
        raise HTTPException(400, "text required")
    import uuid
    p["tasks"].append({"id": uuid.uuid4().hex[:8], "status": "open", "reason": "Added manually", **t.model_dump()})
    patients.save()
    return p["tasks"]


@app.post("/api/patients/{pid}/tasks/{tid}")
def update_task(pid: str, tid: str, u: TaskUpdate):
    p = _get(pid)
    if u.status not in ("open", "done"):
        raise HTTPException(400, "bad status")
    for t in p["tasks"]:
        if t["id"] == tid:
            t["status"] = u.status
            patients.save()
            return p["tasks"]
    raise HTTPException(404, "task not found")


@app.post("/api/patients/{pid}/notes")
def add_note(pid: str, n: NoteIn):
    import time
    p = _get(pid)
    if not n.text.strip():
        raise HTTPException(400, "text required")
    p["notes"].insert(0, {"text": n.text.strip(), "author": n.author, "at": time.strftime("%b %d, %H:%M")})
    patients.save()
    return p["notes"]


@app.post("/api/patients/{pid}/review")
def review(pid: str):
    p = _get(pid)
    p["reviewed"] = not p["reviewed"]
    patients.save()
    return {"reviewed": p["reviewed"]}


@app.get("/api/tasks")
def all_tasks():
    out = []
    risk = {r["id"]: r for r in patients.scored(B())}
    for p in patients.PATIENTS.values():
        for t in p["tasks"]:
            out.append({**t, "patient_id": p["id"], "patient": p["name"], "unit": p["unit"],
                        "tier": risk[p["id"]]["tier"], "probability": risk[p["id"]]["probability"]})
    out.sort(key=lambda t: (t["status"] == "done", -t["probability"]))
    return clean(out)
