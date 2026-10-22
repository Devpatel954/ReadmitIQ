export async function api(path, opts) {
  const r = await fetch(`/api${path}`, opts)
  if (!r.ok) {
    let msg = r.statusText
    try { msg = (await r.json()).detail || msg } catch { /* ignore */ }
    throw new Error(msg)
  }
  return r.json()
}

export const pct = (v, d = 1) => (v == null ? '–' : `${(v * 100).toFixed(d)}%`)
export const num = (v, d = 3) => (v == null ? '–' : Number(v).toFixed(d))
