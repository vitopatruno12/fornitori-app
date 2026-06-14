const STORAGE_KEYS = {
  members: 'atlas_staff_backup_members_v1',
  planning: 'atlas_staff_backup_planning_v1',
  payroll: 'atlas_staff_backup_payroll_v1',
}

const PLANNING_SLOTS_KEY = 'atlas_staff_backup_planning_slots_v1'

const MAX_SNAPSHOTS = 5

/** Slot fissi per backup pianificazione: 1ª–4ª settimana del mese. */
export const PLANNING_WEEK_SLOT_COUNT = 4

function readList(kind) {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS[kind])
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeList(kind, list) {
  window.localStorage.setItem(STORAGE_KEYS[kind], JSON.stringify(list))
}

/** @returns {{ savedAt: string, payload: object } | null} */
export function getLatestStaffBackup(kind) {
  const list = readList(kind)
  return list[0] ?? null
}

export function saveStaffBackup(kind, payload) {
  const list = readList(kind)
  const entry = { savedAt: new Date().toISOString(), payload }
  list.unshift(entry)
  if (list.length > MAX_SNAPSHOTS) list.length = MAX_SNAPSHOTS
  writeList(kind, list)
  return entry
}

export function formatStaffBackupLabel(savedAt) {
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

function readPlanningWeekSlots() {
  try {
    const raw = window.localStorage.getItem(PLANNING_SLOTS_KEY)
    if (!raw) return Array(PLANNING_WEEK_SLOT_COUNT).fill(null)
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return Array(PLANNING_WEEK_SLOT_COUNT).fill(null)
    const out = Array(PLANNING_WEEK_SLOT_COUNT).fill(null)
    for (let i = 0; i < PLANNING_WEEK_SLOT_COUNT; i += 1) {
      out[i] = parsed[i] ?? null
    }
    return out
  } catch {
    return Array(PLANNING_WEEK_SLOT_COUNT).fill(null)
  }
}

function writePlanningWeekSlots(slots) {
  window.localStorage.setItem(
    PLANNING_SLOTS_KEY,
    JSON.stringify(slots.slice(0, PLANNING_WEEK_SLOT_COUNT)),
  )
}

/** @returns {{ savedAt: string, payload: object } | null} */
export function getPlanningWeekBackup(slotIndex) {
  const i = Number(slotIndex)
  if (!Number.isFinite(i) || i < 0 || i >= PLANNING_WEEK_SLOT_COUNT) return null
  const slots = readPlanningWeekSlots()
  return slots[i] ?? null
}

export function savePlanningWeekBackup(slotIndex, payload) {
  const i = Number(slotIndex)
  if (!Number.isFinite(i) || i < 0 || i >= PLANNING_WEEK_SLOT_COUNT) return null
  const slots = readPlanningWeekSlots()
  const entry = { savedAt: new Date().toISOString(), payload }
  slots[i] = entry
  writePlanningWeekSlots(slots)
  return entry
}

export function getPlanningWeekBackupSavedAt(slotIndex) {
  return getPlanningWeekBackup(slotIndex)?.savedAt ?? null
}
