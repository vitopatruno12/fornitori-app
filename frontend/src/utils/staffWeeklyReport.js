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
 * @param {Array<{ id: number, name: string }>} members
 * @param {Array<object>} shifts - voci nel range date già filtrato
 * @param {string} dateFromYmd
 * @param {string} dateToYmd
 */
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
 * @param {{ pdfMainHeading: string, periodTitle: string, periodSub: string, rows: ReturnType<typeof aggregateWeeklyStaffStats> }} opts
 * @returns {Blob}
 */
export function generateWeeklyStaffReportPdf({ pdfMainHeading, periodTitle, periodSub, rows }) {
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

  const body = rows.map((r) => [
    r.name,
    formatHoursIt(r.oreTurno),
    formatHoursIt(r.orePermesso),
    String(r.nPermessi),
    String(r.nAssenze),
    String(r.nMalattia),
  ])

  autoTable(doc, {
    startY: 34,
    head: [['Dipendente', 'Ore turno', 'Ore permesso', 'N. permessi', 'Assenze', 'Malattia']],
    body,
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [41, 98, 120], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 248, 250] },
    margin: { left: 14, right: 14 },
  })

  const finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 0 : 40
  doc.setFontSize(8)
  doc.setTextColor(100, 100, 100)
  doc.text(
    'Ore turno e permesso: somma delle durate indicate in pianificazione. Permessi: numero di voci; ore permesso solo se hanno fascia oraria.',
    14,
    finalY + 8,
    { maxWidth: pageW - 28 },
  )

  return doc.output('blob')
}
