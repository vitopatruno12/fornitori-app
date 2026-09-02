import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchStaffMembers,
  fetchStaffShifts,
  createStaffMember,
  updateStaffMember,
  deleteStaffMember,
  deleteAllStaffMembers,
  createStaffShift,
  updateStaffShift,
  deleteStaffShift,
  deleteStaffShiftsBulk,
  fetchStaffPayrollMonths,
  fetchStaffLocalePacks,
  fetchStaffLocalePack,
  upsertStaffLocalePack,
  fetchStaffBackupDetail,
  fetchStaffBackupSavedAt,
  fetchStaffBackups,
  upsertStaffBackup,
  deleteStaffLocalePack,
} from '../services/staffService'
import { fetchPrimaNotaLocalePacks } from '../services/cashService'
import WeeklyStaffReportModal from '../components/WeeklyStaffReportModal.jsx'
import StaffMemberInfoModal from '../components/StaffMemberInfoModal.jsx'
import StaffPayrollDaysModal from '../components/StaffPayrollDaysModal.jsx'
import StaffPayrollMonthPanel from '../components/StaffPayrollMonthPanel.jsx'
import StaffSectionBackupBar from '../components/StaffSectionBackupBar.jsx'
import GeminiVoiceAssistant from '../components/GeminiVoiceAssistant.jsx'
import { AnalisiLoadingBar } from '../components/AnalisiShared.jsx'
import { suggestStaffShift } from '../services/aiService'
import { aggregateMemberWorkedDays, aggregateWeeklyStaffStats } from '../utils/staffWeeklyReport.js'
import {
  formatStaffBackupLabel,
  getLatestStaffBackup,
  listStaffBackups,
  getStaffBackupEntry,
  getMembersLocaleBackupSavedAt,
  getMembersLocaleBackup,
  getPlanningWeekBackup,
  getPlanningWeekBackupSavedAt,
  listMembersLocaleBackupNames,
  deleteMembersLocaleBackup,
  saveMembersLocaleBackup,
  savePlanningWeekBackup,
  saveStaffBackup,
  planningBackupServerKey,
  payrollBackupServerKey,
  operatorStaffBackupScope,
  staffBackupKeyMatchesScope,
  unscopedStaffBackupKey,
  pickNewestSavedAt,
} from '../utils/staffLocalBackup.js'
import {
  readStaffLocaleStore,
  writeStaffLocaleStore,
  removeStaffLocaleFromStore,
  upsertStoredLocaleAccessCode,
} from '../utils/staffLocaleStore.js'
import { validateLocalePackUniqueness } from '../utils/staffLocaleUniqueness.js'
import {
  CORE_PLANNING_SECTIONS,
  defaultSectionsForLocale,
  isPlanningSectionHidden,
  mergeHiddenPlanningSections,
  memberMatchesSection,
  normalizeSectionName,
  resolveLocaleSections,
  sectionCompareKey,
} from '../utils/staffLocaleSections.js'
import {
  generateLocaleAccessCode,
  isValidLocaleAccessCode,
  normalizeLocaleAccessCode,
  verifyLocaleAccessCode,
} from '../utils/staffLocaleAccessCode.js'
import { DEFAULT_PRIMA_NOTA_STAFF_LOCALE_LINKS } from '../utils/primaNotaStaffLocaleLink.js'
import { getOperatorStationStaffLocaleName, getOperatorStationActivitySlug, operatorStationLocaleNameMatches } from '../utils/operatorStationLocale.js'
import {
  findLocalePackInStore,
  membersFromPackAndDb,
  writeOperatorLocalePackMembers,
} from '../utils/operatorLocalePack.js'
import { matchStaffLocaleName, staffLocaleCompareKey } from '../utils/primaNotaStaffLocaleLink.js'
import {
  closeOtherOperatorStationStaffSessions,
  isOperatorStationStaffSessionOpen,
  setOperatorStationStaffSession,
} from '../utils/operatorStationStaffSession.js'
import { getLockedOperatorStationId } from '../utils/operatorMode.ts'
import {
  fetchOperatorStationShifts,
  invalidateOperatorStationMembersCache,
} from '../utils/operatorStaffReportData.js'
import { isOnline } from '../offline/offlineStatus'
import { patchCachedListsForDelete } from '../offline/offlineCache'
import {
  STAFF_MEMBERS_COLUMNS,
  STAFF_MEMBERS_WORKBOOK_TITLE,
  staffMemberCellValue,
  staffMembersTotalsLabel,
} from '../utils/staffMembersWorkbook.js'
import {
  STAFF_PAYROLL_COLUMNS,
  STAFF_PAYROLL_WORKBOOK_TITLE,
  staffPayrollCellValue,
  staffPayrollTotals,
  staffPayrollTotalsLabel,
} from '../utils/staffPayrollWorkbook.js'

const DAY_HEADERS = ['DOMENICA', 'LUNEDÌ', 'MARTEDÌ', 'MERCOLEDÌ', 'GIOVEDÌ', 'VENERDÌ', 'SABATO']
const HIDDEN_PLANNING_SECTIONS = ['Pulizie', 'Mediazione']
const STAFF_LOCALE_SESSION_KEY = 'staffLocaleSessionOpen'

function readStaffLocaleSessionOpenKeys() {
  try {
    const raw = sessionStorage.getItem(STAFF_LOCALE_SESSION_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((k) => String(k || '').trim().toLocaleLowerCase('it')).filter(Boolean)
  } catch {
    return []
  }
}

function writeStaffLocaleSessionOpenKeys(keys) {
  try {
    const unique = [...new Set((keys || []).map((k) => String(k || '').trim().toLocaleLowerCase('it')).filter(Boolean))]
    sessionStorage.setItem(STAFF_LOCALE_SESSION_KEY, JSON.stringify(unique))
  } catch {
    // ignore
  }
}

function formatEurAmount(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n)
}

function formatHoursDecimal(h) {
  if (h == null || !Number.isFinite(h) || h <= 0) return ''
  if (Math.abs(h - Math.round(h)) < 0.001) return String(Math.round(h))
  return h.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function parseDecimalInput(raw) {
  const s = String(raw ?? '').trim().replace(',', '.')
  if (!s) return 0
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}


const KIND_LABELS = {
  shift: 'Turno',
  permission: 'Permesso',
  absence: 'Assenza',
  sick: 'Malattia',
  ferie: 'Ferie',
  riposo: 'Riposo',
}

const ALL_DAY_ENTRY_KINDS = ['absence', 'sick', 'ferie', 'riposo']
const ENTRY_KIND_VALUES = ['shift', 'permission', ...ALL_DAY_ENTRY_KINDS]

function isAllDayKind(kind) {
  return ALL_DAY_ENTRY_KINDS.includes(String(kind || ''))
}

/** Giorni della settimana (lun–dom) rispetto a weekAnchor (lunedì). */
const WEEK_LOAD_DAY_OPTIONS = [
  { offset: 0, label: 'Lunedì' },
  { offset: 1, label: 'Martedì' },
  { offset: 2, label: 'Mercoledì' },
  { offset: 3, label: 'Giovedì' },
  { offset: 4, label: 'Venerdì' },
  { offset: 5, label: 'Sabato' },
  { offset: 6, label: 'Domenica' },
]

/** Offset 0–6 (lun–dom) del giorno rispetto al lunedì della sua settimana. */
function weekDayOffsetFromDate(d) {
  const monday = startOfWeekMonday(d)
  const picked = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diff = Math.round((picked.getTime() - monday.getTime()) / 86400000)
  return Math.max(0, Math.min(6, diff))
}

function weekLoadDaysForSingleDate(d) {
  return new Set([weekDayOffsetFromDate(d)])
}

const PLANNING_BACKUP_SLOT_LABELS = ['1ª settimana', '2ª settimana', '3ª settimana', '4ª settimana']

function formatShortItDate(ymd) {
  const d = parseYMD(ymd)
  if (Number.isNaN(d.getTime())) return ymd
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
}

/** Le 4 settimane (lun–dom) del mese di riferimento per i backup pianificazione. */
function planningMonthWeekSlots(referenceDate) {
  const ref = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate())
  const y = ref.getFullYear()
  const m = ref.getMonth()
  const lastDay = new Date(y, m + 1, 0)
  let mon = startOfWeekMonday(new Date(y, m, 1))
  const weeks = []
  const seen = new Set()

  while (weeks.length < PLANNING_BACKUP_SLOT_LABELS.length) {
    const fromStr = toYMD(mon)
    if (!seen.has(fromStr)) {
      weeks.push({
        slotIndex: weeks.length,
        anchor: new Date(mon.getFullYear(), mon.getMonth(), mon.getDate()),
        fromStr,
        toStr: toYMD(addDays(mon, 6)),
      })
      seen.add(fromStr)
    }
    mon = addDays(mon, 7)
    if (mon > addDays(lastDay, 7) && weeks.length > 0) break
  }

  while (weeks.length < PLANNING_BACKUP_SLOT_LABELS.length) {
    const prev = weeks[weeks.length - 1]
    const next = addDays(prev.anchor, 7)
    weeks.push({
      slotIndex: weeks.length,
      anchor: new Date(next.getFullYear(), next.getMonth(), next.getDate()),
      fromStr: toYMD(next),
      toStr: toYMD(addDays(next, 6)),
    })
  }

  return weeks
}

function findPlanningBackupSlotForAnchor(anchor, weeks) {
  const a = toYMD(startOfWeekMonday(anchor))
  const idx = weeks.findIndex((w) => w.fromStr === a)
  return idx >= 0 ? idx : 0
}

function StaffActionDropdown({
  label,
  className = 'btn btn-secondary btn-sm',
  disabled = false,
  open,
  onOpenChange,
  items = [],
  title,
}) {
  const rootRef = React.useRef(null)

  useEffect(() => {
    if (!open) return undefined
    function onDocClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) onOpenChange(false)
    }
    document.addEventListener('pointerdown', onDocClick)
    return () => document.removeEventListener('pointerdown', onDocClick)
  }, [open, onOpenChange])

  return (
    <div className={`staff-action-dropdown${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className={className}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        title={title}
        onClick={() => onOpenChange(!open)}
      >
        <span>{label}</span>
        <span className="staff-action-dropdown-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div className="staff-action-dropdown-menu" role="menu">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={`staff-action-dropdown-item${item.active ? ' is-active' : ''}`}
              disabled={disabled || item.disabled}
              onClick={() => {
                onOpenChange(false)
                item.onClick?.()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function groupShiftsByDate(shiftList) {
  const m = new Map()
  for (const s of shiftList || []) {
    const key = shiftWorkDateKey(s.work_date)
    if (!key) continue
    if (!m.has(key)) m.set(key, [])
    m.get(key).push(s)
  }
  for (const arr of m.values()) {
    arr.sort((a, b) => (a.staff_member_name || '').localeCompare(b.staff_member_name || '', 'it'))
  }
  return m
}

function shiftBelongsToSection(shift, sectionName, members, sectionsList) {
  if (!sectionName) return true
  const member = (members || []).find((m) => Number(m.id) === Number(shift?.staff_member_id))
  if (member) return memberMatchesSection(member, sectionName, sectionsList)
  return false
}

function StaffCheckboxDropdown({
  label,
  hideLabel,
  triggerLabel,
  open,
  onOpenChange,
  disabled,
  showSelectAll,
  selectAllRef,
  allSelected,
  onToggleAll,
  selectAllDisabled,
  menuAriaLabel,
  emptyMessage,
  children,
}) {
  const rootRef = React.useRef(null)

  useEffect(() => {
    if (!open) return undefined
    function onDocClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) onOpenChange(false)
    }
    document.addEventListener('pointerdown', onDocClick)
    return () => document.removeEventListener('pointerdown', onDocClick)
  }, [open, onOpenChange])

  return (
    <div className={`staff-check-dropdown${open ? ' is-open' : ''}`} ref={rootRef}>
      {!hideLabel && label ? <span className="staff-shift-select-label">{label}</span> : null}
      <button
        type="button"
        className="form-control staff-check-dropdown-trigger"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => onOpenChange(!open)}
      >
        <span className="staff-check-dropdown-trigger-text">{triggerLabel}</span>
        <span className="staff-check-dropdown-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div className="staff-check-dropdown-menu" role="listbox" aria-label={menuAriaLabel} aria-multiselectable="true">
          {showSelectAll ? (
            <label className="staff-shift-member-option staff-shift-member-option--all">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allSelected}
                disabled={selectAllDisabled}
                onChange={onToggleAll}
              />
              <span>Tutti</span>
            </label>
          ) : null}
          {emptyMessage ? <span className="staff-shift-members-empty">{emptyMessage}</span> : null}
          {children}
        </div>
      ) : null}
    </div>
  )
}

/** Lunedi come primo giorno della settimana (indice getDay: dom=0 ... sab=6). */
function startOfWeekMonday(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dow = x.getDay()
  const delta = dow === 0 ? -6 : 1 - dow
  x.setDate(x.getDate() + delta)
  return x
}

function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
  return x
}

function toYMD(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function currentPayrollYm() {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
}

function monthBoundsFromYm(ym) {
  const [y, m] = String(ym || '').split('-').map(Number)
  if (!y || !m) {
    const t = todayDate()
    return { fromStr: toYMD(t), toStr: toYMD(t) }
  }
  const from = new Date(y, m - 1, 1)
  const to = new Date(y, m, 0)
  return { fromStr: toYMD(from), toStr: toYMD(to) }
}

function formatMonthYmIt(ym) {
  const [y, m] = String(ym || '').split('-').map(Number)
  if (!y || !m) return String(ym || 'Backup')
  return new Date(y, m - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })
}

function parseYMD(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function fmtTime(t) {
  if (!t) return ''
  const s = String(t).slice(0, 8)
  const [h, min] = s.split(':')
  if (h == null) return ''
  return `${parseInt(h, 10)}:${(min || '00').padStart(2, '0')}`
}

function shiftWorkDateKey(value) {
  if (!value) return ''
  if (typeof value === 'string') return value.slice(0, 10)
  if (value instanceof Date && !Number.isNaN(value.getTime())) return toYMD(value)
  return String(value).slice(0, 10)
}

function normalizeShiftRows(rows, membersList) {
  const list = Array.isArray(rows) ? rows : []
  const nameById = Object.fromEntries(
    (membersList || []).map((m) => [Number(m.id), m.name || '']).filter(([id]) => Number.isFinite(id)),
  )
  return list.map((s) => {
    const sid = Number(s.staff_member_id)
    return {
      ...s,
      work_date: shiftWorkDateKey(s.work_date),
      staff_member_id: sid,
      staff_member_name: s.staff_member_name || nameById[sid] || '',
    }
  })
}

function shiftEntryMatches(s, staffId, ymd, kind, timeStart, timeEnd) {
  if (Number(s.staff_member_id) !== Number(staffId)) return false
  if (shiftWorkDateKey(s.work_date) !== shiftWorkDateKey(ymd)) return false
  const entryKind = kind || 'shift'
  if ((s.entry_kind || 'shift') !== entryKind) return false
  if (entryKind === 'shift' || entryKind === 'permission') {
    return fmtTime(s.time_start) === fmtTime(timeStart) && fmtTime(s.time_end) === fmtTime(timeEnd)
  }
  return true
}

function planningRangeFromBackup(fromStr, toStr, planView) {
  const fromD = parseYMD(fromStr)
  const toD = parseYMD(toStr)
  const view = planView || 'week'
  if (view === 'day') {
    return { view, start: fromD, end: fromD, dayFocus: fromD }
  }
  if (view === 'period') {
    return { view, start: fromD, end: toD, periodFrom: fromD, periodTo: toD }
  }
  const anchor = startOfWeekMonday(fromD)
  return { view: 'week', start: anchor, end: addDays(anchor, 6), weekAnchor: anchor }
}

function addDaysToYmd(ymd, days) {
  const d = parseYMD(ymd)
  if (Number.isNaN(d.getTime())) return ymd
  return toYMD(addDays(d, days))
}

const PLANNING_CLIPBOARD_LS = 'atlas_planning_clipboard_v1'

/** Periodo attualmente visibile in base alla vista planning. */
function computeVisiblePlanningRange(planView, weekAnchor, dayFocus, periodFrom, periodTo) {
  let start
  let end
  if (planView === 'week') {
    start = new Date(weekAnchor.getFullYear(), weekAnchor.getMonth(), weekAnchor.getDate())
    end = addDays(start, 6)
  } else if (planView === 'day') {
    start = new Date(dayFocus.getFullYear(), dayFocus.getMonth(), dayFocus.getDate())
    end = start
  } else {
    const fa = toYMD(periodFrom)
    const fb = toYMD(periodTo)
    start =
      fa <= fb
        ? new Date(periodFrom.getFullYear(), periodFrom.getMonth(), periodFrom.getDate())
        : new Date(periodTo.getFullYear(), periodTo.getMonth(), periodTo.getDate())
    end =
      fa <= fb
        ? new Date(periodTo.getFullYear(), periodTo.getMonth(), periodTo.getDate())
        : new Date(periodFrom.getFullYear(), periodFrom.getMonth(), periodFrom.getDate())
  }
  const fromStr = toYMD(start)
  const toStr = toYMD(end)
  return { start, end, fromStr, toStr, dayCount: daysInclusiveCount(start, end) }
}

function dayOffsetFromRangeStart(fromYmd, workYmd) {
  const from = parseYMD(fromYmd)
  const d = parseYMD(workYmd)
  if (Number.isNaN(from.getTime()) || Number.isNaN(d.getTime())) return 0
  return Math.round((d.getTime() - from.getTime()) / 86400000)
}

function readPlanningClipboard() {
  try {
    const raw = localStorage.getItem(PLANNING_CLIPBOARD_LS)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.sourceFromStr || !Array.isArray(parsed.shifts)) return null
    return parsed
  } catch {
    return null
  }
}

function writePlanningClipboard(pack) {
  try {
    if (pack) localStorage.setItem(PLANNING_CLIPBOARD_LS, JSON.stringify(pack))
    else localStorage.removeItem(PLANNING_CLIPBOARD_LS)
  } catch {
    // ignore
  }
}

function buildPlanningClipboardPack(planView, sourceFromStr, sourceToStr, dayCount, sourceShifts) {
  return {
    planView,
    sourceFromStr,
    sourceToStr,
    dayCount,
    copiedAt: new Date().toISOString(),
    shifts: sourceShifts.map((row) => ({
      staff_member_id: Number(row.staff_member_id) || null,
      staff_member_name: String(row.staff_member_name || ''),
      work_date: shiftWorkDateKey(row.work_date),
      dayOffset: dayOffsetFromRangeStart(sourceFromStr, shiftWorkDateKey(row.work_date)),
      entry_kind: row.entry_kind || 'shift',
      time_start: timeInputValue(row.time_start),
      time_end: timeInputValue(row.time_end),
      notes: String(row.notes || ''),
    })),
  }
}

function planningClipboardSummary(pack) {
  if (!pack?.shifts?.length) return ''
  return `${formatShortItDate(pack.sourceFromStr)} – ${formatShortItDate(pack.sourceToStr)} (${pack.shifts.length} voci)`
}

function copyPlanningSourceLabel(planView) {
  if (planView === 'week') return 'settimana visibile'
  if (planView === 'day') return 'giorno visibile'
  return 'periodo visibile'
}

function resolveStaffIdForShiftRow(row, members) {
  const id = Number(row.staff_member_id)
  if (id && members.some((m) => Number(m.id) === id)) return id
  return resolveMemberIdFromBackupName(row.staff_member_name, members)
}

function memberNameById(members, staffId) {
  const m = (members || []).find((row) => Number(row.id) === Number(staffId))
  return m?.name || ''
}

function timeInputValue(t) {
  if (!t) return ''
  return String(t).slice(0, 5)
}

function normalizeTimeInput(v) {
  if (v == null || v === '') return ''
  const s = String(v).trim()
  const m24 = s.match(/^(\d{1,2}):(\d{2})/)
  if (m24) {
    return `${String(Number(m24[1])).padStart(2, '0')}:${m24[2].slice(0, 2)}`
  }
  const mH = s.match(/^(\d{1,2})$/)
  if (mH) return `${String(Number(mH[1])).padStart(2, '0')}:00`
  return s.slice(0, 5)
}

function parseShiftTimesFromText(text) {
  const raw = String(text || '')
  const toT = (h, min) => {
    const hh = String(Number(h)).padStart(2, '0')
    const mm = min != null && String(min).length ? String(min).padStart(2, '0') : '00'
    return `${hh}:${mm}`
  }
  const m1 = raw.match(/(\d{1,2})[:.](\d{2})?\s*[-–]\s*(\d{1,2})[:.](\d{2})?/i)
  if (m1) return { start: toT(m1[1], m1[2]), end: toT(m1[3], m1[4]) }
  const m2 = raw.match(/dalle?\s*(\d{1,2})(?:[:.](\d{2}))?\s*(?:alle?|a)\s*(\d{1,2})(?:[:.](\d{2}))?/i)
  if (m2) return { start: toT(m2[1], m2[2]), end: toT(m2[3], m2[4]) }
  const m3 = raw.match(/\b(\d{1,2})\s*[-–]\s*(\d{1,2})\b/)
  if (m3) return { start: toT(m3[1], null), end: toT(m3[2], null) }
  return { start: '', end: '' }
}

function resolveStaffMemberId(nameHint, members, spoken) {
  const q = String(nameHint || '').trim().toLowerCase()
  if (q) {
    let hit = members.find((m) => (m.name || '').toLowerCase() === q)
    if (!hit) hit = members.find((m) => (m.name || '').toLowerCase().includes(q))
    if (!hit) hit = members.find((m) => q.includes((m.name || '').toLowerCase()))
    if (hit) return hit.id
  }
  const spokenL = String(spoken || '').toLowerCase()
  for (const m of members) {
    const tokens = (m.name || '').toLowerCase().split(/\s+/).filter((p) => p.length >= 3)
    if (tokens.some((p) => spokenL.includes(p))) return m.id
  }
  return null
}

function resolveMemberIdFromBackupName(nameHint, members) {
  const direct = resolveStaffMemberId(nameHint, members, nameHint)
  if (direct) return direct
  const q = String(nameHint || '').trim().toLowerCase()
  if (!q) return null
  const parts = q.split(/\s+/).filter((p) => p.length >= 2)
  for (const m of members) {
    const tokens = String(m.name || '')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
    if (parts.length && parts.every((p) => tokens.some((t) => t.includes(p) || p.includes(t)))) {
      return m.id
    }
  }
  return null
}

function buildShiftApiPayload(staffId, workDate, entryKind, timeStart, timeEnd, notes) {
  const payload = {
    staff_member_id: staffId,
    work_date: workDate,
    time_start: entryKind === 'shift' || entryKind === 'permission' ? `${timeStart}:00` : null,
    time_end: entryKind === 'shift' || entryKind === 'permission' ? `${timeEnd}:00` : null,
    entry_kind: entryKind,
    notes: notes.trim() || null,
  }
  if (entryKind === 'shift') {
    if (!timeStart || !timeEnd) return { error: 'Per il turno servono ora inizio e fine' }
  }
  if (entryKind === 'permission') {
    if ((timeStart && !timeEnd) || (!timeStart && timeEnd)) {
      return { error: 'Permesso: indicare sia inizio sia fine, oppure lasciare vuoto e usare le note' }
    }
    if (!timeStart) {
      payload.time_start = null
      payload.time_end = null
    }
  }
  if (isAllDayKind(entryKind)) {
    payload.time_start = null
    payload.time_end = null
  }
  return { data: payload }
}

async function fetchPlanningShiftsInRange(fromStr, toStr, members, localShifts) {
  try {
    return normalizeShiftRows(await fetchStaffShifts(fromStr, toStr), members)
  } catch (err) {
    if (!isOnline()) {
      return normalizeShiftRows(
        (localShifts || []).filter((row) => {
          const wd = shiftWorkDateKey(row.work_date)
          return wd >= fromStr && wd <= toStr
        }),
        members,
      )
    }
    throw err
  }
}

async function replicatePlanningShifts({
  clipShifts,
  destFromStr,
  destToStr,
  members,
  destExisting,
}) {
  let mem = members
  try {
    const fetched = await fetchStaffMembers()
    if (Array.isArray(fetched) && fetched.length) mem = fetched
  } catch {
    /* usa elenco locale */
  }

  const existingList = normalizeShiftRows(destExisting, mem)
  let created = 0
  let skipped = 0
  let missingNames = 0

  for (const row of clipShifts) {
    const staffId = resolveStaffIdForShiftRow(row, mem)
    if (!staffId) {
      skipped += 1
      missingNames += 1
      continue
    }
    const kind = row.entry_kind || 'shift'
    const dayOffset = Number.isFinite(row.dayOffset)
      ? row.dayOffset
      : dayOffsetFromRangeStart(destFromStr, shiftWorkDateKey(row.work_date))
    const newWorkDate = addDaysToYmd(destFromStr, dayOffset)
    if (newWorkDate < destFromStr || newWorkDate > destToStr) {
      skipped += 1
      continue
    }
    const exists = existingList.some((s) =>
      shiftEntryMatches(s, staffId, newWorkDate, kind, row.time_start, row.time_end),
    )
    if (exists) {
      skipped += 1
      continue
    }
    const built = buildShiftApiPayload(
      staffId,
      newWorkDate,
      kind,
      timeInputValue(row.time_start),
      timeInputValue(row.time_end),
      row.notes || '',
    )
    if (built.error) {
      skipped += 1
      continue
    }
    const createdRow = await createStaffShift(built.data)
    created += 1
    const memberName = row.staff_member_name || memberNameById(mem, staffId)
    existingList.push(
      normalizeShiftRows(
        [
          {
            ...createdRow,
            staff_member_name: createdRow?.staff_member_name || memberName,
          },
        ],
        mem,
      )[0] || {
        staff_member_id: staffId,
        staff_member_name: memberName,
        work_date: newWorkDate,
        entry_kind: kind,
        time_start: built.data.time_start,
        time_end: built.data.time_end,
      },
    )
  }

  return { created, skipped, missingNames, members: mem }
}

function expandBulkShiftsHeuristic(spoken, members, context) {
  const t = String(spoken || '').toLowerCase()
  if (
    !/(tutti|tutte|ogni\s+dipendente|tutti\s+i\s+dipendenti|tutto\s+il\s+personale|intero\s+staff|tutto\s+il\s+team)/i.test(
      t,
    )
  ) {
    return null
  }
  const times = parseShiftTimesFromText(spoken)
  if (!times.start || !times.end) return null

  let dates = []
  const ws = context?.week_start
  const we = context?.week_end
  if (ws && we && /^\d{4}-\d{2}-\d{2}$/.test(ws) && /^\d{4}-\d{2}-\d{2}$/.test(we)) {
    dates = enumerateDayCells(parseYMD(ws), parseYMD(we)).map(toYMD)
  }
  if (dates.length === 0 && context?.selected_date) {
    dates = [context.selected_date]
  }
  if (/luned[iì].*venerd[iì]|lun.*ven|da\s+luned[iì]\s+a\s+venerd[iì]/i.test(t)) {
    dates = dates.filter((d) => {
      const dow = parseYMD(d).getDay()
      return dow >= 1 && dow <= 5
    })
  }
  if (/solo\s+sabato/i.test(t)) {
    dates = dates.filter((d) => parseYMD(d).getDay() === 6)
  }
  if (dates.length === 0) return null

  const targetMembers = members.filter((m) => m.is_active !== false)
  const list = targetMembers.length ? targetMembers : members
  const out = []
  for (const m of list) {
    for (const wd of dates) {
      out.push({
        staff_member_name: m.name,
        work_date: wd,
        entry_kind: 'shift',
        time_start: times.start,
        time_end: times.end,
        notes: '',
      })
    }
  }
  return out.length ? out : null
}

function isBulkStaffVoiceCommand(spoken) {
  const t = String(spoken || '').toLowerCase()
  return (
    /(tutti|tutte|ogni\s+dipendente|tutti\s+i\s+dipendenti|tutto\s+il\s+personale|intero\s+staff|tutto\s+il\s+team)/i.test(
      t,
    ) ||
    /luned[iì].*venerd[iì]|lun.*ven|da\s+luned[iì]\s+a\s+venerd[iì]|settimana|ogni\s+giorno/i.test(t)
  )
}

function collectShiftsFromGemini(r, members, spoken, defaultDate, context) {
  const list = []
  if (Array.isArray(r?.suggested_shifts)) {
    for (const item of r.suggested_shifts) {
      if (item && typeof item === 'object') list.push(item)
    }
  }
  const sf = r?.suggested_fields
  if (sf && typeof sf === 'object' && (sf.staff_member_name || sf.work_date || sf.time_start || sf.time_end)) {
    list.push(sf)
  }
  const bulk = expandBulkShiftsHeuristic(spoken, members, context)
  const single = expandSingleShiftHeuristic(spoken, members, defaultDate, context)
  const heuristic = bulk?.length ? bulk : single?.length ? single : null
  const bulkVoice = isBulkStaffVoiceCommand(spoken)
  if (heuristic?.length) {
    if (list.length === 0) return heuristic
    if (bulkVoice && bulk?.length && bulk.length >= list.length) return bulk
    const probe = list.slice(0, 3).map((item) => resolveOneShiftSuggestion(item, members, spoken, defaultDate))
    const okProbe = probe.filter((p) => p.data).length
    if (okProbe === 0) return heuristic
    if (heuristic.length > list.length) return heuristic
  }
  return list
}

function expandSingleShiftHeuristic(spoken, members, defaultDate, context) {
  const times = parseShiftTimesFromText(spoken)
  if (!times.start || !times.end) return null
  const spokenL = String(spoken || '').toLowerCase()
  for (const m of members) {
    const tokens = (m.name || '').toLowerCase().split(/\s+/).filter((p) => p.length >= 3)
    if (tokens.some((p) => spokenL.includes(p))) {
      let workDate = defaultDate
      const ws = context?.week_start
      const we = context?.week_end
      const dayOnly =
        !/(tutti|lun.*ven|luned|marted|mercol|gioved|venerd|sabato|domenica|settimana)/i.test(spoken)
      if (dayOnly) {
        workDate = defaultDate
      } else if (/luned[iì].*venerd[iì]|lun.*ven/i.test(spoken) && ws && we) {
        const dates = enumerateDayCells(parseYMD(ws), parseYMD(we))
          .map(toYMD)
          .filter((d) => {
            const dow = parseYMD(d).getDay()
            return dow >= 1 && dow <= 5
          })
        if (dates.length === 1) workDate = dates[0]
        else if (dates.length > 1) {
          return dates.map((wd) => ({
            staff_member_name: m.name,
            work_date: wd,
            entry_kind: 'shift',
            time_start: times.start,
            time_end: times.end,
            notes: '',
          }))
        }
      }
      return [
        {
          staff_member_name: m.name,
          work_date: workDate,
          entry_kind: 'shift',
          time_start: times.start,
          time_end: times.end,
          notes: '',
        },
      ]
    }
  }
  return null
}

function resolveOneShiftSuggestion(item, members, spoken, defaultDate) {
  const staffId = resolveStaffMemberId(item.staff_member_name, members, spoken)
  if (!staffId) return { error: 'dipendente non riconosciuto' }

  let workDate = defaultDate
  if (item.work_date) {
    const wd = String(item.work_date).slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(wd)) workDate = wd
  }

  const entryKind =
    item.entry_kind && ENTRY_KIND_VALUES.includes(String(item.entry_kind))
      ? String(item.entry_kind)
      : 'shift'

  let timeStart = normalizeTimeInput(item.time_start)
  let timeEnd = normalizeTimeInput(item.time_end)
  if ((entryKind === 'shift' || entryKind === 'permission') && (!timeStart || !timeEnd)) {
    const parsed = parseShiftTimesFromText(spoken)
    if (!timeStart) timeStart = parsed.start
    if (!timeEnd) timeEnd = parsed.end
  }

  const notes = item.notes ? String(item.notes) : ''
  const built = buildShiftApiPayload(staffId, workDate, entryKind, timeStart, timeEnd, notes)
  if (built.error) return { error: built.error }
  const memberName = members.find((m) => m.id === staffId)?.name || 'dipendente'
  return { data: built.data, staffId, workDate, memberName, entryKind, timeStart, timeEnd }
}

function todayDate() {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate())
}

function scrollToShiftForm() {
  const el = document.getElementById('staff-shift-form-card')
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/** Giorni inclusivi tra due date (ordine qualsiasi). */
function daysInclusiveCount(a, b) {
  const fa = toYMD(a)
  const fb = toYMD(b)
  const [x, y] = fa <= fb ? [fa, fb] : [fb, fa]
  const d0 = parseYMD(x)
  const d1 = parseYMD(y)
  return Math.round((d1.getTime() - d0.getTime()) / 86400000) + 1
}

/** Elenco Date (mezzanotte locale) da start a end inclusi. */
function enumerateDayCells(start, end) {
  const fa = toYMD(start)
  const fb = toYMD(end)
  const [firstStr, lastStr] = fa <= fb ? [fa, fb] : [fb, fa]
  const cells = []
  let cur = parseYMD(firstStr)
  const last = parseYMD(lastStr)
  while (cur <= last) {
    cells.push(new Date(cur.getFullYear(), cur.getMonth(), cur.getDate()))
    cur = addDays(cur, 1)
  }
  return cells
}

/** Intervallo massimo vista Periodo (Dal–Al): ~6 mesi; es. 1 apr → 31 lug = 122 giorni. */
const MAX_PLANNING_PERIOD_DAYS = 186
/** Limite turni creati in un solo comando vocale Gemini (es. 10 dipendenti × 7 giorni). */
const MAX_GEMINI_SHIFTS_BATCH = 80
/** Limite prudente per `https://wa.me/?text=…` (query troppo lunghe = link rotto o bloccato dal browser). */
const WA_ME_URL_MAX_LEN = 7200

async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fallback sotto */
  }
  return copyTextToClipboardFallback(text)
}

function copyTextToClipboardFallback(text) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  ta.style.top = '0'
  document.body.appendChild(ta)
  ta.focus()
  ta.select()
  try {
    const ok = document.execCommand('copy')
    return ok
  } catch {
    return false
  } finally {
    document.body.removeChild(ta)
  }
}

function buildWhatsAppPlanningBody(shifts, displayDayCells, shiftLineFn) {
  const byDate = new Map()
  for (const s of shifts) {
    const k = s.work_date
    if (!byDate.has(k)) byDate.set(k, [])
    byDate.get(k).push(s)
  }
  const lines = []
  for (const d of displayDayCells) {
    const ymd = toYMD(d)
    const label = DAY_HEADERS[d.getDay()]
    const dayNum = d.getDate()
    const monthBit = d.toLocaleDateString('it-IT', { month: 'short' })
    lines.push(`${label} ${dayNum} ${monthBit}`)
    const list = (byDate.get(ymd) || []).slice().sort((a, b) => (a.staff_member_name || '').localeCompare(b.staff_member_name || '', 'it'))
    if (list.length === 0) lines.push('  (nessuna voce)')
    else for (const s of list) lines.push(`  ${shiftLineFn(s)}`)
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

/**
 * Esempio tratto dalla pianificazione reale (mar–apr 2026).
 * Chiavi = data ISO; valori = [nome, HH:MM, HH:MM]
 */
const DEMO_WEEK_BLOCKS = {
  '2026-03-29': [
    ['Marianna', '08:00', '16:00'],
    ['Emy', '08:00', '16:00'],
    ['Roberto', '11:00', '19:00'],
    ['Maria', '09:00', '17:00'],
    ['Marta', '08:00', '16:00'],
    ['Marilú', '08:00', '16:00'],
    ['Nino', '11:00', '19:00'],
  ],
  '2026-03-30': [
    ['Marianna', '08:00', '16:00'],
    ['Emy', '08:00', '14:00'],
    ['Roberto', '10:30', '18:30'],
    ['Maria', '14:00', '18:30'],
    ['Nino', '08:00', '16:00'],
  ],
  '2026-03-31': [
    ['Marianna', '08:00', '16:00'],
    ['Emy', '08:00', '14:00'],
    ['Roberto', '10:30', '18:30'],
    ['Maria', '14:00', '18:30'],
    ['Marta', '08:00', '16:00'],
    ['Nino', '08:00', '16:00'],
  ],
  '2026-04-01': [
    ['Marianna', '08:00', '16:00'],
    ['Emy', '08:00', '14:00'],
    ['Roberto', '10:30', '18:30'],
    ['Maria', '14:00', '18:30'],
    ['Marta', '08:00', '16:00'],
    ['Nino', '08:00', '16:00'],
  ],
  '2026-04-02': [
    ['Marianna', '08:00', '16:00'],
    ['Emy', '08:00', '14:00'],
    ['Roberto', '10:30', '18:30'],
    ['Maria', '14:30', '18:00'],
    ['Marta', '08:00', '16:00'],
    ['Nino', '08:00', '16:00'],
  ],
  '2026-04-03': [
    ['Marianna', '08:00', '16:00'],
    ['Emy', '08:00', '12:00'],
    ['Roberto', '10:30', '18:30'],
    ['Maria', '10:30', '18:30'],
    ['Marta', '08:00', '16:00'],
    ['Nino', '08:00', '16:00'],
  ],
  '2026-04-04': [
    ['Marianna', '08:00', '16:00'],
    ['Emy', '08:00', '12:00'],
    ['Roberto', '10:30', '18:30'],
    ['Maria', '10:30', '18:30'],
    ['Marta', '08:00', '16:00'],
    ['Nino', '08:00', '16:00'],
  ],
  '2026-04-05': [
    ['Marianna', '08:00', '16:00'],
    ['Emy', '08:00', '12:00'],
    ['Roberto', '10:00', '18:00'],
    ['Maria', '12:00', '20:00'],
    ['Jevelin', '12:00', '20:00'],
    ['Marta', '09:00', '17:00'],
    ['Nino', '08:00', '16:00'],
  ],
}

function expandDemoRows() {
  const out = []
  for (const [date, rows] of Object.entries(DEMO_WEEK_BLOCKS)) {
    for (const [name, a, b] of rows) {
      out.push({
        work_date: date,
        name,
        time_start: `${a}:00`,
        time_end: `${b}:00`,
        entry_kind: 'shift',
      })
    }
  }
  return out
}

export default function StaffPage({ operatorMode = false, stationId: stationIdProp = null }) {
  const operatorStationId = operatorMode ? stationIdProp || getLockedOperatorStationId() : null
  const operatorBackupScope = useMemo(
    () => (operatorMode && operatorStationId ? operatorStaffBackupScope(operatorStationId) : ''),
    [operatorMode, operatorStationId],
  )
  const [members, setMembers] = useState([])
  const [shifts, setShifts] = useState([])
  /** True dopo «Carica piano» (o demo) finché non cambi date/vista. */
  const [planningLoaded, setPlanningLoaded] = useState(false)
  const [weekAnchor, setWeekAnchor] = useState(() => startOfWeekMonday(new Date()))
  /** Vista: settimana | singolo giorno | intervallo date libero (dal / al). */
  const [planView, setPlanView] = useState('week')
  const [dayFocus, setDayFocus] = useState(todayDate)
  const [periodFrom, setPeriodFrom] = useState(() => {
    const w = startOfWeekMonday(new Date())
    return new Date(w.getFullYear(), w.getMonth(), w.getDate())
  })
  const [periodTo, setPeriodTo] = useState(() => addDays(startOfWeekMonday(new Date()), 6))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [localeSyncWarning, setLocaleSyncWarning] = useState('')
  const [success, setSuccess] = useState('')
  const [newMemberFirstName, setNewMemberFirstName] = useState('')
  const [newMemberLastName, setNewMemberLastName] = useState('')
  const [newMemberEmail, setNewMemberEmail] = useState('')
  const [newMemberPhone, setNewMemberPhone] = useState('')
  const [newMemberCity, setNewMemberCity] = useState('')
  const [newMemberBirthDate, setNewMemberBirthDate] = useState('')
  const [newMemberSection, setNewMemberSection] = useState('')
  const [localeSections, setLocaleSections] = useState(() => defaultSectionsForLocale(''))
  const [hiddenPlanningSections, setHiddenPlanningSections] = useState([])
  const [activeSection, setActiveSection] = useState(() => defaultSectionsForLocale('')[0] || 'Generale')
  const [newSectionName, setNewSectionName] = useState('')
  const [editingMemberId, setEditingMemberId] = useState(null)
  const memberFormSectionRef = React.useRef(null)
  const [memberInfoId, setMemberInfoId] = useState(null)
  const [memberInfoSaving, setMemberInfoSaving] = useState(false)
  const [demoLoading, setDemoLoading] = useState(false)
  const [reportModalOpen, setReportModalOpen] = useState(false)
  const [reportPdfBlob, setReportPdfBlob] = useState(null)
  const [reportFilename, setReportFilename] = useState('report.pdf')
  const [reportWaText, setReportWaText] = useState('')
  const [reportPeriodLabel, setReportPeriodLabel] = useState('')
  const [reportModalTitle, setReportModalTitle] = useState('Report personale (PDF)')
  const [reportLoading, setReportLoading] = useState(false)
  const [localeStaffName, setLocaleStaffName] = useState('')
  const [localeAccessCode, setLocaleAccessCode] = useState('')
  const [localeSessionOpenKeys, setLocaleSessionOpenKeys] = useState(() => new Set(readStaffLocaleSessionOpenKeys()))
  const [localeSessionBusy, setLocaleSessionBusy] = useState(false)
  const [savedLocaleNames, setSavedLocaleNames] = useState([])
  const [userDeletableLocaleNames, setUserDeletableLocaleNames] = useState([])
  const [planningClipboard, setPlanningClipboard] = useState(() => readPlanningClipboard())

  const [formMemberIds, setFormMemberIds] = useState(() => new Set())
  const formMemberSelectAllRef = React.useRef(null)
  const [formDate, setFormDate] = useState(() => toYMD(new Date()))
  const [formStart, setFormStart] = useState('08:00')
  const [formEnd, setFormEnd] = useState('16:00')
  const [formKind, setFormKind] = useState('shift')
  const [formNotes, setFormNotes] = useState('')
  const [formGenere, setFormGenere] = useState('')
  const [planningSection, setPlanningSection] = useState('')
  const [loadPlanMenuOpen, setLoadPlanMenuOpen] = useState(false)
  const [refreshPlanMenuOpen, setRefreshPlanMenuOpen] = useState(false)
  const [copyPlanMenuOpen, setCopyPlanMenuOpen] = useState(false)
  const [weekLoadDays, setWeekLoadDays] = useState(() => new Set([0, 1, 2, 3, 4]))
  const weekLoadDaysSelectAllRef = React.useRef(null)
  const [membersDropdownOpen, setMembersDropdownOpen] = useState(false)
  const [weekDaysDropdownOpen, setWeekDaysDropdownOpen] = useState(false)
  const [editingShiftId, setEditingShiftId] = useState(null)
  /** Evita richieste duplicate (doppio clic / Invio mentre parte un’altra azione). */
  const [shiftBusy, setShiftBusy] = useState(false)
  const [aiShiftText, setAiShiftText] = useState('')
  const [aiShiftLoading, setAiShiftLoading] = useState(false)
  const [aiShiftSummary, setAiShiftSummary] = useState('')
  /** Ore manuali per dipendente (chiave = id); se assente si usano ore da turni nel periodo. */
  const [hoursOverride, setHoursOverride] = useState({})
  /** Prezzo/ora in modifica nella tabella costi (chiave = id dipendente). */
  const [rateDraft, setRateDraft] = useState({})
  /** Importi calcolati su richiesta (Calcola); assente = non mostrato. */
  const [payrollImporto, setPayrollImporto] = useState({})
  /** Modale giorni/ore turni dalla tabella costi. */
  const [payrollDaysInfoMemberId, setPayrollDaysInfoMemberId] = useState(null)
  /** Mese solare per stipendi (YYYY-MM) e turni caricati per quel mese. */
  const [payrollMonthYm, setPayrollMonthYm] = useState(currentPayrollYm)
  const [payrollShifts, setPayrollShifts] = useState([])
  const [payrollShiftsRefreshing, setPayrollShiftsRefreshing] = useState(false)
  const [payrollBackupKey, setPayrollBackupKey] = useState(currentPayrollYm)
  const [payrollBackupOptions, setPayrollBackupOptions] = useState([])
  const [backupBusy, setBackupBusy] = useState(false)
  const [planningBackupSlot, setPlanningBackupSlot] = useState(0)
  const [membersBackupLocale, setMembersBackupLocale] = useState('')
  const [localePackSavedAtByName, setLocalePackSavedAtByName] = useState({})
  const [backupMeta, setBackupMeta] = useState(() => ({
    members: null,
    planning: getPlanningWeekBackupSavedAt(
      `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
      0,
    ),
    payroll: getLatestStaffBackup('payroll')?.savedAt ?? null,
  }))

  const refreshPayrollBackupOptions = useCallback(async () => {
    const scope = operatorBackupScope
    const options = []
    try {
      const summaries = await fetchStaffBackups('payroll')
      for (const row of summaries) {
        const backupKey = String(row?.backup_key || '').trim()
        if (!backupKey || !staffBackupKeyMatchesScope(backupKey, scope)) continue
        const ym = unscopedStaffBackupKey(backupKey, scope)
        if (!ym) continue
        const when = formatStaffBackupLabel(row.saved_at)
        options.push({
          value: scope ? backupKey : ym,
          label: `${formatMonthYmIt(ym)} — server${when ? ` (${when})` : ''}`,
          savedAt: row.saved_at,
          ym,
          source: 'server',
        })
      }
    } catch {
      // server assente
    }
    const localList = listStaffBackups('payroll', scope || '')
    localList.forEach((entry, index) => {
      const ym = String(entry?.payload?.payrollMonthYm || '').trim() || '—'
      const when = formatStaffBackupLabel(entry.savedAt)
      const hasServer = options.some((o) => o.ym === ym && o.source === 'server')
      const suffix = hasServer ? ' — copia browser' : ' — solo browser'
      options.push({
        value: `local:${index}`,
        label: `${formatMonthYmIt(ym)}${suffix}${when ? ` (${when})` : ''}`,
        savedAt: entry.savedAt,
        ym,
        source: 'local',
      })
    })
    options.sort((a, b) => {
      const ta = Date.parse(a.savedAt || '') || 0
      const tb = Date.parse(b.savedAt || '') || 0
      return tb - ta
    })
    setPayrollBackupOptions(options)
    return options
  }, [operatorBackupScope])

  const payrollBackupSavedAt = useMemo(() => {
    const hit = payrollBackupOptions.find((o) => o.value === payrollBackupKey)
    return hit?.savedAt ?? null
  }, [payrollBackupOptions, payrollBackupKey])

  useEffect(() => {
    void refreshPayrollBackupOptions()
  }, [refreshPayrollBackupOptions])

  useEffect(() => {
    if (!payrollBackupOptions.length) return
    if (payrollBackupOptions.some((o) => o.value === payrollBackupKey)) return
    const serverHit = payrollBackupOptions.find((o) => o.ym === payrollMonthYm)
    setPayrollBackupKey(serverHit?.value ?? payrollBackupOptions[0].value)
  }, [payrollBackupOptions, payrollBackupKey, payrollMonthYm])

  const currentPlanningMonthYm = useCallback(() => {
    return `${weekAnchor.getFullYear()}-${String(weekAnchor.getMonth() + 1).padStart(2, '0')}`
  }, [weekAnchor])

  const refreshBackupMeta = useCallback(
    async (
      planningSlot = planningBackupSlot,
      membersLocale = membersBackupLocale,
      payrollYm = payrollMonthYm,
    ) => {
      const loc = normalizeLocaleName(membersLocale)
      let membersAt = null
      if (loc) {
        membersAt = pickNewestSavedAt(
          localePackSavedAtByName[loc],
          getMembersLocaleBackupSavedAt(loc),
        )
        try {
          const summaries = await fetchStaffLocalePacks()
          const hit = summaries.find((row) => normalizeLocaleName(row?.locale_name) === loc)
          membersAt = pickNewestSavedAt(membersAt, hit?.saved_at)
        } catch {
          // server assente
        }
      }
      const planKey = planningBackupServerKey(currentPlanningMonthYm(), planningSlot, operatorBackupScope)
      const localPlanningAt = getPlanningWeekBackupSavedAt(
        currentPlanningMonthYm(),
        planningSlot,
        operatorBackupScope,
      )
      let serverPlanningAt = null
      if (planKey) {
        try {
          serverPlanningAt = await fetchStaffBackupSavedAt('planning', planKey)
        } catch {
          serverPlanningAt = null
        }
      }
      const planningAt = pickNewestSavedAt(localPlanningAt, serverPlanningAt)
      let serverPayrollAt = null
      const payrollServerKey = payrollYm ? payrollBackupServerKey(payrollYm, operatorBackupScope) : ''
      if (payrollServerKey) {
        try {
          serverPayrollAt = await fetchStaffBackupSavedAt('payroll', payrollServerKey)
        } catch {
          serverPayrollAt = null
        }
      }
      const scopedPayroll = getLatestStaffBackup('payroll', operatorBackupScope || '')
      const localPayrollAt =
        payrollYm && scopedPayroll?.payload?.payrollMonthYm === payrollYm
          ? scopedPayroll?.savedAt ?? null
          : null
      const payrollAt = pickNewestSavedAt(localPayrollAt, serverPayrollAt)
      setBackupMeta({
        members: membersAt,
        planning: planningAt,
        payroll: payrollAt,
      })
    },
    [
      planningBackupSlot,
      membersBackupLocale,
      payrollMonthYm,
      localePackSavedAtByName,
      currentPlanningMonthYm,
      operatorBackupScope,
    ],
  )

  const weekEnd = useMemo(() => addDays(weekAnchor, 6), [weekAnchor])
  const fromStr = useMemo(() => toYMD(weekAnchor), [weekAnchor])
  const toStr = useMemo(() => toYMD(weekEnd), [weekEnd])
  const planningMonthWeeks = useMemo(() => planningMonthWeekSlots(weekAnchor), [weekAnchor])
  const planningBackupSlotOptions = useMemo(
    () =>
      planningMonthWeeks.map((w) => ({
        value: w.slotIndex,
        label: `${PLANNING_BACKUP_SLOT_LABELS[w.slotIndex]} (${formatShortItDate(w.fromStr)} – ${formatShortItDate(w.toStr)})`,
      })),
    [planningMonthWeeks],
  )
  const membersBackupLocaleOptions = useMemo(() => {
    if (operatorMode && operatorStationId) {
      const name = normalizeLocaleName(
        getOperatorStationStaffLocaleName(operatorStationId, savedLocaleNames) || localeStaffName,
      )
      if (!name) {
        return [{ value: '', label: 'Locale postazione' }]
      }
      const savedAt = localePackSavedAtByName[name] || getMembersLocaleBackupSavedAt(name)
      const when = savedAt ? formatStaffBackupLabel(savedAt) : null
      return [
        {
          value: name,
          label: when ? `${name} (backup ${when})` : name,
        },
      ]
    }
    const names = new Set()
    const seenKeys = new Set()
    for (const rawName of [...savedLocaleNames, ...listMembersLocaleBackupNames()]) {
      const n = normalizeLocaleName(rawName)
      const k = n.toLocaleLowerCase('it')
      if (!n || seenKeys.has(k)) continue
      seenKeys.add(k)
      names.add(n)
    }
    const current = normalizeLocaleName(localeStaffName)
    if (current) {
      const k = current.toLocaleLowerCase('it')
      if (!seenKeys.has(k)) names.add(current)
    }
    const sorted = [...names].sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }))
    if (sorted.length === 0) {
      return [{ value: '', label: 'Inserisci un locale sotto' }]
    }
    return sorted.map((name) => {
      const savedAt = localePackSavedAtByName[name] || getMembersLocaleBackupSavedAt(name)
      const when = savedAt ? formatStaffBackupLabel(savedAt) : null
      return {
        value: name,
        label: when ? `${name} (backup ${when})` : name,
      }
    })
  }, [
    operatorMode,
    operatorStationId,
    savedLocaleNames,
    localeStaffName,
    localePackSavedAtByName,
    backupMeta.members,
  ])
  const weekLoadTargetAnchor = useMemo(
    () => (planView === 'week' ? weekAnchor : startOfWeekMonday(formDate ? parseYMD(formDate) : new Date())),
    [planView, weekAnchor, formDate],
  )
  const weekLoadFromStr = useMemo(() => toYMD(weekLoadTargetAnchor), [weekLoadTargetAnchor])
  const weekLoadToStr = useMemo(() => toYMD(addDays(weekLoadTargetAnchor, 6)), [weekLoadTargetAnchor])
  const dayStr = useMemo(() => toYMD(dayFocus), [dayFocus])
  const periodFromStr = useMemo(() => toYMD(periodFrom), [periodFrom])
  const periodToStr = useMemo(() => toYMD(periodTo), [periodTo])
  const periodLoStr = periodFromStr <= periodToStr ? periodFromStr : periodToStr
  const periodHiStr = periodFromStr <= periodToStr ? periodToStr : periodFromStr
  const rangeFromStr = planView === 'week' ? fromStr : planView === 'day' ? dayStr : periodLoStr
  const rangeToStr = planView === 'week' ? toStr : planView === 'day' ? dayStr : periodHiStr

  const payrollMonthBounds = useMemo(() => monthBoundsFromYm(payrollMonthYm), [payrollMonthYm])
  const payrollFromStr = payrollMonthBounds.fromStr
  const payrollToStr = payrollMonthBounds.toStr

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await fetchStaffShifts(payrollFromStr, payrollToStr)
        if (!cancelled) setPayrollShifts(Array.isArray(data) ? data : [])
      } catch {
        if (!cancelled) setPayrollShifts([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [payrollFromStr, payrollToStr])

  useEffect(() => {
    void refreshBackupMeta()
  }, [refreshBackupMeta])

  const oreTurnoByMemberId = useMemo(() => {
    const map = new Map()
    for (const row of aggregateWeeklyStaffStats(members, payrollShifts, payrollFromStr, payrollToStr)) {
      map.set(row.memberId, row.oreTurno)
    }
    return map
  }, [members, payrollShifts, payrollFromStr, payrollToStr])

  const payrollRows = useMemo(() => {
    return members.map((m) => {
      const computedOre = oreTurnoByMemberId.get(m.id) ?? 0
      const ore =
        hoursOverride[m.id] !== undefined
          ? parseDecimalInput(hoursOverride[m.id])
          : computedOre
      return {
        member: m,
        ore,
        computedOre,
      }
    })
  }, [members, oreTurnoByMemberId, hoursOverride])

  const payrollWorkbookTotals = useMemo(
    () => staffPayrollTotals(payrollRows, payrollImporto),
    [payrollRows, payrollImporto],
  )

  useEffect(() => {
    setRateDraft((prev) => {
      const next = { ...prev }
      let changed = false
      for (const m of members) {
        if (next[m.id] === undefined) {
          next[m.id] = m.hourly_rate != null ? String(m.hourly_rate) : ''
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [members])

  const calculatePayrollImporto = useCallback(
    (memberId) => {
      const row = payrollRows.find((r) => r.member.id === memberId)
      if (!row) return
      const rate = parseDecimalInput(rateDraft[memberId] ?? row.member.hourly_rate)
      setPayrollImporto((prev) => ({ ...prev, [memberId]: row.ore * rate }))
    },
    [payrollRows, rateDraft],
  )

  const clearPayrollImporto = useCallback((memberId) => {
    setPayrollImporto((prev) => {
      if (prev[memberId] === undefined) return prev
      const next = { ...prev }
      delete next[memberId]
      return next
    })
  }, [])

  const calculateAllPayrollImporto = useCallback(() => {
    const next = {}
    for (const row of payrollRows) {
      const rate = parseDecimalInput(rateDraft[row.member.id] ?? row.member.hourly_rate)
      next[row.member.id] = row.ore * rate
    }
    setPayrollImporto(next)
  }, [payrollRows, rateDraft])

  const applyPayrollFromShifts = useCallback(
    async (memList) => {
      let list = Array.isArray(memList) ? memList : null
      if (!list) {
        const data = await fetchStaffMembers()
        list = Array.isArray(data) ? data : []
        setMembers(list)
      }
      if (!list.length) {
        setHoursOverride({})
        setPayrollImporto({})
        setPayrollShifts([])
        return
      }
      const data = await fetchStaffShifts(payrollFromStr, payrollToStr)
      const shifts = Array.isArray(data) ? data : []
      setPayrollShifts(shifts)
      setHoursOverride({})
      const oreMap = new Map()
      for (const row of aggregateWeeklyStaffStats(list, shifts, payrollFromStr, payrollToStr)) {
        if (list.some((m) => m.id === row.memberId)) {
          oreMap.set(row.memberId, row.oreTurno)
        }
      }
      setRateDraft((prev) => {
        const next = { ...prev }
        for (const m of list) {
          next[m.id] = m.hourly_rate != null ? String(m.hourly_rate) : ''
        }
        return next
      })
      const nextImporto = {}
      for (const m of list) {
        const ore = oreMap.get(m.id) ?? 0
        const rate = parseDecimalInput(m.hourly_rate)
        nextImporto[m.id] = ore * rate
      }
      setPayrollImporto(nextImporto)
    },
    [payrollFromStr, payrollToStr],
  )

  const refreshPayrollHoursFromShifts = useCallback(async () => {
    setPayrollShiftsRefreshing(true)
    setError('')
    try {
      const monthData = await fetchStaffShifts(payrollFromStr, payrollToStr)
      let merged = Array.isArray(monthData) ? monthData : []
      if (planningLoaded && shifts.length > 0) {
        const from = rangeFromStr
        const to = rangeToStr
        const inRange = (wd) => wd >= from && wd <= to
        merged = merged.filter((s) => !inRange(shiftWorkDateKey(s.work_date)))
        const planningSlice = shifts.filter((s) => inRange(shiftWorkDateKey(s.work_date)))
        merged = [...merged, ...planningSlice]
      }
      const normalized = normalizeShiftRows(merged, members)
      setPayrollShifts(normalized)
      const oreMap = new Map()
      for (const row of aggregateWeeklyStaffStats(members, normalized, payrollFromStr, payrollToStr)) {
        oreMap.set(row.memberId, row.oreTurno)
      }
      setHoursOverride({})
      setPayrollImporto((prev) => {
        const next = { ...prev }
        for (const m of members) {
          const ore = oreMap.get(m.id) ?? 0
          const rate = parseDecimalInput(rateDraft[m.id] ?? m.hourly_rate)
          next[m.id] = ore * rate
        }
        return next
      })
      const rangeNote =
        planningLoaded && rangeFromStr && rangeToStr
          ? ` (include settimana/periodo caricato ${rangeFromStr} → ${rangeToStr})`
          : ''
      setSuccess(`Ore lavorate aggiornate dai turni del mese${rangeNote}.`)
    } catch {
      setError('Aggiornamento ore dai turni non riuscito')
    } finally {
      setPayrollShiftsRefreshing(false)
    }
  }, [
    members,
    payrollFromStr,
    payrollToStr,
    planningLoaded,
    shifts,
    rangeFromStr,
    rangeToStr,
    rateDraft,
  ])

  const buildPayrollLinesForSave = useCallback(() => {
    const lines = []
    for (const row of payrollRows) {
      const amount = payrollImporto[row.member.id]
      if (amount === undefined) continue
      const rate = parseDecimalInput(rateDraft[row.member.id] ?? row.member.hourly_rate)
      lines.push({
        staff_member_id: row.member.id,
        name: row.member.name,
        hours: row.ore,
        hourly_rate: rate,
        amount: Number(amount) || 0,
      })
    }
    return lines
  }, [payrollRows, payrollImporto, rateDraft])

  const resolvePayrollLineMemberId = useCallback(
    (ln) => {
      const rawId = Number(ln.staff_member_id)
      if (Number.isFinite(rawId) && members.some((m) => m.id === rawId)) return rawId
      const name = String(ln.name || '').trim()
      if (!name) return null
      const byName = members.find((m) => String(m.name || '').trim() === name)
      return byName?.id ?? null
    },
    [members],
  )

  const applyPayrollMonthSnapshot = useCallback(
    (rec) => {
      if (!rec?.lines?.length) {
        setHoursOverride({})
        setPayrollImporto({})
        return 0
      }
      const ho = {}
      const imp = {}
      const rd = {}
      let matched = 0
      for (const ln of rec.lines) {
        const id = resolvePayrollLineMemberId(ln)
        if (id == null) continue
        matched += 1
        const hoursStr = formatHoursDecimal(ln.hours)
        ho[id] = hoursStr !== '' ? hoursStr : ln.hours != null ? String(ln.hours) : ''
        imp[id] = ln.amount
        rd[id] = ln.hourly_rate != null ? String(ln.hourly_rate) : ''
      }
      if (matched === 0) return 0
      setHoursOverride(ho)
      setPayrollImporto(imp)
      setRateDraft((prev) => ({ ...prev, ...rd }))
      return matched
    },
    [resolvePayrollLineMemberId],
  )

  useEffect(() => {
    if (members.length === 0) {
      setHoursOverride({})
      setPayrollImporto({})
      return undefined
    }
    let cancelled = false
    ;(async () => {
      try {
        const months = await fetchStaffPayrollMonths()
        if (cancelled) return
        const hit = (months || []).find((m) => m.year_month === payrollMonthYm)
        if (hit?.lines?.length) {
          applyPayrollMonthSnapshot(hit)
        } else if (!hit) {
          setHoursOverride({})
          setPayrollImporto({})
        }
      } catch {
        /* Non azzerare la tabella se l'API archivio fallisce (es. dopo Carica in tabella). */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [payrollMonthYm, applyPayrollMonthSnapshot])

  useEffect(() => {
    if (payrollDaysInfoMemberId == null) return
    if (!members.some((m) => m.id === payrollDaysInfoMemberId)) {
      setPayrollDaysInfoMemberId(null)
    }
  }, [members, payrollDaysInfoMemberId])

  const payrollDaysInfo = useMemo(() => {
    if (payrollDaysInfoMemberId == null) return null
    const member = members.find((m) => m.id === payrollDaysInfoMemberId)
    if (!member) return null
    const worked = aggregateMemberWorkedDays(
      payrollDaysInfoMemberId,
      payrollShifts,
      payrollFromStr,
      payrollToStr,
      member.name,
    )
    return {
      member,
      periodFrom: payrollFromStr,
      periodTo: payrollToStr,
      ...worked,
    }
  }, [payrollDaysInfoMemberId, members, payrollShifts, payrollFromStr, payrollToStr])

  const dayLongLabel = useMemo(
    () =>
      dayFocus.toLocaleDateString('it-IT', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    [dayFocus],
  )

  const dayCells = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekAnchor, i))
  }, [weekAnchor])

  const periodDayCount = useMemo(() => {
    if (planView !== 'period') return 0
    return daysInclusiveCount(periodFrom, periodTo)
  }, [planView, periodFrom, periodTo])

  const periodTooLong = planView === 'period' && periodDayCount > MAX_PLANNING_PERIOD_DAYS

  const displayDayCells = useMemo(() => {
    if (planView === 'week') return dayCells
    if (planView === 'day') return [dayFocus]
    if (periodDayCount > MAX_PLANNING_PERIOD_DAYS) return []
    return enumerateDayCells(periodFrom, periodTo)
  }, [planView, dayCells, dayFocus, periodFrom, periodTo, periodDayCount])

  /** Intervallo date per il report PDF in base alla vista: settimana lun–dom, singolo giorno, o Dal–Al. */
  const reportPdfRange = useMemo(() => {
    if (planView === 'week') {
      const fromD = weekAnchor
      const toD = addDays(weekAnchor, 6)
      return { ok: true, from: fromD, to: toD, kind: 'week', dayCount: 7 }
    }
    if (planView === 'day') {
      return { ok: true, from: dayFocus, to: dayFocus, kind: 'day', dayCount: 1 }
    }
    const n = daysInclusiveCount(periodFrom, periodTo)
    if (n > MAX_PLANNING_PERIOD_DAYS) {
      return { ok: false, reason: 'too_long', days: n }
    }
    const fa = toYMD(periodFrom)
    const fb = toYMD(periodTo)
    const fromD = fa <= fb ? periodFrom : periodTo
    const toD = fa <= fb ? periodTo : periodFrom
    return { ok: true, from: fromD, to: toD, kind: 'period', dayCount: n }
  }, [planView, weekAnchor, dayFocus, periodFrom, periodTo])

  const membersInFormGenere = useMemo(() => {
    if (!formGenere) return members
    return members.filter((m) => memberMatchesSection(m, formGenere, localeSections))
  }, [members, formGenere, localeSections])

  const planningSectionOptions = useMemo(() => {
    const out = [...localeSections]
    const seen = new Set(out.map((s) => sectionCompareKey(s)))
    for (const s of CORE_PLANNING_SECTIONS) {
      const key = sectionCompareKey(s)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(s)
    }
    return out
  }, [localeSections])

  const planningGridSectionOptions = useMemo(
    () =>
      planningSectionOptions.filter(
        (section) => !isPlanningSectionHidden(section, hiddenPlanningSections, HIDDEN_PLANNING_SECTIONS),
      ),
    [planningSectionOptions, hiddenPlanningSections],
  )

  const visiblePlanningShifts = useMemo(() => {
    if (!planningSection) return shifts
    return shifts.filter((s) => shiftBelongsToSection(s, planningSection, members, localeSections))
  }, [shifts, planningSection, members, localeSections])

  const planningWeekBlocks = useMemo(() => {
    const sections = planningSection ? [planningSection] : planningGridSectionOptions
    if (!sections.length) return []
    return sections.map((section) => ({
      section,
      sectionLabel: section,
      shiftsByDate: groupShiftsByDate(
        shifts.filter((s) => shiftBelongsToSection(s, section, members, localeSections)),
      ),
    }))
  }, [planningSection, planningGridSectionOptions, shifts, members, localeSections])

  useEffect(() => {
    if (planningSection && isPlanningSectionHidden(planningSection, hiddenPlanningSections, HIDDEN_PLANNING_SECTIONS)) {
      setPlanningSection('')
    }
  }, [planningSection, hiddenPlanningSections])

  useEffect(() => {
    if (editingShiftId) return
    if (formGenere && isPlanningSectionHidden(formGenere, hiddenPlanningSections, HIDDEN_PLANNING_SECTIONS)) {
      setFormGenere('')
    }
  }, [formGenere, editingShiftId, hiddenPlanningSections])

  const loadForRange = useCallback(async (startDate, endDate) => {
    const from = toYMD(startDate)
    const to = toYMD(endDate)
    const sh =
      operatorMode && operatorStationId
        ? await fetchOperatorStationShifts(operatorStationId, from, to)
        : await fetchStaffShifts(from, to)
    setShifts(normalizeShiftRows(sh, members))
  }, [members, operatorMode, operatorStationId])

  const stationStaffLocaleName = useMemo(
    () => (operatorStationId ? getOperatorStationStaffLocaleName(operatorStationId, savedLocaleNames) : ''),
    [operatorStationId, savedLocaleNames],
  )

  const refreshMembers = useCallback(async () => {
    if (operatorMode && operatorStationId) {
      try {
        const localeName = stationStaffLocaleName || localeStaffName
        const slug = getOperatorStationActivitySlug(operatorStationId)
        const store = await readStaffLocaleStore()
        const hit = findLocalePackInStore(store, localeName, slug)
        const packMembers = Array.isArray(hit?.pack?.members) ? hit.pack.members : []
        let all = []
        try {
          all = await fetchStaffMembers()
        } catch {
          all = members
        }
        const scoped = membersFromPackAndDb(packMembers, all)
        setMembers(scoped)
        invalidateOperatorStationMembersCache(operatorStationId, localeName)
      } catch (e) {
        setError(e?.message || 'Errore caricamento dipendenti')
      }
      return
    }
    try {
      const mem = await fetchStaffMembers()
      setMembers(mem || [])
    } catch (e) {
      setError(e?.message || 'Errore caricamento dipendenti')
    }
  }, [operatorMode, operatorStationId, stationStaffLocaleName, localeStaffName, members])

  const clearStaffDataFromMemory = useCallback(() => {
    setMembers([])
    setShifts([])
    setPlanningLoaded(false)
    setMemberInfoId(null)
    setEditingShiftId(null)
    setEditingMemberId(null)
    setFormMemberIds(new Set())
    setPayrollShifts([])
    setPayrollImporto({})
  }, [])

  useEffect(() => {
    if (!operatorMode) {
      refreshMembers()
    }
  }, [operatorMode, refreshMembers])

  useEffect(() => {
    const n = normalizeLocaleName(localeStaffName)
    if (!n) return
    setMembersBackupLocale(n)
  }, [localeStaffName])

  useEffect(() => {
    setLocaleSections((prev) =>
      resolveLocaleSections({
        localeName: localeStaffName,
        savedSections: prev,
        members,
      }),
    )
  }, [localeStaffName, members])

  useEffect(() => {
    const name = normalizeLocaleName(localeStaffName)
    if (!name) {
      setHiddenPlanningSections([])
      return
    }
    const backup = getMembersLocaleBackup(name)
    const fromBackup = backup?.payload?.hidden_planning_sections
    let cancelled = false
    void readStaffLocaleStore().then((store) => {
      if (cancelled) return
      const storeKey = findLocaleStoreKey(store, name)
      const fromStore = storeKey ? store[storeKey]?.hidden_planning_sections : []
      applyHiddenPlanningSectionsFromSources(fromBackup, fromStore)
    })
    return () => {
      cancelled = true
    }
  }, [localeStaffName])

  useEffect(() => {
    if (!localeSections.length) return
    if (!localeSections.some((s) => sectionCompareKey(s) === sectionCompareKey(activeSection))) {
      setActiveSection(localeSections[0])
    }
    if (!newMemberSection || !localeSections.some((s) => sectionCompareKey(s) === sectionCompareKey(newMemberSection))) {
      setNewMemberSection(localeSections[0])
    }
  }, [localeSections, activeSection, newMemberSection])

  const membersInActiveSection = useMemo(
    () => members.filter((m) => memberMatchesSection(m, activeSection, localeSections)),
    [members, activeSection, localeSections],
  )

  useEffect(() => {
    if (editingShiftId) return
    if (planningSection) setFormGenere(planningSection)
  }, [planningSection, editingShiftId])

  useEffect(() => {
    if (editingShiftId) return
    if (!formGenere) return
    setFormMemberIds((prev) => {
      const allowed = new Set(membersInFormGenere.map((m) => m.id))
      const next = new Set([...prev].filter((id) => allowed.has(id)))
      if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev
      return next
    })
  }, [formGenere, membersInFormGenere, editingShiftId])

  function handleAddLocaleSection() {
    const name = normalizeSectionName(newSectionName)
    if (!name) {
      setError('Inserisci il nome della nuova sezione')
      return
    }
    if (localeSections.some((s) => sectionCompareKey(s) === sectionCompareKey(name))) {
      setError(`La sezione "${name}" esiste già`)
      return
    }
    setError('')
    setLocaleSections((prev) => [...prev, name])
    setActiveSection(name)
    setNewMemberSection(name)
    setNewSectionName('')
    setSuccess(`Sezione "${name}" aggiunta`)
  }

  function handleRemoveActiveSection() {
    const name = normalizeSectionName(activeSection)
    if (!name || localeSections.length <= 1) {
      setError('Serve almeno una sezione')
      return
    }
    const hasMembers = members.some((m) => memberMatchesSection(m, name, localeSections) && normalizeSectionName(m.section))
    if (hasMembers) {
      setError(`Non puoi eliminare "${name}": ci sono dipendenti assegnati. Spostali prima in un’altra sezione.`)
      return
    }
    const next = localeSections.filter((s) => sectionCompareKey(s) !== sectionCompareKey(name))
    setLocaleSections(next)
    setActiveSection(next[0] || 'Generale')
    setNewMemberSection(next[0] || 'Generale')
    setSuccess(`Sezione "${name}" rimossa`)
  }

  async function persistHiddenPlanningSections(localeName, hidden) {
    const name = normalizeLocaleName(localeName)
    if (!name) return
    const cleaned = mergeHiddenPlanningSections(hidden)
    try {
      const store = await readStaffLocaleStore()
      const storeKey = findLocaleStoreKey(store, name)
      if (storeKey && store[storeKey]) {
        store[storeKey] = { ...store[storeKey], hidden_planning_sections: cleaned }
        await writeStaffLocaleStore(store)
      }
    } catch {
      // ignore
    }
    const backup = getMembersLocaleBackup(name)
    const payload = backup?.payload && typeof backup.payload === 'object' ? { ...backup.payload } : {}
    saveMembersLocaleBackup(name, { ...payload, hidden_planning_sections: cleaned })
  }

  function applyHiddenPlanningSectionsFromSources(...sources) {
    setHiddenPlanningSections(mergeHiddenPlanningSections(...sources))
  }

  function handleHidePlanningSection(sectionName) {
    const name = normalizeSectionName(sectionName)
    if (!name) return
    if (isPlanningSectionHidden(name, hiddenPlanningSections, HIDDEN_PLANNING_SECTIONS)) return
    const next = mergeHiddenPlanningSections(hiddenPlanningSections, [name])
    setHiddenPlanningSections(next)
    if (sectionCompareKey(planningSection) === sectionCompareKey(name)) {
      setPlanningSection('')
      setFormGenere('')
    }
    void persistHiddenPlanningSections(localeStaffName, next)
    setSuccess(`Settimana "${name}" rimossa dalla pianificazione`)
  }

  function handleRestorePlanningSection(sectionName) {
    const name = normalizeSectionName(sectionName)
    if (!name) return
    const next = hiddenPlanningSections.filter((s) => sectionCompareKey(s) !== sectionCompareKey(name))
    setHiddenPlanningSections(next)
    void persistHiddenPlanningSections(localeStaffName, next)
    setSuccess(`Settimana "${name}" ripristinata nella pianificazione`)
  }

  useEffect(() => {
    if (membersBackupLocale) return
    const first = membersBackupLocaleOptions.find((o) => o.value)?.value
    if (!first) return
    setMembersBackupLocale(String(first))
  }, [membersBackupLocale, membersBackupLocaleOptions])

  useEffect(() => {
    const idx = findPlanningBackupSlotForAnchor(weekAnchor, planningMonthWeekSlots(weekAnchor))
    setPlanningBackupSlot(idx)
  }, [weekAnchor])

  const markPlanningStale = useCallback(() => {
    setShifts([])
    setPlanningLoaded(false)
  }, [])

  const applyPlanningViewFromRange = useCallback((range) => {
    setPlanView(range.view)
    if (range.view === 'day') {
      setDayFocus(range.dayFocus)
      return
    }
    if (range.view === 'period') {
      setPeriodFrom(range.periodFrom)
      setPeriodTo(range.periodTo)
      return
    }
    setWeekAnchor(range.weekAnchor)
  }, [])

  const reloadPlanning = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      if (planView === 'week') {
        await loadForRange(weekAnchor, addDays(weekAnchor, 6))
      } else if (planView === 'day') {
        await loadForRange(dayFocus, dayFocus)
      } else {
        const n = daysInclusiveCount(periodFrom, periodTo)
        if (n > MAX_PLANNING_PERIOD_DAYS) {
          setError(`Intervallo troppo lungo (${n} giorni). Massimo ${MAX_PLANNING_PERIOD_DAYS} giorni: restringi «Dal» / «Al».`)
          setShifts([])
          setPlanningLoaded(false)
          return
        }
        const fa = toYMD(periodFrom)
        const fb = toYMD(periodTo)
        const start = fa <= fb ? periodFrom : periodTo
        const end = fa <= fb ? periodTo : periodFrom
        await loadForRange(start, end)
      }
      setPlanningLoaded(true)
    } catch (e) {
      setError(e?.message || 'Errore caricamento personale')
      setPlanningLoaded(false)
    } finally {
      setLoading(false)
    }
  }, [planView, weekAnchor, dayFocus, periodFrom, periodTo, loadForRange])

  const applyPlanningSection = useCallback((sectionName) => {
    const next = normalizeSectionName(sectionName)
    setPlanningSection(next)
    if (next) setFormGenere(next)
  }, [])

  const reloadPlanningForSection = useCallback(
    async (sectionName) => {
      applyPlanningSection(sectionName)
      await reloadPlanning()
    },
    [applyPlanningSection, reloadPlanning],
  )

  useEffect(() => {
    const onDataSynced = async () => {
      try {
        const data = await fetchStaffShifts(payrollFromStr, payrollToStr)
        setPayrollShifts(Array.isArray(data) ? data : [])
      } catch {
        setPayrollShifts([])
      }
      await reloadPlanning()
      await refreshMembers()
      await applyPayrollFromShifts()
    }
    window.addEventListener('atlas-refresh-data', onDataSynced)
    return () => window.removeEventListener('atlas-refresh-data', onDataSynced)
  }, [payrollFromStr, payrollToStr, reloadPlanning, refreshMembers, applyPayrollFromShifts])

  /** Ricarica i turni includendo sempre `ymd` (stessa logica di reloadPlanning ma range calcolato sulla data salvata, evita closure stale dopo setState). */
  async function reloadPlanningForWorkDate(ymd) {
    if (!ymd || typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      await reloadPlanning()
      return
    }
    setLoading(true)
    setError('')
    try {
      if (planView === 'week') {
        const anchor = startOfWeekMonday(parseYMD(ymd))
        await loadForRange(anchor, addDays(anchor, 6))
      } else if (planView === 'day') {
        const d = parseYMD(ymd)
        await loadForRange(d, d)
      } else {
        const fa = toYMD(periodFrom)
        const fb = toYMD(periodTo)
        let lo = fa <= fb ? fa : fb
        let hi = fa <= fb ? fb : fa
        if (ymd < lo) lo = ymd
        if (ymd > hi) hi = ymd
        const startD = parseYMD(lo)
        const endD = parseYMD(hi)
        const n = daysInclusiveCount(startD, endD)
        if (n > MAX_PLANNING_PERIOD_DAYS) {
          setError(`Intervallo troppo lungo (${n} giorni). Massimo ${MAX_PLANNING_PERIOD_DAYS} giorni: restringi «Dal» / «Al».`)
          setShifts([])
          setPlanningLoaded(false)
          return
        }
        await loadForRange(startD, endD)
      }
      setPlanningLoaded(true)
    } catch (e) {
      setError(e?.message || 'Errore caricamento personale')
      setPlanningLoaded(false)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!success) return
    const t = window.setTimeout(() => setSuccess(''), 2800)
    return () => window.clearTimeout(t)
  }, [success])

  useEffect(() => {
    if (editingShiftId != null) return
    if (planView === 'day') {
      setFormDate(dayStr)
      return
    }
    if (planView === 'week') {
      const today = toYMD(new Date())
      const weekStart = toYMD(weekAnchor)
      const weekEnd = toYMD(addDays(weekAnchor, 6))
      if (today >= weekStart && today <= weekEnd) {
        setFormDate(today)
      } else {
        setFormDate(weekStart)
      }
    }
  }, [planView, dayStr, weekAnchor, editingShiftId])

  useEffect(() => {
    if (editingShiftId != null) return
    if (planView !== 'day') return
    const offset = weekDayOffsetFromDate(dayFocus)
    setWeekLoadDays((prev) => {
      if (prev.size === 1 && prev.has(offset)) return prev
      return new Set([offset])
    })
  }, [planView, dayFocus, editingShiftId])

  useEffect(() => {
    if (planView === 'period' && editingShiftId == null) {
      setFormDate(periodLoStr)
    }
  }, [planView, periodLoStr, editingShiftId])


  function shiftLine(s) {
    const name = s.staff_member_name
    if (s.entry_kind === 'shift' && s.time_start && s.time_end) {
      return `${name} ${fmtTime(s.time_start)}–${fmtTime(s.time_end)}`
    }
    const kindIt = KIND_LABELS[s.entry_kind] || s.entry_kind
    const extra = s.notes ? ` (${s.notes})` : ''
    const times =
      s.time_start && s.time_end ? ` ${fmtTime(s.time_start)}–${fmtTime(s.time_end)}` : ''
    return `${name} — ${kindIt}${times}${extra}`
  }

  function openDayAndInsertShift(d, sectionName = planningSection) {
    const picked = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    setPlanView('day')
    setDayFocus(picked)
    setEditingShiftId(null)
    setFormDate(toYMD(picked))
    setWeekLoadDays(weekLoadDaysForSingleDate(picked))
    setFormKind('shift')
    setFormStart('08:00')
    setFormEnd('16:00')
    window.setTimeout(scrollToShiftForm, 80)
  }

  async function openWhatsAppPlanning() {
    if (!planningLoaded || displayDayCells.length === 0) {
      setError('Carica prima il piano con «Carica piano» (oppure «Solo demo»).')
      return
    }
    setError('')
    const rangeLabel = `${rangeFromStr} → ${rangeToStr}`
    const title = planningSection
      ? `📅 Planning ${planningSection} (${rangeLabel})`
      : `📅 Planning turni (${rangeLabel})`
    const body = buildWhatsAppPlanningBody(visiblePlanningShifts, displayDayCells, shiftLine)
    const fullText = `${title}\n\n${body}`
    const waUrl = `https://wa.me/?text=${encodeURIComponent(fullText)}`

    if (waUrl.length <= WA_ME_URL_MAX_LEN) {
      window.open(waUrl, '_blank', 'noopener,noreferrer')
      return
    }

    const copied = await copyTextToClipboard(fullText)
    if (!copied) {
      setError(
        'Planning troppo lungo per il link WhatsApp e copia negli appunti non riuscita. Usa HTTPS, riduci il periodo oppure copia le righe dalla griglia.',
      )
      return
    }
    setSuccess(
      'Planning completo copiato negli appunti. Si apre WhatsApp: scegli la chat e incolla il messaggio (tasto destro › Incolla o Ctrl+V).',
    )
    window.open('https://wa.me/', '_blank', 'noopener,noreferrer')
  }

  async function openStaffReportPdf() {
    setReportLoading(true)
    setError('')
    try {
      const rr = reportPdfRange
      if (!rr.ok) {
        setError(
          `Intervallo troppo lungo (${rr.days} giorni) per il report PDF. Massimo ${MAX_PLANNING_PERIOD_DAYS} giorni: restringi «Dal» / «Al».`,
        )
        return
      }
      const { aggregateWeeklyStaffStats, buildWeeklyReportWhatsAppText, generateWeeklyStaffReportPdf } = await import(
        '../utils/staffWeeklyReport.js'
      )
      const fromStr = toYMD(rr.from)
      const toStr = toYMD(rr.to)
      const [mem, sh] = await Promise.all([fetchStaffMembers(), fetchStaffShifts(fromStr, toStr)])
      const rows = aggregateWeeklyStaffStats(mem || [], sh || [], fromStr, toStr)

      let pdfMainHeading = 'Report personale'
      let periodTitle = ''
      let periodSub = ''
      let modalTitle = 'Report personale (PDF)'
      let filename = `report-personale-${fromStr}.pdf`

      if (rr.kind === 'day') {
        pdfMainHeading = 'Report personale — giorno singolo'
        periodTitle = rr.from.toLocaleDateString('it-IT', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
        periodSub = `Data: ${fromStr}`
        modalTitle = 'Report giorno (PDF)'
        filename = `report-personale-giorno-${fromStr}.pdf`
      } else if (rr.kind === 'week') {
        pdfMainHeading = 'Report personale — settimana (lun–dom)'
        periodTitle = `Settimana dal ${rr.from.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} al ${rr.to.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`
        periodSub = `Intervallo dati: ${fromStr} → ${toStr} (7 giorni, lunedi–domenica)`
        modalTitle = 'Report settimana (PDF)'
        filename = `report-personale-settimana-${fromStr}.pdf`
      } else {
        pdfMainHeading = 'Report personale — periodo'
        periodTitle = `Dal ${rr.from.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })} al ${rr.to.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}`
        periodSub = `Intervallo dati: ${fromStr} → ${toStr} (${rr.dayCount} ${rr.dayCount === 1 ? 'giorno' : 'giorni'})`
        modalTitle = 'Report periodo (PDF)'
        filename = `report-personale-periodo-${fromStr}_${toStr}.pdf`
      }

      const blob = generateWeeklyStaffReportPdf({
        pdfMainHeading,
        periodTitle,
        periodSub,
        rows,
        shifts: sh || [],
        dateFromYmd: fromStr,
        dateToYmd: toStr,
      })
      const wa = buildWeeklyReportWhatsAppText(`${fromStr} → ${toStr}`, rows)
      setReportPdfBlob(blob)
      setReportFilename(filename)
      setReportWaText(wa)
      setReportPeriodLabel(`${fromStr} → ${toStr}`)
      setReportModalTitle(modalTitle)
      setReportModalOpen(true)
    } catch (e) {
      setError(e?.message || 'Errore generazione report')
    } finally {
      setReportLoading(false)
    }
  }

  function closeWeeklyReport() {
    setReportModalOpen(false)
    setReportPdfBlob(null)
  }

  function resetMemberForm() {
    setEditingMemberId(null)
    setNewMemberFirstName('')
    setNewMemberLastName('')
    setNewMemberEmail('')
    setNewMemberPhone('')
    setNewMemberCity('')
    setNewMemberBirthDate('')
    setNewMemberSection(activeSection || localeSections[0] || '')
  }

  function handleEditMember(m) {
    setEditingMemberId(m.id)
    setNewMemberFirstName(m.first_name || '')
    setNewMemberLastName(m.last_name || '')
    if (!m.first_name && !m.last_name && m.name) {
      const parts = String(m.name).trim().split(/\s+/)
      setNewMemberFirstName(parts[0] || '')
      setNewMemberLastName(parts.slice(1).join(' ') || '')
    }
    setNewMemberEmail(m.email || '')
    setNewMemberPhone(m.phone || '')
    setNewMemberCity(m.city || '')
    setNewMemberBirthDate(m.birth_date ? String(m.birth_date).slice(0, 10) : '')
    const section = normalizeSectionName(m.section) || activeSection || localeSections[0] || ''
    setNewMemberSection(section)
    if (section) setActiveSection(section)
    setError('')
    setSuccess('')
    window.requestAnimationFrame(() => {
      memberFormSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  async function handleAddMember(e) {
    e.preventDefault()
    const fn = newMemberFirstName.trim()
    const ln = newMemberLastName.trim()
    if (!fn && !ln) {
      setError('Indica almeno nome o cognome')
      return
    }
    const section = normalizeSectionName(newMemberSection) || normalizeSectionName(activeSection) || null
    const payload = {
      name: `${fn} ${ln}`.trim(),
      first_name: fn || null,
      last_name: ln || null,
      email: newMemberEmail.trim() || null,
      phone: newMemberPhone.trim() || null,
      city: newMemberCity.trim() || null,
      section,
      birth_date: newMemberBirthDate.trim() || null,
    }
    try {
      setError('')
      if (section && !localeSections.some((s) => sectionCompareKey(s) === sectionCompareKey(section))) {
        setLocaleSections((prev) => resolveLocaleSections({ localeName: localeStaffName, savedSections: [...prev, section], members }))
      }
      if (section) setActiveSection(section)
      if (editingMemberId) {
        const updated = await updateStaffMember(editingMemberId, payload)
        setSuccess('Dipendente aggiornato')
        if (operatorMode && operatorStationId) {
          const nextMembers = members.map((m) =>
            m.id === editingMemberId ? { ...m, ...payload, id: editingMemberId, ...(updated || {}) } : m,
          )
          setMembers(nextMembers)
          await persistOperatorLocaleMembers(nextMembers)
          resetMemberForm()
          return
        }
      } else {
        const created = await createStaffMember({
          ...payload,
          is_active: true,
        })
        setSuccess('Dipendente aggiunto')
        if (operatorMode && operatorStationId) {
          const nextMembers = [...members, created]
          setMembers(nextMembers)
          await persistOperatorLocaleMembers(nextMembers)
          resetMemberForm()
          return
        }
      }
      resetMemberForm()
      await refreshMembers()
    } catch (err) {
      setError(err?.message || (editingMemberId ? 'Errore aggiornamento' : 'Errore salvataggio'))
    }
  }

  const memberInfoTarget = useMemo(() => members.find((m) => m.id === memberInfoId) ?? null, [members, memberInfoId])

  /** Scheda Info aperta su un id che non è più in elenco (es. eliminato altrove): chiudi modale. */
  useEffect(() => {
    if (memberInfoId == null) return
    if (!members.some((m) => m.id === memberInfoId)) {
      setMemberInfoId(null)
    }
  }, [members, memberInfoId])

  async function handleSaveMemberInfo(id, payload) {
    setMemberInfoSaving(true)
    setError('')
    try {
      await updateStaffMember(id, payload)
      setSuccess('Anagrafica aggiornata')
      setMemberInfoId(null)
      if (operatorMode && operatorStationId) {
        const nextMembers = members.map((m) => (m.id === id ? { ...m, ...payload, id } : m))
        setMembers(nextMembers)
        await persistOperatorLocaleMembers(nextMembers)
        return
      }
      await refreshMembers()
    } catch (err) {
      const msg = String(err?.message || '')
      if (msg.includes('404') || msg.includes('non trovato') || msg.includes('Not Found')) {
        setMemberInfoId(null)
        await refreshMembers()
        setError('Questo dipendente non esiste più sul server. La scheda è stata chiusa.')
      } else {
        setError(msg || 'Errore salvataggio anagrafica')
      }
    } finally {
      setMemberInfoSaving(false)
    }
  }

  const allFormMembersSelected =
    membersInFormGenere.length > 0 && membersInFormGenere.every((m) => formMemberIds.has(m.id))
  const someFormMembersSelected = membersInFormGenere.some((m) => formMemberIds.has(m.id))
  const allWeekDaysSelected = WEEK_LOAD_DAY_OPTIONS.every((d) => weekLoadDays.has(d.offset))
  const someWeekDaysSelected = WEEK_LOAD_DAY_OPTIONS.some((d) => weekLoadDays.has(d.offset))

  const membersDropdownLabel = useMemo(() => {
    if (membersInFormGenere.length === 0) {
      return formGenere ? `Nessun dipendente in ${formGenere}` : 'Nessun dipendente'
    }
    if (formMemberIds.size === 0) return 'Seleziona dipendenti…'
    if (allFormMembersSelected) return formGenere ? `Tutti (${formGenere})` : 'Tutti i dipendenti'
    if (formMemberIds.size === 1) {
      const m = members.find((x) => formMemberIds.has(x.id))
      return m?.name || '1 dipendente'
    }
    const names = members.filter((m) => formMemberIds.has(m.id)).map((m) => m.name)
    if (names.length <= 2) return names.join(', ')
    return `${formMemberIds.size} dipendenti selezionati`
  }, [members, membersInFormGenere, formMemberIds, allFormMembersSelected, formGenere])

  const weekDaysDropdownLabel = useMemo(() => {
    if (weekLoadDays.size === 0) return 'Seleziona giorni…'
    if (allWeekDaysSelected) return 'Tutti i giorni'
    const labels = [...weekLoadDays]
      .sort((a, b) => a - b)
      .map((off) => WEEK_LOAD_DAY_OPTIONS.find((d) => d.offset === off)?.label)
      .filter(Boolean)
    if (labels.length <= 3) return labels.join(', ')
    return `${labels.length} giorni selezionati`
  }, [weekLoadDays, allWeekDaysSelected])

  useEffect(() => {
    setMembersDropdownOpen(false)
    setWeekDaysDropdownOpen(false)
  }, [editingShiftId])

  useEffect(() => {
    const el = formMemberSelectAllRef.current
    if (el) el.indeterminate = someFormMembersSelected && !allFormMembersSelected
  }, [someFormMembersSelected, allFormMembersSelected])

  function toggleFormMemberSelection(memberId) {
    if (editingShiftId) return
    setFormMemberIds((prev) => {
      const next = new Set(prev)
      if (next.has(memberId)) next.delete(memberId)
      else next.add(memberId)
      return next
    })
  }

  function toggleSelectAllFormMembers() {
    if (editingShiftId) return
    if (allFormMembersSelected) {
      setFormMemberIds(new Set())
      return
    }
    setFormMemberIds(new Set(membersInFormGenere.map((m) => m.id)))
  }

  useEffect(() => {
    const el = weekLoadDaysSelectAllRef.current
    if (el) el.indeterminate = someWeekDaysSelected && !allWeekDaysSelected
  }, [someWeekDaysSelected, allWeekDaysSelected])

  function toggleWeekLoadDay(offset) {
    if (editingShiftId) return
    setWeekLoadDays((prev) => {
      const next = new Set(prev)
      if (next.has(offset)) next.delete(offset)
      else next.add(offset)
      return next
    })
  }

  function toggleSelectAllWeekLoadDays() {
    if (editingShiftId) return
    if (allWeekDaysSelected) {
      setWeekLoadDays(new Set())
      return
    }
    setWeekLoadDays(new Set(WEEK_LOAD_DAY_OPTIONS.map((d) => d.offset)))
  }

  async function handleDeleteMember(m) {
    const access = await assertActiveLocaleZoneAccess()
    if (!access.ok) {
      setError(localeAccessErrorMessage(access, 'eliminare dipendenti'))
      return
    }
    if (!window.confirm(`Rimuovere ${m.name} e tutte le sue voci in pianificazione?`)) return
    try {
      setError('')
      if (editingMemberId === m.id) resetMemberForm()
      if (memberInfoId === m.id) setMemberInfoId(null)
      let res = null
      let queuedOffline = false
      try {
        res = await deleteStaffMember(m.id, access.localeName || undefined, access.code)
        queuedOffline = isQueuedOfflineResponse(res)
      } catch (err) {
        const msg = String(err?.message || '')
        if (msg.includes('Codice') || msg.includes('403')) {
          setError(localeAccessErrorMessage({ ...access, wrongCode: true }, 'eliminare dipendenti'))
          return
        }
        if (!isOnline()) {
          queuedOffline = true
          await patchCachedListsForDelete(`/staff/members/${m.id}`)
        } else throw err
      }
      const nextMembers = members.filter((row) => !memberIdsEqual(row.id, m.id))
      setMembers(nextMembers)
      setShifts((prev) => prev.filter((row) => !memberIdsEqual(row.staff_member_id, m.id)))
      setPayrollShifts((prev) => prev.filter((row) => !memberIdsEqual(row.staff_member_id, m.id)))
      if (operatorMode && operatorStationId) {
        await persistOperatorLocaleMembers(nextMembers)
      }
      setFormMemberIds((prev) => {
        if (!prev.has(m.id)) return prev
        const next = new Set(prev)
        next.delete(m.id)
        return next
      })
      if (queuedOffline) {
        setSuccess(`Dipendente rimosso in locale: sincronizzazione automatica alla prossima connessione.`)
      } else {
        setSuccess('Dipendente rimosso')
      }
      if (!queuedOffline) {
        try {
          if (!(operatorMode && operatorStationId)) {
            await refreshMembers()
          }
        } catch {
          // Mantieni aggiornamento locale in memoria.
        }
      }
    } catch (err) {
      setError(err?.message || 'Errore eliminazione')
    }
  }

  async function handleDeleteAllMembers() {
    if (members.length === 0) return
    const access = await assertActiveLocaleZoneAccess()
    if (!access.ok) {
      setError(localeAccessErrorMessage(access, 'eliminare l\'elenco dipendenti'))
      return
    }
    if (
      !window.confirm(
        `Eliminare TUTTI i dipendenti (${members.length})?\n\nVerranno rimosse anche tutte le voci di pianificazione (turni, permessi, assenze, malattia) collegate. L’operazione non si può annullare.`,
      )
    ) {
      return
    }
    try {
      setError('')
      setMemberInfoId(null)
      resetMemberForm()
      const deletedCountBeforeSync = members.length
      let r = null
      let queuedOffline = false
      try {
        r = await deleteAllStaffMembers(access.localeName || undefined, access.code)
        queuedOffline = isQueuedOfflineResponse(r)
      } catch (err) {
        const msg = String(err?.message || '')
        if (msg.includes('Codice') || msg.includes('403')) {
          setError(localeAccessErrorMessage({ ...access, wrongCode: true }, 'eliminare l\'elenco dipendenti'))
          return
        }
        if (!isOnline()) {
          queuedOffline = true
          await patchCachedListsForDelete('/staff/members/bulk')
        } else throw err
      }
      const n = queuedOffline ? deletedCountBeforeSync : r?.deleted ?? 0
      markPlanningStale()
      setEditingShiftId(null)
      setFormMemberIds(new Set())
      setFormDate(toYMD(new Date()))
      setFormStart('08:00')
      setFormEnd('16:00')
      setFormKind('shift')
      setFormNotes('')
      setMembers([])
      setShifts([])
      setPayrollShifts([])
      if (operatorMode && operatorStationId) {
        await persistOperatorLocaleMembers([])
      }
      if (!queuedOffline) {
        try {
          if (!(operatorMode && operatorStationId)) {
            await refreshMembers()
          }
        } catch {
          // Mantieni elenco locale vuoto se il refresh fallisce dopo bulk delete.
        }
      }
      setHoursOverride({})
      setPayrollImporto({})
      setSuccess(
        queuedOffline
          ? `Eliminati ${n} dipendenti in locale: sincronizzazione automatica alla prossima connessione.`
          : n > 0
          ? `Eliminati ${n} dipendenti e tutta la pianificazione associata.`
          : 'Elenco dipendenti già vuoto.',
      )
    } catch (err) {
      setError(err?.message || 'Errore eliminazione elenco dipendenti')
    }
  }

  function normalizeLocaleName(value) {
    return String(value || '').trim()
  }

  function localeNameCompareKey(value) {
    return normalizeLocaleName(value)
      .toLocaleLowerCase('it')
      .replace(/[\s_-]+/g, '')
  }

  function resolveCanonicalLocaleName(localeName) {
    const target = localeNameCompareKey(localeName)
    if (!target) return ''
    const direct = normalizeLocaleName(localeName)
    if (savedLocaleNames.some((n) => localeNameCompareKey(n) === target)) {
      const hit = savedLocaleNames.find((n) => localeNameCompareKey(n) === target)
      return hit || direct
    }
    return direct
  }

  function isStaffLocaleSessionOpen(localeName) {
    if (operatorStationId) {
      return isOperatorStationStaffSessionOpen(operatorStationId, localeName)
    }
    const key = localeNameCompareKey(localeName)
    if (!key) return false
    return localeSessionOpenKeys.has(key)
  }

  function setStaffLocaleSessionOpen(localeName, open) {
    const key = localeNameCompareKey(localeName)
    if (!key) return
    if (operatorStationId) {
      setOperatorStationStaffSession(operatorStationId, localeName, open)
    }
    setLocaleSessionOpenKeys((prev) => {
      const next = new Set([...prev])
      if (open) next.add(key)
      else next.delete(key)
      writeStaffLocaleSessionOpenKeys([...next])
      return next
    })
  }

  const activeLocaleSessionOpen = operatorStationId
    ? isOperatorStationStaffSessionOpen(operatorStationId, localeStaffName || stationStaffLocaleName)
    : isStaffLocaleSessionOpen(localeStaffName)

  function findLocaleStoreKey(store, localeName) {
    const names = Object.keys(store || {})
    const slug = operatorStationId ? getOperatorStationActivitySlug(operatorStationId) : ''
    const matched = slug ? matchStaffLocaleName(localeName, names, slug) : ''
    if (matched) {
      const hit = names.find((n) => localeNameCompareKey(n) === localeNameCompareKey(matched))
      if (hit) return hit
    }
    const target = localeNameCompareKey(localeName)
    if (!target) return ''
    for (const rawKey of names) {
      if (localeNameCompareKey(rawKey) === target) return rawKey
    }
    return ''
  }

  async function persistOperatorLocaleMembers(memberRows) {
    if (!operatorMode || !operatorStationId) return
    const localeName = stationStaffLocaleName || localeStaffName
    if (!localeName) return
    const snapshot = (memberRows || []).map(memberSnapshotFromRow)
    const code = normalizeLocaleAccessCode(localeAccessCode)
    const accessCode = isValidLocaleAccessCode(code) ? code : undefined
    const sectionsForPack = resolveLocaleSections({
      localeName,
      savedSections: localeSections,
      members: snapshot,
    })
    const saveKey = await writeOperatorLocalePackMembers(operatorStationId, localeName, snapshot, {
      sections: sectionsForPack,
      access_code: accessCode,
      hidden_planning_sections: hiddenPlanningSections,
    })
    const canonicalName = saveKey || resolveCanonicalLocaleName(localeName) || localeName
    saveMembersLocaleBackup(canonicalName, {
      members: snapshot,
      sections: sectionsForPack,
      access_code: accessCode || null,
      hidden_planning_sections: hiddenPlanningSections,
    })
    try {
      await upsertStaffLocalePack(canonicalName, snapshot, accessCode, {
        sections: sectionsForPack,
        hidden_planning_sections: hiddenPlanningSections,
      })
    } catch {
      // Il pack locale resta valido anche se il server è offline.
    }
    invalidateOperatorStationMembersCache(operatorStationId, canonicalName)
  }

  function isOfflineQueuedMessage(message) {
    const msg = String(message || '')
    return msg.includes('Sei offline') || msg.includes('quando torna la connessione')
  }

  function isQueuedOfflineResponse(res) {
    return Boolean(res?.__offline) || isOfflineQueuedMessage(res?.message)
  }

  function memberIdsEqual(a, b) {
    return Number(a) === Number(b)
  }

  function filterShiftsOutsideRange(rows, fromStr, toStr) {
    const from = String(fromStr || '').slice(0, 10)
    const to = String(toStr || '').slice(0, 10)
    return (Array.isArray(rows) ? rows : []).filter((row) => {
      const wd = shiftWorkDateKey(row.work_date)
      return wd < from || wd > to
    })
  }

  function removeShiftFromLists(rows, shiftId) {
    return (Array.isArray(rows) ? rows : []).filter((row) => !memberIdsEqual(row.id, shiftId))
  }

  function isUserDeletableLocaleName(localeName) {
    const target = localeNameCompareKey(localeName)
    if (!target) return false
    return userDeletableLocaleNames.some((name) => localeNameCompareKey(name) === target)
  }

  function memberSnapshotFromRow(m) {
    return {
      name: m.name || '',
      first_name: m.first_name || null,
      last_name: m.last_name || null,
      email: m.email || null,
      phone: m.phone || null,
      city: m.city || null,
      section: m.section || null,
      birth_date: m.birth_date || null,
      sort_order: Number.isFinite(Number(m.sort_order)) ? Number(m.sort_order) : 0,
      hourly_rate: m.hourly_rate != null ? Number(m.hourly_rate) : null,
      is_active: Boolean(m.is_active),
    }
  }

  function applyLocaleSections(nextSections, preferredActive = '', membersOverride = null) {
    const memberList = Array.isArray(membersOverride) ? membersOverride : members
    const list = resolveLocaleSections({
      localeName: localeStaffName,
      savedSections: nextSections,
      members: memberList,
    })
    setLocaleSections(list)
    const preferred = normalizeSectionName(preferredActive)
    const preferredKey = sectionCompareKey(preferred)
    const hit = preferredKey
      ? list.find((s) => sectionCompareKey(s) === preferredKey)
      : null
    const nextActive = hit || list.find((s) => sectionCompareKey(s) === sectionCompareKey(activeSection)) || list[0] || 'Generale'
    setActiveSection(nextActive)
    if (!newMemberSection || !list.some((s) => sectionCompareKey(s) === sectionCompareKey(newMemberSection))) {
      setNewMemberSection(nextActive)
    }
  }

  async function readStoredLocaleAccessCode(localeName) {
    const store = await readStaffLocaleStore()
    const storeKey = findLocaleStoreKey(store, localeName)
    const pack = storeKey ? store[storeKey] : null
    return normalizeLocaleAccessCode(pack?.access_code)
  }

  async function resolveLocaleAccessCodeForSave(localeName) {
    const typed = normalizeLocaleAccessCode(localeAccessCode)
    if (isValidLocaleAccessCode(typed)) return typed
    const stored = await readStoredLocaleAccessCode(localeName)
    if (isValidLocaleAccessCode(stored)) return stored
    return generateLocaleAccessCode()
  }

  async function localeExistsInPrimaNota(localeName) {
    const target = localeNameCompareKey(localeName)
    if (!target) return false
    try {
      const packs = await fetchPrimaNotaLocalePacks()
      const rows = Array.isArray(packs) ? packs : []
      return rows.some((row) => {
        const slug = String(row?.activity_slug || '').trim().toLowerCase()
        const linkedStaffName = DEFAULT_PRIMA_NOTA_STAFF_LOCALE_LINKS[slug] || ''
        return (
          localeNameCompareKey(row?.label) === target ||
          localeNameCompareKey(slug) === target ||
          localeNameCompareKey(linkedStaffName) === target
        )
      })
    } catch {
      return false
    }
  }

  async function handleGenerateLocaleCode() {
    const localeName = normalizeLocaleName(localeStaffName)
    if (!localeName) {
      setLocaleAccessCode(generateLocaleAccessCode())
      return
    }
    const target = localeNameCompareKey(localeName)
    const existsInStaff = savedLocaleNames.some((n) => localeNameCompareKey(n) === target)
    const existsInPrimaNota = await localeExistsInPrimaNota(localeName)
    if (existsInStaff || existsInPrimaNota) {
      const ok = window.confirm(
        `Per "${localeName}" esiste già un locale/registro protetto.\n\nVuoi cambiare codice?`,
      )
      if (!ok) return
    }
    setLocaleAccessCode(generateLocaleAccessCode())
  }

  async function collectExistingLocalePacks() {
    const existing = []
    const seenKeys = new Set()
    const addPack = (name, members) => {
      const n = normalizeLocaleName(name)
      if (!n || !Array.isArray(members) || members.length === 0) return
      if (
        operatorMode &&
        operatorStationId &&
        !operatorStationLocaleNameMatches(operatorStationId, n, savedLocaleNames)
      ) {
        return
      }
      const key = n.toLocaleLowerCase('it')
      if (seenKeys.has(key)) return
      seenKeys.add(key)
      existing.push({ name: n, members })
    }
    const store = await readStaffLocaleStore()
    for (const [rawKey, pack] of Object.entries(store)) {
      if (pack?.members?.length) addPack(rawKey, pack.members)
    }
    try {
      const summaries = await fetchStaffLocalePacks()
      await Promise.all(
        summaries.map(async (row) => {
          const n = normalizeLocaleName(row?.locale_name)
          if (!n) return
          const code = await readStoredLocaleAccessCode(n)
          if (!isValidLocaleAccessCode(code)) return
          try {
            const remote = await fetchStaffLocalePack(n, code)
            if (remote?.members?.length) addPack(n, remote.members)
          } catch {
            // dettaglio non disponibile senza codice valido
          }
        }),
      )
    } catch {
      // server assente
    }
    for (const backupName of listMembersLocaleBackupNames((name) => {
      if (!operatorMode || !operatorStationId) return true
      return operatorStationLocaleNameMatches(operatorStationId, name, savedLocaleNames)
    })) {
      const backup = getMembersLocaleBackup(backupName)
      if (backup?.payload?.members?.length) addPack(backupName, backup.payload.members)
    }
    return existing
  }

  async function assertLocalePackCanSave(localeName, snapshot) {
    const existing = await collectExistingLocalePacks()
    return validateLocalePackUniqueness(localeName, snapshot, existing)
  }

  async function resolvePlanningBackup(slotIndex, monthYm = currentPlanningMonthYm()) {
    const ym = String(monthYm || '').trim()
    const slot = Number(slotIndex)
    const local = ym ? getPlanningWeekBackup(ym, slot, operatorBackupScope) : null
    const keysToTry = []
    if (local?.payload?.monthYm) {
      keysToTry.push(planningBackupServerKey(local.payload.monthYm, slot, operatorBackupScope))
    }
    if (ym) keysToTry.push(planningBackupServerKey(ym, slot, operatorBackupScope))
    const seen = new Set()
    for (const key of keysToTry) {
      if (!key || seen.has(key)) continue
      seen.add(key)
      try {
        const remote = await fetchStaffBackupDetail('planning', key)
        if (remote?.payload && Array.isArray(remote.payload.shifts) && remote.payload.shifts.length) {
          return { savedAt: remote.saved_at, payload: remote.payload }
        }
      } catch {
        // fallback locale o altra chiave
      }
    }
    if (local?.payload?.shifts?.length) {
      return local
    }
    try {
      const summaries = await fetchStaffBackups('planning')
      const suffix = `:${slot}`
      const hit = summaries.find((row) => {
        const backupKey = String(row?.backup_key || '')
        return staffBackupKeyMatchesScope(backupKey, operatorBackupScope) && backupKey.endsWith(suffix)
      })
      if (hit?.backup_key) {
        const remote = await fetchStaffBackupDetail('planning', hit.backup_key)
        if (remote?.payload?.shifts?.length) {
          return { savedAt: remote.saved_at, payload: remote.payload }
        }
      }
    } catch {
      // solo locale
    }
    return null
  }

  async function resolvePayrollBackupByKey(key = payrollBackupKey) {
    const k = String(key || '').trim()
    if (!k) return null
    if (k.startsWith('local:')) {
      const idx = Number(k.slice(6))
      const entry = getStaffBackupEntry('payroll', idx, operatorBackupScope || '')
      if (entry?.payload) {
        return { savedAt: entry.savedAt, payload: entry.payload }
      }
      return null
    }
    try {
      const remote = await fetchStaffBackupDetail('payroll', k)
      if (remote?.payload) {
        return { savedAt: remote.saved_at, payload: remote.payload }
      }
    } catch {
      // fallback locale
    }
    const ym = unscopedStaffBackupKey(k, operatorBackupScope)
    const localHit = listStaffBackups('payroll', operatorBackupScope || '').find(
      (e) => e?.payload?.payrollMonthYm === ym || e?.payload?.payrollMonthYm === k,
    )
    if (localHit?.payload) {
      return { savedAt: localHit.savedAt, payload: localHit.payload }
    }
    return null
  }

  async function resolvePayrollBackup(monthYm = payrollMonthYm) {
    const scopedKey = payrollBackupServerKey(monthYm, operatorBackupScope)
    const server = await resolvePayrollBackupByKey(operatorBackupScope ? scopedKey : monthYm)
    if (server?.payload) return server
    return getLatestStaffBackup('payroll', operatorBackupScope || '')
  }

  function matchServerLocaleSummary(summaries, localeName) {
    const target = localeNameCompareKey(localeName)
    return (summaries || []).find((row) => localeNameCompareKey(row?.locale_name) === target)
  }

  async function listServerLocaleSummaries() {
    try {
      return await fetchStaffLocalePacks()
    } catch {
      return []
    }
  }

  async function localeRequiresAccessCode(localeName) {
    const stored = await readStoredLocaleAccessCode(localeName)
    if (isValidLocaleAccessCode(stored)) return true
    try {
      const summaries = await fetchStaffLocalePacks()
      const target = localeNameCompareKey(localeName)
      const hit = summaries.find((row) => localeNameCompareKey(row?.locale_name) === target)
      if (hit?.requires_access_code) return true
    } catch {
      // server assente: se in locale non c'è codice, non richiederlo
    }
    return false
  }

  async function verifyLocaleZoneAccess(localeName, accessCode) {
    const code = normalizeLocaleAccessCode(accessCode)
    const requiresCode = await localeRequiresAccessCode(localeName)
    if (!requiresCode) return { ok: true }
    if (!isValidLocaleAccessCode(code)) {
      return { ok: false, needsCode: true }
    }
    const summaries = await listServerLocaleSummaries()
    if (matchServerLocaleSummary(summaries, localeName)) {
      try {
        await fetchStaffLocalePack(localeName, code)
        await upsertStoredLocaleAccessCode(localeName, code)
        return { ok: true }
      } catch {
        return { ok: false, wrongCode: true }
      }
    }
    const stored = await readStoredLocaleAccessCode(localeName)
    if (stored && verifyLocaleAccessCode(stored, code)) {
      return { ok: true }
    }
    return { ok: false, wrongCode: true }
  }

  async function handleOpenLocaleSession() {
    const localeName = resolveCanonicalLocaleName(localeStaffName)
    if (!localeName) {
      setError('Inserisci o seleziona il locale da aprire.')
      return
    }
    if (localeName !== normalizeLocaleName(localeStaffName)) {
      setLocaleStaffName(localeName)
    }
    if (isStaffLocaleSessionOpen(localeName)) {
      setSuccess(`Locale «${localeName}» già aperto.`)
      return
    }
    const code = normalizeLocaleAccessCode(localeAccessCode)
    setLocaleSessionBusy(true)
    setError('')
    try {
      const access = await verifyLocaleZoneAccess(localeName, code)
      if (!access.ok) {
        setError(localeAccessErrorMessage({ ...access, localeName }, 'aprire il locale'))
        return
      }
      setStaffLocaleSessionOpen(localeName, true)
      setMembersBackupLocale(localeName)
      if (operatorMode) {
        await loadMembersFromLocalePackSilently(localeName, code)
      }
      setSuccess(`Locale «${localeName}» aperto. Usa Chiudi per bloccarlo di nuovo.`)
    } finally {
      setLocaleSessionBusy(false)
    }
  }

  function handleCloseLocaleSession() {
    const localeName = resolveCanonicalLocaleName(localeStaffName) || normalizeLocaleName(localeStaffName)
    if (!localeName) {
      setError('Seleziona il locale da chiudere.')
      return
    }
    const wasOpen = isStaffLocaleSessionOpen(localeName)
    setStaffLocaleSessionOpen(localeName, false)
    setLocaleAccessCode('')
    setLocaleSessionBusy(false)
    setError('')
    if (operatorMode) {
      clearStaffDataFromMemory()
    }
    setSuccess(
      wasOpen
        ? `Locale «${localeName}» chiuso. Inserisci il codice e clicca Accedi per riaprire.`
        : `Locale «${localeName}» già chiuso.`,
    )
  }

  async function assertActiveLocaleZoneAccess() {
    let localeName = resolveCanonicalLocaleName(localeStaffName || membersBackupLocale)
    if (!localeName) {
      for (const n of savedLocaleNames) {
        if (await localeRequiresAccessCode(n)) {
          return { ok: false, localeName: '', needsCode: true, needsLocale: true }
        }
      }
      return { ok: true, localeName: '', code: undefined }
    }
    const requiresCode = await localeRequiresAccessCode(localeName)
    if (requiresCode && !isStaffLocaleSessionOpen(localeName)) {
      return { ok: false, localeName, needsOpen: true }
    }
    const code = normalizeLocaleAccessCode(localeAccessCode)
    const access = await verifyLocaleZoneAccess(localeName, code)
    if (!access.ok) {
      return { ok: false, localeName, needsCode: access.needsCode, wrongCode: access.wrongCode }
    }
    return {
      ok: true,
      localeName,
      code: isValidLocaleAccessCode(code) ? code : undefined,
    }
  }

  function localeAccessErrorMessage(access, action) {
    if (access.needsLocale) {
      return `Seleziona il locale e inserisci il codice a 6 cifre prima di ${action}.`
    }
    if (access.needsOpen) {
      return `Apri il locale «${access.localeName}» con Accedi prima di ${action}.`
    }
    if (access.needsCode) {
      return `Inserisci il codice a 6 cifre del locale "${access.localeName}" per ${action}.`
    }
    return `Codice errato per "${access.localeName}". Non puoi ${action}.`
  }

  async function resolveLocalePack(localeName, accessCode) {
    const key = resolveCanonicalLocaleName(localeName)
    if (!key) return null
    const code = normalizeLocaleAccessCode(accessCode)
    const requiresCode = await localeRequiresAccessCode(key)

    if (requiresCode && !isValidLocaleAccessCode(code)) {
      return { denied: true, needsCode: true }
    }

    const store = await readStaffLocaleStore()
    const matchedStoreKey = findLocaleStoreKey(store, key)
    const local = matchedStoreKey ? store[matchedStoreKey] : null
    const localCode = normalizeLocaleAccessCode(local?.access_code)
    const localCodeOk =
      !localCode || !isValidLocaleAccessCode(code) || verifyLocaleAccessCode(localCode, code)

    if (local && localCodeOk && Array.isArray(local.members) && (local.members.length > 0 || operatorMode)) {
      return {
        saved_at: local.saved_at,
        members: local.members,
        sections: Array.isArray(local.sections) ? local.sections : [],
        access_code: localCode || code || null,
      }
    }

    try {
      const summaries = await listServerLocaleSummaries()
      if (!matchServerLocaleSummary(summaries, key)) {
        throw new Error('locale_not_on_server')
      }
      const remote = await fetchStaffLocalePack(key, isValidLocaleAccessCode(code) ? code : undefined)
      if (remote && Array.isArray(remote.members)) {
        const pack = {
          saved_at: remote.saved_at || new Date().toISOString(),
          members: remote.members,
          sections: Array.isArray(remote.sections) ? remote.sections : [],
          access_code: normalizeLocaleAccessCode(remote.access_code) || code || null,
        }
        const previousKey = findLocaleStoreKey(store, key)
        if (previousKey && previousKey !== key) delete store[previousKey]
        store[key] = pack
        await writeStaffLocaleStore(store)
        if (remote.members.length > 0) return pack
      }
    } catch (err) {
      const msg = String(err?.message || '')
      if (msg.includes('403') || msg.toLowerCase().includes('codice locale')) {
        return { denied: true }
      }
    }

    const backup = getMembersLocaleBackup(key)
    const backupCode = normalizeLocaleAccessCode(backup?.payload?.access_code)
    if (backup?.payload?.members?.length) {
      if (backupCode && isValidLocaleAccessCode(code) && !verifyLocaleAccessCode(backupCode, code)) {
        return { denied: true }
      }
      if (!backupCode || !code || verifyLocaleAccessCode(backupCode, code)) {
        return {
          saved_at: backup.savedAt,
          members: backup.payload.members,
          sections: Array.isArray(backup.payload.sections) ? backup.payload.sections : [],
          access_code: backupCode || code || null,
        }
      }
    }
    return null
  }

  const refreshSavedLocaleNames = useCallback(async () => {
    try {
      setLocaleSyncWarning('')
      const store = await readStaffLocaleStore()
      const names = new Set()
      const userNames = new Set()
      const serverNames = new Set()
      const meta = {}
      try {
        const summaries = await fetchStaffLocalePacks()
        for (const row of summaries) {
          const n = normalizeLocaleName(row?.locale_name)
          if (!n) continue
          serverNames.add(n)
          userNames.add(n)
          names.add(n)
          if (row.saved_at) meta[n] = row.saved_at
        }
      } catch (err) {
        if (isOnline()) {
          setLocaleSyncWarning(
            err?.message ||
              'Elenco locali e backup non sincronizzati dal server. Verifica connessione e deploy con RESTART_API=1.',
          )
        }
      }
      for (const [rawKey, pack] of Object.entries(store)) {
        const n = normalizeLocaleName(rawKey)
        if (!n) continue
        // Includi anche locali vuoti (creati con «Aggiungi locale»).
        if (pack && typeof pack === 'object') {
          names.add(n)
          userNames.add(n)
        }
        if (!meta[n] && pack?.saved_at) meta[n] = pack.saved_at
      }
      for (const backupName of listMembersLocaleBackupNames((name) => {
        if (!operatorMode || !operatorStationId) return true
        return operatorStationLocaleNameMatches(operatorStationId, name, [...names])
      })) {
        const n = normalizeLocaleName(backupName)
        if (n) {
          names.add(n)
          userNames.add(n)
          if (!meta[n]) {
            const savedAt = getMembersLocaleBackupSavedAt(n)
            if (savedAt) meta[n] = savedAt
          }
        }
      }
      const sortIt = (a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' })
      const deduped = []
      const seenLocaleKeys = new Set()
      for (const name of names) {
        const key = name.toLocaleLowerCase('it')
        if (seenLocaleKeys.has(key)) continue
        seenLocaleKeys.add(key)
        deduped.push(name)
      }
      let finalNames = deduped
      let finalUserNames = [...userNames]
      if (operatorMode && operatorStationId) {
        const keepLocale = (n) => operatorStationLocaleNameMatches(operatorStationId, n, deduped)
        finalNames = deduped.filter(keepLocale)
        finalUserNames = [...userNames].filter(keepLocale)
      }
      setLocalePackSavedAtByName(
        operatorMode && operatorStationId
          ? Object.fromEntries(
              Object.entries(meta).filter(([name]) =>
                finalNames.some((n) => localeNameCompareKey(n) === localeNameCompareKey(name)),
              ),
            )
          : meta,
      )
      setSavedLocaleNames(finalNames.sort(sortIt))
      setUserDeletableLocaleNames(finalUserNames.sort(sortIt))
    } catch (err) {
      console.warn('refreshSavedLocaleNames:', err)
    }
  }, [operatorMode, operatorStationId])

  useEffect(() => {
    void refreshSavedLocaleNames()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshSavedLocaleNames()
    }
    const onPageShow = () => void refreshSavedLocaleNames()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('focus', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('focus', onPageShow)
    }
  }, [refreshSavedLocaleNames])

  useEffect(() => {
    if (!operatorMode || !operatorStationId) return
    closeOtherOperatorStationStaffSessions(operatorStationId)
    const linked = getOperatorStationStaffLocaleName(operatorStationId, savedLocaleNames)
    if (!linked) return
    setLocaleStaffName(linked)
    setMembersBackupLocale(linked)
    if (!isOperatorStationStaffSessionOpen(operatorStationId, linked)) {
      clearStaffDataFromMemory()
      return
    }
    void (async () => {
      const stored = await readStoredLocaleAccessCode(linked)
      const code = isValidLocaleAccessCode(stored) ? stored : normalizeLocaleAccessCode(localeAccessCode)
      if (isValidLocaleAccessCode(code)) {
        setLocaleAccessCode(code)
      }
      await loadMembersFromLocalePackSilently(linked, code)
    })()
  }, [operatorMode, operatorStationId, savedLocaleNames, clearStaffDataFromMemory])

  useEffect(() => {
    const onServerDataRefresh = () => {
      void refreshSavedLocaleNames()
      void refreshBackupMeta()
      void refreshPayrollBackupOptions()
    }
    window.addEventListener('atlas-refresh-data', onServerDataRefresh)
    window.addEventListener('atlas-offline-sync-complete', onServerDataRefresh)
    return () => {
      window.removeEventListener('atlas-refresh-data', onServerDataRefresh)
      window.removeEventListener('atlas-offline-sync-complete', onServerDataRefresh)
    }
  }, [refreshSavedLocaleNames, refreshBackupMeta, refreshPayrollBackupOptions])

  async function handleSaveMembersByLocale() {
    const localeName = normalizeLocaleName(localeStaffName)
    if (!localeName) {
      setError('Inserisci il nome del locale prima di salvare i dipendenti')
      return
    }
    try {
      setError('')
      const snapshot = members.map(memberSnapshotFromRow)
      const sectionsForPack = resolveLocaleSections({
        localeName: localeName,
        savedSections: localeSections,
        members: snapshot,
      })
      const check = await assertLocalePackCanSave(localeName, snapshot)
      if (!check.ok) {
        setError(check.message)
        return
      }
      const saveName = check.canonicalName
      const accessCode = await resolveLocaleAccessCodeForSave(localeName)
      const store = await readStaffLocaleStore()
      const previousKey = findLocaleStoreKey(store, localeName)
      store[saveName] = {
        saved_at: new Date().toISOString(),
        members: snapshot,
        sections: sectionsForPack,
        access_code: accessCode,
        hidden_planning_sections: hiddenPlanningSections,
      }
      if (previousKey && previousKey !== saveName) {
        delete store[previousKey]
      }
      if (saveName !== localeName) {
        setLocaleStaffName(saveName)
      }
      await writeStaffLocaleStore(store)
      saveMembersLocaleBackup(saveName, {
        members: snapshot,
        sections: sectionsForPack,
        access_code: accessCode,
        hidden_planning_sections: hiddenPlanningSections,
      })
      try {
        await upsertStaffLocalePack(saveName, snapshot, accessCode, { sections: sectionsForPack })
      } catch (err) {
        const msg = err?.message || ''
        await refreshSavedLocaleNames()
        if (isOfflineQueuedMessage(msg)) {
          setSuccess(
            `Lista dipendenti salvata per "${saveName}" (${snapshot.length} elementi). Codice zona: ${accessCode} — condividilo con il personale. Verrà sincronizzata quando torna la connessione.`,
          )
        } else {
          setError(msg || 'Salvato solo su questo browser: il server non ha ricevuto il locale (riprova con connessione attiva).')
        }
        return
      }
      await refreshSavedLocaleNames()
      setSuccess(
        check.renamed
          ? `${check.message} Codice zona: ${accessCode}.`
          : `Lista dipendenti salvata per "${saveName}" (${snapshot.length} elementi). Codice zona: ${accessCode} — solo chi conosce il codice può caricare questo locale.`,
      )
    } catch {
      setError('Errore nel salvataggio locale dei dipendenti')
    }
  }

  async function handleCreateEmptyLocale() {
    const localeName = normalizeLocaleName(localeStaffName)
    if (!localeName) {
      setError('Inserisci il nome del locale prima di creare il locale vuoto')
      return
    }
    const storeBefore = await readStaffLocaleStore()
    const alreadyLocal = Boolean(findLocaleStoreKey(storeBefore, localeName))
    const alreadyListed = savedLocaleNames.some((n) => localeNameCompareKey(n) === localeNameCompareKey(localeName))
    if (alreadyLocal || alreadyListed) {
      setError(`"${localeName}" esiste già: selezionalo dall'elenco Locali salvati.`)
      return
    }
    try {
      setError('')
      const sectionsForPack = resolveLocaleSections({
        localeName,
        savedSections: defaultSectionsForLocale(localeName),
        members: [],
      })
      const accessCode = await resolveLocaleAccessCodeForSave(localeName)
      const store = await readStaffLocaleStore()
      store[localeName] = {
        saved_at: new Date().toISOString(),
        members: [],
        sections: sectionsForPack,
        access_code: accessCode,
      }
      await writeStaffLocaleStore(store)
      saveMembersLocaleBackup(localeName, {
        members: [],
        sections: sectionsForPack,
        access_code: accessCode,
        hidden_planning_sections: hiddenPlanningSections,
      })
      setLocaleStaffName(localeName)
      setLocaleAccessCode(accessCode)
      try {
        await upsertStaffLocalePack(localeName, [], accessCode, { sections: sectionsForPack })
        setSuccess(`Locale vuoto "${localeName}" creato. Codice zona: ${accessCode}.`)
      } catch (err) {
        const msg = String(err?.message || '')
        if (isOfflineQueuedMessage(msg)) {
          setSuccess(
            `Locale vuoto "${localeName}" salvato su questo browser (codice ${accessCode}). Si sincronizza quando torna la connessione.`,
          )
        } else {
          setSuccess(
            `Locale vuoto "${localeName}" creato su questo browser (codice ${accessCode}). Sync server non riuscita: ${msg || 'riprova più tardi'}.`,
          )
        }
      }
      await refreshSavedLocaleNames()
      await refreshBackupMeta()
    } catch (err) {
      setError(err?.message || 'Creazione locale vuoto non riuscita')
      await refreshSavedLocaleNames()
    }
  }

  async function handleDeleteLocaleName() {
    const localeName = resolveCanonicalLocaleName(localeStaffName)
    if (!localeName) {
      setError('Inserisci o seleziona il locale da eliminare.')
      return
    }
    const storeProbe = await readStaffLocaleStore()
    const existsLocally = Boolean(findLocaleStoreKey(storeProbe, localeName))
    if (!isUserDeletableLocaleName(localeName) && !existsLocally) {
      setError(`"${localeName}" non può essere eliminato da qui (locale di sistema o non ancora salvato).`)
      return
    }
    const code = normalizeLocaleAccessCode(localeAccessCode)
    const access = await verifyLocaleZoneAccess(localeName, code)
    if (!access.ok) {
      if (access.needsCode) {
        setError(`Inserisci il codice a 6 cifre per eliminare "${localeName}".`)
      } else {
        setError(`Codice errato per "${localeName}". Non puoi eliminare questo locale.`)
      }
      return
    }
    if (
      !window.confirm(
        `Eliminare il locale "${localeName}" dall'elenco?\n\nVengono rimossi il nome salvato e l'eventuale backup dipendenti associato. L'elenco dipendenti attuale in tabella non viene modificato.`,
      )
    ) {
      return
    }
    setError('')
    try {
      let serverDeleted = false
      try {
        await deleteStaffLocalePack(localeName, isValidLocaleAccessCode(code) ? code : undefined)
        serverDeleted = true
      } catch (err) {
        const msg = String(err?.message || '')
        if (msg.includes('Codice') || msg.includes('403')) {
          setError(`Codice errato per "${localeName}". Non puoi eliminare questo locale.`)
          return
        }
        if (!msg.includes('404') && !msg.includes('non trovato')) {
          throw err
        }
      }
      await removeStaffLocaleFromStore(localeName)
      deleteMembersLocaleBackup(localeName)
      setLocalePackSavedAtByName((prev) => {
        const next = { ...prev }
        delete next[localeName]
        return next
      })
      if (normalizeLocaleName(membersBackupLocale) === localeName) {
        setMembersBackupLocale('')
      }
      setLocaleStaffName('')
      setLocaleAccessCode('')
      await refreshSavedLocaleNames()
      await refreshBackupMeta()
      setSuccess(
        serverDeleted
          ? `Locale "${localeName}" eliminato.`
          : `Locale "${localeName}" eliminato da questo browser (non trovato sul server).`,
      )
    } catch (err) {
      setError(err?.message || 'Eliminazione locale non riuscita')
    }
  }

  async function syncMembersFromLocalePack(packMembers, localeName, accessCode, { operatorScoped = false } = {}) {
    let existingList = []
    try {
      const existing = await fetchStaffMembers()
      existingList = Array.isArray(existing) ? existing : []
    } catch {
      // Offline senza cache GET: usa lo stato attuale in memoria.
      existingList = Array.isArray(members) ? [...members] : []
    }
    const packRows = Array.isArray(packMembers) ? packMembers : []
    const packByKey = new Map()
    for (const pm of packRows) {
      const key = String(pm.name || '').trim().toLocaleLowerCase('it')
      if (!key) continue
      packByKey.set(key, pm)
    }
    const keptIds = new Set()
    const nextMembersByKey = new Map()

    for (const [, pm] of packByKey) {
      const key = String(pm.name || '').trim().toLocaleLowerCase('it')
      const hit = existingList.find(
        (m) => String(m.name || '').trim().toLocaleLowerCase('it') === key,
      )
      const body = {
        name: String(pm.name || '').trim() || 'Dipendente',
        first_name: pm.first_name || null,
        last_name: pm.last_name || null,
        email: pm.email || null,
        phone: pm.phone || null,
        city: pm.city || null,
        section: pm.section || null,
        birth_date: pm.birth_date || null,
        is_active: pm.is_active !== false,
        hourly_rate: pm.hourly_rate != null ? Number(pm.hourly_rate) : null,
        sort_order: Number.isFinite(Number(pm.sort_order)) ? Number(pm.sort_order) : 0,
      }
      if (hit) {
        const updated = await updateStaffMember(hit.id, body)
        const updatedId = updated?.id ?? hit.id
        keptIds.add(updatedId)
        nextMembersByKey.set(key, { ...hit, ...body, id: updatedId })
      } else {
        const created = await createStaffMember(body)
        if (created?.id != null) {
          keptIds.add(created.id)
          nextMembersByKey.set(key, { ...body, id: created.id })
        }
      }
    }

    if (!operatorScoped) {
      for (const m of existingList) {
        if (!keptIds.has(m.id)) {
          await deleteStaffMember(m.id, localeName || undefined, accessCode)
        }
      }
    }

    let list = []
    if (operatorScoped) {
      list = Array.from(nextMembersByKey.values())
    } else {
      try {
        const mem = await fetchStaffMembers()
        list = Array.isArray(mem) ? mem : []
      } catch {
        list = Array.from(nextMembersByKey.values())
      }
    }
    setMembers(list)
    return list
  }

  async function loadMembersFromLocalePackSilently(localeName, code) {
    const pack = await resolveLocalePack(localeName, code)
    if (pack?.denied) {
      setStaffLocaleSessionOpen(localeName, false)
      if (operatorStationId) {
        setOperatorStationStaffSession(operatorStationId, localeName, false)
      }
      clearStaffDataFromMemory()
      return []
    }
    if (!pack || !Array.isArray(pack.members) || pack.members.length === 0) {
      if (operatorMode) {
        setMembers([])
        return []
      }
      clearStaffDataFromMemory()
      return []
    }
    const mem = await syncMembersFromLocalePack(
      pack.members,
      localeName,
      isValidLocaleAccessCode(code) ? code : undefined,
      { operatorScoped: operatorMode },
    )
    if (operatorMode && operatorStationId) {
      invalidateOperatorStationMembersCache(operatorStationId, localeName)
    }
    applyLocaleSections(
      Array.isArray(pack.sections) ? pack.sections : [],
      Array.isArray(pack.sections) && pack.sections[0] ? pack.sections[0] : '',
      mem,
    )
    applyHiddenPlanningSectionsFromSources(pack.hidden_planning_sections)
    markPlanningStale()
    return mem
  }

  async function handleLoadMembersByLocale() {
    const localeName = resolveCanonicalLocaleName(localeStaffName)
    if (!localeName) {
      setError('Inserisci il nome del locale prima di caricare i dipendenti')
      return
    }
    if (localeName !== normalizeLocaleName(localeStaffName)) {
      setLocaleStaffName(localeName)
    }
    const code = normalizeLocaleAccessCode(localeAccessCode)
    const requiresCode = await localeRequiresAccessCode(localeName)
    if (requiresCode && !isValidLocaleAccessCode(code)) {
      setError(
        `Inserisci il codice a 6 cifre per "${localeName}" (es. dal database). Senza codice corretto non puoi caricare dipendenti di altre zone.`,
      )
      return
    }
    const pack = await resolveLocalePack(localeName, code)
    if (pack?.denied) {
      setError(`Codice errato per "${localeName}". Verifica il codice nel database e riprova.`)
      return
    }
    if (!pack || !Array.isArray(pack.members) || pack.members.length === 0) {
      setError(`Nessuna lista salvata trovata per il locale "${localeName}" (né su questo browser né sul server).`)
      return
    }
    if (
      !window.confirm(
        `Caricare i dipendenti salvati per "${localeName}"?\n\nL'elenco viene allineato al backup (stessi nomi aggiornati, altri rimossi). I turni già pianificati restano collegati ai dipendenti con lo stesso nome.`,
      )
    ) {
      return
    }

    try {
      setError('')
      setShiftBusy(true)
      const mem = await syncMembersFromLocalePack(
        pack.members,
        localeName,
        isValidLocaleAccessCode(code) ? code : undefined,
      )
      applyLocaleSections(
        Array.isArray(pack.sections) ? pack.sections : [],
        Array.isArray(pack.sections) && pack.sections[0] ? pack.sections[0] : '',
        mem,
      )
      applyHiddenPlanningSectionsFromSources(pack.hidden_planning_sections)
      markPlanningStale()
      setMemberInfoId(null)
      setEditingShiftId(null)
      setFormMemberIds(new Set())
      setFormDate(toYMD(new Date()))
      setFormStart('08:00')
      setFormEnd('16:00')
      setFormKind('shift')
      setFormNotes('')
      let payrollUpdated = true
      try {
        await applyPayrollFromShifts(mem)
      } catch {
        payrollUpdated = false
      }
      setSuccess(
        payrollUpdated
          ? `Lista dipendenti caricata per locale "${localeName}" (${pack.members.length} elementi). Ore e costi aggiornati dai turni del mese.`
          : `Lista dipendenti caricata per locale "${localeName}" (${pack.members.length} elementi). Offline: ore e costi restano invariati finché non ricarichi i turni.`,
      )
    } catch (err) {
      setError(err?.message || 'Errore nel caricamento dipendenti per locale')
      await refreshMembers()
    } finally {
      setShiftBusy(false)
    }
  }

  function startEditShift(s) {
    setError('')
    setEditingShiftId(s.id)
    setFormMemberIds(new Set([s.staff_member_id]))
    setFormDate(s.work_date)
    setFormStart(timeInputValue(s.time_start))
    setFormEnd(timeInputValue(s.time_end))
    setFormKind(s.entry_kind || 'shift')
    setFormNotes(s.notes || '')
    const member = members.find((m) => Number(m.id) === Number(s.staff_member_id))
    const section = normalizeSectionName(member?.section) || planningSection || localeSections[0] || ''
    if (section) setFormGenere(section)
  }

  const resetForm = useCallback(() => {
    setEditingShiftId(null)
    setFormMemberIds(new Set())
    setFormDate(toYMD(new Date()))
    setFormStart('08:00')
    setFormEnd('16:00')
    setFormKind('shift')
    setFormNotes('')
    setFormGenere(planningSection || '')
    setError('')
  }, [planningSection])

  /** Mantieni i dipendenti selezionati nel modulo turni allineati all’elenco reale (evita POST con id eliminato → 400). */
  useEffect(() => {
    if (members.length === 0) {
      setFormMemberIds((prev) => (prev.size === 0 ? prev : new Set()))
      return
    }
    setFormMemberIds((prev) => {
      const valid = new Set(members.map((m) => m.id))
      const next = new Set([...prev].filter((id) => valid.has(id)))
      if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev
      return next
    })
  }, [members])

  /** Allinea vista planning alla data del turno salvato (evita che sparisca dopo voce/AI se dayFocus o settimana erano altri giorni). */
  function focusPlanningOnWorkDate(ymd) {
    if (!ymd || typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return
    const d = parseYMD(ymd)
    if (Number.isNaN(d.getTime())) return

    if (planView === 'day') {
      setDayFocus(d)
      return
    }
    if (planView === 'week') {
      setWeekAnchor(startOfWeekMonday(d))
      return
    }
    if (planView === 'period') {
      const fa = toYMD(periodFrom)
      const fb = toYMD(periodTo)
      const lo = fa <= fb ? fa : fb
      const hi = fa <= fb ? fb : fa
      if (ymd < lo) {
        if (fa <= fb) setPeriodFrom(d)
        else setPeriodTo(d)
      } else if (ymd > hi) {
        if (fa <= fb) setPeriodTo(d)
        else setPeriodFrom(d)
      }
    }
  }

  async function handleGeminiShiftCompile(spoken) {
    const t = String(spoken || '').trim()
    if (!t) return
    if (editingShiftId) {
      setError('Termina la modifica in corso prima di aggiungere un turno con Gemini.')
      return
    }
    const selectedDate = formDate || dayStr
    const geminiContext = {
      selected_date: selectedDate,
      today: toYMD(new Date()),
      plan_view: planView,
      week_start: rangeFromStr,
      week_end: rangeToStr,
    }
    setAiShiftText(t)
    try {
      setAiShiftLoading(true)
      setError('')
      setAiShiftSummary('Atlas AI elabora il comando…')
      const memberNames = members.map((m) => m.name).filter(Boolean)
      const r = await suggestStaffShift(t, memberNames, geminiContext)
      const rawItems = collectShiftsFromGemini(r, members, t, selectedDate, geminiContext)

      if (!rawItems.length) {
        const warnings = (r?.warnings || []).join(' · ')
        const quota = r?.quota_exceeded
        setError(
          quota
            ? `${warnings} Puoi ancora usare comandi semplici (es. "Marianna 8-16" o "tutti lunedì-venerdì 8-16") con compilazione locale.`
            : warnings
              || 'Comando non compreso. Per tutti: "tutti i dipendenti lunedì-venerdì turno 8-16" (vista Settimana). Per uno: "Marianna martedì 8-16".',
        )
        setAiShiftSummary('')
        return
      }

      const usedLocal = r?.quota_exceeded || r?.local_fallback

      const resolved = []
      const seen = new Set()
      for (const item of rawItems) {
        const one = resolveOneShiftSuggestion(item, members, t, selectedDate)
        if (one.error || !one.data) continue
        const key = `${one.staffId}|${one.workDate}|${one.data.entry_kind}|${one.data.time_start}|${one.data.time_end}`
        if (seen.has(key)) continue
        seen.add(key)
        resolved.push(one)
      }

      if (!resolved.length) {
        setError('Nessun turno valido: indica dipendente e orari (es. 8-16).')
        setAiShiftSummary('')
        return
      }

      let toSave = resolved
      let truncated = false
      if (toSave.length > MAX_GEMINI_SHIFTS_BATCH) {
        toSave = toSave.slice(0, MAX_GEMINI_SHIFTS_BATCH)
        truncated = true
      }

      const first = toSave[0]
      setFormMemberIds(new Set(toSave.map((row) => row.staffId)))
      setFormDate(first.workDate)
      setFormKind(first.entryKind)
      setFormStart(first.timeStart)
      setFormEnd(first.timeEnd)

      setShiftBusy(true)
      let ok = 0
      let fail = 0
      for (let i = 0; i < toSave.length; i += 1) {
        setAiShiftSummary(`Salvataggio turni ${i + 1} / ${toSave.length}…`)
        try {
          await createStaffShift(toSave[i].data)
          ok += 1
        } catch {
          fail += 1
        }
      }

      const lastDate = toSave[toSave.length - 1].workDate
      focusPlanningOnWorkDate(lastDate)
      const localNote = usedLocal ? ' (compilazione locale — quota Gemini esaurita)' : ''
      if (toSave.length === 1) {
        const timesLabel =
          first.timeStart && first.timeEnd ? ` ${first.timeStart}–${first.timeEnd}` : ''
        setSuccess(`Turno aggiunto: ${first.memberName}, ${first.workDate}${timesLabel}.${localNote}`)
      } else {
        setSuccess(
          `Aggiunti ${ok} turni${fail ? ` (${fail} non salvati)` : ''}${truncated ? ` — limite ${MAX_GEMINI_SHIFTS_BATCH}, riduci il periodo` : ''}.${localNote}`,
        )
      }
      setAiShiftSummary(ok > 1 ? `${ok} turni in pianificazione` : 'Salvato in pianificazione')
      setAiShiftText('')
      resetForm()
      if (planView === 'day') {
        setFormDate(lastDate)
        setDayFocus(parseYMD(lastDate))
      }
      await reloadPlanning()
    } catch (err) {
      const msg = String(err?.message || '')
      if (err?.name === 'AbortError') {
        setError('Gemini ha impiegato troppo tempo. Prova comandi più corti o meno giorni.')
      } else if (msg.includes('400')) {
        setError(msg.replace(/^400:\s*/, '') || 'Richiesta non valida: controlla dipendente e orari.')
      } else {
        setError('Atlas AI non disponibile. Avvia Ollama (ollama serve) e il backend FastAPI (porta 8000).')
      }
      setAiShiftSummary('')
    } finally {
      setAiShiftLoading(false)
      setShiftBusy(false)
    }
  }

  function buildShiftPayloadForMember(staffId) {
    const payload = {
      staff_member_id: staffId,
      work_date: formDate,
      time_start: formKind === 'shift' || formKind === 'permission' ? `${formStart}:00` : null,
      time_end: formKind === 'shift' || formKind === 'permission' ? `${formEnd}:00` : null,
      entry_kind: formKind,
      notes: formNotes.trim() || null,
    }
    if (formKind === 'shift') {
      if (!formStart || !formEnd) {
        return { error: 'Per il turno servono ora inizio e fine' }
      }
    }
    if (formKind === 'permission') {
      if ((formStart && !formEnd) || (!formStart && formEnd)) {
        return { error: 'Permesso: indicare sia inizio sia fine, oppure lasciare vuoto e usare le note' }
      }
      if (!formStart) {
        payload.time_start = null
        payload.time_end = null
      }
    }
    if (isAllDayKind(formKind)) {
      payload.time_start = null
      payload.time_end = null
    }
    return { payload }
  }

  async function handleLoadMemberIntoWeekDays() {
    if (shiftBusy) return
    if (editingShiftId) {
      setError('Termina la modifica in corso prima di caricare in settimana.')
      return
    }
    const staffIds = [...formMemberIds]
    if (!staffIds.length) {
      setError('Seleziona almeno un dipendente')
      return
    }
    if (weekLoadDays.size === 0) {
      setError('Seleziona almeno un giorno della settimana.')
      return
    }
    const invalid = staffIds.filter((id) => !members.some((m) => m.id === id))
    if (invalid.length) {
      setError('Uno o più dipendenti selezionati non sono più in elenco.')
      await refreshMembers()
      return
    }

    const anchor = weekLoadTargetAnchor
    const weekFrom = toYMD(anchor)
    const weekTo = toYMD(addDays(anchor, 6))
    const dayLabels = [...weekLoadDays]
      .sort((a, b) => a - b)
      .map((off) => WEEK_LOAD_DAY_OPTIONS.find((d) => d.offset === off)?.label)
      .filter(Boolean)
      .join(', ')

    setPlanView('week')
    setWeekAnchor(anchor)
    setShiftBusy(true)
    setError('')
    try {
      const existing = await fetchStaffShifts(weekFrom, weekTo)
      const existingList = normalizeShiftRows(existing, members)
      let created = 0
      let skipped = 0
      const savedDates = []

      for (const staffId of staffIds) {
        const built = buildShiftPayloadForMember(staffId)
        if (built.error) {
          setError(built.error)
          return
        }
        for (const offset of [...weekLoadDays].sort((a, b) => a - b)) {
          const ymd = toYMD(addDays(anchor, offset))
          const exists = existingList.some((s) =>
            shiftEntryMatches(s, staffId, ymd, formKind, built.payload.time_start, built.payload.time_end),
          )
          if (exists) {
            skipped += 1
            continue
          }
          const createdRow = await createStaffShift({ ...built.payload, work_date: ymd })
          created += 1
          savedDates.push(ymd)
          existingList.push(
            normalizeShiftRows([createdRow], members)[0] || {
              staff_member_id: staffId,
              work_date: ymd,
              entry_kind: formKind,
              time_start: built.payload.time_start,
              time_end: built.payload.time_end,
            },
          )
        }
      }

      setPlanningLoaded(true)
      if (savedDates.length > 0) {
        focusPlanningOnWorkDate(savedDates[savedDates.length - 1])
      }
      await loadForRange(anchor, addDays(anchor, 6))
      const memberLabel =
        staffIds.length === 1
          ? members.find((m) => m.id === staffIds[0])?.name || 'Dipendente'
          : `${staffIds.length} dipendenti`
      setSuccess(
        created > 0
          ? `Caricato ${memberLabel} in settimana (${weekFrom} → ${weekTo}) per: ${dayLabels}. Creati ${created} turni${skipped ? `, ${skipped} già presenti` : ''}.`
          : `Nessun nuovo turno: i dipendenti selezionati hanno già voci per i giorni scelti (${dayLabels}).`,
      )
      setFormMemberIds(new Set())
    } catch (err) {
      setError(err?.message || 'Errore caricamento in settimana')
    } finally {
      setShiftBusy(false)
    }
  }

  async function handleSubmitShift(e) {
    e.preventDefault()
    if (!editingShiftId) return
    if (shiftBusy) return
    const staffIds = [...formMemberIds]
    if (!staffIds.length) {
      setError('Seleziona almeno un dipendente')
      return
    }
    if (staffIds.length !== 1) {
      setError('In modifica puoi selezionare un solo dipendente.')
      return
    }
    const invalid = staffIds.filter((id) => !members.some((m) => m.id === id))
    if (invalid.length) {
      setError('Uno o più dipendenti selezionati non sono più in elenco.')
      await refreshMembers()
      return
    }
    const savedWorkDate = formDate

    setShiftBusy(true)
    try {
      setError('')
      const staffId = staffIds[0]
      const built = buildShiftPayloadForMember(staffId)
      if (built.error) {
        setError(built.error)
        return
      }
      await updateStaffShift(editingShiftId, { ...built.payload, work_date: formDate })
      setSuccess('Voce aggiornata')
      focusPlanningOnWorkDate(savedWorkDate)
      resetForm()
      await reloadPlanningForWorkDate(savedWorkDate)
    } catch (err) {
      const msg = String(err?.message || '')
      if (msg.includes('404') || msg.includes('Voce non trovata') || msg.includes('Not Found')) {
        resetForm()
        setError('La voce non esiste più (già eliminata o elenco non aggiornato). Modulo ripristinato.')
        await reloadPlanning()
      } else if (msg.includes('400') && msg.includes('Dipendente non trovato')) {
        await refreshMembers()
        resetForm()
        setError('Dipendente non valido o non più presente: elenco aggiornato e modulo ripristinato.')
        await reloadPlanning()
      } else if (msg.includes('400')) {
        setError(msg.replace(/^400:\s*/, '') || 'Richiesta non valida: controlla tipo voce, orari e dipendente.')
      } else {
        setError(msg || 'Errore salvataggio')
      }
    } finally {
      setShiftBusy(false)
    }
  }

  async function handleDeleteShift(id) {
    if (shiftBusy) return
    if (!window.confirm('Eliminare questa voce?')) return
    setShiftBusy(true)
    try {
      setError('')
      let res = null
      let queuedOffline = false
      try {
        res = await deleteStaffShift(id)
        queuedOffline = isQueuedOfflineResponse(res)
      } catch (err) {
        if (!isOnline()) {
          queuedOffline = true
          await patchCachedListsForDelete(`/staff/shifts/${id}`)
        } else throw err
      }
      if (queuedOffline) {
        setShifts((prev) => removeShiftFromLists(prev, id))
        setPayrollShifts((prev) => removeShiftFromLists(prev, id))
        setSuccess('Voce rimossa in locale: sincronizzazione automatica alla prossima connessione.')
      } else {
        setSuccess('Voce eliminata')
        await reloadPlanning()
      }
      if (editingShiftId === id) resetForm()
    } catch (err) {
      const msg = String(err?.message || '')
      if (msg.includes('404') || msg.includes('Voce non trovata') || msg.includes('Not Found')) {
        if (editingShiftId === id) resetForm()
        setError('Voce già assente sul server. Elenco aggiornato.')
        if (!isOnline()) {
          setShifts((prev) => removeShiftFromLists(prev, id))
          setPayrollShifts((prev) => removeShiftFromLists(prev, id))
        } else {
          await reloadPlanning()
        }
      } else {
        setError(msg || 'Errore eliminazione')
      }
    } finally {
      setShiftBusy(false)
    }
  }

  async function handleDeleteWeekPlanning() {
    if (shiftBusy || loading) return
    const periodoDesc =
      planView === 'week'
        ? `settimana visibile (dal ${rangeFromStr} al ${rangeToStr})`
        : planView === 'day'
          ? `giorno ${dayLongLabel} (${rangeFromStr})`
          : `periodo scelto (dal ${rangeFromStr} al ${rangeToStr})`
    if (
      !window.confirm(
        `Eliminare TUTTE le voci di pianificazione per ${periodoDesc}?\n\nL’anagrafica dipendenti non viene toccata.`,
      )
    ) {
      return
    }
    setShiftBusy(true)
    setError('')
    try {
      let r = null
      let queuedOffline = false
      try {
        r = await deleteStaffShiftsBulk(rangeFromStr, rangeToStr)
        queuedOffline = isQueuedOfflineResponse(r)
      } catch (err) {
        if (!isOnline()) {
          queuedOffline = true
          const q = new URLSearchParams({ from: rangeFromStr, to: rangeToStr })
          await patchCachedListsForDelete(`/staff/shifts/bulk?${q}`)
        } else throw err
      }
      const removedCount = queuedOffline
        ? shifts.filter((row) => {
            const wd = shiftWorkDateKey(row.work_date)
            return wd >= rangeFromStr && wd <= rangeToStr
          }).length
        : r?.deleted ?? 0
      if (queuedOffline) {
        setShifts((prev) => filterShiftsOutsideRange(prev, rangeFromStr, rangeToStr))
        setPayrollShifts((prev) => filterShiftsOutsideRange(prev, rangeFromStr, rangeToStr))
        setSuccess(
          removedCount > 0
            ? `Eliminate ${removedCount} voci di planning in locale: sincronizzazione automatica alla prossima connessione.`
            : 'Nessuna voce da eliminare in questo periodo.',
        )
      } else {
        setSuccess(removedCount > 0 ? `Eliminate ${removedCount} voci di planning.` : 'Nessuna voce da eliminare in questo periodo.')
        await reloadPlanning()
      }
      resetForm()
    } catch (err) {
      setError(err?.message || 'Errore eliminazione planning')
    } finally {
      setShiftBusy(false)
    }
  }

  async function handleCopyPlanning(sectionName = planningSection) {
    if (shiftBusy || loading) return
    if (planView === 'period' && periodTooLong) {
      setError(`Intervallo troppo lungo (${periodDayCount} giorni). Massimo ${MAX_PLANNING_PERIOD_DAYS} giorni.`)
      return
    }
    if (members.length === 0) {
      setError('Aggiungi almeno un dipendente prima di copiare il planning.')
      return
    }

    applyPlanningSection(sectionName)
    const sectionLabel = normalizeSectionName(sectionName)

    const { fromStr: sourceFromStr, toStr: sourceToStr, dayCount } = computeVisiblePlanningRange(
      planView,
      weekAnchor,
      dayFocus,
      periodFrom,
      periodTo,
    )
    const srcLabel = copyPlanningSourceLabel(planView)

    setShiftBusy(true)
    setError('')
    try {
      let mem = members
      try {
        const fetched = await fetchStaffMembers()
        if (Array.isArray(fetched) && fetched.length) mem = fetched
      } catch {
        /* usa elenco locale */
      }

      const sourceShifts = (await fetchPlanningShiftsInRange(sourceFromStr, sourceToStr, mem, shifts)).filter((row) =>
        sectionName ? shiftBelongsToSection(row, sectionName, mem, localeSections) : true,
      )
      if (!sourceShifts.length) {
        setError(
          sectionLabel
            ? `Nessuna voce ${sectionLabel} nella ${srcLabel} (${sourceFromStr} → ${sourceToStr}).`
            : `Nessuna voce nella ${srcLabel} (${sourceFromStr} → ${sourceToStr}).`,
        )
        return
      }

      const pack = buildPlanningClipboardPack(planView, sourceFromStr, sourceToStr, dayCount, sourceShifts)
      setPlanningClipboard(pack)
      writePlanningClipboard(pack)
      setSuccess(
        `Copiati ${sourceShifts.length} turni${sectionLabel ? ` (${sectionLabel})` : ''} (${sourceFromStr} → ${sourceToStr}). Vai al periodo di destinazione e premi Incolla.`,
      )
    } catch (err) {
      setError(err?.message || 'Copia planning non riuscita')
    } finally {
      setShiftBusy(false)
    }
  }

  async function handlePastePlanning() {
    if (shiftBusy || loading) return
    if (planView === 'period' && periodTooLong) {
      setError(`Intervallo troppo lungo (${periodDayCount} giorni). Massimo ${MAX_PLANNING_PERIOD_DAYS} giorni.`)
      return
    }
    if (members.length === 0) {
      setError('Aggiungi almeno un dipendente prima di incollare il planning.')
      return
    }
    const pack = planningClipboard
    if (!pack?.shifts?.length) {
      setError('Nessun planning copiato. Usa prima Copia sulla settimana o periodo sorgente.')
      return
    }

    const {
      start: destStart,
      end: destEnd,
      fromStr: destFromStr,
      toStr: destToStr,
      dayCount: destDayCount,
    } = computeVisiblePlanningRange(planView, weekAnchor, dayFocus, periodFrom, periodTo)
    const dstLabel = copyPlanningSourceLabel(planView)

    if (destDayCount < pack.dayCount) {
      setError(
        `Il periodo visibile (${destFromStr} → ${destToStr}, ${destDayCount} giorni) è più corto del planning copiato (${pack.sourceFromStr} → ${pack.sourceToStr}, ${pack.dayCount} giorni).`,
      )
      return
    }

    if (
      !window.confirm(
        `Incollare ${pack.shifts.length} voci copiate da ${pack.sourceFromStr} → ${pack.sourceToStr} nella ${dstLabel} (${destFromStr} → ${destToStr})?\n\nOgni dipendente viene ricollegato per nome. Le voci già presenti nel periodo di destinazione non vengono duplicate.`,
      )
    ) {
      return
    }

    setShiftBusy(true)
    setError('')
    try {
      const destExisting = await fetchPlanningShiftsInRange(destFromStr, destToStr, members, shifts)
      const { created, skipped, missingNames } = await replicatePlanningShifts({
        clipShifts: pack.shifts,
        destFromStr,
        destToStr,
        members,
        destExisting,
      })

      markPlanningStale()
      await loadForRange(destStart, destEnd)
      setPlanningLoaded(true)

      const missingMsg =
        missingNames > 0 ? ` ${missingNames} voci saltate: dipendente non trovato in anagrafica.` : ''
      setSuccess(
        created > 0
          ? `Incollati ${created} turni nella ${dstLabel} (${destFromStr} → ${destToStr}).${skipped ? ` Saltate ${skipped} voci.` : ''}${missingMsg}`
          : `Nessuna nuova voce incollata: il periodo ha già tutte le voci oppure non ci sono turni validi da incollare.${missingMsg}`,
      )
    } catch (err) {
      setError(err?.message || 'Incolla planning non riuscita')
    } finally {
      setShiftBusy(false)
    }
  }

  async function handleBackupMembers() {
    if (members.length === 0) {
      setError('Nessun dipendente da salvare nel backup.')
      return
    }
    const localeName = normalizeLocaleName(membersBackupLocale || localeStaffName)
    if (!localeName) {
      setError('Seleziona o inserisci il nome locale per il backup dipendenti.')
      return
    }
    setBackupBusy(true)
    setError('')
    try {
      const snapshot = members.map(memberSnapshotFromRow)
      const sectionsForPack = resolveLocaleSections({
        localeName,
        savedSections: localeSections,
        members: snapshot,
      })
      const check = await assertLocalePackCanSave(localeName, snapshot)
      if (!check.ok) {
        setError(check.message)
        return
      }
      const saveName = check.canonicalName
      const accessCode = await resolveLocaleAccessCodeForSave(localeName)
      saveMembersLocaleBackup(saveName, {
        members: snapshot,
        sections: sectionsForPack,
        access_code: accessCode,
        hidden_planning_sections: hiddenPlanningSections,
      })
      const saved = await upsertStaffLocalePack(saveName, snapshot, accessCode, { sections: sectionsForPack })
      setMembersBackupLocale(saveName)
      if (saveName !== localeName) {
        setLocaleStaffName(saveName)
      }
      setLocalePackSavedAtByName((prev) => ({
        ...prev,
        [saveName]: saved?.saved_at || new Date().toISOString(),
      }))
      await refreshSavedLocaleNames()
      await refreshBackupMeta(planningBackupSlot, saveName)
      setSuccess(
        check.renamed
          ? `${check.message} Codice zona: ${accessCode}.`
          : `Backup dipendenti creato per "${saveName}" (${members.length} voci). Codice zona: ${accessCode}.`,
      )
    } catch (err) {
      const msg = err?.message || ''
      if (isOfflineQueuedMessage(msg)) {
        setSuccess(
          `Backup salvato solo su questo browser per "${localeName}" (verrà sincronizzato quando torna la connessione).`,
        )
      } else {
        setError(msg || `Backup salvato solo su questo browser per "${localeName}" (server non raggiungibile).`)
      }
      setMembersBackupLocale(localeName)
      await refreshSavedLocaleNames()
      await refreshBackupMeta(planningBackupSlot, localeName)
    } finally {
      setBackupBusy(false)
    }
  }

  async function handleRestoreMembersBackup() {
    const localeName = normalizeLocaleName(membersBackupLocale)
    if (!localeName) {
      setError('Seleziona il locale di cui ripristinare il backup dipendenti.')
      return
    }
    const code = normalizeLocaleAccessCode(localeAccessCode)
    const requiresCode = await localeRequiresAccessCode(localeName)
    if (requiresCode && !isValidLocaleAccessCode(code)) {
      setError('Inserisci il codice a 6 cifre del locale per ripristinare il backup.')
      return
    }
    const pack = await resolveLocalePack(localeName, code)
    if (pack?.denied) {
      setError('Codice errato: non puoi ripristinare il backup di un altro locale.')
      return
    }
    const rows = pack?.members
    if (!rows?.length) {
      setError(`Nessun backup dipendenti per il locale "${localeName}".`)
      return
    }
    const when = formatStaffBackupLabel(pack.saved_at) || 'backup'
    if (
      !window.confirm(
        `Ripristinare ${rows.length} dipendenti per "${localeName}" dal backup del ${when}?\n\nVengono aggiunti i nomi mancanti; quelli già in elenco non vengono duplicati.`,
      )
    ) {
      return
    }
    setBackupBusy(true)
    setError('')
    try {
      let mem = []
      try {
        mem = await fetchStaffMembers()
      } catch {
        mem = Array.isArray(members) ? [...members] : []
      }
      const names = new Set(mem.map((m) => String(m.name || '').trim().toLowerCase()).filter(Boolean))
      let added = 0
      for (const m of rows) {
        const name = String(m.name || '').trim()
        if (!name) continue
        const key = name.toLowerCase()
        if (names.has(key)) continue
        await createStaffMember({
          name,
          first_name: m.first_name || null,
          last_name: m.last_name || null,
          email: m.email || null,
          phone: m.phone || null,
          city: m.city || null,
          section: m.section || null,
          birth_date: m.birth_date || null,
          sort_order: m.sort_order,
          hourly_rate: m.hourly_rate,
          is_active: m.is_active !== false,
        })
        names.add(key)
        added += 1
      }
      await refreshMembers()
      applyLocaleSections(Array.isArray(pack.sections) ? pack.sections : [], '', rows)
      applyHiddenPlanningSectionsFromSources(pack.hidden_planning_sections)
      await applyPayrollFromShifts()
      await refreshBackupMeta(planningBackupSlot, localeName)
      setSuccess(
        added > 0
          ? `Ripristinati ${added} dipendenti dal backup di "${localeName}".`
          : `Nessun nuovo dipendente per "${localeName}": tutti i nomi del backup sono già in elenco.`,
      )
    } catch (err) {
      setError(err?.message || 'Ripristino backup dipendenti non riuscito')
      await refreshMembers()
    } finally {
      setBackupBusy(false)
    }
  }

  async function handleSelectSavedLocale(value) {
    const name = normalizeLocaleName(value)
    setLocaleStaffName(name)
    if (!name) {
      setLocaleAccessCode('')
      return
    }
    const stored = await readStoredLocaleAccessCode(name)
    setLocaleAccessCode(isValidLocaleAccessCode(stored) ? stored : '')
  }

  function handleMembersBackupLocaleChange(value) {
    const name = normalizeLocaleName(value)
    if (!name) return
    setMembersBackupLocale(name)
    setLocaleStaffName(name)
    void refreshBackupMeta(planningBackupSlot, name)
  }

  function handlePlanningBackupSlotChange(slotIndex) {
    const idx = Number(slotIndex)
    if (!Number.isFinite(idx)) return
    const weeks = planningMonthWeekSlots(weekAnchor)
    const w = weeks[idx]
    if (!w) return
    setPlanningBackupSlot(idx)
    void refreshBackupMeta(idx, membersBackupLocale)
    setPlanView('week')
    const newAnchor = new Date(w.anchor.getFullYear(), w.anchor.getMonth(), w.anchor.getDate())
    setWeekAnchor(newAnchor)
    void (async () => {
      setLoading(true)
      setError('')
      try {
        await loadForRange(newAnchor, addDays(newAnchor, 6))
        setPlanningLoaded(true)
      } catch (err) {
        setError(err?.message || 'Errore caricamento pianificazione')
        setPlanningLoaded(false)
      } finally {
        setLoading(false)
      }
    })()
  }

  async function handleBackupPlanning() {
    setBackupBusy(true)
    setError('')
    try {
      let list = Array.isArray(shifts) ? shifts : []
      if (!list.length) {
        const data = await fetchStaffShifts(rangeFromStr, rangeToStr)
        list = Array.isArray(data) ? data : []
      }
      if (!list.length) {
        setError(
          `Nessuna voce di pianificazione nel periodo ${rangeFromStr} → ${rangeToStr}. Carica il piano prima del backup.`,
        )
        return
      }
      const nameById = Object.fromEntries(members.map((m) => [m.id, m.name]))
      const slotLabel = PLANNING_BACKUP_SLOT_LABELS[planningBackupSlot] || 'settimana'
      const monthYm = currentPlanningMonthYm()
      const payload = {
        rangeFrom: rangeFromStr,
        rangeTo: rangeToStr,
        planView,
        weekSlot: planningBackupSlot,
        weekSlotLabel: slotLabel,
        monthYm,
        shifts: list.map((s) => ({
          member_name: s.staff_member_name || nameById[s.staff_member_id] || '',
          work_date: shiftWorkDateKey(s.work_date),
          time_start: s.time_start,
          time_end: s.time_end,
          entry_kind: s.entry_kind || 'shift',
          notes: s.notes || null,
        })),
      }
      const localEntry = savePlanningWeekBackup(monthYm, planningBackupSlot, payload, operatorBackupScope)
      if (localEntry?.savedAt) {
        setBackupMeta((prev) => ({ ...prev, planning: localEntry.savedAt }))
      }
      const planKey = planningBackupServerKey(monthYm, planningBackupSlot, operatorBackupScope)
      try {
        await upsertStaffBackup('planning', planKey, payload)
        await refreshBackupMeta(planningBackupSlot)
        setSuccess(
          `Backup ${slotLabel} creato (${list.length} voci, ${rangeFromStr} → ${rangeToStr}, condiviso sul server).`,
        )
      } catch {
        await refreshBackupMeta(planningBackupSlot)
        setSuccess(
          `Backup ${slotLabel} salvato solo su questo browser (${list.length} voci, server non raggiungibile).`,
        )
      }
    } catch (err) {
      setError(err?.message || 'Backup pianificazione non riuscito')
    } finally {
      setBackupBusy(false)
    }
  }

  async function handleRestorePlanningBackup() {
    const latest = await resolvePlanningBackup(planningBackupSlot)
    const rows = latest?.payload?.shifts
    if (!rows?.length) {
      setError(
        `Nessun backup per ${PLANNING_BACKUP_SLOT_LABELS[planningBackupSlot] || 'questa settimana'}. Crea prima un backup.`,
      )
      return
    }
    const when = formatStaffBackupLabel(latest.savedAt) || 'backup'
    const slotLabel = latest.payload.weekSlotLabel || PLANNING_BACKUP_SLOT_LABELS[planningBackupSlot] || 'settimana'
    const from = latest.payload.rangeFrom || rangeFromStr
    const to = latest.payload.rangeTo || rangeToStr
    if (
      !window.confirm(
        `Ripristinare ${rows.length} voci di pianificazione (${slotLabel}) dal backup del ${when}?\n\nPeriodo backup: ${from} → ${to}.\nVengono ricreate solo le voci mancanti (duplicati saltati).`,
      )
    ) {
      return
    }
    setBackupBusy(true)
    setError('')
    const backupRange = planningRangeFromBackup(from, to, latest.payload.planView)
    try {
      let mem = []
      try {
        mem = await fetchStaffMembers()
      } catch {
        mem = Array.isArray(members) ? [...members] : []
      }
      let existing = []
      try {
        existing = await fetchStaffShifts(from, to)
      } catch {
        existing = Array.isArray(shifts) ? shifts : []
      }
      const existingList = normalizeShiftRows(existing, mem)
      let created = 0
      let skipped = 0
      let missingMembers = 0
      for (const row of rows) {
        const staffId = resolveMemberIdFromBackupName(row.member_name, mem)
        if (!staffId) {
          skipped += 1
          missingMembers += 1
          continue
        }
        const kind = row.entry_kind || 'shift'
        const workDate = shiftWorkDateKey(row.work_date)
        const exists = existingList.some((s) =>
          shiftEntryMatches(s, staffId, workDate, kind, row.time_start, row.time_end),
        )
        if (exists) {
          skipped += 1
          continue
        }
        const createdRow = await createStaffShift({
          staff_member_id: staffId,
          work_date: workDate,
          time_start: row.time_start,
          time_end: row.time_end,
          entry_kind: kind,
          notes: row.notes,
        })
        created += 1
        existingList.push(
          normalizeShiftRows([createdRow], mem)[0] || {
            staff_member_id: staffId,
            work_date: row.work_date,
            entry_kind: kind,
            time_start: row.time_start,
            time_end: row.time_end,
          },
        )
      }
      applyPlanningViewFromRange(backupRange)
      setPlanningLoaded(true)
      setLoading(true)
      await loadForRange(backupRange.start, backupRange.end)
      setLoading(false)
      await refreshBackupMeta(planningBackupSlot)
      await applyPayrollFromShifts(mem)
      const missingNote =
        missingMembers > 0
          ? ` ${missingMembers} voci senza dipendente corrispondente (ricrea il backup dopo aver caricato i dipendenti).`
          : ''
      setSuccess(
        created > 0
          ? `Ripristinate ${created} voci (${slotLabel}, ${from} → ${to})${skipped ? `; ${skipped} saltate` : ''}.${missingNote}`
          : `Nessuna nuova voce: ${skipped} già presenti o non ripristinabili.${missingNote} Periodo backup mostrato in griglia.`,
      )
    } catch (err) {
      setError(err?.message || 'Ripristino backup pianificazione non riuscito')
      applyPlanningViewFromRange(backupRange)
      try {
        await loadForRange(backupRange.start, backupRange.end)
        setPlanningLoaded(true)
      } catch {
        setPlanningLoaded(false)
      }
    } finally {
      setLoading(false)
      setBackupBusy(false)
    }
  }

  async function handleBackupPayroll() {
    setBackupBusy(true)
    setError('')
    try {
      const lines = buildPayrollLinesForSave()
      let archiveMonths = []
      try {
        archiveMonths = await fetchStaffPayrollMonths()
      } catch {
        archiveMonths = []
      }
      const payload = {
        payrollMonthYm,
        periodFromStr: payrollFromStr,
        periodToStr: payrollToStr,
        hoursOverride: { ...hoursOverride },
        payrollImporto: { ...payrollImporto },
        rateDraft: { ...rateDraft },
        lines,
        archiveMonths: Array.isArray(archiveMonths) ? archiveMonths : [],
      }
      const localPayrollEntry = saveStaffBackup('payroll', payload, operatorBackupScope)
      if (localPayrollEntry?.savedAt) {
        setBackupMeta((prev) => ({ ...prev, payroll: localPayrollEntry.savedAt }))
      }
      const payrollServerKey = payrollBackupServerKey(payrollMonthYm, operatorBackupScope)
      try {
        await upsertStaffBackup('payroll', payrollServerKey, payload)
        await refreshPayrollBackupOptions()
        setPayrollBackupKey(operatorBackupScope ? payrollServerKey : payrollMonthYm)
        await refreshBackupMeta()
        setSuccess(
          `Backup ore e costi creato (mese ${payrollMonthYm}${lines.length ? `, ${lines.length} righe calcolate` : ''}, condiviso sul server).`,
        )
      } catch {
        await refreshPayrollBackupOptions()
        setPayrollBackupKey(`local:0`)
        await refreshBackupMeta()
        setSuccess(
          `Backup ore e costi salvato solo su questo browser (mese ${payrollMonthYm}, server non raggiungibile).`,
        )
      }
    } catch (err) {
      setError(err?.message || 'Backup ore e costi non riuscito')
    } finally {
      setBackupBusy(false)
    }
  }

  async function handleRestorePayrollBackup() {
    const latest = await resolvePayrollBackupByKey(payrollBackupKey)
    if (!latest?.payload) {
      setError('Nessun backup ore e costi da ripristinare per la selezione corrente.')
      return
    }
    const when = formatStaffBackupLabel(latest.savedAt) || 'backup'
    const ym = latest.payload.payrollMonthYm || payrollMonthYm
    const selectedLabel =
      payrollBackupOptions.find((o) => o.value === payrollBackupKey)?.label || formatMonthYmIt(ym)
    if (
      !window.confirm(
        `Ripristinare ore e costi dal backup selezionato?\n\n${selectedLabel}\nMese: ${ym}\nSalvato: ${when}\n\nLa tabella corrente verrà sostituita con i dati salvati.`,
      )
    ) {
      return
    }
    setBackupBusy(true)
    setError('')
    try {
      if (latest.payload.payrollMonthYm) setPayrollMonthYm(latest.payload.payrollMonthYm)
      if (latest.payload.lines?.length) {
        const matched = applyPayrollMonthSnapshot({ lines: latest.payload.lines })
        if (matched === 0) {
          setHoursOverride(latest.payload.hoursOverride || {})
          setPayrollImporto(latest.payload.payrollImporto || {})
          if (latest.payload.rateDraft) {
            setRateDraft((prev) => ({ ...prev, ...latest.payload.rateDraft }))
          }
        }
      } else {
        setHoursOverride(latest.payload.hoursOverride || {})
        setPayrollImporto(latest.payload.payrollImporto || {})
        if (latest.payload.rateDraft) {
          setRateDraft((prev) => ({ ...prev, ...latest.payload.rateDraft }))
        }
      }
      await refreshPayrollBackupOptions()
      await refreshBackupMeta()
      setSuccess(`Ore e costi ripristinati dal backup (mese ${ym}).`)
    } catch (err) {
      setError(err?.message || 'Ripristino backup ore e costi non riuscito')
    } finally {
      setBackupBusy(false)
    }
  }

  function handlePayrollBackupSelectChange(value) {
    setPayrollBackupKey(String(value || ''))
  }

  async function loadDemoExample() {
    if (!window.confirm('Carica l’esempio (mar–apr 2026)? Vengono creati i dipendenti mancanti e le righe turno. Puoi duplicare o modificare dopo.')) return
    setDemoLoading(true)
    setError('')
    try {
      markPlanningStale()
      let mem = await fetchStaffMembers()
      const names = new Set()
      for (const r of expandDemoRows()) names.add(r.name)
      for (const n of names) {
        if (!mem.find((m) => m.name === n)) {
          await createStaffMember({ name: n, is_active: true })
        }
      }
      mem = await fetchStaffMembers()
      setMembers(mem || [])
      const idByName = Object.fromEntries(mem.map((m) => [m.name, m.id]))
      for (const r of expandDemoRows()) {
        const sid = idByName[r.name]
        if (!sid) continue
        await createStaffShift({
          staff_member_id: sid,
          work_date: r.work_date,
          time_start: r.time_start,
          time_end: r.time_end,
          entry_kind: r.entry_kind,
        })
      }
      const anchor = startOfWeekMonday(parseYMD('2026-03-30'))
      setPlanView('week')
      setWeekAnchor(anchor)
      setSuccess(
        'Esempio caricato (8 giorni). La settimana parte da lunedi e termina domenica.',
      )
      await loadForRange(anchor, addDays(anchor, 6))
      setPlanningLoaded(true)
    } catch (err) {
      setError(err?.message || 'Errore caricamento esempio')
    } finally {
      setDemoLoading(false)
    }
  }


  return (
    <div className="staff-page">
      <header className="staff-page-hero">
        <div className="staff-page-hero-inner">
          {!operatorMode ? <h1 className="page-header staff-page-title">Personale</h1> : null}
          <p className="staff-page-lead">
            {operatorMode ? (
              <>
                Personale della postazione: <strong>{stationStaffLocaleName || 'locale collegato'}</strong>. Inserisci il{' '}
                <strong>codice a 6 cifre</strong> e clicca <strong>Accedi</strong> per vedere dipendenti e pianificazione di questo locale
                (i dati di altre sedi non restano visibili).
              </>
            ) : (
              <>
                Gestisci i dipendenti e la pianificazione: <strong>turni</strong> con fascia oraria, <strong>permessi</strong>,{' '}
                <strong>assenze</strong>, <strong>malattia</strong>, <strong>ferie</strong> e <strong>riposo</strong>. Scegli <strong>Settimana</strong>, un singolo <strong>Giorno</strong>,
                oppure <strong>Periodo</strong> con date Dal/Al (fino a {MAX_PLANNING_PERIOD_DAYS} giorni), poi usa
                <strong> «Carica piano»</strong> per scaricare i turni dal server in base alle date selezionate (il caricamento non
                parte da solo quando cambi data). In ogni sezione usa <strong>Crea backup</strong> prima di cancellazioni importanti (salvataggio sul server, recuperabile da altri PC e browser).
              </>
            )}
          </p>
        </div>
      </header>

      {error && <div className="alert alert-danger">{error}</div>}
      {localeSyncWarning && <div className="alert alert-warning">{localeSyncWarning}</div>}
      {success && <div className="alert alert-info">{success}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <section className="card" ref={memberFormSectionRef} style={{ order: 1, marginBottom: 0 }}>
        <h2 className="page-subheader" style={{ marginTop: 0 }}>
          {operatorMode ? 'Accesso personale' : editingMemberId ? 'Modifica dipendente' : 'Dipendenti'}
        </h2>
        {!operatorMode ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: '-0.35rem', marginBottom: '0.85rem', maxWidth: 720, lineHeight: 1.45 }}>
          Organizza i dipendenti per <strong>sezione</strong> (Banco, Cucina, Forno…). La colonna <strong>Ordine</strong> viene assegnata automaticamente e definisce la sequenza negli elenchi e nel menu a tendina della pianificazione.
        </p>
        ) : null}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.65rem',
            alignItems: 'flex-end',
            marginBottom: '1rem',
            padding: '0.7rem',
            border: '1px dashed var(--border)',
            borderRadius: 'var(--radius)',
            background: 'color-mix(in oklab, var(--bg-card) 92%, #0ea5e9 8%)',
          }}
        >
          <div className="form-group" style={{ marginBottom: 0, flex: '1 1 250px' }}>
            <label>Nome locale</label>
            <input
              className="form-control"
              value={operatorMode ? stationStaffLocaleName || localeStaffName : localeStaffName}
              onChange={(e) => setLocaleStaffName(e.target.value)}
              placeholder="Es. La Risacca"
              disabled={operatorMode || shiftBusy || loading || demoLoading || reportLoading}
              readOnly={operatorMode}
              title={
                operatorMode
                  ? 'Locale fisso per questa postazione operativa'
                  : 'Ogni nome locale è univoco: non puoi salvare la stessa lista dipendenti sotto un altro nome'
              }
            />
          </div>
          {!operatorMode ? (
          <div className="form-group" style={{ marginBottom: 0, flex: '1 1 240px', minWidth: 220 }}>
            <label>Locali salvati</label>
            <select
              className="form-control"
              value={
                savedLocaleNames.find(
                  (n) => localeNameCompareKey(n) === localeNameCompareKey(localeStaffName),
                ) || ''
              }
              onChange={(e) => void handleSelectSavedLocale(e.target.value)}
              disabled={shiftBusy || loading || demoLoading || reportLoading || savedLocaleNames.length === 0}
            >
              <option value="">{savedLocaleNames.length === 0 ? 'Nessun locale salvato' : 'Seleziona locale salvato'}</option>
              {savedLocaleNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          ) : null}
          <div className="form-group" style={{ marginBottom: 0, flex: '0 1 150px', minWidth: 140 }}>
            <label>Codice zona (6 cifre)</label>
            <input
              className="form-control"
              value={localeAccessCode}
              onChange={(e) => setLocaleAccessCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(ev) => {
                if (ev.key !== 'Enter') return
                if (activeLocaleSessionOpen || localeSessionBusy) {
                  ev.preventDefault()
                  return
                }
                const code = normalizeLocaleAccessCode(localeAccessCode)
                if (!isValidLocaleAccessCode(code)) return
                ev.preventDefault()
                void handleOpenLocaleSession()
              }}
              placeholder="123456"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              disabled={
                activeLocaleSessionOpen || shiftBusy || loading || demoLoading || reportLoading || localeSessionBusy
              }
              readOnly={activeLocaleSessionOpen}
              title="Obbligatorio per aprire il locale: ogni zona ha il suo codice."
            />
          </div>
          <button
            type="button"
            className={`btn prima-nota-accedi-btn${activeLocaleSessionOpen ? ' is-register-open' : ''}`}
            disabled={
              localeSessionBusy ||
              activeLocaleSessionOpen ||
              shiftBusy ||
              loading ||
              demoLoading ||
              reportLoading ||
              !normalizeLocaleName(operatorMode ? stationStaffLocaleName || localeStaffName : localeStaffName)
            }
            onClick={() => void handleOpenLocaleSession()}
            title={
              activeLocaleSessionOpen
                ? 'Locale già aperto: Accedi bloccato. Usa Chiudi per richiuderlo.'
                : 'Inserisci il codice e apri il locale (come in Prima Nota).'
            }
          >
            {localeSessionBusy ? 'Accesso…' : activeLocaleSessionOpen ? 'Bloccato' : 'Accedi'}
          </button>
          <button
            type="button"
            className="btn btn-outline-danger prima-nota-chiudi-btn"
            onClick={() => handleCloseLocaleSession()}
            disabled={localeSessionBusy}
            title="Chiude il locale: servirà di nuovo il codice per Accedi."
          >
            Chiudi
          </button>
          {!operatorMode ? (
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={() => void handleGenerateLocaleCode()}
            disabled={activeLocaleSessionOpen || shiftBusy || loading || demoLoading || reportLoading}
            title="Genera un nuovo codice da usare al prossimo salvataggio"
          >
            Genera codice
          </button>
          ) : null}
          {(!operatorMode || activeLocaleSessionOpen) ? (
          <>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSaveMembersByLocale()}
            disabled={shiftBusy || loading || demoLoading || reportLoading}
            title="Salva la lista dipendenti corrente associandola al nome locale"
          >
            Salva dipendenti
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void handleLoadMembersByLocale()}
            disabled={shiftBusy || loading || demoLoading || reportLoading}
            title="Carica la lista dipendenti salvata per questo locale e sostituisce l'elenco attuale"
          >
            Carica dipendenti
          </button>
          {!operatorMode ? (
          <button
            type="button"
            className="btn btn-outline-primary"
            onClick={() => void handleCreateEmptyLocale()}
            disabled={shiftBusy || loading || demoLoading || reportLoading}
            title="Crea un locale anche senza elenco dipendenti"
          >
            Aggiungi locale
          </button>
          ) : null}
          <button
            type="button"
            className="btn btn-outline-danger"
            onClick={() => void handleDeleteLocaleName()}
            disabled={
              shiftBusy ||
              loading ||
              demoLoading ||
              reportLoading ||
              !normalizeLocaleName(localeStaffName)
            }
            title="Rimuove il locale selezionato: serve il codice zona a 6 cifre se il locale è protetto"
          >
            Elimina locale
          </button>
          </>
          ) : null}
          <p style={{ flex: '1 1 100%', margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
            Stato locale:{' '}
            <strong style={{ color: activeLocaleSessionOpen ? '#047857' : '#b45309' }}>
              {activeLocaleSessionOpen ? 'APERTO' : 'CHIUSO'}
            </strong>
            {' — '}
            Ogni locale salvato ha un <strong>codice a 6 cifre</strong>: apri con <strong>Accedi</strong> (come in Prima Nota) e
            chiudi con <strong>Chiudi</strong>. Senza apertura non si modificano gli elenchi protetti.
          </p>
        </div>
        {operatorMode && !activeLocaleSessionOpen ? (
          <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
            Il personale di <strong>{stationStaffLocaleName || 'questa postazione'}</strong> è nascosto finché non inserisci il codice e
            clicchi <strong>Accedi</strong>.
          </div>
        ) : null}
        {(!operatorMode || activeLocaleSessionOpen) ? (
        <>
        <StaffSectionBackupBar
          sectionTitle={
            operatorMode
              ? `dipendenti (${getOperatorStationStaffLocaleName(operatorStationId, savedLocaleNames) || stationStaffLocaleName || 'postazione'})`
              : 'dipendenti'
          }
          lastSavedAt={backupMeta.members}
          onBackup={handleBackupMembers}
          onRestore={handleRestoreMembersBackup}
          disabled={shiftBusy || demoLoading || reportLoading || backupBusy}
          busy={backupBusy}
          slotLabel="Locale"
          emptySlotMessage="Nessun backup per questo locale"
          slotOptions={operatorMode ? null : membersBackupLocaleOptions}
          slotValue={membersBackupLocale}
          onSlotChange={operatorMode ? undefined : handleMembersBackupLocaleChange}
        />
        <form onSubmit={handleAddMember} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', alignItems: 'flex-end', marginBottom: '1rem' }}>
          <div className="form-group" style={{ marginBottom: 0, flex: '1 1 140px' }}>
            <label>Nome</label>
            <input className="form-control" value={newMemberFirstName} onChange={(e) => setNewMemberFirstName(e.target.value)} placeholder="Nome" />
          </div>
          <div className="form-group" style={{ marginBottom: 0, flex: '1 1 140px' }}>
            <label>Cognome</label>
            <input className="form-control" value={newMemberLastName} onChange={(e) => setNewMemberLastName(e.target.value)} placeholder="Cognome" />
          </div>
          <div className="form-group" style={{ marginBottom: 0, flex: '0 1 160px' }}>
            <label>Sezione</label>
            <select
              className="form-control"
              value={newMemberSection || activeSection || ''}
              onChange={(e) => {
                setNewMemberSection(e.target.value)
                setActiveSection(e.target.value)
              }}
            >
              {localeSections.map((section) => (
                <option key={section} value={section}>
                  {section}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0, flex: '1 1 180px' }}>
            <label>Email</label>
            <input type="email" className="form-control" value={newMemberEmail} onChange={(e) => setNewMemberEmail(e.target.value)} placeholder="email@esempio.it" />
          </div>
          <div className="form-group" style={{ marginBottom: 0, flex: '1 1 130px' }}>
            <label>Telefono</label>
            <input type="tel" className="form-control" value={newMemberPhone} onChange={(e) => setNewMemberPhone(e.target.value)} placeholder="Cell. / tel." />
          </div>
          <div className="form-group" style={{ marginBottom: 0, flex: '1 1 130px' }}>
            <label>Città</label>
            <input className="form-control" value={newMemberCity} onChange={(e) => setNewMemberCity(e.target.value)} placeholder="Città" />
          </div>
          <div className="form-group" style={{ marginBottom: 0, flex: '0 1 150px' }}>
            <label>Nascita</label>
            <input type="date" className="form-control" value={newMemberBirthDate} onChange={(e) => setNewMemberBirthDate(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary">
            {editingMemberId ? 'Salva modifiche' : 'Aggiungi'}
          </button>
          {editingMemberId && (
            <button type="button" className="btn btn-secondary" onClick={resetMemberForm}>
              Annulla
            </button>
          )}
        </form>
        <div
          className="staff-section-toolbar"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.5rem',
            alignItems: 'center',
            marginBottom: '1rem',
          }}
        >
          <div className="btn-group" role="tablist" aria-label="Sezioni personale">
            {localeSections.map((section) => {
              const count = members.filter((m) => memberMatchesSection(m, section, localeSections)).length
              const active = sectionCompareKey(section) === sectionCompareKey(activeSection)
              return (
                <button
                  key={section}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => {
                    setActiveSection(section)
                    setNewMemberSection(section)
                  }}
                >
                  {section}
                  {count ? ` (${count})` : ''}
                </button>
              )
            })}
          </div>
          <div className="form-group" style={{ marginBottom: 0, display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
            <input
              className="form-control form-control-sm"
              style={{ minWidth: 140, maxWidth: 200 }}
              value={newSectionName}
              onChange={(e) => setNewSectionName(e.target.value)}
              placeholder="Nuova sezione"
              aria-label="Nome nuova sezione"
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleAddLocaleSection}>
              + Aggiungi sezione
            </button>
            <button
              type="button"
              className="btn btn-outline-danger btn-sm"
              onClick={handleRemoveActiveSection}
              disabled={localeSections.length <= 1}
              title="Elimina la sezione attiva se non ha dipendenti assegnati"
            >
              Elimina sezione
            </button>
          </div>
          <button
            type="button"
            className="btn btn-outline-danger btn-sm"
            disabled={members.length === 0 || shiftBusy || demoLoading || reportLoading}
            onClick={() => void handleDeleteAllMembers()}
            title="Rimuove tutti i dipendenti: serve il codice zona se il locale selezionato è protetto"
          >
            Elimina elenco dipendenti
          </button>
        </div>
        <div className="workbook-card-nested">
          <div className="pagamenti-workbook-toolbar">
            <div className="pagamenti-workbook-toolbar-left">
              <span className="pagamenti-workbook-title">{STAFF_MEMBERS_WORKBOOK_TITLE}</span>
              <span className="pagamenti-workbook-sheet-label">
                {activeSection}: {membersInActiveSection.length} / {members.length} dipendenti
              </span>
            </div>
          </div>
          <div className="pagamenti-grid-wrap excel-wrap workbook-grid-wrap">
            <table className="app-table excel-table pagamenti-grid workbook-grid staff-members-grid">
              <colgroup>
                {STAFF_MEMBERS_COLUMNS.map((col) => (
                  <col key={col.id} style={{ minWidth: col.width }} />
                ))}
                <col style={{ minWidth: 240 }} />
              </colgroup>
              <thead>
                <tr>
                  {STAFF_MEMBERS_COLUMNS.map((col) => (
                    <th
                      key={col.id}
                      className={[
                        col.numeric ? 'text-end' : '',
                        col.sticky === 'left' ? 'workbook-col-sticky-left' : '',
                      ].filter(Boolean).join(' ')}
                    >
                      {col.label}
                    </th>
                  ))}
                  <th className="sup-actions-col">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {membersInActiveSection.map((m, idx) => (
                  <tr key={m.id} className="workbook-grid-row">
                    {STAFF_MEMBERS_COLUMNS.map((col) => (
                      <td
                        key={col.id}
                        className={col.sticky === 'left' ? 'workbook-col-sticky-left' : ''}
                      >
                        {col.id === 'is_active' ? (
                          <div className="staff-workbook-checkbox-cell">
                            <input
                              type="checkbox"
                              checked={m.is_active}
                              onChange={async (e) => {
                                try {
                                  await updateStaffMember(m.id, { is_active: e.target.checked })
                                  await refreshMembers()
                                } catch (err) {
                                  const msg = String(err?.message || '')
                                  await refreshMembers()
                                  if (msg.includes('404') || msg.includes('non trovato')) {
                                    setError('Dipendente non più presente: elenco aggiornato.')
                                  } else {
                                    setError('Aggiornamento stato non riuscito')
                                  }
                                }
                              }}
                              aria-label={`Attivo ${m.name}`}
                            />
                          </div>
                        ) : (
                          <input
                            className={[
                              'excel-cell',
                              'pagamenti-cell-readonly',
                              col.numeric ? 'excel-cell-num' : '',
                              col.emphasis ? 'workbook-cell-emphasis' : '',
                            ].filter(Boolean).join(' ')}
                            value={staffMemberCellValue(m, col, { rowIndex: idx })}
                            readOnly
                            tabIndex={-1}
                            aria-label={`${col.label} ${m.name}`}
                          />
                        )}
                      </td>
                    ))}
                    <td className="sup-actions-col">
                      <div className="sup-actions-btns staff-member-actions">
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => handleEditMember(m)}
                          title="Modifica anagrafica nel modulo sopra"
                        >
                          Modifica
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline-secondary btn-sm"
                          onClick={() => setMemberInfoId(m.id)}
                          title="Scheda rapida: nome, cognome, email, telefono, città, età"
                        >
                          Info
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline-danger btn-sm"
                          onClick={() => handleDeleteMember(m)}
                          title="Richiede il codice zona se il locale selezionato è protetto"
                        >
                          Elimina
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {membersInActiveSection.length === 0 ? (
                  <tr>
                    <td colSpan={STAFF_MEMBERS_COLUMNS.length + 1} className="empty-state">
                      {members.length === 0
                        ? 'Nessun dipendente: aggiungi almeno un nome per pianificare i turni.'
                        : `Nessun dipendente in «${activeSection}». Aggiungi qualcuno in questa sezione o scegli un’altra tab.`}
                    </td>
                  </tr>
                ) : (
                  <tr className="workbook-row-totals">
                    {STAFF_MEMBERS_COLUMNS.map((col) => (
                      <td
                        key={`tot-${col.id}`}
                        className={col.sticky === 'left' ? 'workbook-col-sticky-left' : ''}
                      >
                        <input
                          className={[
                            'excel-cell',
                            'pagamenti-cell-readonly',
                            col.numeric ? 'excel-cell-num' : '',
                            'workbook-cell-total',
                          ].filter(Boolean).join(' ')}
                          value={staffMembersTotalsLabel(col.id, membersInActiveSection.length)}
                          readOnly
                          tabIndex={-1}
                        />
                      </td>
                    ))}
                    <td className="sup-actions-col" />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        </>
        ) : null}
      </section>

      {(!operatorMode || activeLocaleSessionOpen) ? (
      <>
      <section className="card" style={{ order: 2, marginBottom: '1rem' }}>
        <h2 className="page-subheader" style={{ marginTop: 0 }}>
          Ore lavorate e costo
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: '-0.35rem', marginBottom: '0.75rem' }}>
          Le ore si calcolano dai turni del <strong>mese selezionato</strong> (puoi modificarle).
          Caricando l&apos;elenco dipendenti, ore e costi si aggiornano automaticamente dai turni pianificati.
          Dopo nuovi turni in pianificazione usa <strong>Aggiorna ore</strong>.
          <strong> Calcola tutti</strong> o <strong>Calcola</strong> per riga.
          <strong> Salva</strong> / <strong>Ricarica in archivio</strong> memorizzano il mese nel menu Archivio (compatto, senza lista lunga).
          Nel menu <strong>Backup</strong> scegli quale snapshot ripristinare (server o copia browser).
        </p>
        <StaffSectionBackupBar
          sectionTitle="ore e costi"
          lastSavedAt={payrollBackupSavedAt}
          onBackup={handleBackupPayroll}
          onRestore={handleRestorePayrollBackup}
          disabled={shiftBusy || demoLoading || reportLoading}
          busy={backupBusy}
          slotLabel="Backup"
          emptySlotMessage="Nessun backup ore e costi salvato"
          slotOptions={payrollBackupOptions.map((o) => ({ value: o.value, label: o.label }))}
          slotValue={payrollBackupKey}
          onSlotChange={handlePayrollBackupSelectChange}
          allowRestoreWithoutMeta={payrollBackupOptions.length > 0}
        />
        <StaffPayrollMonthPanel
          payrollMonthYm={payrollMonthYm}
          onPayrollMonthYmChange={setPayrollMonthYm}
          periodFromStr={payrollFromStr}
          periodToStr={payrollToStr}
          buildLinesForSave={buildPayrollLinesForSave}
          applySnapshot={applyPayrollMonthSnapshot}
          onNotifyError={setError}
          onNotifySuccess={setSuccess}
          disabled={shiftBusy}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.65rem' }}>
          <button
            type="button"
            className="btn btn-vino btn-sm"
            onClick={() => void refreshPayrollHoursFromShifts()}
            disabled={members.length === 0 || payrollShiftsRefreshing || shiftBusy}
            title="Ricarica i turni del mese e include la settimana/periodo caricato in pianificazione"
          >
            {payrollShiftsRefreshing ? 'Aggiornamento…' : 'Aggiorna ore'}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={calculateAllPayrollImporto}
            disabled={members.length === 0}
          >
            Calcola tutti gli importi
          </button>
        </div>
        <div className="workbook-card-nested">
          <div className="pagamenti-workbook-toolbar">
            <div className="pagamenti-workbook-toolbar-left">
              <span className="pagamenti-workbook-title">{STAFF_PAYROLL_WORKBOOK_TITLE}</span>
              <span className="pagamenti-workbook-sheet-label">{payrollRows.length} dipendenti</span>
            </div>
          </div>
          <div className="pagamenti-grid-wrap excel-wrap workbook-grid-wrap">
            <table className="app-table excel-table pagamenti-grid workbook-grid staff-payroll-grid">
              <colgroup>
                {STAFF_PAYROLL_COLUMNS.map((col) => (
                  <col key={col.id} style={{ minWidth: col.width }} />
                ))}
                <col style={{ minWidth: 320 }} />
              </colgroup>
              <thead>
                <tr>
                  {STAFF_PAYROLL_COLUMNS.map((col) => (
                    <th
                      key={col.id}
                      className={[
                        col.numeric ? 'text-end' : '',
                        col.sticky === 'left' ? 'workbook-col-sticky-left' : '',
                      ].filter(Boolean).join(' ')}
                    >
                      {col.label}
                    </th>
                  ))}
                  <th className="sup-actions-col">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {payrollRows.map(({ member: m, computedOre, ore }, rowIndex) => (
                  <tr key={m.id} className="workbook-grid-row">
                    {STAFF_PAYROLL_COLUMNS.map((col) => {
                      if (col.id === 'hours') {
                        return (
                          <td key={col.id}>
                            <input
                              type="number"
                              step="0.25"
                              min="0"
                              className={['excel-cell', 'excel-cell-num'].join(' ')}
                              value={
                                hoursOverride[m.id] !== undefined
                                  ? hoursOverride[m.id]
                                  : formatHoursDecimal(computedOre)
                              }
                              onChange={(e) =>
                                setHoursOverride((prev) => ({ ...prev, [m.id]: e.target.value }))
                              }
                              title={
                                computedOre > 0
                                  ? `Ore da turni nel periodo: ${formatHoursDecimal(computedOre)}`
                                  : 'Nessun turno nel periodo'
                              }
                              aria-label={`Ore lavorate ${m.name}`}
                            />
                          </td>
                        )
                      }
                      if (col.id === 'hourly_rate') {
                        return (
                          <td key={col.id}>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              className={['excel-cell', 'excel-cell-num'].join(' ')}
                              value={rateDraft[m.id] ?? (m.hourly_rate != null ? String(m.hourly_rate) : '')}
                              onChange={(e) =>
                                setRateDraft((prev) => ({ ...prev, [m.id]: e.target.value }))
                              }
                              onBlur={async (e) => {
                                const raw = e.target.value.trim()
                                const v = raw === '' ? null : parseDecimalInput(raw)
                                const prev = m.hourly_rate == null ? null : Number(m.hourly_rate)
                                if (v === prev || (v == null && prev == null)) return
                                try {
                                  await updateStaffMember(m.id, { hourly_rate: v })
                                  await refreshMembers()
                                } catch {
                                  setError('Salvataggio prezzo/ora non riuscito')
                                }
                              }}
                              aria-label={`Prezzo ora ${m.name}`}
                            />
                          </td>
                        )
                      }
                      return (
                        <td
                          key={col.id}
                          className={col.sticky === 'left' ? 'workbook-col-sticky-left' : ''}
                        >
                          <input
                            className={[
                              'excel-cell',
                              'pagamenti-cell-readonly',
                              col.numeric ? 'excel-cell-num' : '',
                              col.emphasis ? 'workbook-cell-emphasis' : '',
                              col.id === 'importo' ? 'workbook-cell-total' : '',
                            ].filter(Boolean).join(' ')}
                            value={staffPayrollCellValue(
                              { member: m, computedOre, ore },
                              col,
                              { rowIndex, importo: payrollImporto[m.id] },
                            )}
                            readOnly
                            tabIndex={-1}
                            aria-label={`${col.label} ${m.name}`}
                          />
                        </td>
                      )
                    })}
                    <td className="sup-actions-col">
                      <div className="sup-actions-btns">
                        <button
                          type="button"
                          className="btn btn-outline-secondary btn-sm"
                          onClick={() => setPayrollDaysInfoMemberId(m.id)}
                          title="Giorni e ore dai turni nel periodo"
                        >
                          Info giorni
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => calculatePayrollImporto(m.id)}
                        >
                          Calcola
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline-secondary btn-sm"
                          onClick={() => clearPayrollImporto(m.id)}
                          disabled={payrollImporto[m.id] === undefined}
                          title="Elimina importo calcolato"
                        >
                          Cancella
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {members.length === 0 ? (
                  <tr>
                    <td colSpan={STAFF_PAYROLL_COLUMNS.length + 1} className="empty-state">
                      Aggiungi dipendenti per calcolare ore e importi.
                    </td>
                  </tr>
                ) : (
                  <tr className="workbook-row-totals">
                    {STAFF_PAYROLL_COLUMNS.map((col) => (
                      <td
                        key={`tot-${col.id}`}
                        className={col.sticky === 'left' ? 'workbook-col-sticky-left' : ''}
                      >
                        <input
                          className={[
                            'excel-cell',
                            'pagamenti-cell-readonly',
                            col.numeric ? 'excel-cell-num' : '',
                            'workbook-cell-total',
                          ].filter(Boolean).join(' ')}
                          value={staffPayrollTotalsLabel(col.id, payrollWorkbookTotals)}
                          readOnly
                          tabIndex={-1}
                        />
                      </td>
                    ))}
                    <td className="sup-actions-col" />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="card" style={{ order: 3, marginBottom: 0 }}>
        <h2 className="page-subheader" style={{ marginTop: 0, marginBottom: '0.65rem' }}>
          Pianificazione turni
        </h2>
        <StaffSectionBackupBar
          sectionTitle="pianificazione"
          lastSavedAt={backupMeta.planning}
          onBackup={handleBackupPlanning}
          onRestore={handleRestorePlanningBackup}
          disabled={shiftBusy || demoLoading || reportLoading || backupBusy}
          busy={backupBusy}
          slotLabel="Settimana"
          emptySlotMessage="Nessun backup per questa settimana"
          slotOptions={planningBackupSlotOptions}
          slotValue={planningBackupSlot}
          onSlotChange={handlePlanningBackupSlotChange}
          allowRestoreWithoutMeta
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: '0.75rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
            <div className="btn-group" role="group" aria-label="Vista calendario">
              <button
                type="button"
                className={`btn btn-sm ${planView === 'week' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => {
                  markPlanningStale()
                  if (planView === 'day') {
                    setWeekAnchor(startOfWeekMonday(dayFocus))
                  }
                  setPlanView('week')
                }}
              >
                Settimana
              </button>
              <button
                type="button"
                className={`btn btn-sm ${planView === 'day' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => {
                  markPlanningStale()
                  setDayFocus(todayDate())
                  setPlanView('day')
                }}
              >
                Giorno
              </button>
              <button
                type="button"
                className={`btn btn-sm ${planView === 'period' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => {
                  markPlanningStale()
                  if (planView === 'week') {
                    setPeriodFrom(new Date(weekAnchor.getFullYear(), weekAnchor.getMonth(), weekAnchor.getDate()))
                    setPeriodTo(addDays(weekAnchor, 6))
                  } else if (planView === 'day') {
                    setPeriodFrom(new Date(dayFocus.getFullYear(), dayFocus.getMonth(), dayFocus.getDate()))
                    setPeriodTo(new Date(dayFocus.getFullYear(), dayFocus.getMonth(), dayFocus.getDate()))
                  }
                  setPlanView('period')
                }}
              >
                Periodo
              </button>
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => {
                  markPlanningStale()
                  const t = todayDate()
                  const y = t.getFullYear()
                  const mo = t.getMonth()
                  setPeriodFrom(new Date(y, mo, 1))
                  setPeriodTo(new Date(y, mo + 1, 0))
                  setPlanView('period')
                }}
                title="Passa alla vista Periodo con Dal/Al = mese solare corrente (poi usa «Carica piano» o «Aggiorna piano»)"
              >
                Mese
              </button>
            </div>
            {planView === 'week' ? (
              <>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    markPlanningStale()
                    setWeekAnchor((w) => addDays(w, -7))
                  }}
                >
                  « Settimana prec.
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    markPlanningStale()
                    setWeekAnchor((w) => addDays(w, 7))
                  }}
                >
                  Settimana succ. »
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    markPlanningStale()
                    setWeekAnchor(startOfWeekMonday(new Date()))
                  }}
                >
                  Settimana corrente
                </button>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.9rem' }}>
                  Vai a settimana che contiene
                  <input
                    type="date"
                    className="form-control"
                    value={toYMD(weekAnchor)}
                    onChange={(e) => {
                      const v = e.target.value
                      if (!v) return
                      markPlanningStale()
                      setWeekAnchor(startOfWeekMonday(parseYMD(v)))
                    }}
                  />
                </label>
              </>
            ) : planView === 'day' ? (
              <>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    markPlanningStale()
                    setDayFocus((d) => addDays(d, -1))
                  }}
                >
                  « Giorno prec.
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    markPlanningStale()
                    setDayFocus((d) => addDays(d, 1))
                  }}
                >
                  Giorno succ. »
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    markPlanningStale()
                    setDayFocus(todayDate())
                  }}
                >
                  Oggi
                </button>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.9rem' }}>
                  Data
                  <input
                    type="date"
                    className="form-control"
                    value={dayStr}
                    onChange={(e) => {
                      const v = e.target.value
                      if (!v) return
                      markPlanningStale()
                      setDayFocus(parseYMD(v))
                    }}
                  />
                </label>
              </>
            ) : (
              <>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.9rem' }}>
                  Dal
                  <input
                    type="date"
                    className="form-control"
                    value={periodFromStr}
                    onChange={(e) => {
                      const v = e.target.value
                      if (!v) return
                      markPlanningStale()
                      setPeriodFrom(parseYMD(v))
                    }}
                  />
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.9rem' }}>
                  Al
                  <input
                    type="date"
                    className="form-control"
                    value={periodToStr}
                    onChange={(e) => {
                      const v = e.target.value
                      if (!v) return
                      markPlanningStale()
                      setPeriodTo(parseYMD(v))
                    }}
                  />
                </label>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', maxWidth: 240 }}>
                  Max {MAX_PLANNING_PERIOD_DAYS} giorni. Se «Dal» è dopo «Al», in «Carica piano» l’intervallo viene letto in ordine corretto.
                </span>
              </>
            )}
            <StaffActionDropdown
              label={loading ? 'Caricamento…' : planningSection ? `Carica piano · ${planningSection}` : 'Carica piano'}
              className="btn btn-primary"
              disabled={loading || demoLoading || periodTooLong}
              open={loadPlanMenuOpen}
              onOpenChange={(next) => {
                setLoadPlanMenuOpen(next)
                if (next) {
                  setRefreshPlanMenuOpen(false)
                  setCopyPlanMenuOpen(false)
                }
              }}
              title={
                periodTooLong
                  ? `Intervallo troppo lungo (${periodDayCount} giorni). Massimo ${MAX_PLANNING_PERIOD_DAYS} giorni.`
                  : 'Scegli il piano da mostrare: Banco, Cucina, Forno o un’altra sezione'
              }
              items={[
                {
                  id: '__all__',
                  label: 'Tutti i piani',
                  active: !planningSection,
                  onClick: () => void reloadPlanningForSection(''),
                },
                ...planningGridSectionOptions.map((section) => ({
                  id: `load-${section}`,
                  label: section,
                  active: sectionCompareKey(section) === sectionCompareKey(planningSection),
                  onClick: () => void reloadPlanningForSection(section),
                })),
              ]}
            />
            <button
              type="button"
              className="btn btn-whatsapp btn-sm"
              disabled={loading || demoLoading || !planningLoaded || displayDayCells.length === 0}
              onClick={openWhatsAppPlanning}
              title="Invia il planning su WhatsApp: testo completo nel messaggio se possibile; se è molto lungo, viene copiato negli appunti e si apre WhatsApp per incollare"
            >
              WhatsApp
            </button>
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              disabled={reportLoading || demoLoading || !reportPdfRange.ok}
              onClick={() => void openStaffReportPdf()}
              title={
                !reportPdfRange.ok
                  ? `Periodo troppo lungo (${reportPdfRange.days} giorni). Massimo ${MAX_PLANNING_PERIOD_DAYS} giorni.`
                  : planView === 'week'
                    ? 'Report PDF della settimana (lun–dom): ore turno, permessi, assenze e malattia per dipendente.'
                    : planView === 'day'
                      ? 'Report PDF del giorno selezionato: stesso riepilogo per quel solo giorno.'
                      : `Report PDF dell’intervallo Dal–Al (fino a ${MAX_PLANNING_PERIOD_DAYS} giorni): stesso riepilogo sul periodo.`
              }
            >
              {reportLoading ? 'Report…' : 'Report PDF'}
            </button>
            <StaffActionDropdown
              label={loading ? 'Aggiornamento…' : planningSection ? `Aggiorna piano · ${planningSection}` : 'Aggiorna piano'}
              className="btn btn-outline-secondary btn-sm"
              disabled={shiftBusy || loading || demoLoading}
              open={refreshPlanMenuOpen}
              onOpenChange={(next) => {
                setRefreshPlanMenuOpen(next)
                if (next) {
                  setLoadPlanMenuOpen(false)
                  setCopyPlanMenuOpen(false)
                }
              }}
              title="Scegli quale piano aggiornare dal server"
              items={[
                {
                  id: 'refresh-all',
                  label: 'Tutti i piani',
                  active: !planningSection,
                  onClick: () => void reloadPlanningForSection(''),
                },
                ...planningGridSectionOptions.map((section) => ({
                  id: `refresh-${section}`,
                  label: section,
                  active: sectionCompareKey(section) === sectionCompareKey(planningSection),
                  onClick: () => void reloadPlanningForSection(section),
                })),
              ]}
            />
            <StaffActionDropdown
              label={shiftBusy ? 'Copia…' : planningSection ? `Copia · ${planningSection}` : 'Copia'}
              className="btn btn-secondary btn-sm"
              disabled={shiftBusy || loading || demoLoading || periodTooLong || members.length === 0}
              open={copyPlanMenuOpen}
              onOpenChange={(next) => {
                setCopyPlanMenuOpen(next)
                if (next) {
                  setLoadPlanMenuOpen(false)
                  setRefreshPlanMenuOpen(false)
                }
              }}
              title={
                periodTooLong
                  ? `Intervallo troppo lungo (${periodDayCount} giorni). Massimo ${MAX_PLANNING_PERIOD_DAYS} giorni.`
                  : 'Copia il piano della sezione scelta (Banco, Cucina, Forno…)'
              }
              items={[
                {
                  id: 'copy-all',
                  label: 'Tutti i piani',
                  active: !planningSection,
                  onClick: () => void handleCopyPlanning(''),
                },
                ...planningGridSectionOptions.map((section) => ({
                  id: `copy-${section}`,
                  label: section,
                  active: sectionCompareKey(section) === sectionCompareKey(planningSection),
                  onClick: () => void handleCopyPlanning(section),
                })),
              ]}
            />
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={
                shiftBusy ||
                loading ||
                demoLoading ||
                periodTooLong ||
                members.length === 0 ||
                !planningClipboard?.shifts?.length
              }
              onClick={() => void handlePastePlanning()}
              title={
                !planningClipboard?.shifts?.length
                  ? 'Prima usa Copia sulla settimana o periodo sorgente'
                  : planView === 'week'
                    ? `Incolla il planning copiato (${planningClipboardSummary(planningClipboard)}) nella settimana visibile`
                    : planView === 'day'
                      ? `Incolla il planning copiato (${planningClipboardSummary(planningClipboard)}) nel giorno visibile`
                      : `Incolla il planning copiato (${planningClipboardSummary(planningClipboard)}) nel periodo visibile`
              }
            >
              {shiftBusy ? 'Incolla…' : 'Incolla'}
            </button>
            <button
              type="button"
              className="btn btn-outline-danger btn-sm"
              disabled={shiftBusy || loading || demoLoading}
              onClick={handleDeleteWeekPlanning}
              title={
                planView === 'week'
                  ? 'Rimuove tutte le voci nel periodo settimanale indicato'
                  : planView === 'day'
                    ? 'Rimuove tutte le voci del giorno selezionato'
                    : 'Rimuove tutte le voci nell’intervallo Dal–Al'
              }
            >
              {planView === 'week' ? 'Elimina planning settimana' : planView === 'day' ? 'Elimina planning giorno' : 'Elimina planning periodo'}
            </button>
          </div>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: '-0.25rem' }}>
          {planView === 'week' ? (
            <>
              Periodo: <strong>{fromStr}</strong> → <strong>{toStr}</strong>
            </>
          ) : planView === 'day' ? (
            <>
              Giorno: <strong style={{ textTransform: 'capitalize' }}>{dayLongLabel}</strong> <span style={{ opacity: 0.85 }}>({dayStr})</span>
            </>
          ) : (
            <>
              Intervallo caricato: <strong>{rangeFromStr}</strong> → <strong>{rangeToStr}</strong>
              <span style={{ marginLeft: '0.5rem', opacity: 0.85 }}>
                ({periodTooLong ? `${periodDayCount} giorni — troppo lungo` : `${displayDayCells.length} ${displayDayCells.length === 1 ? 'giorno' : 'giorni'} in griglia`})
              </span>
            </>
          )}
          <span style={{ marginLeft: '0.65rem' }}>
            · Piano: <strong>{planningSection || 'Tutti'}</strong>
          </span>
          {planningClipboard?.shifts?.length ? (
            <span style={{ marginLeft: '0.65rem', opacity: 0.9 }}>
              · Planning copiato: <strong>{planningClipboardSummary(planningClipboard)}</strong>
            </span>
          ) : null}
        </p>

        {periodTooLong ? (
          <div className="alert alert-warning" style={{ marginBottom: '0.75rem' }}>
            Intervallo <strong>{periodLoStr}</strong> → <strong>{periodHiStr}</strong> = {periodDayCount} giorni: supera il
            massimo di <strong>{MAX_PLANNING_PERIOD_DAYS}</strong> giorni. Restringi «Dal» / «Al», poi clicca{' '}
            <strong>Carica piano</strong>.
          </div>
        ) : null}

        {loading && <AnalisiLoadingBar active label="Caricamento personale" variant="subtle" />}

        {!loading && !periodTooLong && hiddenPlanningSections.length > 0 ? (
          <div className="staff-hidden-planning-sections staff-report-no-print">
            <span>Sezioni nascoste:</span>
            {hiddenPlanningSections.map((section) => (
              <button
                key={section}
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => handleRestorePlanningSection(section)}
                title={`Ripristina Settimana ${section}`}
              >
                + {section}
              </button>
            ))}
          </div>
        ) : null}

        {!loading && !periodTooLong && planningWeekBlocks.length === 0 ? (
          <p className="text-muted" style={{ margin: '0 0 0.75rem' }}>
            Nessuna sezione visibile nella pianificazione. Ripristina una sezione nascosta qui sopra oppure aggiungine una nuova.
          </p>
        ) : null}

        {!loading && !periodTooLong && planningWeekBlocks.length > 0 ? (
          <div className="staff-planning-sections">
            {planningWeekBlocks.map((block) => (
              <div key={block.section} className="staff-section-week">
                <h3 className="staff-section-week-title">
                  <span className="staff-section-week-title-label">Settimana {block.sectionLabel}</span>
                  <span className="staff-section-week-title-actions">
                    <span className="staff-section-week-title-count">
                      {members.filter((m) => memberMatchesSection(m, block.section, localeSections)).length} dipendenti
                    </span>
                    <button
                      type="button"
                      className="staff-section-week-remove"
                      onClick={() => handleHidePlanningSection(block.section)}
                      disabled={shiftBusy}
                      title={`Rimuovi Settimana ${block.sectionLabel} dalla pianificazione`}
                      aria-label={`Rimuovi Settimana ${block.sectionLabel}`}
                    >
                      ×
                    </button>
                  </span>
                </h3>
                <div
                  className={
                    planView === 'day'
                      ? 'staff-week-grid staff-week-grid--single'
                      : planView === 'period' && displayDayCells.length > 14
                        ? 'staff-week-grid staff-week-grid--period-scroll'
                        : 'staff-week-grid'
                  }
                >
                  {displayDayCells.map((d) => {
                    const ymd = toYMD(d)
                    const dow = d.getDay()
                    const label = DAY_HEADERS[dow]
                    const dayNum = d.getDate()
                    const list = block.shiftsByDate.get(ymd) || []
                    return (
                      <div key={`${block.section}-${ymd}`} className="staff-day-card card" style={{ padding: '0.85rem', margin: 0 }}>
                        <div
                          className="staff-day-title"
                          style={{
                            fontWeight: 700,
                            fontSize: '0.95rem',
                            marginBottom: '0.6rem',
                            borderBottom: '1px solid var(--border, #e5e7eb)',
                            paddingBottom: '0.35rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '0.5rem',
                          }}
                        >
                          <span>
                            {label} {dayNum}
                          </span>
                          <button
                            type="button"
                            className="btn btn-vino btn-sm"
                            style={{ padding: '0.2rem 0.5rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }}
                            onClick={() => {
                              applyPlanningSection(block.section)
                              openDayAndInsertShift(d, block.section)
                            }}
                            disabled={shiftBusy}
                            title={`Apri questo giorno nel piano ${block.sectionLabel}`}
                          >
                            Apri giorno
                          </button>
                        </div>
                        <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: '0.88rem', lineHeight: 1.45 }}>
                          {list.map((s) => (
                            <li key={s.id} style={{ marginBottom: '0.35rem', display: 'flex', justifyContent: 'space-between', gap: '0.35rem', alignItems: 'flex-start' }}>
                              <span>{shiftLine(s)}</span>
                              <span style={{ flexShrink: 0 }}>
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  style={{ padding: '0.15rem 0.4rem' }}
                                  disabled={shiftBusy}
                                  onClick={() => startEditShift(s)}
                                >
                                  Mod.
                                </button>
                              </span>
                            </li>
                          ))}
                          {list.length === 0 && <li style={{ color: 'var(--text-muted)' }}>Nessuna voce</li>}
                        </ul>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section id="staff-shift-form-card" className="card" style={{ order: 2 }}>
        <h2 className="page-subheader" style={{ marginTop: 0 }}>
          {editingShiftId ? 'Modifica voce' : 'Nuova voce in pianificazione'}
        </h2>
        {!editingShiftId ? (
          <div className="staff-shift-form-hint" role="note">
            <p className="staff-shift-form-hint-title">Come inserire un turno</p>
            <p className="staff-shift-form-hint-list" style={{ margin: 0 }}>
              Scegli il <strong>Genere</strong> (Banco, Cucina, Forno… dalla sezione del dipendente), i{' '}
              <strong>Dipendenti</strong> e i <strong>Giorni settimana</strong>, imposta il <strong>Tipo</strong>
              {isAllDayKind(formKind)
                ? ' (ferie, assenza, malattia e riposo non richiedono orari)'
                : ' e gli orari'}
              , poi clicca <strong>Carica</strong>. Inserisce le voci nella settimana di quella sezione.
            </p>
          </div>
        ) : null}
        {!operatorMode ? (
        <GeminiVoiceAssistant
          label="Turno a voce (Gemini)"
          hint='Un dipendente: "Marianna martedì 8-16". Tutti insieme (vista Settimana): "tutti i dipendenti da lunedì a venerdì turno 8-16". Salvataggio automatico di tutti i turni.'
          text={aiShiftText}
          onTextChange={setAiShiftText}
          onCompile={handleGeminiShiftCompile}
          compiling={aiShiftLoading}
          disabled={shiftBusy}
          onClear={() => setAiShiftSummary('')}
        />
        ) : null}
        {aiShiftSummary ? (
          <div className="alert alert-success" style={{ marginBottom: '0.75rem' }}>
            <strong>Gemini:</strong> {aiShiftSummary}
          </div>
        ) : null}
        <form
          onSubmit={handleSubmitShift}
          className="form-row"
          style={{ flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end' }}
          aria-busy={shiftBusy}
        >
          <div className="form-group" style={{ flex: '0 1 150px' }}>
            <label>Genere</label>
            <select
              className="form-control"
              value={formGenere}
              disabled={shiftBusy}
              onChange={(e) => {
                const next = e.target.value
                setFormGenere(next)
                if (next) applyPlanningSection(next)
              }}
            >
              <option value="">Tutte le sezioni</option>
              {planningGridSectionOptions.map((section) => (
                <option key={section} value={section}>
                  {section}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ flex: '1 1 170px' }}>
            <label>Dipendenti</label>
            <StaffCheckboxDropdown
              hideLabel
              triggerLabel={membersDropdownLabel}
              open={membersDropdownOpen}
              onOpenChange={(next) => {
                setMembersDropdownOpen(next)
                if (next) setWeekDaysDropdownOpen(false)
              }}
              disabled={shiftBusy || membersInFormGenere.length === 0}
              showSelectAll={membersInFormGenere.length > 0 && !editingShiftId}
              selectAllRef={formMemberSelectAllRef}
              allSelected={allFormMembersSelected}
              onToggleAll={toggleSelectAllFormMembers}
              selectAllDisabled={shiftBusy}
              menuAriaLabel="Seleziona dipendenti"
              emptyMessage={
                membersInFormGenere.length === 0
                  ? formGenere
                    ? `Nessun dipendente in «${formGenere}». Assegna la sezione in anagrafica.`
                    : 'Nessun dipendente in elenco'
                  : null
              }
            >
              {membersInFormGenere.map((m) => (
                <label key={m.id} className="staff-shift-member-option">
                  <input
                    type="checkbox"
                    checked={formMemberIds.has(m.id)}
                    disabled={shiftBusy || (Boolean(editingShiftId) && !formMemberIds.has(m.id))}
                    onChange={() => toggleFormMemberSelection(m.id)}
                  />
                  <span>
                    {m.name}
                    {m.section ? ` (${m.section})` : ''}
                  </span>
                </label>
              ))}
            </StaffCheckboxDropdown>
          </div>
          <div className="form-group" style={{ flex: '1 1 150px' }}>
            <label>Giorni settimana</label>
            <StaffCheckboxDropdown
              hideLabel
              triggerLabel={weekDaysDropdownLabel}
              open={weekDaysDropdownOpen}
              onOpenChange={(next) => {
                setWeekDaysDropdownOpen(next)
                if (next) setMembersDropdownOpen(false)
              }}
              disabled={shiftBusy || Boolean(editingShiftId)}
              showSelectAll={!editingShiftId}
              selectAllRef={weekLoadDaysSelectAllRef}
              allSelected={allWeekDaysSelected}
              onToggleAll={toggleSelectAllWeekLoadDays}
              selectAllDisabled={shiftBusy}
              menuAriaLabel="Seleziona giorni della settimana"
            >
              {WEEK_LOAD_DAY_OPTIONS.map((d) => (
                <label key={d.offset} className="staff-shift-member-option">
                  <input
                    type="checkbox"
                    checked={weekLoadDays.has(d.offset)}
                    disabled={shiftBusy || Boolean(editingShiftId)}
                    onChange={() => toggleWeekLoadDay(d.offset)}
                  />
                  <span>{d.label}</span>
                </label>
              ))}
            </StaffCheckboxDropdown>
          </div>
          <div className="form-group" style={{ flex: '0 1 130px' }}>
            <label>Tipo</label>
            <select className="form-control" value={formKind} onChange={(e) => setFormKind(e.target.value)} disabled={shiftBusy}>
              <option value="shift">Turno</option>
              <option value="permission">Permesso</option>
              <option value="absence">Assenza</option>
              <option value="sick">Malattia</option>
              <option value="ferie">Ferie</option>
              <option value="riposo">Riposo</option>
            </select>
          </div>
          {(formKind === 'shift' || formKind === 'permission') && (
            <>
              <div className="form-group" style={{ flex: '0 1 100px' }}>
                <label>Inizio</label>
                <input type="time" className="form-control" value={formStart} onChange={(e) => setFormStart(e.target.value)} disabled={shiftBusy} />
              </div>
              <div className="form-group" style={{ flex: '0 1 100px' }}>
                <label>Fine</label>
                <input type="time" className="form-control" value={formEnd} onChange={(e) => setFormEnd(e.target.value)} disabled={shiftBusy} />
              </div>
            </>
          )}
          <div className="form-group" style={{ flex: '1 1 200px' }}>
            <label>Note</label>
            <input
              className="form-control"
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              placeholder="Dettagli utili"
              disabled={shiftBusy}
            />
          </div>
          <div className="staff-shift-actions-col" style={{ marginBottom: '0.35rem' }}>
            {!editingShiftId ? (
              <button
                type="button"
                className="btn btn-vino staff-week-load-btn-top"
                disabled={shiftBusy || formMemberIds.size === 0 || weekLoadDays.size === 0}
                onClick={() => void handleLoadMemberIntoWeekDays()}
                title="Inserisce i dipendenti selezionati nei giorni scelti della settimana visibile (usa tipo, orari e note del modulo)"
              >
                Carica
              </button>
            ) : (
              <div className="btn-group">
                <button type="submit" className="btn btn-primary" disabled={shiftBusy}>
                  {shiftBusy ? 'Attendere…' : 'Salva modifiche'}
                </button>
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  disabled={shiftBusy || loading || demoLoading}
                  onClick={() => reloadPlanning()}
                  title="Ricarica i turni dal server per il periodo selezionato (il modulo resta aperto; le modifiche non salvate restano nei campi)"
                >
                  {loading ? 'Aggiornamento…' : 'Aggiorna planning'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => resetForm()} disabled={shiftBusy}>
                  Annulla
                </button>
                <button type="button" className="btn btn-outline-danger" onClick={() => handleDeleteShift(editingShiftId)} disabled={shiftBusy}>
                  Elimina
                </button>
              </div>
            )}
          </div>
        </form>
      </section>
      </>
      ) : null}
      </div>

      <WeeklyStaffReportModal
        open={reportModalOpen}
        onClose={closeWeeklyReport}
        pdfBlob={reportPdfBlob}
        filename={reportFilename}
        whatsappText={reportWaText}
        periodLabel={reportPeriodLabel}
        modalTitle={reportModalTitle}
        onNotify={(msg) => setSuccess(msg)}
      />

      <StaffMemberInfoModal
        member={memberInfoTarget}
        onClose={() => !memberInfoSaving && setMemberInfoId(null)}
        onSave={handleSaveMemberInfo}
        saving={memberInfoSaving}
      />

      <StaffPayrollDaysModal
        open={payrollDaysInfo != null}
        memberName={payrollDaysInfo?.member?.name ?? ''}
        periodFrom={payrollDaysInfo?.periodFrom ?? ''}
        periodTo={payrollDaysInfo?.periodTo ?? ''}
        days={payrollDaysInfo?.days ?? []}
        totalHours={payrollDaysInfo?.totalHours ?? 0}
        giorniLavorati={payrollDaysInfo?.giorniLavorati ?? 0}
        onClose={() => setPayrollDaysInfoMemberId(null)}
      />
    </div>
  )
}
