const STORAGE_KEY = 'atlas_prima_nota_backup_movements_v1'
const MAX_SNAPSHOTS = 5

function readList() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeList(list) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
}

/** @returns {{ savedAt: string, payload: object } | null} */
export function getLatestPrimaNotaBackup() {
  const list = readList()
  return list[0] ?? null
}

export function savePrimaNotaBackup(payload) {
  const list = readList()
  const entry = { savedAt: new Date().toISOString(), payload }
  list.unshift(entry)
  if (list.length > MAX_SNAPSHOTS) list.length = MAX_SNAPSHOTS
  writeList(list)
  return entry
}

export function formatPrimaNotaBackupLabel(savedAt) {
  if (!savedAt) return null
  const d = new Date(savedAt)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('it-IT', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function movementBackupKey(row) {
  const date = String(row.entry_date || '').slice(0, 10)
  return [
    date,
    row.type || '',
    Number(row.amount || 0).toFixed(2),
    String(row.description || '').trim().toLowerCase(),
    row.conto || '',
    row.activity || '',
    String(row.note || '').trim().toLowerCase(),
    String(row.riferimento_documento || '').trim().toLowerCase(),
  ].join('|')
}
