import { useState } from 'react'

const USERS = [
  { name: 'Dana Whitfield', role: 'coordinator', title: 'RN Care Coordinator', desc: 'Work the discharge worklist, review risk, complete care-transition tasks.' },
  { name: 'Sam Rivera', role: 'admin', title: 'ML / Quality Lead', desc: 'Everything above plus model performance, drift and data-quality monitoring.' },
]

export default function Login({ onLogin }) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="login">
      <div className="login-card">
        <div className="logo" style={{ fontSize: 26, justifyContent: 'center' }}>🏥 ReadmitIQ</div>
        <p className="muted" style={{ textAlign: 'center', margin: '6px 0 24px' }}>
          Predict 30-day readmissions. Act before discharge. Trust the model.
        </p>
        {USERS.map((u) => (
          <button key={u.role} className="user" disabled={busy} onClick={() => { setBusy(true); setTimeout(() => onLogin(u), 300) }}>
            <div className="avatar">{u.name.split(' ').map((x) => x[0]).join('')}</div>
            <div style={{ textAlign: 'left' }}><b>{u.name}</b><div className="muted">{u.title}</div><div className="muted" style={{ fontSize: 12 }}>{u.desc}</div></div>
          </button>
        ))}
        <p className="muted" style={{ fontSize: 11, textAlign: 'center', marginTop: 18 }}>Demo environment · synthetic data · not for clinical use</p>
      </div>
    </div>
  )
}
