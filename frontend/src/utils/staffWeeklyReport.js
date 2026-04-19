import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

/**
 * Ore decimali tra due orari HH:MM:SS (gestisce anche turno oltre mezzanotte).
 */
export function hoursBetween(timeStart, timeEnd) {
  if (!timeStart || !timeEnd) return 0
  const parse = (t) => {
    const s = String(t).slice(0, 8)
    const [h = '0', m = '0', sec = '0'] = s.split(':')
    return parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseInt(sec, 10)
  }
  let diff = parse(timeEnd) - parse(timeStart)
  if (diff < 0) diff += 24 * 3600
  return diff / 3600
}

function formatHoursIt(h) {
  if (h <= 0) return '—'
  return `${h.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} h`
}

/**
 * Testo con a capo: jsPDF con `maxWidth` disegna più righe ma non aggiorna Y → rischio sovrapposizione con tabelle.
 * @param {import('jspdf').jsPDF} doc
 * @returns {number} coordinata Y sotto l'ultima riga
 */
function writeWrappedLines(doc, text, x, y, maxWidth, lineHeightMm) {
  const lines = doc.splitTextToSize(String(text), maxWidth)
  doc.text(lines, x, y)
  return y + lines.length * lineHeightMm
}

/**
 * @param {Array<{ id: number, name: string }>} members
 * @param {Array<object>} shifts - voci nel range date già filtrato
 * @param {string} dateFromYmd
 * @param {string} dateToYmd
 */
/** Giorni di calendario inclusivi tra due date YYYY-MM-DD. */
function countInclusiveCalendarDays(fromYmd, toYmd) {
  const d0 = new Date(`${fromYmd}T12:00:00`)
  const d1 = new Date(`${toYmd}T12:00:00`)
  if (Number.isNaN(d0.getTime()) || Number.isNaN(d1.getTime())) return 0
  if (d1 < d0) return 0
  return Math.round((d1.getTime() - d0.getTime()) / 86400000) + 1
}

/**
 * Totali periodo per sole voci tipo turno (ore lavorate) + quantificazione equivalente turni.
 * @param {Array<object>} shifts
 * @param {string} dateFromYmd
 * @param {string} dateToYmd
 */
export function aggregateShiftPeriodTotals(shifts, dateFromYmd, dateToYmd) {
  let totalOreTurno = 0
  const giorniConTurno = new Set()
  const list = Array.isArray(shifts) ? shifts : []
  for (const s of list) {
    if (!s || s.work_date < dateFromYmd || s.work_date > dateToYmd) continue
    if (s.entry_kind !== 'shift') continue
    const h = hoursBetween(s.time_start, s.time_end)
    totalOreTurno += h
    if (h > 0) giorniConTurno.add(s.work_date)
  }
  const giorniPeriodo = countInclusiveCalendarDays(dateFromYmd, dateToYmd)
  const orePerTurnoRiferimento = 8
  const turniEquivalenti =
    orePerTurnoRiferimento > 0 ? totalOreTurno / orePerTurnoRiferimento : 0
  const nGiorniConTurno = giorniConTurno.size
  const oreMedieGiornoTurno = nGiorniConTurno > 0 ? totalOreTurno / nGiorniConTurno : 0

  return {
    totalOreTurno,
    giorniPeriodo,
    giorniConTurno: nGiorniConTurno,
    turniEquivalenti,
    oreMedieGiornoTurno,
    orePerTurnoRiferimento,
  }
}

function parseYmdLocal(ymd) {
  const parts = String(ymd).split('-').map(Number)
  if (parts.length < 3 || Number.isNaN(parts[0])) return null
  return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0)
}

function formatYmdLocal(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Lettera giorno settimana (settimana da lunedì: 0=L … 6=D). */
const DOW_LETTER_MON = ['L', 'M', 'M', 'G', 'V', 'S', 'D']

function enumerateDaysInclusive(dateFromYmd, dateToYmd) {
  const a = parseYmdLocal(dateFromYmd)
  const b = parseYmdLocal(dateToYmd)
  if (!a || !b) return []
  const start = a <= b ? a : b
  const end = a <= b ? b : a
  const out = []
  let cur = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 12, 0, 0, 0)
  const endT = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 12, 0, 0, 0)
  while (cur.getTime() <= endT.getTime()) {
    const jd = cur.getDay()
    const dowMon0 = jd === 0 ? 6 : jd - 1
    out.push({
      ymd: formatYmdLocal(cur),
      dayOfMonth: cur.getDate(),
      dowMon0,
      isWeekend: jd === 0 || jd === 6,
    })
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1, 12, 0, 0, 0)
  }
  return out
}

function chunkArray(arr, size) {
  const chunks = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

/** Map "staffId|YYYY-MM-DD" -> ore turno (somma voci shift). */
function buildShiftHourMatrixMap(shifts, dateFromYmd, dateToYmd) {
  const m = new Map()
  for (const s of shifts || []) {
    if (!s || s.entry_kind !== 'shift') continue
    if (s.work_date < dateFromYmd || s.work_date > dateToYmd) continue
    const h = hoursBetween(s.time_start, s.time_end)
    const k = `${Number(s.staff_member_id)}|${s.work_date}`
    m.set(k, (m.get(k) || 0) + h)
  }
  return m
}

function formatMatrixCellHours(h) {
  if (!h || h <= 0) return ''
  if (Math.abs(h - Math.round(h)) < 0.001) return String(Math.round(h))
  return h.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

export function aggregateWeeklyStaffStats(members, shifts, dateFromYmd, dateToYmd) {
  const byId = new Map()
  for (const m of members) {
    byId.set(m.id, {
      memberId: m.id,
      name: m.name,
      oreTurno: 0,
      orePermesso: 0,
      nPermessi: 0,
      nAssenze: 0,
      nMalattia: 0,
    })
  }
  for (const s of shifts) {
    if (s.work_date < dateFromYmd || s.work_date > dateToYmd) continue
    let row = byId.get(s.staff_member_id)
    if (!row) {
      row = {
        memberId: s.staff_member_id,
        name: s.staff_member_name || `ID ${s.staff_member_id}`,
        oreTurno: 0,
        orePermesso: 0,
        nPermessi: 0,
        nAssenze: 0,
        nMalattia: 0,
      }
      byId.set(s.staff_member_id, row)
    }
    const h = hoursBetween(s.time_start, s.time_end)
    switch (s.entry_kind) {
      case 'shift':
        row.oreTurno += h
        break
      case 'permission':
        row.nPermessi += 1
        if (h > 0) row.orePermesso += h
        break
      case 'absence':
        row.nAssenze += 1
        break
      case 'sick':
        row.nMalattia += 1
        break
      default:
        break
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'it'))
}

/**
 * Testo breve per WhatsApp quando non si può allegare il PDF.
 */
export function buildWeeklyReportWhatsAppText(periodTitle, rows) {
  const lines = [`📊 Report personale — ${periodTitle}`, '']
  for (const r of rows) {
    lines.push(
      `• ${r.name}: turno ${formatHoursIt(r.oreTurno)} | permessi ${r.nPermessi} (${formatHoursIt(r.orePermesso)}) | assenze ${r.nAssenze} | malattia ${r.nMalattia}`,
    )
  }
  return lines.join('\n')
}

/**
 * @param {{ pdfMainHeading: string, periodTitle: string, periodSub: string, rows: ReturnType<typeof aggregateWeeklyStaffStats>, shifts?: object[], dateFromYmd?: string, dateToYmd?: string }} opts
 * @returns {Blob}
 */
export function generateWeeklyStaffReportPdf({
  pdfMainHeading,
  periodTitle,
  periodSub,
  rows,
  shifts = [],
  dateFromYmd = '',
  dateToYmd = '',
}) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  doc.setFontSize(16)
  doc.text(pdfMainHeading, 14, 14)
  doc.setFontSize(10)
  doc.setTextColor(60, 60, 60)
  doc.text(periodTitle, 14, 22)
  doc.text(periodSub, 14, 28)
  const gen = new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })
  doc.text(`Generato: ${gen}`, pageW - 14, 14, { align: 'right' })

  let tableStartY = 34
  if (dateFromYmd && dateToYmd) {
    const t = aggregateShiftPeriodTotals(shifts, dateFromYmd, dateToYmd)
    let y = 34
    doc.setFontSize(11)
    doc.setTextColor(25, 40, 55)
    doc.text('Ore lavorate e quantificazione turni', 14, y)
    y += 6
    doc.setFontSize(9)
    doc.setTextColor(45, 45, 45)
    doc.text(`Totale ore turno nel periodo: ${formatHoursIt(t.totalOreTurno)}`, 14, y)
    y += 5
    doc.text(
      `Giorni di calendario nel periodo: ${t.giorniPeriodo} — giorni con almeno un turno: ${t.giorniConTurno}`,
      14,
      y,
    )
    y += 5
    const turniStr = t.turniEquivalenti.toLocaleString('it-IT', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })
    y = writeWrappedLines(
      doc,
      `Equivalente turni (ogni turno = ${t.orePerTurnoRiferimento} h): circa ${turniStr} turni.`,
      14,
      y,
      pageW - 28,
      4.3,
    )
    y += 3
    if (t.giorniConTurno > 0) {
      doc.text(`Media ore nei giorni con turno: ${formatHoursIt(t.oreMedieGiornoTurno)}`, 14, y)
      y += 5
    }
    const blockTop = y + 4
    doc.setFontSize(10)
    doc.setTextColor(25, 40, 55)
    const afterMatrixTitle = writeWrappedLines(
      doc,
      'Matrice ore turno (stile planning: dipendenti in riga, ogni colonna un giorno del periodo; sabato e domenica evidenziate)',
      14,
      blockTop,
      pageW - 28,
      4.5,
    )
    let yMatrix = afterMatrixTitle + 2

    const allDays = enumerateDaysInclusive(dateFromYmd, dateToYmd)
    const hourMap = buildShiftHourMatrixMap(shifts, dateFromYmd, dateToYmd)
    const maxDaysPerTable = 31
    const dayChunks = chunkArray(allDays, maxDaysPerTable)
    const nChunks = dayChunks.length

    for (let ci = 0; ci < dayChunks.length; ci++) {
      const chunk = dayChunks[ci]
      const headRow1 = ['Dipendente', ...chunk.map((d) => String(d.dayOfMonth)), 'Tot. ore']
      const headRow2 = ['', ...chunk.map((d) => DOW_LETTER_MON[d.dowMon0]), '']
      const matrixBody = rows.map((r) => {
        const dayCells = chunk.map((d) => {
          const h = hourMap.get(`${Number(r.memberId)}|${d.ymd}`) || 0
          return formatMatrixCellHours(h)
        })
        return [r.name, ...dayCells, formatMatrixCellHours(r.oreTurno)]
      })

      const lastColIdx = chunk.length + 1
      const weekendFill = [210, 228, 245]
      const headFill = [55, 95, 115]

      autoTable(doc, {
        startY: yMatrix,
        head: [headRow1, headRow2],
        body: matrixBody,
        styles: {
          fontSize: chunk.length > 24 ? 5.5 : 6.5,
          cellPadding: 0.6,
          halign: 'center',
          valign: 'middle',
          overflow: 'linebreak',
        },
        headStyles: { fillColor: headFill, textColor: 255, fontSize: chunk.length > 24 ? 6 : 7 },
        columnStyles: {
          0: { halign: 'left', cellWidth: 28 },
          [lastColIdx]: { fontStyle: 'bold', cellWidth: 14 },
        },
        margin: { left: 14, right: 14 },
        tableWidth: pageW - 28,
        didParseCell: (data) => {
          const col = data.column.index
          if (col === 0) {
            if (data.section === 'body') {
              data.cell.styles.halign = 'left'
              data.cell.styles.fontStyle = 'normal'
            }
            return
          }
          if (col === lastColIdx) return
          const di = col - 1
          if (di < 0 || di >= chunk.length || !chunk[di].isWeekend) return
          data.cell.styles.fillColor = weekendFill
          if (data.section === 'head') {
            data.cell.styles.textColor = [35, 50, 75]
          }
        },
      })
      yMatrix = (doc.lastAutoTable?.finalY ?? yMatrix) + 6
      if (ci < nChunks - 1) {
        doc.setFontSize(8)
        doc.setTextColor(80, 80, 80)
        doc.text(`Segue: parte ${ci + 2} di ${nChunks} (giorni successivi del periodo).`, 14, yMatrix)
        yMatrix += 4
      }
    }
    tableStartY = yMatrix
  }

  const body = rows.map((r) => [
    r.name,
    formatHoursIt(r.oreTurno),
    formatHoursIt(r.orePermesso),
    String(r.nPermessi),
    String(r.nAssenze),
    String(r.nMalattia),
  ])

  autoTable(doc, {
    startY: tableStartY,
    head: [['Dipendente', 'Ore turno', 'Ore permesso', 'N. permessi', 'Assenze', 'Malattia']],
    body,
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [41, 98, 120], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 248, 250] },
    margin: { left: 14, right: 14 },
  })

  return doc.output('blob')
}
