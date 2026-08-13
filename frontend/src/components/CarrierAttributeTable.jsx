import React from 'react'
import { AnalisiLoadingBar } from './AnalisiShared.jsx'

function columnInputType(col) {
  if (col.inputType) return col.inputType
  if (col.id.endsWith('_date') || col.id === 'service_date') return 'date'
  if (col.numeric) return 'number'
  return 'text'
}

function columnInputStep(col) {
  if (col.step) return col.step
  if (col.id === 'odometer_km') return '1'
  if (col.numeric) return '0.01'
  return undefined
}

/**
 * Tabella attributi + righe:
 * - intestazione con i nomi colonna (Data, Descrizione, …)
 * - righe già salvate
 * - riga vuota in fondo per inserire
 */
export default function CarrierAttributeTable({
  title,
  columns,
  rows = [],
  draftRow,
  onDraftChange,
  onAddRow,
  onDeleteSaved,
  cellValue,
  loading = false,
  loadingLabel = 'Caricamento dati',
  addRowLabel = '+ Aggiungi riga',
}) {
  function handleDraftKeyDown(e) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    onAddRow?.()
  }

  return (
    <section className="card carriers-attr-table-card">
      <div className="carriers-attr-table-header">
        <h2 className="page-subheader" style={{ margin: 0 }}>
          {title}
        </h2>
        {typeof onAddRow === 'function' ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onAddRow}>
            {addRowLabel}
          </button>
        ) : null}
      </div>
      <AnalisiLoadingBar active={Boolean(loading)} label={loadingLabel} variant="subtle" />
      {!loading && (
        <div className="pagamenti-grid-wrap excel-wrap">
          <table className="app-table excel-table pagamenti-grid workbook-grid carriers-attr-table">
            <colgroup>
              {columns.map((col) => (
                <col key={col.id} style={col.width ? { minWidth: col.width } : undefined} />
              ))}
              {typeof onDeleteSaved === 'function' ? <col style={{ minWidth: 90 }} /> : null}
            </colgroup>
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.id} className={col.numeric ? 'text-end' : ''}>
                    {col.label}
                  </th>
                ))}
                {typeof onDeleteSaved === 'function' ? <th className="sup-actions-col" /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={row.id ?? rowIndex} className="workbook-grid-row">
                  {columns.map((col) => (
                    <td key={col.id}>
                      <input
                        className={[
                          'excel-cell',
                          'pagamenti-cell-readonly',
                          col.numeric ? 'excel-cell-num' : '',
                          col.emphasis ? 'workbook-cell-emphasis' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        value={cellValue(row, col, { rowIndex })}
                        readOnly
                        tabIndex={-1}
                        aria-label={`${col.label} riga ${rowIndex + 1}`}
                      />
                    </td>
                  ))}
                  {typeof onDeleteSaved === 'function' ? (
                    <td className="sup-actions-col">
                      <button
                        type="button"
                        className="btn btn-outline-danger btn-sm"
                        onClick={() => onDeleteSaved(row)}
                      >
                        Elimina
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
              {draftRow ? (
                <tr className="workbook-grid-row carriers-draft-row">
                  {columns.map((col) => {
                    const inputType = columnInputType(col)
                    return (
                      <td key={col.id}>
                        <input
                          className={[
                            'excel-cell',
                            col.numeric ? 'excel-cell-num' : '',
                            col.emphasis ? 'workbook-cell-emphasis' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          type={inputType}
                          step={inputType === 'number' ? columnInputStep(col) : undefined}
                          value={draftRow[col.id] ?? ''}
                          onChange={(e) => onDraftChange?.(col.id, e.target.value)}
                          onKeyDown={handleDraftKeyDown}
                          placeholder={col.id === 'description' ? 'Scrivi qui…' : undefined}
                          aria-label={`Nuova riga · ${col.label}`}
                        />
                      </td>
                    )
                  })}
                  {typeof onDeleteSaved === 'function' ? <td className="sup-actions-col" /> : null}
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
