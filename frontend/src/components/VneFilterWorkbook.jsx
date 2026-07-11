import React from 'react'

/**
 * Riga filtri in stile Excel (intestazioni + celle editabili).
 */
export default function VneFilterWorkbook({
  title,
  sheetLabel = '',
  fields = [],
  gridClassName = '',
}) {
  return (
    <div className="workbook-card-nested vne-filter-workbook">
      <div className="pagamenti-workbook-toolbar">
        <div className="pagamenti-workbook-toolbar-left">
          <span className="pagamenti-workbook-title">{title}</span>
          {sheetLabel ? <span className="pagamenti-workbook-sheet-label">{sheetLabel}</span> : null}
        </div>
      </div>
      <div className="pagamenti-grid-wrap excel-wrap workbook-grid-wrap">
        <table
          className={['app-table', 'excel-table', 'pagamenti-grid', 'workbook-grid', 'vne-filter-grid', gridClassName]
            .filter(Boolean)
            .join(' ')}
        >
          <colgroup>
            {fields.map((field) => (
              <col
                key={field.id}
                style={
                  field.fluid
                    ? { width: `${field.width || 0}%` }
                    : field.width
                      ? { minWidth: field.width }
                      : undefined
                }
              />
            ))}
          </colgroup>
          <thead>
            <tr>
              {fields.map((field) => (
                <th key={field.id} className={field.action ? 'vne-filter-action-col' : ''}>
                  {field.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="vne-filter-row">
              {fields.map((field) => (
                <td key={field.id} className={field.action ? 'vne-filter-action-col' : ''}>
                  <div className={['vne-filter-cell', field.action ? 'vne-filter-cell-action' : ''].filter(Boolean).join(' ')}>
                    {typeof field.render === 'function' ? field.render() : null}
                  </div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
