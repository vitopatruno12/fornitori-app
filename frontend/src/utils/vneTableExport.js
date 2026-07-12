import { downloadWorkbookAsExcel } from './pagamentiExcel.js'

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function sanitizeFilename(name) {
  return (
    String(name || 'vne_export')
      .replace(/[<>:"/\\|?*]+/g, '_')
      .trim() || 'vne_export'
  )
}

export function buildVneTableAoA(columns, rows, cellValue, { totalsLabel, totals } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const cols = Array.isArray(columns) ? columns : []
  const header = cols.map((col) => col.label)
  const dataRows = list.map((row, rowIndex) =>
    cols.map((col) => {
      const value = cellValue(row, col, { rowIndex })
      return value == null ? '' : String(value)
    }),
  )
  const result = [header, ...dataRows]
  if (totals != null && typeof totalsLabel === 'function' && list.length > 0) {
    result.push(cols.map((col) => {
      const value = totalsLabel(col.id, totals)
      return value == null ? '' : String(value)
    }))
  }
  return result
}

export function downloadVneTableCsv({ title, columns, rows, cellValue, totalsLabel, totals }) {
  const aoa = buildVneTableAoA(columns, rows, cellValue, { totalsLabel, totals })
  const lines = aoa.map((row) =>
    row
      .map((cell) => {
        const text = String(cell ?? '').replace(/"/g, '""')
        return /[",\n\r;]/.test(text) ? `"${text}"` : text
      })
      .join(';'),
  )
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${sanitizeFilename(title)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

export function downloadVneTableExcel({ title, columns, rows, cellValue, totalsLabel, totals, sheetName }) {
  const aoa = buildVneTableAoA(columns, rows, cellValue, { totalsLabel, totals })
  downloadWorkbookAsExcel({
    title,
    sheets: [{ name: sheetName || 'Dati', rows: aoa }],
  })
}

export function printVneTable({ title, subtitle, columns, rows, cellValue, totalsLabel, totals }) {
  const list = Array.isArray(rows) ? rows : []
  if (list.length === 0) throw new Error('Nessun dato da stampare')

  const aoa = buildVneTableAoA(columns, rows, cellValue, { totalsLabel, totals })
  const header = aoa[0] || []
  const body = aoa.slice(1)
  const hasTotalsRow = totals != null && typeof totalsLabel === 'function'
  const dataRows = hasTotalsRow ? body.slice(0, -1) : body
  const totalsRow = hasTotalsRow ? body[body.length - 1] : null

  const thead = `<tr>${header.map((label) => `<th>${escapeHtml(label)}</th>`).join('')}</tr>`
  const tbody = [
    ...dataRows.map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${escapeHtml(cell).replace(/\n/g, '<br/>')}</td>`).join('')}</tr>`,
    ),
    totalsRow
      ? `<tr class="totals">${totalsRow.map((cell) => `<td>${escapeHtml(cell).replace(/\n/g, '<br/>')}</td>`).join('')}</tr>`
      : '',
  ].join('')

  const safeTitle = escapeHtml(title || 'VNE')
  const safeSubtitle = escapeHtml(subtitle || '')
  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${safeTitle}</title>
  <style>
    body { font-family: Segoe UI, system-ui, sans-serif; color: #111; padding: 1rem; margin: 0; }
    h1 { font-size: 1.1rem; margin: 0 0 0.25rem 0; }
    .sub { color: #555; font-size: 0.85rem; margin-bottom: 0.75rem; }
    table { border-collapse: collapse; width: 100%; font-size: 0.8rem; }
    th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #f0f4f8; }
    tr.totals td { font-weight: 700; background: #f8fafc; }
    @media print { body { padding: 0.5rem; } }
  </style>
</head>
<body onload="setTimeout(function(){ try { window.focus(); window.print(); } catch (e) {} }, 300)">
  <h1>${safeTitle}</h1>
  ${safeSubtitle ? `<p class="sub">${safeSubtitle}</p>` : ''}
  <table>
    <thead>${thead}</thead>
    <tbody>${tbody}</tbody>
  </table>
</body>
</html>`

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const blobUrl = URL.createObjectURL(blob)
  const popup = window.open(blobUrl, '_blank')
  if (!popup) {
    URL.revokeObjectURL(blobUrl)
    throw new Error('Abilita i popup per stampare o salvare come PDF')
  }
  window.setTimeout(() => {
    try {
      URL.revokeObjectURL(blobUrl)
    } catch {
      // ignore
    }
  }, 120000)
}
