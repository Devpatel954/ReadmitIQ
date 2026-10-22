import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'
import { num, pct } from '../api'
import { C, Chart, Kpi, axis, tip } from '../components'

export default function Performance({ model }) {
  const m = model.metrics, cf = m.confusion
  return (
    <>
      <div className="top"><div>
        <h1>Model performance</h1>
        <div className="muted">Selected by 5-fold CV · isotonic-calibrated · threshold {m.threshold} tuned for F1 on validation split ({model.splits.validation.toLocaleString()} rows)</div>
      </div></div>
      <div className="grid g6">
        <Kpi label="ROC-AUC" value={num(m.roc_auc)} color={C.brand} />
        <Kpi label="Avg precision" value={num(m.avg_precision)} />
        <Kpi label="Precision" value={pct(m.precision)} />
        <Kpi label="Recall" value={pct(m.recall)} />
        <Kpi label="Brier" value={num(m.brier)} />
        <Kpi label="ECE" value={num(m.ece)} sub="calibration gap" />
      </div>
      <div className="grid g3">
        <Chart title="ROC curve">
          <LineChart data={m.roc_curve}><CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
            <XAxis dataKey="x" type="number" domain={[0, 1]} {...axis} /><YAxis {...axis} /><Tooltip {...tip} />
            <Line dataKey="y" name="TPR" stroke={C.brand} dot={false} strokeWidth={2} />
            <Line data={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} dataKey="y" stroke={C.muted} strokeDasharray="4 4" dot={false} /></LineChart>
        </Chart>
        <Chart title="Precision-recall curve">
          <LineChart data={m.pr_curve}><CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
            <XAxis dataKey="x" type="number" domain={[0, 1]} {...axis} /><YAxis domain={[0, 1]} {...axis} /><Tooltip {...tip} />
            <Line dataKey="y" name="Precision" stroke={C.purple} dot={false} strokeWidth={2} /></LineChart>
        </Chart>
        <Chart title="Calibration" note="Predicted vs. observed readmission rate">
          <LineChart data={m.calibration}><CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
            <XAxis dataKey="predicted" type="number" domain={[0, 1]} {...axis} /><YAxis domain={[0, 1]} {...axis} /><Tooltip {...tip} />
            <Line dataKey="observed" stroke={C.ok} strokeWidth={2} />
            <Line data={[{ predicted: 0, observed: 0 }, { predicted: 1, observed: 1 }]} dataKey="observed" stroke={C.muted} strokeDasharray="4 4" dot={false} /></LineChart>
        </Chart>
      </div>
      <div className="grid g3">
        <Chart title="Score distribution" note="Predicted risk by true outcome">
          <AreaChart data={m.score_distribution}><CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
            <XAxis dataKey="bin" {...axis} /><YAxis {...axis} /><Tooltip {...tip} /><Legend />
            <Area dataKey="negative" name="Not readmitted" stroke={C.brand} fill={C.brand} fillOpacity={0.3} />
            <Area dataKey="positive" name="Readmitted" stroke={C.bad} fill={C.bad} fillOpacity={0.3} /></AreaChart>
        </Chart>
        <Chart title="Feature importance" note="Permutation, ΔAUC">
          <BarChart layout="vertical" data={model.importance.slice(0, 8)} margin={{ left: 40 }}>
            <XAxis type="number" {...axis} /><YAxis type="category" dataKey="feature" {...axis} width={120} /><Tooltip {...tip} />
            <Bar dataKey="importance" fill={C.brand} radius={4} /></BarChart>
        </Chart>
        <div className="card">
          <h2>Confusion matrix (test)</h2>
          <table><tbody>
            <tr><th></th><th>Pred. no</th><th>Pred. yes</th></tr>
            <tr><th>Actual no</th><td>{cf.tn}</td><td style={{ color: C.warn }}>{cf.fp}</td></tr>
            <tr><th>Actual yes</th><td style={{ color: C.bad }}>{cf.fn}</td><td style={{ color: C.ok }}>{cf.tp}</td></tr>
          </tbody></table>
          <h2 style={{ marginTop: 20 }}>Model selection (5-fold CV AUC)</h2>
          <table><tbody>{model.comparison.map((c) => (
            <tr key={c.model}><td>{c.model}{c.model === model.name && ' ✓'}</td><td>{num(c.cv_auc_mean)} ± {num(c.cv_auc_std)}</td></tr>
          ))}</tbody></table>
          <div className="muted" style={{ marginTop: 12 }}>Pipeline: median impute + missing flags → scale · mode impute → one-hot · 6 engineered features (polypharmacy, prior-visit total, meds/day, labs/day, high creatinine, senior).</div>
        </div>
      </div>
    </>
  )
}
