import {
  aggregateShiftPeriodTotals,
  aggregateWeeklyStaffStats,
  hoursBetween,
} from './staffWeeklyReport.js'

const KIND_LABELS = {
  shift: 'Turno',
  permission: 'Permesso',
  absence: 'Assenza',
  sick: 'Malattia',
  ferie: 'Ferie',
  riposo: 'Riposo',
}

export const STAFF_REPORT_SHEET_VOCI = 'VOCI'
export const STAFF_REPORT_SHEET_FERIE = 'FERIE'
export const STAFF_REPORT_SHEET_RIEPILOGO = 'RIEPILOGO'
export const STAFF_REPORT_SHEET_TOTALI = 'TOTALI'

export const STAFF_REPORT_VOCI_HEADERS = ['Dipendente', 'Dal', 'Al', 'Tipo', 'Ore', 'Note']

export const STAFF_REPORT_RIEPILOGO_HEADERS = [
  'Dipendente',
  'Ore turno',
  'Ore permesso',
  'N. permessi',
  'Assenze',
  'Malattia',
  'Ferie',
  'Riposo',
]

export const STAFF_REPORT_VOCI_COLUMNS = [
  { id: 'employee', label: 'Dipendente', width: 24, emphasis: true, fluid: true },
  { id: 'dal', label: 'Dal', width: 14, fluid: true },
  { id: 'al', label: 'Al', width: 14, fluid: true },
  { id: 'kind', label: 'Tipo', width: 12, fluid: true },
  { id: 'hours', label: 'Ore', numeric: true, width: 10, fluid: true },
  { id: 'notes', label: 'Note', width: 26, multiline: true, fluid: true },
]

export const STAFF_REPORT_FERIE_HEADERS = ['Dipendente', 'Dal', 'Al', 'Tipo', 'Giorni', 'Note']

export const STAFF_REPORT_FERIE_COLUMNS = [
  { id: 'employee', label: 'Dipendente', width: 24, emphasis: true, fluid: true },
  { id: 'dal', label: 'Dal', width: 14, fluid: true },
  { id: 'al', label: 'Al', width: 14, fluid: true },
  { id: 'kind', label: 'Tipo', width: 12, fluid: true },
  { id: 'days', label: 'Giorni', numeric: true, width: 10, fluid: true },
  { id: 'notes', label: 'Note', width: 26, multiline: true, fluid: true },
]

export const STAFF_REPORT_RIEPILOGO_COLUMNS = [
  { id: 'employee', label: 'Dipendente', width: 22, emphasis: true, fluid: true },
  { id: 'shiftHours', label: 'Ore turno', width: 14, fluid: true },
  { id: 'permissionHours', label: 'Ore permesso', width: 14, fluid: true },
  { id: 'permissionCount', label: 'N. permessi', numeric: true, width: 12, fluid: true },
  { id: 'absences', label: 'Assenze', numeric: true, width: 12, fluid: true },
  { id: 'sick', label: 'Malattia', numeric: true, width: 12, fluid: true },
  { id: 'ferie', label: 'Ferie', numeric: true, width: 12, fluid: true },
  { id: 'riposo', label: 'Riposo', numeric: true, width: 12, fluid: true },
]

export const STAFF_REPORT_TOTALI_COLUMNS = [
  { id: 'label', label: 'Voce', width: 38, emphasis: true, fluid: true },
  { id: 'value', label: 'Valore', width: 62, multiline: true, fluid: true },
]

function formatYmdIt(ymd) {
  const d = new Date(`${ymd}T12:00:00`)
  if (Number.isNaN(d.getTime())) return ymd
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatTimeShort(value) {
  if (!value) return ''
  return String(value).slice(0, 5)
}

function formatHoursCell(h) {
  if (!h || h <= 0) return ''
  if (Math.abs(h - Math.round(h)) < 0.001) return String(Math.round(h))
  return h.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function formatHoursLabel(h) {
  if (!h || h <= 0) return '—'
  return `${formatHoursCell(h)} h`
}

function memberNameForShift(shift, members) {
  const direct = String(shift.staff_member_name || '').trim()
  if (direct) return direct
  const id = Number(shift.staff_member_id)
  const m = (members || []).find((row) => Number(row.id) === id)
  return m?.name || ''
}

function compareShifts(a, b, members) {
  const byDate = String(a.work_date).localeCompare(String(b.work_date))
  if (byDate !== 0) return byDate
  const byName = memberNameForShift(a, members).localeCompare(memberNameForShift(b, members), 'it')
  if (byName !== 0) return byName
  return String(a.time_start || '').localeCompare(String(b.time_start || ''))
}

function ymdKey(value) {
  return String(value || '').slice(0, 10)
}

function addDaysYmd(ymd, days) {
  const d = new Date(`${ymd}T12:00:00`)
  if (Number.isNaN(d.getTime())) return ymd
  d.setDate(d.getDate() + days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function inclusiveDayCount(from, to) {
  const a = new Date(`${from}T12:00:00`)
  const b = new Date(`${to}T12:00:00`)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return 0
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1
}

function isWeekendYmd(ymd) {
  const day = new Date(`${ymd}T12:00:00`).getDay()
  return day === 0 || day === 6
}

/** Tra due blocchi di ferie manca solo sabato e/o domenica: è lo stesso periodo. */
function gapIsWeekendOnly(leftTo, rightFrom) {
  let cursor = addDaysYmd(leftTo, 1)
  if (!cursor || cursor >= rightFrom) return false
  while (cursor < rightFrom) {
    if (!isWeekendYmd(cursor)) return false
    cursor = addDaysYmd(cursor, 1)
  }
  return true
}

/**
 * Giorni di ferie consecutivi dello stesso dipendente (stesse note) diventano un solo intervallo.
 * @param {object[]} shifts
 * @param {object[]} members
 */
export function collapseFerieRanges(shifts, members) {
  const groups = new Map()
  for (const shift of shifts || []) {
    if (!shift || shift.entry_kind !== 'ferie') continue
    const ymd = ymdKey(shift.work_date)
    if (!ymd) continue
    const notes = String(shift.notes || '').trim()
    const key = `${Number(shift.staff_member_id)}|${notes}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(shift)
  }

  const ranges = []
  for (const list of groups.values()) {
    list.sort((a, b) => ymdKey(a.work_date).localeCompare(ymdKey(b.work_date)) || Number(a.id) - Number(b.id))
    let current = null
    for (const shift of list) {
      const ymd = ymdKey(shift.work_date)
      const id = Number(shift.id)
      if (!current) {
        current = {
          staffMemberId: Number(shift.staff_member_id),
          employee: memberNameForShift(shift, members),
          kind: 'Ferie',
          entryKind: 'ferie',
          notes: String(shift.notes || '').trim(),
          dateFrom: ymd,
          dateTo: ymd,
          days: 1,
          shiftIds: Number.isFinite(id) ? [id] : [],
          byDate: { [ymd]: Number.isFinite(id) ? [id] : [] },
        }
        continue
      }
      if (ymd === current.dateTo) {
        if (Number.isFinite(id)) {
          current.shiftIds.push(id)
          current.byDate[ymd].push(id)
        }
        continue
      }
      if (ymd === addDaysYmd(current.dateTo, 1)) {
        current.dateTo = ymd
        current.days += 1
        current.byDate[ymd] = Number.isFinite(id) ? [id] : []
        if (Number.isFinite(id)) current.shiftIds.push(id)
        continue
      }
      ranges.push(current)
      current = {
        staffMemberId: Number(shift.staff_member_id),
        employee: memberNameForShift(shift, members),
        kind: 'Ferie',
        entryKind: 'ferie',
        notes: String(shift.notes || '').trim(),
        dateFrom: ymd,
        dateTo: ymd,
        days: 1,
        shiftIds: Number.isFinite(id) ? [id] : [],
        byDate: { [ymd]: Number.isFinite(id) ? [id] : [] },
      }
    }
    if (current) ranges.push(current)
  }

  ranges.sort((a, b) => {
    const byMember = a.staffMemberId - b.staffMemberId
    if (byMember !== 0) return byMember
    const byNotes = a.notes.localeCompare(b.notes, 'it')
    if (byNotes !== 0) return byNotes
    return a.dateFrom.localeCompare(b.dateFrom)
  })

  const merged = []
  for (const range of ranges) {
    const prev = merged[merged.length - 1]
    if (
      prev &&
      prev.staffMemberId === range.staffMemberId &&
      prev.notes === range.notes &&
      gapIsWeekendOnly(prev.dateTo, range.dateFrom)
    ) {
      prev.dateTo = range.dateTo
      prev.days = inclusiveDayCount(prev.dateFrom, prev.dateTo)
      prev.shiftIds.push(...range.shiftIds)
      Object.assign(prev.byDate, range.byDate)
      continue
    }
    merged.push(range)
  }

  merged.sort((a, b) => {
    const byName = a.employee.localeCompare(b.employee, 'it')
    if (byName !== 0) return byName
    return a.dateFrom.localeCompare(b.dateFrom)
  })
  return merged
}

function ferieRangeToRow(range) {
  return {
    dal: formatYmdIt(range.dateFrom),
    al: formatYmdIt(range.dateTo),
    employee: range.employee,
    kind: range.kind,
    days: String(range.days),
    notes: range.notes || '',
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    staffMemberId: range.staffMemberId,
    entryKind: range.entryKind,
    shiftIds: range.shiftIds,
    byDate: range.byDate,
  }
}

function shiftToVociRecord(shift, members) {
  const ymd = ymdKey(shift.work_date)
  const hours = hoursBetween(shift.time_start, shift.time_end)
  const id = Number(shift.id)
  return {
    employee: memberNameForShift(shift, members),
    dal: formatYmdIt(ymd),
    al: formatYmdIt(ymd),
    kind: KIND_LABELS[shift.entry_kind] || shift.entry_kind || 'Turno',
    timeStart: formatTimeShort(shift.time_start),
    timeEnd: formatTimeShort(shift.time_end),
    hours: formatHoursCell(hours),
    notes: shift.notes || '',
    dateFrom: ymd,
    dateTo: ymd,
    staffMemberId: Number(shift.staff_member_id),
    entryKind: shift.entry_kind || 'shift',
    shiftIds: Number.isFinite(id) ? [id] : [],
    byDate: { [ymd]: Number.isFinite(id) ? [id] : [] },
  }
}

function vociRecordToExcel(record) {
  return [record.employee, record.dal, record.al, record.kind, record.hours || '', record.notes || '']
}

/**
 * @param {{ members: object[], shifts: object[], dateFrom: string, dateTo: string }} opts
 */
export function buildStaffReportWorkbook({ members = [], shifts = [], dateFrom, dateTo }) {
  const from = String(dateFrom || '').slice(0, 10)
  const to = String(dateTo || '').slice(0, 10)
  const title = `Report personale ${from} — ${to}`

  const filtered = (shifts || [])
    .filter((s) => s && s.work_date >= from && s.work_date <= to)
    .slice()
    .sort((a, b) => compareShifts(a, b, members))

  const ferieRanges = collapseFerieRanges(filtered, members)
  const ferieRecords = ferieRanges.map((range) => ferieRangeToRow(range))
  const ferieRows = [
    STAFF_REPORT_FERIE_HEADERS,
    ...ferieRecords.map((record) => [record.employee, record.dal, record.al, record.kind, record.days, record.notes]),
  ]

  const otherRecords = filtered
    .filter((shift) => shift.entry_kind !== 'ferie')
    .map((shift) => shiftToVociRecord(shift, members))
  const vociRecords = [...otherRecords, ...ferieRecords].sort((a, b) => {
    const byName = String(a.employee || '').localeCompare(String(b.employee || ''), 'it')
    if (byName !== 0) return byName
    return String(a.dateFrom || '').localeCompare(String(b.dateFrom || ''))
  })
  const vociRows = [STAFF_REPORT_VOCI_HEADERS, ...vociRecords.map(vociRecordToExcel)]

  const stats = aggregateWeeklyStaffStats(members, shifts, from, to)
  const riepilogoRows = [
    STAFF_REPORT_RIEPILOGO_HEADERS,
    ...stats.map((row) => [
      row.name,
      formatHoursLabel(row.oreTurno),
      formatHoursLabel(row.orePermesso),
      String(row.nPermessi),
      String(row.nAssenze),
      String(row.nMalattia),
      String(row.nFerie),
      String(row.nRiposo ?? 0),
    ]),
  ]

  const totals = aggregateShiftPeriodTotals(shifts, from, to)
  const nFerie = ferieRanges.length
  const giorniFerie = ferieRanges.reduce((sum, range) => sum + Number(range.days || 0), 0)
  const turniStr = totals.turniEquivalenti.toLocaleString('it-IT', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
  const totaliRows = [
    ['Voce', 'Valore'],
    ['Periodo', `${formatYmdIt(from)} → ${formatYmdIt(to)}`],
    ['Totale ore turno', formatHoursLabel(totals.totalOreTurno)],
    ['Giorni di calendario', String(totals.giorniPeriodo)],
    ['Giorni con almeno un turno', String(totals.giorniConTurno)],
    [`Equivalente turni (${totals.orePerTurnoRiferimento} h)`, turniStr],
    ['Media ore nei giorni con turno', formatHoursLabel(totals.oreMedieGiornoTurno)],
    ['Numero voci nel foglio VOCI', String(Math.max(0, vociRows.length - 1))],
    ['Numero periodi ferie', String(nFerie)],
    ['Giorni di ferie', String(giorniFerie)],
    ['Numero dipendenti', String(stats.length)],
  ]

  return {
    title,
    dateFrom: from,
    dateTo: to,
    sheets: [
      { name: STAFF_REPORT_SHEET_VOCI, rows: vociRows, records: vociRecords },
      { name: STAFF_REPORT_SHEET_FERIE, rows: ferieRows, records: ferieRecords },
      { name: STAFF_REPORT_SHEET_RIEPILOGO, rows: riepilogoRows },
      { name: STAFF_REPORT_SHEET_TOTALI, rows: totaliRows },
    ],
  }
}

export function formatStaffReportCell(value) {
  if (value == null || value === '') return ''
  return String(value)
}

export function staffReportSheetHeaders(sheet) {
  const rows = sheet?.rows || []
  return Array.isArray(rows[0]) ? rows[0] : []
}

export function staffReportSheetBodyRows(sheet) {
  const rows = sheet?.rows || []
  return rows.length > 1 ? rows.slice(1) : []
}

export function staffReportColumnCount(sheet) {
  const headers = staffReportSheetHeaders(sheet)
  const body = staffReportSheetBodyRows(sheet)
  const maxBody = body.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0)
  return Math.max(headers.length, maxBody, 1)
}

export function staffReportColumnsForSheet(sheet) {
  const name = sheet?.name
  if (name === STAFF_REPORT_SHEET_FERIE) return STAFF_REPORT_FERIE_COLUMNS
  if (name === STAFF_REPORT_SHEET_VOCI) return STAFF_REPORT_VOCI_COLUMNS
  if (name === STAFF_REPORT_SHEET_RIEPILOGO) return STAFF_REPORT_RIEPILOGO_COLUMNS
  if (name === STAFF_REPORT_SHEET_TOTALI) return STAFF_REPORT_TOTALI_COLUMNS
  const headers = staffReportSheetHeaders(sheet)
  return headers.map((label, index) => ({
    id: `col_${index}`,
    label: String(label || ''),
    width: 14,
    fluid: true,
  }))
}

function ferieRowFromArray(row) {
  return {
    employee: row?.[0] ?? '',
    dal: row?.[1] ?? '',
    al: row?.[2] ?? '',
    kind: row?.[3] ?? '',
    days: row?.[4] ?? '',
    notes: row?.[5] ?? '',
  }
}

function vociRowFromArray(row) {
  return {
    employee: row?.[0] ?? '',
    dal: row?.[1] ?? '',
    al: row?.[2] ?? '',
    kind: row?.[3] ?? '',
    hours: row?.[4] ?? '',
    notes: row?.[5] ?? '',
  }
}

function riepilogoRowFromArray(row) {
  return {
    employee: row?.[0] ?? '',
    shiftHours: row?.[1] ?? '',
    permissionHours: row?.[2] ?? '',
    permissionCount: row?.[3] ?? '',
    absences: row?.[4] ?? '',
    sick: row?.[5] ?? '',
    ferie: row?.[6] ?? '',
    riposo: row?.[7] ?? '',
  }
}

function totaliRowFromArray(row) {
  return {
    label: row?.[0] ?? '',
    value: row?.[1] ?? '',
  }
}

export function staffReportGridRows(sheet) {
  const body = staffReportSheetBodyRows(sheet)
  const name = sheet?.name
  if (name === STAFF_REPORT_SHEET_FERIE) {
    return Array.isArray(sheet.records) ? sheet.records : body.map(ferieRowFromArray)
  }
  if (name === STAFF_REPORT_SHEET_VOCI) {
    return Array.isArray(sheet.records) ? sheet.records : body.map(vociRowFromArray)
  }
  if (name === STAFF_REPORT_SHEET_RIEPILOGO) return body.map(riepilogoRowFromArray)
  if (name === STAFF_REPORT_SHEET_TOTALI) return body.map(totaliRowFromArray)
  return body.map((row, rowIndex) => {
    const out = { id: `row-${rowIndex}` }
    const cells = Array.isArray(row) ? row : []
    cells.forEach((value, index) => {
      out[`col_${index}`] = value ?? ''
    })
    return out
  })
}

/**
 * @param {Record<string, unknown>} row
 * @param {{ id: string }} column
 */
export function staffReportCellValue(row, column) {
  const value = row?.[column.id]
  return formatStaffReportCell(value)
}

export function staffReportTotalsLabel(columnId, count) {
  if (columnId === 'employee' || columnId === 'label') return `TOTALI (${count})`
  return ''
}
