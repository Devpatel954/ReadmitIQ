"""GenAI monitoring analyst: uses OpenAI if OPENAI_API_KEY is set, otherwise a deterministic rule-based narrative."""
import json
import os


def rule_based(report: dict, baseline: dict) -> dict:
    h, alerts = report["health"], report["alerts"]
    crit = [a for a in alerts if a["severity"] == "critical"]
    perf, deg = report.get("performance"), report.get("degradation")
    drivers = ", ".join(report["top_drifters"]) or "none"
    lines = [f"Model health is **{h.upper()}** for {report.get('label') or 'this batch'} ({report['rows']:,} encounters)."]
    lines.append(f"{report['drifted_features']} of {len(report['drift'])} features show drift; strongest: {drivers}. "
                 f"Prediction-score PSI is {report['prediction']['psi']:.2f}.")
    lines.append(f"Data quality score {report['validation']['quality_score']}/100 with {len(report['validation']['issues'])} validation issue(s).")
    if perf:
        lines.append(f"ROC-AUC {perf['roc_auc']:.3f} (baseline {baseline['roc_auc']:.3f}, Δ {deg['roc_auc_delta']:+.3f}); "
                     f"recall {perf['recall']:.1%} (Δ {deg['recall_delta']:+.1%}).")
    actions = []
    if any(a["category"] == "Data quality" for a in crit):
        actions.append("Fix upstream data pipeline faults (invalid ranges, missing labs, unseen categories) before trusting predictions.")
    if report["drifted_features"] >= 3 or report["prediction"]["psi"] >= 0.1:
        actions.append("Investigate population shift; compare cohort mix with the training window.")
    if deg and (deg["roc_auc_delta"] <= -0.03 or deg["recall_delta"] <= -0.08):
        actions.append("Schedule retraining on recent labelled data and re-validate calibration and threshold.")
    if h == "critical" and (any(a["category"] in ("Data quality", "Performance") for a in crit)):
        actions.append("Escalate to the clinical ML owner; consider human review of high-risk lists until resolved.")
    if not actions:
        actions.append("No action required. Continue scheduled monitoring.")
    return {"source": "rule-based", "summary": " ".join(lines), "actions": actions}


def generate_insight(report: dict, baseline: dict) -> dict:
    base = rule_based(report, baseline)
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        return base
    try:
        from openai import OpenAI
        facts = {"health": report["health"], "alerts": report["alerts"][:12], "top_drifters": report["top_drifters"],
                 "prediction_psi": report["prediction"]["psi"], "performance": {k: report["performance"][k] for k in ("roc_auc", "precision", "recall", "brier")} if report.get("performance") else None,
                 "degradation": report.get("degradation"), "baseline_auc": baseline["roc_auc"],
                 "quality_score": report["validation"]["quality_score"]}
        r = OpenAI(api_key=key).chat.completions.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"), response_format={"type": "json_object"},
            messages=[{"role": "system", "content": "You are an ML monitoring analyst for a hospital readmission model. "
                       "Return JSON {\"summary\": str (<=90 words), \"actions\": [str,...3 max]}. Use only the supplied facts."},
                      {"role": "user", "content": json.dumps(facts)}])
        data = json.loads(r.choices[0].message.content)
        return {"source": os.getenv("OPENAI_MODEL", "gpt-4o-mini"), "summary": data["summary"], "actions": data["actions"]}
    except Exception:
        return base


def patient_brief(p: dict, res: dict, plan_texts: list[str]) -> dict:
    f = p["features"]
    drivers = [d for d in res["drivers"] if d["impact"] > 0.01][:3]
    drv = ", ".join(f"{d['feature'].replace('_', ' ')} ({d['value']})" for d in drivers) or "no single dominant factor"
    base = (f"{p['name']} ({int(f['age'])}{f['gender']}) was admitted for {f['primary_diagnosis'].lower()} "
            f"({int(f['time_in_hospital'])} days, {f['admission_type'].lower()} admission) and has a {res['tier'].lower()} "
            f"30-day readmission risk of {res['probability']:.0%} versus a {res['baseline_rate']:.0%} population rate. "
            f"Main risk drivers: {drv}.")
    out = {"source": "rule-based", "summary": base, "focus": plan_texts[:3]}
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        return out
    try:
        from openai import OpenAI
        facts = {"patient": {k: v for k, v in f.items()}, "risk": res["probability"], "tier": res["tier"],
                 "drivers": res["drivers"], "care_plan": plan_texts}
        r = OpenAI(api_key=key).chat.completions.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"), response_format={"type": "json_object"},
            messages=[{"role": "system", "content": "You write concise discharge-readiness briefs for care coordinators. "
                       "Return JSON {\"summary\": str (<=80 words, no PHI beyond given), \"focus\": [up to 3 str]}. Use only given facts."},
                      {"role": "user", "content": json.dumps(facts, default=str)}])
        d = json.loads(r.choices[0].message.content)
        return {"source": os.getenv("OPENAI_MODEL", "gpt-4o-mini"), "summary": d["summary"], "focus": d["focus"]}
    except Exception:
        return out
