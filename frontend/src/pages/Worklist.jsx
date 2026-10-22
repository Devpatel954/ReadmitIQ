import { useEffect, useMemo, useState } from 'react'
import { api, pct } from '../api'
import { C, Kpi, Pill } from '../components'

const tierColor = { High: C.bad, Medium: C.warn, Low: C.ok }

export default function Worklist({ open, user }) {
  const [d, setD] = useState(null)
  const [tier, setTier] = useState('All')
  const [unit, setUnit] = useState('All')
  const [q, setQ] = useState('')
  const [day, setDay] = useState('All')
  useEffect(() => { api('/census').then(setD) }, [])

  const rows = useMemo(() => d?.patients.filter((p) =>
    (tier === 'All' || p.tier === tier) && (unit === 'All' || p.unit === unit) && (day === 'All' || p.discharge === day) &&
    (!q || `${p.name} ${p.mrn} ${p.diagnosis}`.toLowerCase().includes(q.toLowerCase()))) ?? [], [d, tier, unit, q, day])

  if (!d) return <div className="spin">Loading census…</div>
  const s = d.summary
  const hour = new Date().getHours()
  return (
    <>
      <div className="top"><div>
        <h1>Good {hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}, {user.name.split(' ')[0]}</h1>
        <div className="muted">{s.discharging_today} patients are planned for discharge today. Start with the highest-risk patients.</div>
      </div></div>
      <div className="grid g4">
        <Kpi label="Inpatient census" value={s.total} sub={`${s.discharging_today} discharging today`} />
        <Kpi label="High risk" value={s.high} sub={`+ ${s.medium} medium`} color={C.bad} />
        <Kpi label="Open care tasks" value={s.open_tasks} sub="across all patients" color={C.warn} />
        <Kpi label="Expected readmissions" value={s.expected_readmissions} sub="if no intervention" />
      </div>
      <div className="card">
        <div className="toolbar">
          <input placeholder="Search name, MRN, diagnosis…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
          <div className="seg">{['All', 'High', 'Medium', 'Low'].map((t) => <button key={t} className={tier === t ? 'on' : ''} onClick={() => setTier(t)}>{t}</button>)}</div>
          <div className="seg">{['All', 'Today', 'Tomorrow'].map((t) => <button key={t} className={day === t ? 'on' : ''} onClick={() => setDay(t)}>{t === 'All' ? 'Any discharge' : t}</button>)}</div>
          <select value={unit} onChange={(e) => setUnit(e.target.value)}><option>All</option>{s.units.map((u) => <option key={u}>{u}</option>)}</select>
          <span className="muted" style={{ marginLeft: 'auto' }}>{rows.length} patients</span>
        </div>
        <table>
          <thead><tr><th>Patient</th><th>Unit / Room</th><th>Diagnosis</th><th>Discharge</th><th style={{ width: 200 }}>30-day risk</th><th>Care tasks</th><th></th></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id} className="click" onClick={() => open(p.id)}>
              <td><b>{p.name}</b><div className="muted">{Math.round(p.age)}{p.gender} · {p.mrn}</div></td>
              <td>{p.unit}<div className="muted">Rm {p.room} · {p.attending}</div></td>
              <td>{p.diagnosis}<div className="muted">LOS {p.los}d</div></td>
              <td>{p.discharge}</td>
              <td><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div className="bar" style={{ flex: 1 }}><i style={{ width: pct(p.probability, 0), background: tierColor[p.tier] }} /></div>
                <b style={{ width: 38 }}>{pct(p.probability, 0)}</b><Pill s={p.tier} /></div></td>
              <td>{p.tasks_total ? `${p.tasks_total - p.tasks_open}/${p.tasks_total} done` : '–'}</td>
              <td>{p.reviewed ? <span style={{ color: C.ok }}>✓ reviewed</span> : p.tier === 'High' ? <span style={{ color: C.warn }}>needs review</span> : ''}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>
  )
}
