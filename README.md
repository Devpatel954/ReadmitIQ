# ReadmitIQ – Hospital Readmission Prediction & AI Model Monitoring (MVP)

Full-stack demo: **React + Recharts** UI, **FastAPI** backend, **scikit-learn** pipeline, optional **OpenAI** analyst.

## What it is
A care-transition **app** for hospital discharge teams, with the ML monitoring in an admin area.

Sign in as **Dana (RN Care Coordinator)** or **Sam (ML/Quality Lead, admin)**.

| Screen | Purpose |
|---|---|
| Discharge worklist | Live inpatient census ranked by 30-day readmission risk; filter by tier, unit, discharge day; search |
| Patient workspace | Risk gauge, per-patient drivers, AI discharge brief, auto-generated care plan (checkable tasks), notes, what-if simulator, mark reviewed |
| Care tasks | Cross-patient task queue by owner (coordinator, pharmacist, social work, physician) |
| New admission | Enter a patient, see instant risk, add to the census with a generated care plan |
| Model health (admin) | Overview, performance (ROC/PR/calibration/importance), drift & data quality (upload CSV or simulate drift), retrain |

Tasks/notes persist in `backend/artifacts/workflow.json` (delete it to reset the demo census).

## ML pipeline (`backend/app/pipeline.py`)
Synthetic EHR encounters (`data.py`, 16 features) → engineered features (polypharmacy, prior-visit total, meds/labs per day, high creatinine, senior) → median/mode imputation + missing indicators, scaling, one-hot → Logistic Regression vs. Gradient Boosting (5-fold CV) → isotonic calibration → F1-tuned threshold on a validation split → held-out test evaluation.

## Monitoring (`backend/app/monitoring.py`)
- Validation: schema, missing-rate vs baseline, valid ranges, unseen categories, duplicate IDs → quality score
- Drift: PSI (+ KS / Chi²) per feature, prediction-score PSI (warn ≥0.10, alert ≥0.25)
- Performance: AUC/recall/precision/Brier deltas vs training baseline → alerts

## API
`GET /api/model`, `/api/overview`, `/api/monitoring/timeline`, `/api/monitoring/simulate?scenario=none|mild|severe`, `POST /api/monitoring/upload` (CSV), `POST /api/predict`, `POST /api/retrain`, `GET /api/sample-csv`. Docs at `/docs`.

> Data is synthetic – not for clinical use. For real data, replace `generate()` with your loader and keep the same columns (+ `readmitted_30d` label for performance monitoring).

## Deploy on Vercel
`vercel.json` defines two services on one domain: `frontend` (Vite, public, `/(.*)`) and `backend` (FastAPI, public at `/api/(.*)`, entrypoint `backend/main.py`). The frontend calls `/api` same-origin, so no bindings are needed.

Import the repo in Vercel (Framework preset: **Services**) or run `vercel dev` locally. Optionally set `OPENAI_API_KEY` for LLM summaries.

Serverless notes: the pre-trained model (`backend/artifacts/model.joblib`) ships with the repo; runtime writes (tasks, notes, retrained model) go to `/tmp`, which is **ephemeral and per-instance**. That is fine for a demo; use a database (Postgres/KV) for real persistence.
