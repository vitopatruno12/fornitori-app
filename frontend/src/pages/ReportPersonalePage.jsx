import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import WorkbookGrid from '../components/WorkbookGrid.jsx'
import OperatorStationStaffGate from '../components/OperatorStationStaffGate.jsx'
import StaffGestionaleLocaleSelect from '../components/StaffGestionaleLocaleSelect.jsx'
import { useGestionaleStaffLocale } from '../hooks/useGestionaleStaffLocale.js'
import { fetchStaffShifts } from '../services/staffService.js'
import { downloadWorkbookAsExcel } from '../utils/pagamentiExcel.js'
import {
  fetchOperatorStationShifts,
  filterShiftsForOperatorLocale,
  preloadOperatorStationMembers,
  resolveOperatorStationMembers,
} from '../utils/operatorStaffReportData.js'
import { resolveGestionaleLocaleMembers } from '../utils/gestionaleStaffLocale.js'
import { isOperatorStationStaffSessionOpen } from '../utils/operatorStationStaffSession.js'
import { getLockedOperatorStationId } from '../utils/operatorMode.ts'
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

function startOfWeekMonday(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = x.getDay()
  const diff = day === 0 ? -6 : 1 - day
  x.setDate(x.getDate() + diff)
  return x
}

function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() + n)
  return x
}

function defaultPeriod(operatorMode = false) {
  const now = new Date()
  if (operatorMode) {
    const from = startOfWeekMonday(now)
    const to = addDays(from, 6)
    return { from: toYmd(from), to: toYmd(to) }
  }
  return { from: toYmd(startOfMonth(now)), to: toYmd(endOfMonth(now)) }
}

const MAX_OPERATOR_REPORT_DAYS = 31

function daysInclusive(fromYmd, toYmdValue) {
  const from = new Date(`${fromYmd}T12:00:00`)
  const to = new Date(`${toYmdValue}T12:00:00`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86400000) + 1)
}

export default function ReportPersonalePage({ operatorMode = false, stationId = null }) {
  const operatorStationId = operatorMode ? stationId || getLockedOperatorStationId() : null
  const {
    localeNames: gestionaleLocaleNames,
    localeName: gestionaleLocale,
    setLocaleName: setGestionaleLocale,
    loadingLocales: gestionaleLocalesLoading,
  } = useGestionaleStaffLocale(!operatorMode)
  const [operatorSessionOpen, setOperatorSessionOpen] = useState(() => {
    if (!operatorMode) return true
    const sid = stationId || getLockedOperatorStationId()
    return isOperatorStationStaffSessionOpen(sid)
  })
  const initial = defaultPeriod(operatorMode)
  const [dateFrom, setDateFrom] = useState(initial.from)
  const [dateTo, setDateTo] = useState(initial.to)
  const [workbook, setWorkbook] = useState(() =>
    buildStaffReportWorkbook({ members: [], shifts: [], dateFrom: initial.from, dateTo: initial.to }),
  )
  const [activeSheet, setActiveSheet] = useState('VOCI')
  const [loading, setLoading] = useState(() => {
    if (!operatorMode) return true
    const sid = stationId || getLockedOperatorStationId()
    return isOperatorStationStaffSessionOpen(sid)
  })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [generatedAt, setGeneratedAt] = useState('')
  const dateFromRef = useRef(dateFrom)
  const dateToRef = useRef(dateTo)
  dateFromRef.current = dateFrom
  dateToRef.current = dateTo

  const loadReportData = useCallback(
    async (from, to) => {
      if (operatorMode && operatorStationId) {
        const { members } = await resolveOperatorStationMembers(operatorStationId)
        const shifts = await fetchOperatorStationShifts(operatorStationId, from, to)
        return { members, shifts }
      }
      if (!gestionaleLocale) {
        return { members: [], shifts: [] }
      }
      const { members, memberIds, packNameKeys } = await resolveGestionaleLocaleMembers(gestionaleLocale)
      let shifts = []
      if (memberIds.length) {
        const shiftsRaw = await fetchStaffShifts(from, to, { memberIds })
        shifts = filterShiftsForOperatorLocale(shiftsRaw, { memberIds, packNameKeys })
      }
      return { members, shifts }
    },
    [operatorMode, operatorStationId, gestionaleLocale],
  )

  useEffect(() => {
    if (!operatorMode || !operatorSessionOpen || !operatorStationId) return
    void preloadOperatorStationMembers(operatorStationId)
  }, [operatorMode, operatorSessionOpen, operatorStationId])

  const runRefresh = useCallback(async () => {
    const from = String(dateFromRef.current || '').slice(0, 10)
    const to = String(dateToRef.current || '').slice(0, 10)
    if (!from || !to) {
      setError('Seleziona un intervallo date valido')
      setLoading(false)
      return
    }
    if (!operatorMode && !gestionaleLocale) {
      setError('Seleziona il locale personale dal menu in alto.')
      setLoading(false)
      return
    }
    if (to < from) {
      setError('La data «Al» deve essere uguale o successiva a «Dal»')
      setLoading(false)
      return
    }
    if (operatorMode && daysInclusive(from, to) > MAX_OPERATOR_REPORT_DAYS) {
      setError(
        `Periodo troppo lungo (${daysInclusive(from, to)} giorni). Nella postazione operativa usa al massimo ${MAX_OPERATOR_REPORT_DAYS} giorni.`,
      )
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const { members, shifts } = await loadReportData(from, to)
      try {
        const next = buildStaffReportWorkbook({ members, shifts, dateFrom: from, dateTo: to })
        setWorkbook(next)
        setGeneratedAt(new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }))
        if (!members.length) {
          setSuccess('Report generato: nessun dipendente registrato nel periodo.')
        } else if (!shifts.length) {
          setSuccess('Report generato: nessuna voce di pianificazione nel periodo selezionato.')
        } else {
          setSuccess(`Report aggiornato — ${shifts.length} voci caricate dal personale.`)
        }
      } catch (buildErr) {
        setError(buildErr?.message || 'Errore generazione report')
      }
    } catch (err) {
      setError(err?.message || 'Impossibile caricare i dati del personale')
    } finally {
      setLoading(false)
    }
  }, [loadReportData, operatorMode, gestionaleLocale])

  useEffect(() => {
    if (operatorMode && !operatorSessionOpen) {
      setLoading(false)
      return
    }
    void runRefresh()
  }, [
    operatorMode,
    operatorSessionOpen,
    runRefresh,
    operatorMode ? undefined : dateFrom,
    operatorMode ? undefined : dateTo,
    operatorMode ? undefined : gestionaleLocale,
  ])

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

  const reportHero = (
    <section className="staff-page-hero staff-report-no-print">
      <div className="staff-page-hero-inner staff-page-hero-inner--with-locale">
        <div>
          <h1 className="page-header staff-page-title">Report personale</h1>
          <p className="staff-page-lead">
            Foglio Excel con tutte le voci di pianificazione del periodo scelto: turni, permessi, assenze, malattia, ferie e riposo.
            Puoi stampare il report o scaricarlo in Excel.
            {operatorMode ? (
              <>
                {' '}
                Periodo consigliato: <strong>settimana corrente</strong> (massimo {MAX_OPERATOR_REPORT_DAYS} giorni).
              </>
            ) : (
              <>
                {' '}
                Scegli il <strong>locale</strong> dal menu: il report mostra solo il personale di quel negozio.
              </>
            )}
          </p>
        </div>
        {!operatorMode ? (
          <StaffGestionaleLocaleSelect
            localeNames={gestionaleLocaleNames}
            value={gestionaleLocale}
            onChange={setGestionaleLocale}
            loading={gestionaleLocalesLoading}
          />
        ) : null}
      </div>
    </section>
  )

  const reportBody = (
    <div className="pagamenti-page staff-report-page">
      {!operatorMode ? reportHero : null}

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
              onClick={() => void runRefresh()}
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

  if (operatorMode) {
    return (
      <OperatorStationStaffGate
        stationId={operatorStationId}
        title="Report personale"
        banner={reportHero}
        onSessionChange={setOperatorSessionOpen}
      >
        {reportBody}
      </OperatorStationStaffGate>
    )
  }

  return reportBody
}
