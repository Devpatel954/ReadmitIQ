import { useCallback, useEffect, useRef, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis, ReferenceLine } from 'recharts'
import { Sparkles } from 'lucide-react'
import { api, num, pct } from '../api'
import { C, Chart, Kpi, Pill, axis, tip } from '../components'

const SCEN = [['none', 'No drift'], ['mild', 'Mild drift'], ['severe', 'Severe drift']]

export default function Monitoring() {
  const [scenario, setScenario] = useState('mild')
  const [rep, setRep] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [sel, setSel] = useState(null)
  const file = useRef()

  const run = useCallback(async (fn) => {
    setBusy(true); setErr('')
    try { const r = await fn(); setRep(r); setSel(r.drift[0]?.feature) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }, [])
  useEffect(() => { run(() => api(`/monitoring/simulate?scenario=${scenario}`)) }, [scenario, run])

  const upload = (e) => {
    const f = e.target.files[0]; if (!f) return
    const fd = new FormData(); fd.append('file', f)
    run(() => api('/monitoring/upload', { method: 'POST', body: fd })); e.target.value = ''
  }

  const d = rep?.drift.find((x) => x.feature === sel)
  const hist = rep && (d?.type === 'numeric' ? rep.feature_histograms[sel] : d?.distribution?.map((x) => ({ bin: x.category, ...x })))
  const missing = rep?.validation.columns.map((c) => ({ feature: c.feature, current: c.missing_rate, reference: c.reference_missing_rate })).filter((c) => c.current > 0 || c.reference > 0)

  return (
    <>
      <div className="top">
        <div>
          <h1>Drift detection & data quality</h1>
          <div className="muted">Automated validation, PSI / KS / Chi² drift tests and performance-degradation checks against the training baseline</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="seg">{SCEN.map(([k, l]) => <button key={k} className={scenario === k && rep?.scenario ? 'on' : ''} onClick={() => setScenario(k)}>{l}</button>)}</div>
          <input ref={file} type="file" accept=".csv" hidden onChange={upload} />
          <button className="btn ghost" onClick={() => file.current.click()}>Upload CSV batch</button>
          <a className="btn ghost" style={{ textDecoration: 'none' }} href="/api/sample-csv?scenario=severe">Sample CSV</a>
        </div>
      </div>
      {err && <div className="err">{err}</div>}
      {busy && !rep && <div className="spin">Analysing batch…</div>}
      {rep && (
        <div style={{ opacity: busy ? 0.5 : 1 }}>
          <div className="card insight" style={{ marginBottom: 16 }}>
            <h2><Sparkles size={15} style={{ verticalAlign: -2 }} /> AI monitoring analyst <span className="muted">({rep.insight.source})</span></h2>
            <p>{rep.insight.summary.replace(/\*\*/g, '')}</p>
            <ul>{rep.insight.actions.map((a, i) => <li key={i}>{a}</li>)}</ul>
          </div>
          <div className="grid g6">
            <Kpi label="Health" value={<Pill s={rep.health}>{rep.health}</Pill>} sub={rep.scenario?.description || rep.label} />
            <Kpi label="Data quality" value={`${rep.validation.quality_score}/100`} sub={`${rep.validation.issues.length} issues`} color={rep.validation.quality_score < 70 ? C.bad : C.ok} />
            <Kpi label="Drifted features" value={`${rep.drifted_features}/${rep.drift.length}`} color={rep.drifted_features ? C.warn : C.ok} />
            <Kpi label="Prediction PSI" value={num(rep.prediction.psi, 2)} sub={`mean score ${pct(rep.prediction.mean_score)}`} />
            <Kpi label="ROC-AUC" value={rep.performance ? num(rep.performance.roc_auc) : '–'} sub={rep.degradation && `Δ ${rep.degradation.roc_auc_delta >= 0 ? '+' : ''}${num(rep.degradation.roc_auc_delta)}`} color={rep.degradation?.roc_auc_delta < -0.03 ? C.bad : undefined} />
            <Kpi label="Recall / Precision" value={rep.performance ? `${pct(rep.performance.recall, 0)} / ${pct(rep.performance.precision, 0)}` : '–'} sub={rep.performance && `Brier ${num(rep.performance.brier)}`} />
          </div>
          <div className="grid g2">
            <div className="card">
              <h2>Active alerts ({rep.alerts.length})</h2>
              <div style={{ maxHeight: 280, overflow: 'auto' }}>
                {rep.alerts.length === 0 && <div className="muted">No alerts. All checks passed.</div>}
                {rep.alerts.map((a, i) => (
                  <div className="alert-row" key={i}><Pill s={a.severity}>{a.severity}</Pill><b style={{ minWidth: 110 }}>{a.category}</b><span className="muted">{a.message}</span></div>
                ))}
              </div>
            </div>
            <Chart title="Prediction distribution" note="Reference (test set) vs. current batch scores">
              <BarChart data={rep.prediction.distribution}><CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
                <XAxis dataKey="bin" {...axis} /><YAxis {...axis} tickFormatter={(v) => pct(v, 0)} /><Tooltip {...tip} formatter={(v) => pct(v)} /><Legend />
                <Bar dataKey="reference" fill={C.muted} /><Bar dataKey="current" fill={C.brand} /></BarChart>
            </Chart>
          </div>
          <div className="grid" style={{ gridTemplateColumns: '3fr 2fr' }}>
            <div className="card">
              <h2>Feature drift <span className="muted">(click a row)</span></h2>
              <table>
                <thead><tr><th>Feature</th><th>Test</th><th>PSI</th><th>p-value</th><th>Status</th></tr></thead>
                <tbody>{rep.drift.map((x) => (
                  <tr key={x.feature} className="click" onClick={() => setSel(x.feature)} style={x.feature === sel ? { background: '#18243d' } : {}}>
                    <td>{x.feature}</td><td>{x.test}</td><td>{num(x.psi)}</td><td>{x.p_value < 0.001 ? '<0.001' : num(x.p_value)}</td><td><Pill s={x.status} /></td></tr>
                ))}</tbody>
              </table>
            </div>
            <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
              {hist && (
                <Chart title={`Distribution: ${sel}`} note="Training reference vs. current" height={210}>
                  <BarChart data={hist}><CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
                    <XAxis dataKey="bin" {...axis} /><YAxis {...axis} tickFormatter={(v) => pct(v, 0)} /><Tooltip {...tip} formatter={(v) => pct(v)} /><Legend />
                    <Bar dataKey="reference" fill={C.muted} /><Bar dataKey="current" fill={C.warn} /></BarChart>
                </Chart>
              )}
              <Chart title="Missing values by feature" height={200}>
                <BarChart data={missing}><CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
                  <XAxis dataKey="feature" {...axis} hide /><YAxis {...axis} tickFormatter={(v) => pct(v, 0)} /><Tooltip {...tip} formatter={(v) => pct(v)} /><Legend />
                  <ReferenceLine y={0.2} stroke={C.bad} strokeDasharray="4 4" />
                  <Bar dataKey="reference" fill={C.muted} /><Bar dataKey="current" fill={C.bad} /></BarChart>
              </Chart>
            </div>
          </div>
          <div className="card">
            <h2>Validation report</h2>
            {rep.validation.issues.length === 0 ? <div className="muted">No validation issues.</div> : (
              <table><thead><tr><th>Severity</th><th>Feature</th><th>Check</th><th>Details</th></tr></thead>
                <tbody>{rep.validation.issues.map((i, k) => <tr key={k}><td><Pill s={i.severity} /></td><td>{i.feature}</td><td>{i.type}</td><td>{i.message}</td></tr>)}</tbody></table>
            )}
          </div>
        </div>
      )}
    </>
  )
}
