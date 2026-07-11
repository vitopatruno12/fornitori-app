import React from 'react'
import { PRIMA_NOTA_SUMMARY_COLUMNS } from '../utils/primaNotaDailySalesWorkbook.js'

/**
 * Tabella readonly in stile Pagamenti fornitori (excel-table + pagamenti-grid).
 */
export default function PrimaNotaExcelSummaryTable({ title, hint, rows = [] }) {
  return (
    <div className="prima-nota-excel-summary">
      {title ? <h3 className="prima-nota-excel-summary-title">{title}</h3> : null}
      {hint ? <p className="prima-nota-excel-summary-hint">{hint}</p> : null}
      <div className="pagamenti-grid-wrap excel-wrap">
        <table className="app-table excel-table pagamenti-grid prima-nota-summary-grid">
          <colgroup>
            {PRIMA_NOTA_SUMMARY_COLUMNS.map((col) => (
              <col key={col.id} style={{ minWidth: col.width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {PRIMA_NOTA_SUMMARY_COLUMNS.map((col) => (
                <th key={col.id} className={col.numeric ? 'text-end' : ''}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={row.rowClass || ''}>
                <td>
                  <input
                    className={[
                      'excel-cell',
                      'pagamenti-cell-readonly',
                      row.rowClass === 'pagamenti-row-totals' ? 'pagamenti-cell-emphasis' : '',
                    ].filter(Boolean).join(' ')}
                    value={row.label}
                    readOnly
                    tabIndex={-1}
                    aria-label={row.label}
                  />
                </td>
                <td>
                  <input
                    className={[
                      'excel-cell',
                      'excel-cell-num',
                      'pagamenti-cell-readonly',
                      row.rowClass === 'pagamenti-row-totals' ? 'pagamenti-cell-emphasis' : '',
                    ].filter(Boolean).join(' ')}
                    value={row.amount}
                    readOnly
                    tabIndex={-1}
                    aria-label={`${row.label} importo`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
