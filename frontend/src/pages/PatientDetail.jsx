import { useCallback, useEffect, useState } from 'react'
import { Bar, BarChart, Cell, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowLeft, Sparkles } from 'lucide-react'
import { api, pct } from '../api'
import { C, Chart, Pill, axis, tip } from '../components'

const post = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })
const tierColor = { High: C.bad, Medium: C.warn, Low: C.ok }

function WhatIf({ p }) {
  const f = p.features
  const [v, setV] = useState({ num_medications: f.num_medications, time_in_hospital: f.time_in_hospital, discharge_disposition: f.discharge_disposition, a1c_result: f.a1c_result })
  const [r, setR] = useState(null)
  const dirty = Object.keys(v).some((k) => v[k] !== f[k])
  useEffect(() => {
    if (!dirty) { setR(null); return }
    const t = setTimeout(() => post('/predict', { ...f, ...v }).then(setR), 200)
    return () => clearTimeout(t)
  }, [v]) // eslint-disable-line
  const delta = r ? r.probability - p.probability : 0
  return (
    <div className="card">
      <h2>What-if simulator</h2>
      <div className="muted" style={{ marginBottom: 10 }}>Test how changing the discharge plan or medication load would move this patient's risk.</div>
      <div className="form">
        <label>Medications<input type="number" value={v.num_medications} onChange={(e) => setV({ ...v, num_medications: Number(e.target.value) })} /></label>
        <label>Days in hospital<input type="number" value={v.time_in_hospital} onChange={(e) => setV({ ...v, time_in_hospital: Number(e.target.value) })} /></label>
        <label>Discharge to<select value={v.discharge_disposition} onChange={(e) => setV({ ...v, discharge_disposition: e.target.value })}>{['Home', 'Home Health', 'SNF', 'Rehab', 'AMA'].map((o) => <option key={o}>{o}</option>)}</select></label>
        <label>A1c result<select value={v.a1c_result} onChange={(e) => setV({ ...v, a1c_result: e.target.value })}>{['Normal', '>7', '>8', 'Not tested'].map((o) => <option key={o}>{o}</option>)}</select></label>
      </div>
      {r && <div style={{ marginTop: 12, fontSize: 15 }}>Risk {pct(p.probability, 0)} → <b style={{ color: tierColor[r.tier] }}>{pct(r.probability, 0)}</b>{' '}
        <span style={{ color: delta <= 0 ? C.ok : C.bad }}>({delta > 0 ? '+' : ''}{(delta * 100).toFixed(1)} pts)</span></div>}
    </div>
  )
}

export default function PatientDetail({ id, back, user }) {
  const [p, setP] = useState(null)
  const [task, setTask] = useState('')
  const [note, setNote] = useState('')
  const load = useCallback(() => api(`/patients/${id}`).then(setP), [id])
  useEffect(() => { load() }, [load])
  if (!p) return <div className="spin">Loading patient…</div>
  const f = p.features
  const done = p.tasks.filter((t) => t.status === 'done').length
  const upd = (patch) => setP((x) => ({ ...x, ...patch }))

  return (
    <>
      <button className="btn ghost" onClick={back} style={{ marginBottom: 14 }}><ArrowLeft size={14} style={{ verticalAlign: -2 }} /> Worklist</button>
      <div className="top">
        <div>
          <h1>{p.name} <Pill s={p.tier}>{p.tier} risk</Pill></h1>
          <div className="muted">{Math.round(f.age)}{f.gender} · {p.mrn} · {p.unit} Rm {p.room} · {p.attending} · {f.insurance} · Discharge {p.discharge.toLowerCase()} to {f.discharge_disposition}</div>
        </div>
        <button className={`btn ${p.reviewed ? 'ghost' : ''}`} onClick={async () => upd({ reviewed: (await post(`/patients/${id}/review`)).reviewed })}>
          {p.reviewed ? '✓ Reviewed (undo)' : 'Mark risk reviewed'}</button>
      </div>
      <div className="grid" style={{ gridTemplateColumns: '2fr 3fr' }}>
        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <div className="card" style={{ textAlign: 'center' }}>
            <div className="muted">30-day readmission risk</div>
            <div className="gauge" style={{ color: tierColor[p.tier] }}>{pct(p.probability, 0)}</div>
            <div className="bar"><i style={{ width: pct(p.probability, 0), background: tierColor[p.tier] }} /></div>
            <div className="muted" style={{ marginTop: 6 }}>Population average {pct(p.baseline_rate, 0)} · flag threshold {pct(p.threshold, 0)}</div>
          </div>
          <Chart title="Why this risk?" note="Red raises risk, green lowers it vs. an average patient" height={220}>
            <BarChart layout="vertical" data={p.drivers.map((d) => ({ ...d, name: `${d.feature.replace(/_/g, ' ')} = ${d.value}` }))} margin={{ left: 40 }}>
              <XAxis type="number" {...axis} tickFormatter={(v) => pct(v, 0)} /><YAxis type="category" dataKey="name" {...axis} width={150} />
              <Tooltip {...tip} formatter={(v) => pct(v)} /><ReferenceLine x={0} stroke={C.muted} />
              <Bar dataKey="impact" radius={3}>{p.drivers.map((d, i) => <Cell key={i} fill={d.impact > 0 ? C.bad : C.ok} />)}</Bar>
            </BarChart>
          </Chart>
          <WhatIf p={p} />
        </div>
        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <div className="card insight">
            <h2><Sparkles size={15} style={{ verticalAlign: -2 }} /> AI discharge brief <span className="muted">({p.brief.source})</span></h2>
            <p>{p.brief.summary}</p>
            {p.brief.focus.length > 0 && <ul>{p.brief.focus.map((x, i) => <li key={i}>{x}</li>)}</ul>}
          </div>
          <div className="card">
            <h2>Care-transition plan <span className="muted">{done}/{p.tasks.length} complete</span></h2>
            <div className="bar" style={{ marginBottom: 10 }}><i style={{ width: p.tasks.length ? `${(done / p.tasks.length) * 100}%` : 0, background: C.ok }} /></div>
            {p.tasks.length === 0 && <div className="muted">Low risk. No special interventions required. Standard discharge instructions apply.</div>}
            {p.tasks.map((t) => (
              <label key={t.id} className={`task ${t.status}`}>
                <input type="checkbox" checked={t.status === 'done'} onChange={async (e) => upd({ tasks: await post(`/patients/${id}/tasks/${t.id}`, { status: e.target.checked ? 'done' : 'open' }) })} />
                <div style={{ flex: 1 }}><div className="t">{t.text}</div><div className="muted" style={{ fontSize: 12 }}>{t.reason} · {t.owner} · due {t.due}</div></div>
              </label>
            ))}
            <form className="inline" onSubmit={async (e) => { e.preventDefault(); if (!task.trim()) return; upd({ tasks: await post(`/patients/${id}/tasks`, { text: task }) }); setTask('') }}>
              <input placeholder="Add a task…" value={task} onChange={(e) => setTask(e.target.value)} style={{ flex: 1 }} /><button className="btn">Add</button>
            </form>
          </div>
          <div className="card">
            <h2>Clinical notes</h2>
            <form className="inline" onSubmit={async (e) => { e.preventDefault(); if (!note.trim()) return; upd({ notes: await post(`/patients/${id}/notes`, { text: note, author: user.name }) }); setNote('') }}>
              <input placeholder="Write a note (e.g. spoke with daughter, scheduled PCP)…" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1 }} /><button className="btn">Save</button>
            </form>
            {p.notes.length === 0 && <div className="muted" style={{ marginTop: 10 }}>No notes yet.</div>}
            {p.notes.map((n, i) => <div key={i} className="note"><div className="muted" style={{ fontSize: 12 }}>{n.author} · {n.at}</div>{n.text}</div>)}
          </div>
        </div>
      </div>
    </>
  )
}
