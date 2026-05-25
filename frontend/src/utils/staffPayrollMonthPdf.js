import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

function formatEur(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '—'
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(v)
}

function formatHours(h) {
  const v = Number(h)
  if (!Number.isFinite(v) || v <= 0) return '—'
  return v.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function monthLabelIt(yearMonth) {
  const [y, m] = String(yearMonth || '').split('-').map(Number)
  if (!y || !m) return yearMonth || ''
  const d = new Date(y, m - 1, 1)
  return d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })
}

/**
 * PDF riepilogo stipendi mensili salvati.
 * @param {{ yearMonth: string, periodFrom: string, periodTo: string, lines: Array<{ name: string, hours: number, hourly_rate: number, amount: number }>, totalAmount: number, notes?: string }} opts
 * @returns {Blob}
 */
export function generateMonthlyPayrollPdf({
  yearMonth,
  periodFrom,
  periodTo,
  lines = [],
  totalAmount = 0,
  notes = '',
}) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const title = `Stipendi — ${monthLabelIt(yearMonth)}`
  doc.setFontSize(16)
  doc.text(title, 14, 16)
  doc.setFontSize(10)
  doc.setTextColor(60, 60, 60)
  doc.text(`Periodo: dal ${periodFrom} al ${periodTo}`, 14, 24)
  const gen = new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })
  doc.text(`Generato: ${gen}`, pageW - 14, 16, { align: 'right' })

  const body = (lines || []).map((ln) => [
    ln.name || '—',
    formatHours(ln.hours),
    formatEur(ln.hourly_rate),
    formatEur(ln.amount),
  ])

  autoTable(doc, {
    startY: 32,
    head: [['Dipendente', 'Ore', '€ / ora', 'Importo']],
    body,
    styles: { fontSize: 10, cellPadding: 2.5 },
    headStyles: { fillColor: [13, 148, 136], textColor: 255 },
    columnStyles: {
      0: { cellWidth: 70 },
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right', fontStyle: 'bold' },
    },
  })

  const finalY = (doc.lastAutoTable?.finalY || 32) + 8
  doc.setFontSize(11)
  doc.setTextColor(25, 25, 25)
  doc.text(`Totale stipendi: ${formatEur(totalAmount)}`, 14, finalY)

  if (notes && String(notes).trim()) {
    doc.setFontSize(9)
    doc.setTextColor(80, 80, 80)
    doc.text(`Note: ${String(notes).trim()}`, 14, finalY + 7, { maxWidth: pageW - 28 })
  }

  return doc.output('blob')
}

export function payrollMonthPdfFilename(yearMonth) {
  return `stipendi-${yearMonth || 'mese'}.pdf`
}
