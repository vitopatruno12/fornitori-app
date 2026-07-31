import React, { useCallback, useEffect, useMemo, useState } from 'react'
import WorkbookGrid from '../components/WorkbookGrid.jsx'
import { fetchStaffMembers, fetchStaffShifts } from '../services/staffService.js'
import { downloadWorkbookAsExcel } from '../utils/pagamentiExcel.js'
import {
  buildStaffReportWorkbook,
  staffReportCellValue,
  staffReportColumnsForSheet,
  staffReportGridRows,
  staffReportTotalsLabel,
} from '../utils/staffReportWorkbook.js'

function toYmd(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
}

function defaultPeriod() {
  const now = new Date()
  return { from: toYmd(startOfMonth(now)), to: toYmd(endOfMonth(now)) }
}

export default function ReportPersonalePage() {
  const initial = defaultPeriod()
  const [dateFrom, setDateFrom] = useState(initial.from)
  const [dateTo, setDateTo] = useState(initial.to)
  const [workbook, setWorkbook] = useState(() =>
    buildStaffReportWorkbook({ members: [], shifts: [], dateFrom: initial.from, dateTo: initial.to }),
  )
  const [activeSheet, setActiveSheet] = useState('VOCI')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [generatedAt, setGeneratedAt] = useState('')

  const refreshReport = useCallback(async () => {
    const from = String(dateFrom || '').slice(0, 10)
    const to = String(dateTo || '').slice(0, 10)
    if (!from || !to) {
      setError('Seleziona un intervallo date valido')
      return
    }
    if (to < from) {
      setError('La data «Al» deve essere uguale o successiva a «Dal»')
      return
    }
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const [membersRaw, shiftsRaw] = await Promise.all([
        fetchStaffMembers(),
        fetchStaffShifts(from, to),
      ])
      const members = Array.isArray(membersRaw) ? membersRaw : []
      const shifts = Array.isArray(shiftsRaw) ? shiftsRaw : []
      const next = buildStaffReportWorkbook({ members, shifts, dateFrom: from, dateTo: to })
      setWorkbook(next)
      setGeneratedAt(
        new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }),
      )
      if (!members.length) {
        setSuccess('Report generato: nessun dipendente registrato nel periodo.')
      } else if (!shifts.length) {
        setSuccess('Report generato: nessuna voce di pianificazione nel periodo selezionato.')
      } else {
        setSuccess(`Report aggiornato — ${shifts.length} voci caricate dal personale.`)
      }
    } catch (err) {
      setError(err?.message || 'Impossibile caricare i dati del personale')
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => {
    void refreshReport()
  }, [refreshReport])

  const currentSheet = useMemo(
    () => workbook.sheets.find((sheet) => sheet.name === activeSheet) || workbook.sheets[0],
    [workbook.sheets, activeSheet],
  )

  const columns = useMemo(
    () => (currentSheet ? staffReportColumnsForSheet(currentSheet) : []),
    [currentSheet],
  )

  const gridRows = useMemo(
    () => (currentSheet ? staffReportGridRows(currentSheet) : []),
    [currentSheet],
  )

  function handleDownloadExcel() {
    setError('')
    try {
      downloadWorkbookAsExcel(workbook)
      setSuccess('File Excel scaricato')
    } catch (err) {
      setError(err?.message || 'Download Excel non riuscito')
    }
  }

  function handlePrint() {
    window.print()
  }

  return (
    <div className="pagamenti-page staff-report-page">
      <section className="staff-page-hero staff-report-no-print">
        <h1 className="page-header staff-page-title">Report personale</h1>
        <p className="staff-page-lead">
          Foglio Excel con tutte le voci di pianificazione del periodo scelto: turni, permessi, assenze, malattia e ferie.
          Puoi stampare il report o scaricarlo in Excel.
        </p>
      </section>

      {error && <div className="alert alert-danger staff-report-no-print">{error}</div>}
      {success && <div className="alert alert-success staff-report-no-print">{success}</div>}

      <section className="card pagamenti-workbook-card staff-report-print-area">
        <div className="pagamenti-workbook-toolbar staff-report-no-print">
          <div className="pagamenti-workbook-toolbar-left">
            <span className="pagamenti-workbook-title">{workbook.title}</span>
            <span className="pagamenti-workbook-sheet-label">Foglio: {currentSheet?.name}</span>
            {generatedAt ? (
              <span className="pagamenti-workbook-updated">Generato: {generatedAt}</span>
            ) : null}
          </div>
          <div className="pagamenti-workbook-actions staff-report-period-actions">
            <label className="staff-report-period-field">
              <span>Dal</span>
              <input
                type="date"
                className="form-control form-control-sm"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </label>
            <label className="staff-report-period-field">
              <span>Al</span>
              <input
                type="date"
                className="form-control form-control-sm"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={loading}
              onClick={() => void refreshReport()}
            >
              {loading ? 'Aggiornamento…' : 'Aggiorna'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={loading}
              onClick={handleDownloadExcel}
            >
              Download Excel
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={loading} onClick={handlePrint}>
              Stampa
            </button>
          </div>
        </div>

        <div className="staff-report-print-heading">
          <h2>{workbook.title}</h2>
          <p>
            Foglio <strong>{currentSheet?.name}</strong>
            {generatedAt ? ` — generato ${generatedAt}` : ''}
          </p>
        </div>

        <WorkbookGrid
          title={workbook.title}
          sheetLabel={
            loading
              ? 'Aggiornamento…'
              : gridRows.length > 0
                ? `${gridRows.length} righe · ${currentSheet?.name}`
                : `Nessuna voce · ${currentSheet?.name}`
          }
          columns={columns}
          rows={gridRows}
          cellValue={staffReportCellValue}
          totalsLabel={staffReportTotalsLabel}
          totals={gridRows}
          gridClassName="staff-report-grid workbook-grid"
          loading={loading}
          hideToolbar
          emptyMessage="Nessuna voce nel periodo selezionato."
          rowKey={(row, rowIndex) => `${currentSheet?.name || 'sheet'}-${rowIndex}-${row.employee || row.label || row.date || ''}`}
          getCellTitle={(row, col) => {
            if (col.id === 'notes' || col.id === 'value') {
              return String(row?.[col.id] || '')
            }
            return ''
          }}
        />

        <div className="pagamenti-sheet-tabs staff-report-no-print" role="tablist" aria-label="Fogli report personale">
          {workbook.sheets.map((sheet) => (
            <div
              key={sheet.name}
              className={`pagamenti-sheet-tab-wrap${sheet.name === activeSheet ? ' is-active' : ''}`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={sheet.name === activeSheet}
                className={`pagamenti-sheet-tab${sheet.name === activeSheet ? ' is-active' : ''}`}
                onClick={() => setActiveSheet(sheet.name)}
              >
                {sheet.name}
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
