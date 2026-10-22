import { useCallback, useEffect, useState } from 'react'
import { ClipboardList, ListChecks, LogOut, ShieldAlert, UserPlus } from 'lucide-react'
import { api } from './api'
import Login from './pages/Login'
import Worklist from './pages/Worklist'
import PatientDetail from './pages/PatientDetail'
import Tasks from './pages/Tasks'
import Predictor from './pages/Predictor'
import ModelHealth from './pages/ModelHealth'

const NAV = [
  ['worklist', 'Discharge worklist', ClipboardList, false],
  ['tasks', 'Care tasks', ListChecks, false],
  ['admit', 'New admission', UserPlus, false],
  ['model', 'Model health', ShieldAlert, true],
]

export default function App() {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('rq_user') || 'null'))
  const [tab, setTab] = useState('worklist')
  const [patient, setPatient] = useState(null)
  const [model, setModel] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(() => api('/model').then(setModel).catch((e) => setError(e.message)), [])
  useEffect(() => { if (user) load() }, [user, load])

  if (!user) return <Login onLogin={(u) => { localStorage.setItem('rq_user', JSON.stringify(u)); setUser(u) }} />

  const go = (t) => { setTab(t); setPatient(null) }
  const openPatient = (id) => { setTab('worklist'); setPatient(id) }
  const logout = () => { localStorage.removeItem('rq_user'); setUser(null); go('worklist') }

  return (
    <div className="app">
      <aside className="side">
        <div className="logo">🏥 ReadmitIQ</div>
        <div className="sub">Care-transition platform</div>
        {NAV.filter(([, , , admin]) => !admin || user.role === 'admin').map(([id, label, Icon, admin]) => (
          <button key={id} className={`nav ${tab === id ? 'active' : ''}`} onClick={() => go(id)}>
            <Icon size={17} /> {label}{admin && <span className="tag">admin</span>}
          </button>
        ))}
        <div className="me">
          <div className="avatar">{user.name.split(' ').map((x) => x[0]).join('')}</div>
          <div style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: 13 }}>{user.name}</b><div className="muted" style={{ fontSize: 11 }}>{user.title}</div></div>
          <button className="icon" title="Sign out" onClick={logout}><LogOut size={16} /></button>
        </div>
      </aside>
      <main className="main">
        {error && <div className="err">{error}</div>}
        {!model ? <div className="spin">Connecting to API…</div> : (
          <>
            {tab === 'worklist' && (patient ? <PatientDetail key={patient} id={patient} back={() => setPatient(null)} user={user} /> : <Worklist open={openPatient} user={user} />)}
            {tab === 'tasks' && <Tasks open={openPatient} />}
            {tab === 'admit' && <Predictor model={model} open={openPatient} />}
            {tab === 'model' && user.role === 'admin' && <ModelHealth model={model} setModel={setModel} />}
          </>
        )}
      </main>
    </div>
  )
}
