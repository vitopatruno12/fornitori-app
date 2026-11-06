import React, { useCallback, useMemo, useRef, useState } from 'react'
import { AnalisiLoadingBar } from './AnalisiShared.jsx'
import { useOperatorTabletLight } from '../utils/operatorTabletLight.js'
import { isOperatorStationMode } from '../utils/operatorMode.ts'

const VIRTUALIZE_FROM = 48
const ROW_H = 42

/**
 * Griglia readonly in stile Excel (workbook).
 * Con molte righe virtualizza il tbody (solo viewport + overscan).
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
  scrollToKey = '',
  scrollToToken = 0,
  getTotalsCellClassName,
  actionsColWidth = '9.5rem',
  renderCell,
  virtualize,
  plainCells = false,
}) {
  const lightCells = plainCells || (useOperatorTabletLight() && isOperatorStationMode())
  const showTotals = totals != null && typeof totalsLabel === 'function' && rows.length > 0
  const hasActions = Boolean(actionsHeader && typeof renderActions === 'function')
  const colSpan = columns.length + (hasActions ? 1 : 0)
  const useVirtual =
    virtualize === true || (virtualize !== false && Array.isArray(rows) && rows.length >= VIRTUALIZE_FROM)

  const wrapRef = useRef(null)
  const scrollRaf = useRef(0)
  const pendingScroll = useRef(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(480)
  const overscanBefore = lightCells ? 2 : 6
  const overscanAfter = lightCells ? 4 : 12

  const onScroll = useCallback((e) => {
    if (!useVirtual) return
    pendingScroll.current = e.currentTarget.scrollTop
    if (scrollRaf.current) return
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0
      const next = pendingScroll.current
      setScrollTop((prev) => (
        Math.floor(prev / ROW_H) === Math.floor(next / ROW_H) ? prev : next
      ))
    })
  }, [useVirtual])

  const setWrapNode = useCallback((node) => {
    wrapRef.current = node
    if (node) setViewportH(node.clientHeight || 480)
  }, [])

  React.useEffect(() => {
    if (!useVirtual) return undefined
    const node = wrapRef.current
    if (!node || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => setViewportH(node.clientHeight || 480))
    ro.observe(node)
    return () => ro.disconnect()
  }, [useVirtual, rows.length])

  React.useEffect(() => () => {
    if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current)
  }, [])

  const scrolledTokenRef = useRef('')
  React.useEffect(() => {
    const key = String(scrollToKey || '').trim()
    if (!key || !Array.isArray(rows) || rows.length === 0) return undefined
    const token = `${key}:${scrollToToken || 0}`
    if (scrolledTokenRef.current === token) return undefined
    const index = rows.findIndex((row, i) => String(resolveRowKey(row, i)) === key)
    if (index < 0) return undefined
    scrolledTokenRef.current = token

    const node = wrapRef.current
    const view = node?.clientHeight || viewportH || 480
    const top = Math.max(0, index * ROW_H - Math.max(0, (view - ROW_H) / 2))
    if (node) node.scrollTop = top
    pendingScroll.current = top
    setScrollTop((prev) => (Math.abs(prev - top) < 1 ? prev : top))

    let frames = 0
    let raf = 0
    const align = () => {
      const box = wrapRef.current
      if (!box) {
        frames += 1
        if (frames < 16) raf = window.requestAnimationFrame(align)
        return
      }
      if (!useVirtual) {
        const rowId = typeof getRowId === 'function' ? getRowId(rows[index], index) : ''
        const el = rowId ? document.getElementById(String(rowId)) : null
        if (el) {
          el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' })
          return
        }
      }
      // Con la virtualizzazione l'altezza riga è fissa: si sposta il riquadro, non la riga vera.
      box.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' })
    }
    raf = window.requestAnimationFrame(align)
    return () => window.cancelAnimationFrame(raf)
    // resolveRowKey è definita nel render e legge solo rowKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToKey, scrollToToken, rows])

  const start = useVirtual
    ? Math.max(0, Math.floor(scrollTop / ROW_H) - overscanBefore)
    : 0
  const visibleCount = useVirtual ? Math.ceil(viewportH / ROW_H) + overscanBefore + overscanAfter : rows.length
  const end = useVirtual ? Math.min(rows.length, start + visibleCount) : rows.length
  const visibleRows = useMemo(
    () => (useVirtual ? rows.slice(start, end) : rows),
    [rows, useVirtual, start, end],
  )
  const padTop = useVirtual ? start * ROW_H : 0
  const padBottom = useVirtual ? Math.max(0, (rows.length - end) * ROW_H) : 0

  function resolveRowKey(row, rowIndex) {
    if (typeof rowKey === 'function') return rowKey(row, rowIndex)
    if (row?.id != null) return String(row.id)
    return String(rowIndex)
  }

  function renderDataRow(row, rowIndex) {
    return (
      <tr
        key={resolveRowKey(row, rowIndex)}
        id={typeof getRowId === 'function' ? getRowId(row, rowIndex) : undefined}
        className={[
          'workbook-grid-row',
          typeof onRowClick === 'function' ? 'pn-row-click' : '',
          typeof getRowClassName === 'function' ? getRowClassName(row, rowIndex) : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={typeof onRowClick === 'function' ? () => onRowClick(row, rowIndex) : undefined}
        title={typeof onRowClick === 'function' ? rowClickTitle : undefined}
      >
        {columns.map((col) => {
          const tone =
            typeof col.tone === 'function' ? col.tone(row, col, { rowIndex }) : col.tone || ''
          const titleAttr =
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
          ]
            .filter(Boolean)
            .join(' ')
          const cellValueText = cellValue(row, col, { rowIndex })
          const customCell =
            typeof renderCell === 'function'
              ? renderCell(row, col, { rowIndex, value: cellValueText })
              : null
          const multilineRows = col.multiline
            ? Math.min(10, Math.max(2, String(cellValueText).split('\n').length))
            : undefined
          const plainClass = `${cellClasses} excel-cell-plain`
          return (
            <td
              key={col.id}
              data-label={col.label}
              title={lightCells && !customCell && titleAttr ? titleAttr : undefined}
              className={[
                col.sticky === 'left' ? 'workbook-col-sticky-left' : '',
                lightCells && !customCell ? plainClass : '',
              ].filter(Boolean).join(' ')}
            >
              {customCell != null ? (
                customCell
              ) : lightCells ? (
                cellValueText
              ) : col.multiline ? (
                <textarea
                  className={cellClasses}
                  value={cellValueText}
                  title={titleAttr}
                  readOnly
                  rows={multilineRows}
                  tabIndex={-1}
                  aria-label={`${col.label} riga ${rowIndex + 1}`}
                />
              ) : (
                <input
                  className={cellClasses}
                  value={cellValueText}
                  title={titleAttr}
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
    )
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
        <div
          ref={setWrapNode}
          className={lightCells
            ? 'pagamenti-grid-wrap excel-wrap workbook-grid-wrap workbook-grid-wrap-light'
            : 'pagamenti-grid-wrap excel-wrap workbook-grid-wrap'}
          onScroll={onScroll}
        >
          <table
            className={['app-table', 'excel-table', 'pagamenti-grid', 'workbook-grid', gridClassName]
              .filter(Boolean)
              .join(' ')}
          >
            <colgroup>
              {columns.map((col) => (
                <col
                  key={col.id}
                  style={
                    col.fluid
                      ? { width: `${col.width || 0}%` }
                      : col.width
                        ? {
                            width: typeof col.width === 'number' ? `${col.width}px` : col.width,
                            minWidth: 0,
                          }
                        : { minWidth: 0 }
                  }
                />
              ))}
              {hasActions ? <col style={{ width: actionsColWidth, minWidth: 0 }} /> : null}
            </colgroup>
            <thead>
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.id}
                    className={[
                      col.numeric ? 'text-end' : '',
                      col.sticky === 'left' ? 'workbook-col-sticky-left' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {col.label}
                  </th>
                ))}
                {hasActions ? <th className="sup-actions-col">{actionsHeader}</th> : null}
              </tr>
            </thead>
            <tbody>
              {useVirtual && padTop > 0 ? (
                <tr aria-hidden className="workbook-virtual-spacer">
                  <td colSpan={colSpan} style={{ height: padTop, padding: 0, border: 0 }} />
                </tr>
              ) : null}
              {visibleRows.map((row, i) => renderDataRow(row, useVirtual ? start + i : i))}
              {useVirtual && padBottom > 0 ? (
                <tr aria-hidden className="workbook-virtual-spacer">
                  <td colSpan={colSpan} style={{ height: padBottom, padding: 0, border: 0 }} />
                </tr>
              ) : null}
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
                      data-label={col.label}
                      className={lightCells ? [
                        col.sticky === 'left' ? 'workbook-col-sticky-left' : '',
                        'excel-cell',
                        'excel-cell-plain',
                        'pagamenti-cell-readonly',
                        col.numeric ? 'excel-cell-num' : '',
                        'workbook-cell-total',
                        typeof getTotalsCellClassName === 'function'
                          ? getTotalsCellClassName(col.id, totals)
                          : '',
                      ].filter(Boolean).join(' ') : (col.sticky === 'left' ? 'workbook-col-sticky-left' : '')}
                    >
                      {lightCells ? totalsLabel(col.id, totals) : (
                      <input
                        className={[
                          'excel-cell',
                          'pagamenti-cell-readonly',
                          col.numeric ? 'excel-cell-num' : '',
                          'workbook-cell-total',
                          typeof getTotalsCellClassName === 'function'
                            ? getTotalsCellClassName(col.id, totals)
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        value={totalsLabel(col.id, totals)}
                        readOnly
                        tabIndex={-1}
                      />
                      )}
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
