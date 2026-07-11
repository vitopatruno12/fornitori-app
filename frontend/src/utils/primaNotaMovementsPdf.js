import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

function eur(value) {
  const n = Number(value || 0)
  return `€ ${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString('it-IT')
}

/**
 * @param {object} opts
 * @param {string} opts.activityLabel
 * @param {string} opts.periodLabel
 * @param {Array} opts.rows — righe con campi ledger (entrata, uscita, …)
 * @param {object} opts.totals
 */
export function generatePrimaNotaMovementsPdf({ activityLabel, periodLabel, rows, totals }) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const generatedAt = new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })

  doc.setFontSize(16)
  doc.text('Prima Nota — Movimenti cassa', 14, 14)
  doc.setFontSize(10)
  doc.setTextColor(60, 60, 60)
  doc.text(`Locale: ${activityLabel || '—'}`, 14, 21)
  doc.text(`Periodo: ${periodLabel || '—'}`, 14, 27)
  doc.text(`Generato: ${generatedAt}`, pageW - 14, 14, { align: 'right' })

  const body = (rows || []).map((entry, idx) => [
    formatDate(entry.entry_date),
    String(idx + 1),
    entry.description || '—',
    entry.entrata > 0 ? eur(entry.entrata) : '—',
    entry.uscita > 0 ? eur(entry.uscita) : '—',
    entry.affectsSaldo ? eur(entry.totaleMovimento) : '—',
    entry.nonFiscale !== 0 ? eur(entry.nonFiscale) : '—',
    entry.pos !== 0 ? eur(entry.pos) : '—',
    entry.refill !== 0 ? eur(entry.refill) : '—',
    eur(entry.incasso),
  ])

  if (totals?.count > 0) {
    body.push([
      'Totali',
      `${totals.count} mov.`,
      '',
      eur(totals.entrata),
      eur(totals.uscita),
      eur(totals.fiscale),
      eur(totals.nonFiscale),
      eur(totals.pos),
      eur(totals.refill),
      eur(totals.incasso),
    ])
  }

  autoTable(doc, {
    startY: 32,
    head: [['Data', 'N.', 'Operazioni', 'Entrata', 'Uscita', 'Fiscale', 'NC', 'POS', 'Refill', 'Totale']],
    body,
    styles: { fontSize: 8, cellPadding: 1.8 },
    headStyles: { fillColor: [17, 76, 95], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 248, 250] },
    margin: { left: 10, right: 10 },
    columnStyles: {
      2: { cellWidth: 58 },
    },
    didParseCell(data) {
      if (data.section === 'body' && data.row.index === body.length - 1 && totals?.count > 0) {
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.fillColor = [230, 236, 240]
      }
    },
  })

  return doc.output('blob')
}

export function downloadPrimaNotaMovementsPdf(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
