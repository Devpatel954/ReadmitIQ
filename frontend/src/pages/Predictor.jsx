import { useEffect, useState } from 'react'
import { Bar, BarChart, Cell, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts'
import { api, pct } from '../api'
import { C, Chart, Pill, axis, tip } from '../components'

const NUMERIC = [
  ['age', 'Age'], ['time_in_hospital', 'Days in hospital'], ['num_lab_procedures', 'Lab procedures'],
  ['num_medications', 'Medications'], ['num_diagnoses', 'Diagnoses'], ['prior_inpatient_visits', 'Prior inpatient visits'],
  ['prior_er_visits', 'Prior ER visits'], ['creatinine', 'Creatinine'], ['bmi', 'BMI'], ['systolic_bp', 'Systolic BP'],
]
const CATS = [
  ['gender', 'Gender'], ['insurance', 'Insurance'], ['admission_type', 'Admission type'],
  ['primary_diagnosis', 'Primary diagnosis'], ['discharge_disposition', 'Discharge'], ['a1c_result', 'A1c result'],
]
const PRESETS = {
  'Typical elderly cardiac': {},
  'Low-risk young elective': { age: 34, admission_type: 'Elective', primary_diagnosis: 'Injury', time_in_hospital: 2, num_medications: 5, prior_inpatient_visits: 0, prior_er_visits: 0, creatinine: 0.9, discharge_disposition: 'Home', a1c_result: 'Normal', insurance: 'Private', systolic_bp: 120 },
  'Very high-risk': { age: 82, time_in_hospital: 11, num_medications: 32, num_diagnoses: 12, prior_inpatient_visits: 5, prior_er_visits: 3, creatinine: 3.2, discharge_disposition: 'AMA' },
}
const DEFAULT = { age: 70, gender: 'F', insurance: 'Medicare', admission_type: 'Emergency', primary_diagnosis: 'Circulatory', discharge_disposition: 'Home', a1c_result: '>8', time_in_hospital: 6, num_lab_procedures: 50, num_medications: 18, num_diagnoses: 8, prior_inpatient_visits: 2, prior_er_visits: 1, creatinine: 1.6, bmi: 31, systolic_bp: 140 }

export default function Predictor({ model, open }) {
  const [schema, setSchema] = useState(null)
  const [p, setP] = useState(DEFAULT)
  const [name, setName] = useState('')
  const [res, setRes] = useState(null)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  const body = () => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v === '' ? null : v]))
  const admit = async () => {
    setSaving(true)
    try {
      const r = await api('/patients', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name || 'New Patient', features: body() }) })
      open(r.id)
    } catch (e) { setErr(e.message); setSaving(false) }
  }

  useEffect(() => { api('/schema').then(setSchema) }, [])
  useEffect(() => {
    const t = setTimeout(() => {
      api('/predict', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body()) })
        .then((r) => { setRes(r); setErr('') }).catch((e) => setErr(e.message))
    }, 250)
    return () => clearTimeout(t)
  }, [p, model.version])

  if (!schema) return <div className="spin">Loading…</div>
  const set = (k, num) => (e) => setP({ ...p, [k]: num ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value })
  const tierColor = res ? { High: C.bad, Medium: C.warn, Low: C.ok }[res.tier] : C.muted

  return (
    <>
      <div className="top"><div>
        <h1>New admission assessment</h1>
        <div className="muted">Enter an admitted patient's details to get an instant risk score, then add them to the census with a generated care plan.</div>
      </div>
        <div className="seg">{Object.keys(PRESETS).map((k) => (
          <button key={k} onClick={() => setP({ ...DEFAULT, ...PRESETS[k] })}>{k}</button>))}</div>
      </div>
      {err && <div className="err">{err}</div>}
      <div className="grid" style={{ gridTemplateColumns: '3fr 2fr' }}>
        <div className="card">
          <h2>Encounter details</h2>
          <div className="form" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <label style={{ gridColumn: '1 / -1' }}>Patient name<input placeholder="e.g. Jane Doe" value={name} onChange={(e) => setName(e.target.value)} /></label>
            {CATS.map(([k, l]) => (
              <label key={k}>{l}<select value={p[k]} onChange={set(k)}>{schema.categories[k].map((o) => <option key={o}>{o}</option>)}</select></label>
            ))}
            {NUMERIC.map(([k, l]) => (
              <label key={k}>{l}<input type="number" step="any" value={p[k] ?? ''} onChange={set(k, true)} /></label>
            ))}
          </div>
        </div>
        <div>
          {res && (
            <>
              <div className="card" style={{ textAlign: 'center', marginBottom: 16 }}>
                <div className="muted">Predicted 30-day readmission risk</div>
                <div className="gauge" style={{ color: tierColor }}>{pct(res.probability, 0)}</div>
                <Pill s={res.tier}>{res.tier} risk</Pill>
                <div className="bar" style={{ margin: '14px 0 6px' }}><i style={{ width: pct(res.probability, 0), background: tierColor }} /></div>
                <div className="muted">Population rate {pct(res.baseline_rate, 0)} · flag threshold {pct(res.threshold, 0)} ·{' '}
                  {res.flagged ? <b style={{ color: C.bad }}>flag for care-transition follow-up</b> : 'no action flag'}</div>
                <button className="btn" style={{ width: '100%', marginTop: 12 }} disabled={saving} onClick={admit}>{saving ? 'Adding…' : 'Add to census & open care plan →'}</button>
              </div>
              <Chart title="Why this score?" note="Change in risk vs. an average patient (red ↑ risk, green ↓ risk)" height={230}>
                <BarChart layout="vertical" data={res.drivers.map((d) => ({ ...d, name: `${d.feature} = ${d.value}` }))} margin={{ left: 70 }}>
                  <XAxis type="number" {...axis} tickFormatter={(v) => pct(v, 0)} /><YAxis type="category" dataKey="name" {...axis} width={150} />
                  <Tooltip {...tip} formatter={(v) => pct(v)} /><ReferenceLine x={0} stroke={C.muted} />
                  <Bar dataKey="impact" radius={3}>{res.drivers.map((d, i) => <Cell key={i} fill={d.impact > 0 ? C.bad : C.ok} />)}</Bar>
                </BarChart>
              </Chart>
            </>
          )}
        </div>
      </div>
    </>
  )
}
