import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

function toMinutes(hhmm) {
  if (!hhmm) return null
  const [h = '0', m = '0'] = String(hhmm).split(':')
  const hh = Number(h)
  const mm = Number(m)
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
  return hh * 60 + mm
}

export function durationHours(start, end) {
  const s = toMinutes(start)
  const e = toMinutes(end)
  if (s == null || e == null) return 0
  let diff = e - s
  if (diff < 0) diff += 24 * 60
  return diff / 60
}

function formatHours(hours) {
  if (!hours) return '—'
  return `${hours.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} h`
}

function eur(v) {
  return `€ ${Number(v || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function generateSupportTechnicianPdf({ periodLabel, rows, technicianName, hourlyRate }) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const generatedAt = new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })
  const rate = Number(hourlyRate || 0)

  doc.setFontSize(16)
  doc.text('Assistenza tecnica — Report lavori / Fattura', 14, 14)
  doc.setFontSize(10)
  doc.setTextColor(60, 60, 60)
  doc.text(`Periodo: ${periodLabel}`, 14, 21)
  doc.text(`Tecnico: ${technicianName || 'Tutti'}`, 14, 27)
  doc.text(`Generato: ${generatedAt}`, pageW - 14, 14, { align: 'right' })
  if (rate > 0) doc.text(`Tariffa: € ${rate.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/h`, pageW - 14, 21, { align: 'right' })

  const body = rows.map((r) => {
    const hours = durationHours(r.time_start, r.time_end)
    const amount = rate > 0 ? hours * rate : 0
    return [
      new Date(`${r.activity_date}T12:00:00`).toLocaleDateString('it-IT'),
      r.technician_name || '—',
      r.kind === 'completed' ? 'Svolto' : 'Pianificato',
      [r.time_start || '--:--', r.time_end || '--:--'].join(' - '),
      formatHours(hours),
      r.location || '—',
      r.notes || '—',
      rate > 0 ? `€ ${amount.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—',
    ]
  })

  autoTable(doc, {
    startY: 32,
    head: [['Data', 'Tecnico', 'Tipo', 'Orario', 'Ore', 'Dove', 'Intervento svolto', 'Importo']],
    body,
    styles: { fontSize: 8.5, cellPadding: 2 },
    headStyles: { fillColor: [17, 76, 95], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 248, 250] },
    margin: { left: 12, right: 12 },
    columnStyles: {
      6: { cellWidth: 72 },
    },
  })

  const totalHours = rows.reduce((acc, r) => acc + durationHours(r.time_start, r.time_end), 0)
  const totalAmount = rate > 0 ? totalHours * rate : 0
  const finalY = (doc.lastAutoTable?.finalY || 40) + 8
  doc.setFontSize(10)
  doc.setTextColor(30, 30, 30)
  doc.text(`Totale ore: ${formatHours(totalHours)}`, 14, finalY)
  if (rate > 0) {
    doc.text(`Totale fattura: € ${totalAmount.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 14, finalY + 6)
  } else {
    doc.setFontSize(8.5)
    doc.setTextColor(90, 90, 90)
    doc.text('Imposta una tariffa €/h per ottenere il totale fattura nel PDF.', 14, finalY + 6)
  }

  return doc.output('blob')
}

export function generateSupportTechnicianInvoicePdf({
  rows,
  technicianName,
  hourlyRate,
  invoiceNumber,
  invoiceDate,
}) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const rate = Number(hourlyRate || 0)
  const invDate = invoiceDate
    ? new Date(`${invoiceDate}T12:00:00`).toLocaleDateString('it-IT')
    : new Date().toLocaleDateString('it-IT')

  const enriched = rows.map((r) => {
    const hours = durationHours(r.time_start, r.time_end)
    return {
      ...r,
      hours,
      amount: hours * rate,
    }
  })
  const totalHours = enriched.reduce((acc, r) => acc + r.hours, 0)
  const totalAmount = enriched.reduce((acc, r) => acc + r.amount, 0)

  doc.setFontSize(16)
  doc.text('FATTURA PRESTAZIONI ASSISTENZA TECNICA', 14, 16)
  doc.setFontSize(10)
  doc.setTextColor(70, 70, 70)
  doc.text(`Numero: ${invoiceNumber || 'N/D'}`, 14, 24)
  doc.text(`Data: ${invDate}`, 14, 30)
  doc.text(`Tecnico: ${technicianName}`, 14, 36)
  doc.text(`Tariffa oraria: ${eur(rate)}/h`, 14, 42)
  doc.text('Documento generato da Fornitori App (bozza interna da verificare).', pageW - 14, 24, { align: 'right' })

  const body = enriched.map((r) => [
    new Date(`${r.activity_date}T12:00:00`).toLocaleDateString('it-IT'),
    [r.time_start || '--:--', r.time_end || '--:--'].join(' - '),
    formatHours(r.hours),
    r.location || '—',
    r.notes || '—',
    eur(r.amount),
  ])

  autoTable(doc, {
    startY: 48,
    head: [['Data', 'Orario', 'Ore', 'Dove', 'Descrizione intervento', 'Importo']],
    body,
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [22, 101, 122], textColor: 255 },
    margin: { left: 12, right: 12 },
    columnStyles: {
      4: { cellWidth: 74 },
    },
  })

  const finalY = (doc.lastAutoTable?.finalY || 80) + 8
  doc.setFontSize(11)
  doc.setTextColor(20, 20, 20)
  doc.text(`Totale ore: ${formatHours(totalHours)}`, 14, finalY)
  doc.text(`Totale fattura: ${eur(totalAmount)}`, 14, finalY + 7)

  doc.setFontSize(8.5)
  doc.setTextColor(90, 90, 90)
  doc.text(
    'Nota: questo PDF e una bozza operativa. Integrare eventuali dati fiscali (partita IVA, imponibile, IVA, ritenuta) prima dell’invio ufficiale.',
    14,
    finalY + 16,
    { maxWidth: pageW - 28 },
  )
  return doc.output('blob')
}

