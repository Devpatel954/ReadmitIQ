import { useEffect, useState } from 'react'
import { api } from '../api'
import { Pill } from '../components'

export default function Tasks({ open }) {
  const [tasks, setTasks] = useState(null)
  const [show, setShow] = useState('open')
  const [owner, setOwner] = useState('All')
  const load = () => api('/tasks').then(setTasks)
  useEffect(() => { load() }, [])
  if (!tasks) return <div className="spin">Loading tasks…</div>
  const owners = ['All', ...new Set(tasks.map((t) => t.owner))]
  const rows = tasks.filter((t) => (show === 'all' || t.status === show) && (owner === 'All' || t.owner === owner))
  const toggle = async (t) => {
    await api(`/patients/${t.patient_id}/tasks/${t.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: t.status === 'open' ? 'done' : 'open' }) })
    load()
  }
  return (
    <>
      <div className="top"><div><h1>Care tasks</h1><div className="muted">All interventions across patients, highest-risk first.</div></div></div>
      <div className="card">
        <div className="toolbar">
          <div className="seg">{[['open', 'Open'], ['done', 'Done'], ['all', 'All']].map(([k, l]) => <button key={k} className={show === k ? 'on' : ''} onClick={() => setShow(k)}>{l}</button>)}</div>
          <select value={owner} onChange={(e) => setOwner(e.target.value)}>{owners.map((o) => <option key={o}>{o}</option>)}</select>
          <span className="muted" style={{ marginLeft: 'auto' }}>{rows.length} tasks</span>
        </div>
        <table>
          <thead><tr><th style={{ width: 30 }}></th><th>Task</th><th>Patient</th><th>Risk</th><th>Owner</th><th>Due</th></tr></thead>
          <tbody>{rows.map((t) => (
            <tr key={t.id} style={{ opacity: t.status === 'done' ? 0.5 : 1 }}>
              <td><input type="checkbox" checked={t.status === 'done'} onChange={() => toggle(t)} /></td>
              <td style={{ textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>{t.text}</td>
              <td><a className="link" onClick={() => open(t.patient_id)}>{t.patient}</a><div className="muted">{t.unit}</div></td>
              <td><Pill s={t.tier} /></td><td>{t.owner}</td><td>{t.due}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>
  )
}
