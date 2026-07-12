import React from 'react'
import WorkbookGrid from './WorkbookGrid.jsx'
import {
  downloadVneTableCsv,
  downloadVneTableExcel,
  printVneTable,
} from '../utils/vneTableExport.js'

export default function VneWorkbookGrid({
  exportEnabled = true,
  exportSubtitle = '',
  columns,
  rows = [],
  cellValue,
  totalsLabel,
  totals = null,
  title,
  sheetLabel = '',
  loading = false,
  ...rest
}) {
  const canExport = exportEnabled && !loading && Array.isArray(rows) && rows.length > 0

  function runExport(exportFn) {
    try {
      exportFn({
        title,
        subtitle: exportSubtitle || sheetLabel,
        columns,
        rows,
        cellValue,
        totalsLabel,
        totals,
        sheetName: sheetLabel || 'Dati',
      })
    } catch (err) {
      window.alert(err?.message || 'Export non riuscito')
    }
  }

  const toolbarActions = exportEnabled ? (
    <div className="pagamenti-workbook-actions vne-workbook-export-actions">
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={!canExport}
        onClick={() => runExport(printVneTable)}
        title="Apre la finestra di stampa: puoi salvare come PDF"
      >
        Stampa
      </button>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={!canExport}
        onClick={() => runExport(downloadVneTableExcel)}
      >
        Scarica Excel
      </button>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={!canExport}
        onClick={() => runExport(downloadVneTableCsv)}
      >
        Scarica CSV
      </button>
    </div>
  ) : null

  return (
    <WorkbookGrid
      title={title}
      sheetLabel={sheetLabel}
      columns={columns}
      rows={rows}
      cellValue={cellValue}
      totalsLabel={totalsLabel}
      totals={totals}
      loading={loading}
      toolbarActions={toolbarActions}
      {...rest}
    />
  )
}
