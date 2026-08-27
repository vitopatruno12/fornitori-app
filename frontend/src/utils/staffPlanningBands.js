import { sectionCompareKey } from './staffLocaleSections.js'

export const PULIZIE_SECTION_LABEL = 'Pulizie'

export const DEFAULT_PULIZIE_COVERAGE_BANDS = [
  { id: 'mattina', label: 'Prima parte giornata', start: '06:00', end: '12:00', target: 4 },
  { id: 'pomeriggio', label: 'Seconda parte giornata', start: '12:00', end: '18:00', target: 2 },
  { id: 'chiusura', label: 'Chiusura', start: '18:00', end: '22:00', target: 1 },
]

const STORAGE_PREFIX = 'atlasStaffPulizieBands:'

export function isPulizieSection(value) {
  return sectionCompareKey(value) === sectionCompareKey(PULIZIE_SECTION_LABEL)
}

function normalizeBand(raw, index = 0) {
  const fallback = DEFAULT_PULIZIE_COVERAGE_BANDS[index] || DEFAULT_PULIZIE_COVERAGE_BANDS[0]
  const id = String(raw?.id || fallback.id)
  const label = String(raw?.label || fallback.label).trim() || fallback.label
  const start = normalizeClock(raw?.start, fallback.start)
  const end = normalizeClock(raw?.end, fallback.end)
  const target = Math.max(0, Number(raw?.target ?? fallback.target) || 0)
  return { id, label, start, end, target }
}

function normalizeClock(value, fallback) {
  const raw = String(value || fallback || '').trim()
  const m = raw.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return fallback
  const hh = Math.min(23, Math.max(0, Number(m[1])))
  const mm = Math.min(59, Math.max(0, Number(m[2])))
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

export function normalizePulizieCoverageBands(bands) {
  const list = Array.isArray(bands) ? bands : []
  if (!list.length) return DEFAULT_PULIZIE_COVERAGE_BANDS.map((b) => ({ ...b }))
  return DEFAULT_PULIZIE_COVERAGE_BANDS.map((fallback, index) => normalizeBand(list[index] || list.find((b) => b?.id === fallback.id), index))
}

export function loadPulizieCoverageBands(localeName) {
  const key = `${STORAGE_PREFIX}${String(localeName || 'default').trim().toLowerCase()}`
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return normalizePulizieCoverageBands()
    return normalizePulizieCoverageBands(JSON.parse(raw))
  } catch {
    return normalizePulizieCoverageBands()
  }
}

export function savePulizieCoverageBands(localeName, bands) {
  const key = `${STORAGE_PREFIX}${String(localeName || 'default').trim().toLowerCase()}`
  const normalized = normalizePulizieCoverageBands(bands)
  try {
    localStorage.setItem(key, JSON.stringify(normalized))
  } catch {
    /* ignore quota */
  }
  return normalized
}

function parseClockToMinutes(value) {
  const m = String(value || '').match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

function isTimedWorkShift(shift) {
  return String(shift?.entry_kind || 'shift') === 'shift' && shift?.time_start && shift?.time_end
}

export function shiftOverlapsBand(shift, band) {
  if (!isTimedWorkShift(shift)) return false
  const start = parseClockToMinutes(shift.time_start)
  const end = parseClockToMinutes(shift.time_end)
  const bandStart = parseClockToMinutes(band.start)
  const bandEnd = parseClockToMinutes(band.end)
  if (start == null || end == null || bandStart == null || bandEnd == null) return false
  return start < bandEnd && end > bandStart
}

export function countBandAssignments(shifts, band) {
  const list = Array.isArray(shifts) ? shifts : []
  return list.filter((shift) => shiftOverlapsBand(shift, band)).length
}

export function summarizeBandCoverage(shifts, bands) {
  const normalized = normalizePulizieCoverageBands(bands)
  return normalized.map((band) => {
    const assigned = countBandAssignments(shifts, band)
    const target = Number(band.target) || 0
    return {
      ...band,
      assigned,
      target,
      ok: target <= 0 ? assigned > 0 : assigned >= target,
      gap: target > 0 ? Math.max(0, target - assigned) : 0,
    }
  })
}

/** Raggruppa turni per fascia oraria identica (utile anche fuori Pulizie). */
export function groupShiftsByExactTimeBand(shifts) {
  const list = Array.isArray(shifts) ? shifts.filter(isTimedWorkShift) : []
  const map = new Map()
  for (const shift of list) {
    const key = `${shift.time_start}-${shift.time_end}`
    if (!map.has(key)) {
      map.set(key, { start: shift.time_start, end: shift.time_end, shifts: [] })
    }
    map.get(key).push(shift)
  }
  return [...map.values()].sort((a, b) => String(a.start).localeCompare(String(b.start)))
}
