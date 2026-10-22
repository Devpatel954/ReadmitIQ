import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { api } from '../api'
import Overview from './Overview'
import Performance from './Performance'
import Monitoring from './Monitoring'

const SUB = [['overview', 'Overview'], ['performance', 'Model performance'], ['monitor', 'Drift & data quality']]

export default function ModelHealth({ model, setModel, goto }) {
  const [sub, setSub] = useState('overview')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [epoch, setEpoch] = useState(0)
  const retrain = async () => {
    setBusy(true); setErr('')
    try { setModel(await api('/retrain', { method: 'POST' })); setEpoch((e) => e + 1) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <>
      <div className="top" style={{ marginBottom: 12 }}>
        <div className="seg">{SUB.map(([k, l]) => <button key={k} className={sub === k ? 'on' : ''} onClick={() => setSub(k)}>{l}</button>)}</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span className="muted">{model.name} · {model.version}</span>
          <button className="btn ghost" disabled={busy} onClick={retrain}><RefreshCw size={13} style={{ verticalAlign: -2 }} /> {busy ? 'Training…' : 'Retrain model'}</button>
        </div>
      </div>
      {err && <div className="err">{err}</div>}
      <div key={epoch}>
        {sub === 'overview' && <Overview model={model} goto={() => setSub('monitor')} />}
        {sub === 'performance' && <Performance model={model} />}
        {sub === 'monitor' && <Monitoring />}
      </div>
    </>
  )
}
