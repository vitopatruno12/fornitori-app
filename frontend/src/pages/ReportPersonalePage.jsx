import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import WorkbookGrid from '../components/WorkbookGrid.jsx'
import OperatorStationStaffGate from '../components/OperatorStationStaffGate.jsx'
import GestionaleStaffLocaleGate from '../components/GestionaleStaffLocaleGate.jsx'
import { createStaffShift, deleteStaffShift, fetchStaffShifts, updateStaffShift } from '../services/staffService.js'
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
  STAFF_REPORT_SHEET_FERIE,
  STAFF_REPORT_SHEET_VOCI,
  staffReportCellValue,
  staffReportColumnsForSheet,
  staffReportGridRows,
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
const MAX_FERIE_RANGE_DAYS = 60

function eachYmd(fromYmd, toYmdValue) {
  const out = []
  let cursor = String(fromYmd || '').slice(0, 10)
  const end = String(toYmdValue || '').slice(0, 10)
  let guard = 0
  while (cursor && end && cursor <= end && guard < 400) {
    out.push(cursor)
    const d = new Date(`${cursor}T12:00:00`)
    d.setDate(d.getDate() + 1)
    cursor = toYmd(d)
    guard += 1
  }
  return out
}

function daysInclusive(fromYmd, toYmdValue) {
  const from = new Date(`${fromYmd}T12:00:00`)
  const to = new Date(`${toYmdValue}T12:00:00`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86400000) + 1)
}

function eachYmdInRange(fromYmd, toYmdValue) {
  const out = []
  let cur = new Date(`${fromYmd}T12:00:00`)
  const end = new Date(`${toYmdValue}T12:00:00`)
  if (Number.isNaN(cur.getTime()) || Number.isNaN(end.getTime()) || end < cur) return out
  while (cur <= end) {
    out.push(toYmd(cur))
    cur = addDays(cur, 1)
  }
  return out
}

export default function ReportPersonalePage({ operatorMode = false, stationId = null }) {
  const operatorStationId = operatorMode ? stationId || getLockedOperatorStationId() : null
  const [operatorSessionOpen, setOperatorSessionOpen] = useState(() => {
    if (!operatorMode) return false
    const sid = stationId || getLockedOperatorStationId()
    return isOperatorStationStaffSessionOpen(sid)
  })
  const [gestionaleSessionOpen, setGestionaleSessionOpen] = useState(false)
  const [gestionaleLocale, setGestionaleLocale] = useState('')
  const [gestionaleAccessCode, setGestionaleAccessCode] = useState('')
  const initial = defaultPeriod(operatorMode)
  const [dateFrom, setDateFrom] = useState(initial.from)
  const [dateTo, setDateTo] = useState(initial.to)
  const [workbook, setWorkbook] = useState(() =>
    buildStaffReportWorkbook({ members: [], shifts: [], dateFrom: initial.from, dateTo: initial.to }),
  )
  const [activeSheet, setActiveSheet] = useState('VOCI')
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [generatedAt, setGeneratedAt] = useState('')
  const [ferieMemberId, setFerieMemberId] = useState('')
  const [ferieFrom, setFerieFrom] = useState(initial.from)
  const [ferieTo, setFerieTo] = useState(initial.from)
  const [ferieNotes, setFerieNotes] = useState('')
  const [ferieEdit, setFerieEdit] = useState(null)
  const [ferieBusy, setFerieBusy] = useState(false)
  const dateFromRef = useRef(dateFrom)
  const dateToRef = useRef(dateTo)
  dateFromRef.current = dateFrom
  dateToRef.current = dateTo

  const sessionReady = operatorMode ? operatorSessionOpen : gestionaleSessionOpen

  const loadReportData = useCallback(
    async (from, to) => {
      if (operatorMode && operatorStationId) {
        const { members: mem } = await resolveOperatorStationMembers(operatorStationId)
        const shifts = await fetchOperatorStationShifts(operatorStationId, from, to)
        return { members: mem, shifts }
      }
      if (!gestionaleLocale || !gestionaleSessionOpen) {
        return { members: [], shifts: [] }
      }
      const { members: mem, memberIds, packNameKeys } = await resolveGestionaleLocaleMembers(gestionaleLocale, {
        accessCode: gestionaleAccessCode,
      })
      let shifts = []
      if (memberIds.length) {
        const shiftsRaw = await fetchStaffShifts(from, to, { memberIds })
        shifts = filterShiftsForOperatorLocale(shiftsRaw, { memberIds, packNameKeys })
      }
      return { members: mem, shifts }
    },
    [operatorMode, operatorStationId, gestionaleLocale, gestionaleSessionOpen, gestionaleAccessCode],
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
    if (!operatorMode && (!gestionaleLocale || !gestionaleSessionOpen)) {
      setError('Apri il locale con Accedi per generare il report.')
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
      const { members: mem, shifts } = await loadReportData(from, to)
      setMembers(Array.isArray(mem) ? mem : [])
      try {
        const next = buildStaffReportWorkbook({ members: mem, shifts, dateFrom: from, dateTo: to })
        setWorkbook(next)
        setGeneratedAt(new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }))
        if (!mem.length) {
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
  }, [loadReportData, operatorMode, gestionaleLocale, gestionaleSessionOpen])

  useEffect(() => {
    if (operatorMode && !operatorSessionOpen) {
      setLoading(false)
      return
    }
    if (!operatorMode && !gestionaleSessionOpen) {
      setLoading(false)
      return
    }
    void runRefresh()
  }, [
    operatorMode,
    operatorSessionOpen,
    gestionaleSessionOpen,
    gestionaleLocale,
    runRefresh,
    operatorMode ? undefined : dateFrom,
    operatorMode ? undefined : dateTo,
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

  const activeMembers = useMemo(
    () => (members || []).filter((m) => m && m.is_active !== false).slice().sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), 'it'),
    ),
    [members],
  )

  async function handleRegisterFerie(e) {
    e.preventDefault()
    setError('')
    setSuccess('')
    const memberId = Number(ferieMemberId)
    const from = String(ferieFrom || '').slice(0, 10)
    const to = String(ferieTo || '').slice(0, 10)
    if (!memberId) {
      setError('Seleziona il dipendente per le ferie.')
      return
    }
    if (!from || !to) {
      setError('Indica le date di inizio e fine ferie.')
      return
    }
    if (to < from) {
      setError('La data fine ferie deve essere uguale o successiva alla data inizio.')
      return
    }
    const days = eachYmdInRange(from, to)
    if (!days.length) {
      setError('Intervallo ferie non valido.')
      return
    }
    if (days.length > MAX_FERIE_RANGE_DAYS) {
      setError(`Massimo ${MAX_FERIE_RANGE_DAYS} giorni di ferie per registrazione.`)
      return
    }
    setFerieBusy(true)
    try {
      let created = 0
      let skipped = 0
      const notes = String(ferieNotes || '').trim() || null
      let existing = []
      try {
        existing = await fetchStaffShifts(from, to, { memberIds: [memberId] })
      } catch {
        existing = []
      }
      const existingFerieDays = new Set(
        (existing || [])
          .filter((s) => Number(s.staff_member_id) === memberId && s.entry_kind === 'ferie')
          .map((s) => String(s.work_date || '').slice(0, 10)),
      )
      for (const ymd of days) {
        if (existingFerieDays.has(ymd)) {
          skipped += 1
          continue
        }
        await createStaffShift({
          staff_member_id: memberId,
          work_date: ymd,
          time_start: null,
          time_end: null,
          entry_kind: 'ferie',
          notes,
        })
        created += 1
        existingFerieDays.add(ymd)
      }
      const reportFrom = from < dateFromRef.current ? from : dateFromRef.current
      const reportTo = to > dateToRef.current ? to : dateToRef.current
      if (reportFrom !== dateFromRef.current) setDateFrom(reportFrom)
      if (reportTo !== dateToRef.current) setDateTo(reportTo)
      dateFromRef.current = reportFrom
      dateToRef.current = reportTo
      setActiveSheet(STAFF_REPORT_SHEET_FERIE)
      await runRefresh()
      const memberName = activeMembers.find((m) => Number(m.id) === memberId)?.name || 'dipendente'
      setSuccess(
        created > 0
          ? `Ferie registrate per ${memberName}: ${created} giorn${created === 1 ? 'o' : 'i'}${skipped ? ` (${skipped} già presenti)` : ''}.`
          : skipped
            ? `Nessuna nuova ferie: ${skipped} giorn${skipped === 1 ? 'o' : 'i'} già registrat${skipped === 1 ? 'o' : 'i'}.`
            : 'Nessuna ferie registrata.',
      )
      setFerieNotes('')
    } catch (err) {
      setError(err?.message || 'Impossibile registrare le ferie')
    } finally {
      setFerieBusy(false)
    }
  }

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

  function openFerieEdit(row) {
    if (!row?.staffMemberId || !row.dateFrom || !row.dateTo) return
    setError('')
    setFerieEdit({
      staffMemberId: row.staffMemberId,
      employee: row.employee || '',
      dateFrom: row.dateFrom,
      dateTo: row.dateTo,
      notes: row.notes || '',
      originalNotes: row.notes || '',
      byDate: row.byDate || {},
    })
  }

  async function deleteFerieRange(row) {
    const ids = Array.isArray(row?.shiftIds) ? row.shiftIds.filter((id) => id != null) : []
    if (!ids.length) {
      setError('Questa riga non ha voci da eliminare.')
      return
    }
    const label = row.employee || 'questo dipendente'
    const dal = row.dal || row.dateFrom
    const al = row.al || row.dateTo
    if (!window.confirm(`Eliminare le ferie di ${label} dal ${dal} al ${al}?`)) return
    setFerieBusy(true)
    setError('')
    setSuccess('')
    try {
      for (const id of ids) {
        await deleteStaffShift(id)
      }
      setFerieEdit(null)
      setSuccess(`Ferie eliminate: ${label}, ${dal} – ${al}.`)
      await runRefresh()
    } catch (err) {
      setError(err?.message || 'Eliminazione ferie non riuscita')
      await runRefresh()
    } finally {
      setFerieBusy(false)
    }
  }

  async function saveFerieRange() {
    if (!ferieEdit) return
    const from = String(ferieEdit.dateFrom || '').slice(0, 10)
    const to = String(ferieEdit.dateTo || '').slice(0, 10)
    if (!from || !to) {
      setError('Indica le date dal e al')
      return
    }
    if (to < from) {
      setError('La data «Al» deve essere uguale o successiva a «Dal»')
      return
    }
    const wanted = eachYmd(from, to)
    if (!wanted.length || wanted.length > 366) {
      setError('Intervallo ferie non valido')
      return
    }
    const notes = String(ferieEdit.notes || '').trim()
    const notesChanged = notes !== String(ferieEdit.originalNotes || '').trim()
    const byDate = ferieEdit.byDate || {}
    const idsToDelete = []
    const idsToUpdate = []
    for (const [ymd, rawIds] of Object.entries(byDate)) {
      const ids = (Array.isArray(rawIds) ? rawIds : [rawIds]).filter((id) => id != null)
      if (!wanted.includes(ymd)) idsToDelete.push(...ids)
      else if (notesChanged) idsToUpdate.push(...ids)
    }
    const datesToCreate = wanted.filter((ymd) => !byDate[ymd] || (Array.isArray(byDate[ymd]) && byDate[ymd].length === 0))
    setFerieBusy(true)
    setError('')
    setSuccess('')
    try {
      for (const id of idsToDelete) {
        await deleteStaffShift(id)
      }
      for (const id of idsToUpdate) {
        await updateStaffShift(id, { notes: notes || null, entry_kind: 'ferie', time_start: null, time_end: null })
      }
      for (const ymd of datesToCreate) {
        await createStaffShift({
          staff_member_id: ferieEdit.staffMemberId,
          work_date: ymd,
          time_start: null,
          time_end: null,
          entry_kind: 'ferie',
          notes: notes || null,
        })
      }
      setFerieEdit(null)
      setSuccess(`Ferie aggiornate: ${ferieEdit.employee}, ${wanted.length} giorni.`)
      await runRefresh()
    } catch (err) {
      setError(err?.message || 'Salvataggio ferie non riuscito')
      await runRefresh()
    } finally {
      setFerieBusy(false)
    }
  }

  const reportHero = (
    <section className="staff-page-hero staff-report-no-print">
      <div className="staff-page-hero-inner staff-page-hero-inner--with-locale">
        <div>
          <h1 className="page-header staff-page-title">Report personale</h1>
          <p className="staff-page-lead">
            Foglio Excel con tutte le voci di pianificazione del periodo scelto: turni, permessi, assenze, malattia, ferie e riposo.
            Puoi stampare il report o scaricarlo in Excel. Nel foglio <strong>FERIE</strong> registri un periodo dal/al:
            in elenco compare una sola riga, con Modifica ed Elimina.
            {operatorMode ? (
              <>
                {' '}
                Periodo consigliato: <strong>settimana corrente</strong> (massimo {MAX_OPERATOR_REPORT_DAYS} giorni).
              </>
            ) : (
              <>
                {' '}
                Apri il <strong>locale</strong> con il codice: il report mostra solo il personale di quel negozio.
              </>
            )}
          </p>
        </div>
      </div>
    </section>
  )

  const ferieForm = sessionReady ? (
    <section className="card staff-report-ferie-card staff-report-no-print" aria-label="Registra ferie manuali">
      <h2 className="staff-report-ferie-title">Registra ferie</h2>
      <p className="staff-report-ferie-lead">
        Seleziona il dipendente e il periodo. In elenco il mese di ferie resta una sola riga, dal al.
      </p>
      <form className="staff-report-ferie-form" onSubmit={(e) => void handleRegisterFerie(e)}>
        <div className="form-group">
          <label htmlFor="report-ferie-member">Dipendente</label>
          <select
            id="report-ferie-member"
            className="form-control"
            value={ferieMemberId}
            onChange={(e) => setFerieMemberId(e.target.value)}
            disabled={ferieBusy || loading || !activeMembers.length}
            required
          >
            <option value="">— Seleziona —</option>
            {activeMembers.map((m) => (
              <option key={m.id} value={String(m.id)}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="report-ferie-from">Dal</label>
          <input
            id="report-ferie-from"
            type="date"
            className="form-control"
            value={ferieFrom}
            onChange={(e) => {
              const v = e.target.value
              setFerieFrom(v)
              if (ferieTo && v && ferieTo < v) setFerieTo(v)
            }}
            disabled={ferieBusy || loading}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="report-ferie-to">Al</label>
          <input
            id="report-ferie-to"
            type="date"
            className="form-control"
            value={ferieTo}
            onChange={(e) => setFerieTo(e.target.value)}
            disabled={ferieBusy || loading}
            required
          />
        </div>
        <div className="form-group staff-report-ferie-notes">
          <label htmlFor="report-ferie-notes">Note (opzionale)</label>
          <input
            id="report-ferie-notes"
            className="form-control"
            value={ferieNotes}
            onChange={(e) => setFerieNotes(e.target.value)}
            placeholder="Es. ferie estive"
            disabled={ferieBusy || loading}
          />
        </div>
        <div className="form-group staff-report-ferie-actions">
          <label>&nbsp;</label>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={ferieBusy || loading || !activeMembers.length}
          >
            {ferieBusy ? 'Salvataggio…' : 'Registra ferie'}
          </button>
        </div>
      </form>
      {!activeMembers.length ? (
        <p className="staff-report-ferie-empty">Nessun dipendente nel locale: carica il personale prima di registrare le ferie.</p>
      ) : null}
    </section>
  ) : null

  const reportBody = (
    <div className="pagamenti-page staff-report-page">
      {error && <div className="alert alert-danger staff-report-no-print">{error}</div>}
      {success && <div className="alert alert-success staff-report-no-print">{success}</div>}

      {ferieForm}

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
              disabled={loading || ferieBusy}
              onClick={() => void runRefresh()}
            >
              {loading ? 'Aggiornamento…' : 'Aggiorna'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={loading || ferieBusy}
              onClick={handleDownloadExcel}
            >
              Download Excel
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={loading || ferieBusy} onClick={handlePrint}>
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

        {(activeSheet === 'FERIE' || activeSheet === 'VOCI') && ferieEdit ? (
          <form
            className="staff-report-ferie-edit staff-report-no-print"
            onSubmit={(e) => {
              e.preventDefault()
              void saveFerieRange()
            }}
          >
            <strong>Modifica ferie · {ferieEdit.employee}</strong>
            <label>
              Dal
              <input
                type="date"
                className="form-control form-control-sm"
                value={ferieEdit.dateFrom}
                disabled={ferieBusy}
                onChange={(e) => setFerieEdit((prev) => (prev ? { ...prev, dateFrom: e.target.value } : prev))}
              />
            </label>
            <label>
              Al
              <input
                type="date"
                className="form-control form-control-sm"
                value={ferieEdit.dateTo}
                disabled={ferieBusy}
                onChange={(e) => setFerieEdit((prev) => (prev ? { ...prev, dateTo: e.target.value } : prev))}
              />
            </label>
            <label className="staff-report-ferie-edit-notes">
              Note
              <input
                className="form-control form-control-sm"
                value={ferieEdit.notes}
                disabled={ferieBusy}
                onChange={(e) => setFerieEdit((prev) => (prev ? { ...prev, notes: e.target.value } : prev))}
              />
            </label>
            <button type="submit" className="btn btn-primary btn-sm" disabled={ferieBusy}>
              {ferieBusy ? 'Salvataggio…' : 'Salva'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={ferieBusy}
              onClick={() => setFerieEdit(null)}
            >
              Annulla
            </button>
          </form>
        ) : null}

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
          gridClassName="staff-report-grid workbook-grid"
          loading={loading}
          hideToolbar
          emptyMessage="Nessuna voce nel periodo selezionato."
          actionsHeader={
            currentSheet?.name === STAFF_REPORT_SHEET_FERIE || currentSheet?.name === STAFF_REPORT_SHEET_VOCI
              ? 'Azioni'
              : ''
          }
          actionsColWidth="13rem"
          renderActions={
            currentSheet?.name === STAFF_REPORT_SHEET_FERIE || currentSheet?.name === STAFF_REPORT_SHEET_VOCI
              ? (row) =>
                  row?.entryKind === 'ferie' || row?.kind === 'Ferie' ? (
                    <div className="staff-report-row-actions staff-report-no-print">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={ferieBusy || loading || !row.staffMemberId}
                        onClick={() => openFerieEdit(row)}
                      >
                        Modifica
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline-danger btn-sm"
                        disabled={ferieBusy || loading || !row.shiftIds?.length}
                        onClick={() => void deleteFerieRange(row)}
                      >
                        Elimina
                      </button>
                    </div>
                  ) : null
              : undefined
          }
          rowKey={(row, rowIndex) =>
            `${currentSheet?.name || 'sheet'}-${row.dateFrom || row.shiftId || rowIndex}-${row.employee || row.label || row.date || ''}`
          }
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

  return (
    <GestionaleStaffLocaleGate
      title="Report personale"
      banner={reportHero}
      onSessionChange={(open, locale, code) => {
        setGestionaleSessionOpen(Boolean(open))
        setGestionaleLocale(open ? String(locale || '') : '')
        setGestionaleAccessCode(open ? String(code || '') : '')
        if (!open) {
          setMembers([])
          setFerieMemberId('')
          setWorkbook(
            buildStaffReportWorkbook({
              members: [],
              shifts: [],
              dateFrom: dateFromRef.current,
              dateTo: dateToRef.current,
            }),
          )
        }
      }}
    >
      {reportBody}
    </GestionaleStaffLocaleGate>
  )
}
