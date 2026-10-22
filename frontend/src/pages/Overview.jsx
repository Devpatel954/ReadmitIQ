import { useEffect, useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis, ReferenceLine } from 'recharts'
import { api, num, pct } from '../api'
import { C, Chart, Kpi, Pill, axis, tip } from '../components'

export default function Overview({ model, goto }) {
  const [d, setD] = useState(null)
  useEffect(() => { api('/overview').then(setD) }, [model.version])
  if (!d) return <div className="spin">Computing 8-week production simulation…</div>
  const m = d.metrics, last = d.latest_week
  return (
    <>
      <div className="top">
        <div>
          <h1>Executive overview</h1>
          <div className="muted">30-day hospital readmission risk model · {model.splits.train + model.splits.validation + model.splits.test} encounters · trained {model.trained_at}</div>
        </div>
        <div>Production status: <Pill s={last.health}>{last.health.toUpperCase()}</Pill></div>
      </div>
      <div className="grid g6">
        <Kpi label="ROC-AUC" value={num(m.roc_auc)} sub="held-out test set" color={C.brand} />
        <Kpi label="Precision" value={pct(m.precision)} sub="at operating threshold" />
        <Kpi label="Recall" value={pct(m.recall)} sub="readmissions caught" />
        <Kpi label="F1" value={num(m.f1)} />
        <Kpi label="Brier" value={num(m.brier)} sub="calibration error" />
        <Kpi label="Latest AUC" value={num(last.roc_auc)} sub={`${last.week} in production`} color={last.roc_auc < m.roc_auc - 0.05 ? C.bad : C.ok} />
      </div>
      <div className="grid g2">
        <Chart title="ROC-AUC in production (weekly)" note="Degrades as the patient population drifts away from training data">
          <LineChart data={d.timeline}>
            <CartesianGrid stroke={C.grid} strokeDasharray="3 3" /><XAxis dataKey="week" {...axis} />
            <YAxis domain={[0.5, 0.85]} {...axis} /><Tooltip {...tip} /><Legend />
            <ReferenceLine y={m.roc_auc} stroke={C.ok} strokeDasharray="4 4" label={{ value: 'baseline', fill: C.ok, fontSize: 11 }} />
            <Line dataKey="roc_auc" name="ROC-AUC" stroke={C.brand} strokeWidth={2} />
            <Line dataKey="precision" stroke={C.purple} dot={false} />
            <Line dataKey="recall" stroke={C.warn} dot={false} />
          </LineChart>
        </Chart>
        <Chart title="Drift & data quality (weekly)" note="Max feature PSI · prediction PSI · avg missing rate">
          <LineChart data={d.timeline}>
            <CartesianGrid stroke={C.grid} strokeDasharray="3 3" /><XAxis dataKey="week" {...axis} />
            <YAxis {...axis} /><Tooltip {...tip} /><Legend />
            <ReferenceLine y={0.25} stroke={C.bad} strokeDasharray="4 4" label={{ value: 'PSI alert 0.25', fill: C.bad, fontSize: 11 }} />
            <Line dataKey="max_psi" name="Max feature PSI" stroke={C.bad} strokeWidth={2} />
            <Line dataKey="prediction_psi" name="Prediction PSI" stroke={C.warn} />
            <Line dataKey="missing_rate" name="Missing rate" stroke={C.purple} />
          </LineChart>
        </Chart>
      </div>
      <div className="card">
        <h2>Weekly monitoring log</h2>
        <table>
          <thead><tr><th>Week</th><th>Health</th><th>ROC-AUC</th><th>Recall</th><th>Drifted features</th><th>Quality</th><th>Alerts</th></tr></thead>
          <tbody>{d.timeline.map((r) => (
            <tr key={r.week}><td>{r.week}</td><td><Pill s={r.health} /></td><td>{num(r.roc_auc)}</td><td>{pct(r.recall)}</td>
              <td>{r.drifted_features}</td><td>{r.quality_score}/100</td><td>{r.alerts}</td></tr>
          ))}</tbody>
        </table>
        <div style={{ marginTop: 14 }}><button className="btn" onClick={() => goto('monitor')}>Investigate drift →</button></div>
      </div>
    </>
  )
}
