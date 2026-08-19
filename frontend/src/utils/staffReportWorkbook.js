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

export const STAFF_REPORT_VOCI_HEADERS = [
  'Data',
  'Dipendente',
  'Tipo',
  'Ora inizio',
  'Ora fine',
  'Ore',
  'Note',
]

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
  { id: 'date', label: 'Data', width: 11, fluid: true },
  { id: 'employee', label: 'Dipendente', width: 18, emphasis: true, fluid: true },
  { id: 'kind', label: 'Tipo', width: 12, fluid: true },
  { id: 'timeStart', label: 'Ora inizio', width: 10, fluid: true },
  { id: 'timeEnd', label: 'Ora fine', width: 10, fluid: true },
  { id: 'hours', label: 'Ore', numeric: true, width: 8, fluid: true },
  { id: 'notes', label: 'Note', width: 31, multiline: true, fluid: true },
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

function shiftToVociRow(shift, members) {
  const kind = KIND_LABELS[shift.entry_kind] || shift.entry_kind || 'Turno'
  const hours = hoursBetween(shift.time_start, shift.time_end)
  return [
    formatYmdIt(shift.work_date),
    memberNameForShift(shift, members),
    kind,
    formatTimeShort(shift.time_start),
    formatTimeShort(shift.time_end),
    formatHoursCell(hours),
    shift.notes || '',
  ]
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

  const vociRows = [STAFF_REPORT_VOCI_HEADERS]
  for (const shift of filtered) {
    vociRows.push(shiftToVociRow(shift, members))
  }

  const ferieShifts = filtered.filter((s) => s.entry_kind === 'ferie')
  const ferieRows = [STAFF_REPORT_VOCI_HEADERS]
  for (const shift of ferieShifts) {
    ferieRows.push(shiftToVociRow(shift, members))
  }

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
  const nFerie = ferieShifts.length
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
    ['Numero voci ferie', String(nFerie)],
    ['Numero dipendenti', String(stats.length)],
  ]

  return {
    title,
    dateFrom: from,
    dateTo: to,
    sheets: [
      { name: STAFF_REPORT_SHEET_VOCI, rows: vociRows },
      { name: STAFF_REPORT_SHEET_FERIE, rows: ferieRows },
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
  if (name === STAFF_REPORT_SHEET_VOCI || name === STAFF_REPORT_SHEET_FERIE) return STAFF_REPORT_VOCI_COLUMNS
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

function vociRowFromArray(row) {
  return {
    date: row?.[0] ?? '',
    employee: row?.[1] ?? '',
    kind: row?.[2] ?? '',
    timeStart: row?.[3] ?? '',
    timeEnd: row?.[4] ?? '',
    hours: row?.[5] ?? '',
    notes: row?.[6] ?? '',
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
  if (name === STAFF_REPORT_SHEET_VOCI || name === STAFF_REPORT_SHEET_FERIE) return body.map(vociRowFromArray)
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
