import React from 'react'
import WorkbookGrid from './WorkbookGrid.jsx'
import { AnalisiLoadingBar } from './AnalisiShared.jsx'
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
  loadingLabel = 'Lettura dati VNE',
  toolbarActions: toolbarActionsProp = null,
  hideToolbar = false,
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

  const exportActions = exportEnabled ? (
    <div className="pagamenti-workbook-actions vne-workbook-export-actions">
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={!canExport}
        onClick={() => runExport(printVneTable)}
        title="Apre la finestra di stampa: puoi salvare come PDF"
      >
        Stampa / PDF
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

  const toolbarActions = (
    <>
      {exportActions}
      {toolbarActionsProp}
    </>
  )

  return (
    <>
      <AnalisiLoadingBar active={Boolean(loading)} label={loadingLabel} variant="subtle" />
      {(!loading || (Array.isArray(rows) && rows.length > 0)) && (
        <WorkbookGrid
          {...rest}
          title={title}
          sheetLabel={loading ? 'Aggiornamento…' : sheetLabel}
          columns={columns}
          rows={rows}
          cellValue={cellValue}
          totalsLabel={totalsLabel}
          totals={totals}
          loading={false}
          hideToolbar={hideToolbar}
          toolbarActions={toolbarActions}
        />
      )}
    </>
  )
}
