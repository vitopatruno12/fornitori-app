import React from 'react'
import { AnalisiLoadingBar } from './AnalisiShared.jsx'

/**
 * Griglia readonly in stile Excel (workbook).
 */
export default function WorkbookGrid({
  title,
  sheetLabel = '',
  columns,
  rows = [],
  cellValue,
  totalsLabel,
  totals = null,
  gridClassName = '',
  loading = false,
  loadingLabel = 'Caricamento dati',
  emptyMessage = 'Nessun dato disponibile.',
  hideToolbar = false,
  toolbarActions = null,
  rowKey,
  actionsHeader = '',
  renderActions,
  getRowClassName,
  getCellTitle,
  onRowClick,
  rowClickTitle = 'Apri dettaglio',
  getRowId,
  getTotalsCellClassName,
}) {
  const showTotals = totals != null && typeof totalsLabel === 'function' && rows.length > 0
  const hasActions = Boolean(actionsHeader && typeof renderActions === 'function')
  const colSpan = columns.length + (hasActions ? 1 : 0)

  function resolveRowKey(row, rowIndex) {
    if (typeof rowKey === 'function') return rowKey(row, rowIndex)
    if (row?.id != null) return String(row.id)
    return String(rowIndex)
  }

  return (
    <div className="workbook-card-nested">
      {!hideToolbar ? (
        <div className="pagamenti-workbook-toolbar">
          <div className="pagamenti-workbook-toolbar-left">
            <span className="pagamenti-workbook-title">{title}</span>
            {sheetLabel ? <span className="pagamenti-workbook-sheet-label">{sheetLabel}</span> : null}
          </div>
          {toolbarActions}
        </div>
      ) : null}
      <AnalisiLoadingBar active={Boolean(loading)} label={loadingLabel} variant="subtle" />
      {!loading && (
        <div className="pagamenti-grid-wrap excel-wrap workbook-grid-wrap">
          <table className={['app-table', 'excel-table', 'pagamenti-grid', 'workbook-grid', gridClassName].filter(Boolean).join(' ')}>
            <colgroup>
              {columns.map((col) => (
                <col
                  key={col.id}
                  style={
                    col.fluid
                      ? { width: `${col.width || 0}%` }
                      : col.width
                        ? { minWidth: col.width }
                        : undefined
                  }
                />
              ))}
              {hasActions ? <col style={{ minWidth: 168 }} /> : null}
            </colgroup>
            <thead>
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.id}
                    className={[
                      col.numeric ? 'text-end' : '',
                      col.sticky === 'left' ? 'workbook-col-sticky-left' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    {col.label}
                  </th>
                ))}
                {hasActions ? <th className="sup-actions-col">{actionsHeader}</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr
                  key={resolveRowKey(row, rowIndex)}
                  id={typeof getRowId === 'function' ? getRowId(row, rowIndex) : undefined}
                  className={[
                    'workbook-grid-row',
                    typeof onRowClick === 'function' ? 'pn-row-click' : '',
                    typeof getRowClassName === 'function' ? getRowClassName(row, rowIndex) : '',
                  ].filter(Boolean).join(' ')}
                  onClick={typeof onRowClick === 'function' ? () => onRowClick(row, rowIndex) : undefined}
                  title={typeof onRowClick === 'function' ? rowClickTitle : undefined}
                >
                  {columns.map((col) => {
                    const tone =
                      typeof col.tone === 'function' ? col.tone(row, col, { rowIndex }) : col.tone || ''
                    const title =
                      typeof getCellTitle === 'function'
                        ? getCellTitle(row, col, { rowIndex })
                        : typeof col.cellTitle === 'function'
                          ? col.cellTitle(row, col, { rowIndex })
                          : ''
                    const cellClasses = [
                      'excel-cell',
                      'pagamenti-cell-readonly',
                      col.numeric ? 'excel-cell-num' : '',
                      col.emphasis ? 'workbook-cell-emphasis' : '',
                      col.mono ? 'workbook-cell-mono' : '',
                      col.multiline ? 'excel-cell-multiline' : '',
                      tone,
                    ].filter(Boolean).join(' ')
                    const cellValueText = cellValue(row, col, { rowIndex })
                    const multilineRows = col.multiline
                      ? Math.min(10, Math.max(2, String(cellValueText).split('\n').length))
                      : undefined
                    return (
                      <td
                        key={col.id}
                        className={col.sticky === 'left' ? 'workbook-col-sticky-left' : ''}
                      >
                        {col.multiline ? (
                          <textarea
                            className={cellClasses}
                            value={cellValueText}
                            title={title}
                            readOnly
                            rows={multilineRows}
                            tabIndex={-1}
                            aria-label={`${col.label} riga ${rowIndex + 1}`}
                          />
                        ) : (
                          <input
                            className={cellClasses}
                            value={cellValueText}
                            title={title}
                            readOnly
                            tabIndex={-1}
                            aria-label={`${col.label} riga ${rowIndex + 1}`}
                          />
                        )}
                      </td>
                    )
                  })}
                  {hasActions ? <td className="sup-actions-col">{renderActions(row, rowIndex)}</td> : null}
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} className="empty-state">
                    {emptyMessage}
                  </td>
                </tr>
              ) : showTotals ? (
                <tr className="workbook-row-totals">
                  {columns.map((col) => (
                    <td
                      key={`tot-${col.id}`}
                      className={col.sticky === 'left' ? 'workbook-col-sticky-left' : ''}
                    >
                      <input
                        className={[
                          'excel-cell',
                          'pagamenti-cell-readonly',
                          col.numeric ? 'excel-cell-num' : '',
                          'workbook-cell-total',
                          typeof getTotalsCellClassName === 'function'
                            ? getTotalsCellClassName(col.id, totals)
                            : '',
                        ].filter(Boolean).join(' ')}
                        value={totalsLabel(col.id, totals)}
                        readOnly
                        tabIndex={-1}
                      />
                    </td>
                  ))}
                  {hasActions ? <td className="sup-actions-col" /> : null}
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
