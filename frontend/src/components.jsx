import { ResponsiveContainer } from 'recharts'

export const C = { brand: '#38bdf8', ok: '#34d399', warn: '#fbbf24', bad: '#f87171', purple: '#a78bfa', grid: '#243350', muted: '#8b9bb8' }
export const axis = { stroke: C.muted, fontSize: 11 }
export const tip = { contentStyle: { background: '#0b1220', border: '1px solid #243350', borderRadius: 8, fontSize: 12 } }

export function Kpi({ label, value, sub, color }) {
  return (
    <div className="card kpi">
      <div className="l">{label}</div>
      <div className="v" style={{ color }}>{value}</div>
      {sub && <div className="d muted">{sub}</div>}
    </div>
  )
}

export function Chart({ title, note, height = 260, children }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      {note && <div className="muted" style={{ marginTop: -8, marginBottom: 8 }}>{note}</div>}
      <ResponsiveContainer width="100%" height={height}>{children}</ResponsiveContainer>
    </div>
  )
}

export const Pill = ({ s, children }) => <span className={`pill ${s}`}>{children ?? s}</span>
