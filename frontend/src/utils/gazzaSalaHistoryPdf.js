import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { gazzaSalaEveningHistoryTotal, gazzaSalaPaymentLabel } from './gazzaSalaWorkbook.js'

function formatEur(value) {
  if (value == null || value === '') return ''
  const n = Number(String(value).replace(',', '.'))
  if (!Number.isFinite(n)) return ''
  return n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatTime(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
}

function formatDay(isoDate) {
  const [y, m, d] = String(isoDate || '').split('-')
  if (!y || !m || !d) return isoDate || ''
  return `${d}/${m}/${y}`
}

/**
 * PDF dello storico sala (prenotazione, clienti, cameriere, conto, metodo).
 * @param {{ date: string, fascia: string, entries: Array<Record<string, unknown>> }} opts
 */
export function buildGazzaSalaHistoryPdf({ date, fascia, entries }) {
  const list = Array.isArray(entries) ? entries : []
  const title = fascia === 'cena' ? 'Storico serata' : 'Storico pranzo'
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()

  doc.setFontSize(16)
  doc.text(`Gazza Ladra — ${title}`, 14, 16)
  doc.setFontSize(11)
  doc.setTextColor(55, 65, 81)
  doc.text(formatDay(date), 14, 23)
  doc.text(`${list.length} ${list.length === 1 ? 'conto' : 'conti'}`, pageW - 14, 16, { align: 'right' })
  doc.setTextColor(0, 0, 0)

  const body = list.map((entry) => [
    String(entry.table_id ?? ''),
    entry.reservation_name || '',
    entry.clients === '' || entry.clients == null ? '' : String(entry.clients),
    entry.waiter || '',
    formatEur(entry.paid),
    gazzaSalaPaymentLabel(entry.payment_type),
    formatTime(entry.paidAt),
  ])

  if (list.length === 0) {
    body.push(['', 'Nessun tavolo pagato in questa fascia.', '', '', '', '', ''])
  } else {
    body.push(['', '', '', 'Totale', formatEur(gazzaSalaEveningHistoryTotal(list)), '', ''])
  }

  autoTable(doc, {
    startY: 30,
    head: [[
      'Tavolo',
      'Nome prenotazione',
      'N. clienti',
      'Cameriere',
      'Conto pagato €',
      'Metodo',
      'Ora',
    ]],
    body,
    styles: { fontSize: 9, cellPadding: 2, overflow: 'linebreak' },
    headStyles: { fillColor: [22, 101, 52], textColor: 255 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 12, right: 12 },
    columnStyles: {
      0: { cellWidth: 16, halign: 'center' },
      2: { cellWidth: 20, halign: 'right' },
      4: { cellWidth: 28, halign: 'right' },
      6: { cellWidth: 16, halign: 'center' },
    },
    didParseCell(data) {
      const last = data.row.index === body.length - 1
      if (data.section === 'body' && last && list.length > 0) {
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.fillColor = [254, 249, 195]
      }
    },
  })

  return doc.output('blob')
}

/** Apre il PDF in una scheda, senza scaricarlo. */
export function openGazzaSalaHistoryPdf(blob) {
  const url = URL.createObjectURL(blob)
  const popup = window.open(url, '_blank')
  if (!popup) {
    URL.revokeObjectURL(url)
    window.alert('Abilita i popup per aprire lo storico.')
    return
  }
  window.setTimeout(() => {
    try {
      URL.revokeObjectURL(url)
    } catch {
      /* ignore */
    }
  }, 120000)
}
