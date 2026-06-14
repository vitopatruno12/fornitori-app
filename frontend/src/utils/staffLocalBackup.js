const STORAGE_KEYS = {
  members: 'atlas_staff_backup_members_v1',
  planning: 'atlas_staff_backup_planning_v1',
  payroll: 'atlas_staff_backup_payroll_v1',
}

const PLANNING_SLOTS_KEY = 'atlas_staff_backup_planning_slots_v2'
const PLANNING_SLOTS_LEGACY_KEY = 'atlas_staff_backup_planning_slots_v1'
const MEMBERS_BY_LOCALE_KEY = 'atlas_staff_backup_members_by_locale_v1'

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

/** @returns {{ savedAt: string, payload: object }[]} */
export function listStaffBackups(kind) {
  return readList(kind)
}

/** @returns {{ savedAt: string, payload: object } | null} */
export function getStaffBackupEntry(kind, index) {
  const list = readList(kind)
  const i = Number(index)
  if (!Number.isFinite(i) || i < 0 || i >= list.length) return null
  return list[i] ?? null
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

function monthYmFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return ''
  const direct = String(payload.monthYm || '').trim()
  if (direct) return direct
  const from = String(payload.rangeFrom || '').trim()
  if (from.length >= 7) return from.slice(0, 7)
  return ''
}

function readPlanningBackupMap() {
  try {
    const raw = window.localStorage.getItem(PLANNING_SLOTS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed
      }
    }
  } catch {
    // ignore
  }

  const legacy = readPlanningWeekSlotsLegacy()
  const map = {}
  for (let i = 0; i < legacy.length; i += 1) {
    const entry = legacy[i]
    if (!entry?.payload) continue
    const ym = monthYmFromPayload(entry.payload)
    if (!ym) continue
    map[planningBackupServerKey(ym, i)] = entry
  }
  if (Object.keys(map).length) writePlanningBackupMap(map)
  return map
}

function writePlanningBackupMap(map) {
  window.localStorage.setItem(PLANNING_SLOTS_KEY, JSON.stringify(map))
}

function readPlanningWeekSlotsLegacy() {
  try {
    const raw = window.localStorage.getItem(PLANNING_SLOTS_LEGACY_KEY)
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

/** @returns {{ savedAt: string, payload: object } | null} */
export function getPlanningWeekBackup(monthYm, slotIndex) {
  const ym = String(monthYm || '').trim()
  const i = Number(slotIndex)
  if (!ym || !Number.isFinite(i) || i < 0 || i >= PLANNING_WEEK_SLOT_COUNT) return null
  const map = readPlanningBackupMap()
  const key = planningBackupServerKey(ym, i)
  if (key && map[key]) return map[key]

  const suffix = `:${i}`
  const matches = Object.entries(map).filter(([k, v]) => k.endsWith(suffix) && v?.payload)
  if (matches.length === 1) return matches[0][1]
  return null
}

export function savePlanningWeekBackup(monthYm, slotIndex, payload) {
  const ym = String(monthYm || monthYmFromPayload(payload) || '').trim()
  const i = Number(slotIndex)
  if (!ym || !Number.isFinite(i) || i < 0 || i >= PLANNING_WEEK_SLOT_COUNT) return null
  const map = readPlanningBackupMap()
  const entry = { savedAt: new Date().toISOString(), payload: { ...payload, monthYm: ym } }
  map[planningBackupServerKey(ym, i)] = entry
  writePlanningBackupMap(map)
  return entry
}

export function getPlanningWeekBackupSavedAt(monthYm, slotIndex) {
  return getPlanningWeekBackup(monthYm, slotIndex)?.savedAt ?? null
}

function normalizeMembersLocaleKey(name) {
  return String(name || '').trim()
}

function readMembersByLocaleMap() {
  try {
    const raw = window.localStorage.getItem(MEMBERS_BY_LOCALE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeMembersByLocaleMap(map) {
  window.localStorage.setItem(MEMBERS_BY_LOCALE_KEY, JSON.stringify(map))
}

/** @returns {string[]} nomi locali con almeno un backup dipendenti salvato */
export function listMembersLocaleBackupNames() {
  const map = readMembersByLocaleMap()
  return Object.keys(map)
    .filter((k) => map[k]?.payload?.members?.length)
    .sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }))
}

/** @returns {{ savedAt: string, payload: object } | null} */
export function getMembersLocaleBackup(localeName) {
  const key = normalizeMembersLocaleKey(localeName)
  if (!key) return null
  const map = readMembersByLocaleMap()
  return map[key] ?? null
}

export function saveMembersLocaleBackup(localeName, payload) {
  const key = normalizeMembersLocaleKey(localeName)
  if (!key) return null
  const map = readMembersByLocaleMap()
  const entry = {
    savedAt: new Date().toISOString(),
    payload: { ...payload, localeName: key },
  }
  map[key] = entry
  writeMembersByLocaleMap(map)
  return entry
}

export function getMembersLocaleBackupSavedAt(localeName) {
  return getMembersLocaleBackup(localeName)?.savedAt ?? null
}

export function deleteMembersLocaleBackup(localeName) {
  const key = normalizeMembersLocaleKey(localeName)
  if (!key) return false
  const map = readMembersByLocaleMap()
  if (!(key in map)) return false
  delete map[key]
  writeMembersByLocaleMap(map)
  return true
}

/** Chiave server per backup pianificazione: mese + slot settimana (0–3). */
export function planningBackupServerKey(monthYm, slotIndex) {
  const ym = String(monthYm || '').trim()
  const slot = Number(slotIndex)
  if (!ym || !Number.isFinite(slot)) return ''
  return `${ym}:${slot}`
}
