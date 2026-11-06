import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  deleteGazzaSalaHistory,
  fetchGazzaSala,
  importGazzaSala,
  markGazzaSalaPaid,
  resetGazzaSala,
  saveGazzaSalaRow,
} from '../services/gazzaSalaApi.js'
import { buildGazzaSalaHistoryPdf, openGazzaSalaHistoryPdf } from '../utils/gazzaSalaHistoryPdf.js'
import { downloadWorkbookAsExcel } from '../utils/pagamentiExcel.js'
import { getGazzaSalaPalmarePath } from '../utils/operatorMode.ts'
import {
  GAZZA_SALA_COLUMNS,
  GAZZA_SALA_FASCE,
  GAZZA_SALA_STATUS_OPTIONS,
  GAZZA_SALA_STATUS_SELECT_OPTIONS,
  GAZZA_SALA_TABLE_COUNT,
  GAZZA_SALA_WORKBOOK_TITLE,
  createEmptyGazzaSalaRow,
  createEmptyGazzaSalaRows,
  gazzaSalaRowForPalmare,
  gazzaSalaCellDisplay,
  gazzaSalaPaymentLabel,
  gazzaSalaRowHasData,
  gazzaSalaRowsToAoa,
  gazzaSalaStatusRowClass,
  gazzaSalaStorageKey,
  gazzaSalaEveningHistoryKey,
  gazzaSalaTotals,
  gazzaSalaTotalsLabel,
  loadGazzaSalaEveningHistory,
  normalizeGazzaSalaRows,
  parseGazzaSalaAmount,
} from '../utils/gazzaSalaWorkbook.js'

function formatSalaEur(value) {
  const n = Number(value) || 0
  return `${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
}

function formatSalaSavedAt(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function todayIsoDate() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function readLocalSheet(nextDate, nextFascia) {
  try {
    const raw = localStorage.getItem(gazzaSalaStorageKey(nextDate, nextFascia))
    const parsed = raw ? JSON.parse(raw) : null
    return {
      tables: normalizeGazzaSalaRows(parsed?.tables ?? parsed?.rows),
      history: loadGazzaSalaEveningHistory(nextDate, nextFascia),
      savedAt: parsed?.savedAt || '',
    }
  } catch {
    return { tables: createEmptyGazzaSalaRows(), history: [], savedAt: '' }
  }
}

function localSheetHasData(local) {
  if (local.history.length) return true
  return local.tables.some(
    (row) => gazzaSalaRowHasData(row) || (parseGazzaSalaAmount(row.paid_total) || 0) > 0,
  )
}

function writeLocalSheet(nextDate, nextFascia, tables, savedAt, history) {
  try {
    localStorage.setItem(
      gazzaSalaStorageKey(nextDate, nextFascia),
      JSON.stringify({ date: nextDate, fascia: nextFascia, tables, savedAt: savedAt || '' }),
    )
    localStorage.setItem(gazzaSalaEveningHistoryKey(nextDate, nextFascia), JSON.stringify(history || []))
  } catch {
    /* quota */
  }
}

function mergeSalaRows(localRows, remoteTables, pending, hold) {
  const remote = normalizeGazzaSalaRows(remoteTables)
  return remote.map((row) => {
    if (pending.has(row.table_id) || hold.has(row.table_id)) {
      return localRows.find((item) => item.table_id === row.table_id) || row
    }
    return row
  })
}

function statusOptionsFor(row) {
  const current = String(row?.status || '')
  if (current !== 'pagato' && current !== 'conto') return GAZZA_SALA_STATUS_SELECT_OPTIONS
  if (GAZZA_SALA_STATUS_SELECT_OPTIONS.some((opt) => opt.value === current)) {
    return GAZZA_SALA_STATUS_SELECT_OPTIONS
  }
  const extra = GAZZA_SALA_STATUS_OPTIONS.find((opt) => opt.value === current)
  return extra ? [...GAZZA_SALA_STATUS_SELECT_OPTIONS, extra] : GAZZA_SALA_STATUS_SELECT_OPTIONS
}

function palmareAbsoluteUrl() {
  const path = getGazzaSalaPalmarePath()
  if (typeof window === 'undefined') return path
  return `${window.location.origin}${path}`
}

/** Sala Gazza Ladra condivisa tra postazione e palmari. */
export function GazzaLadraSalaPage({ operatorMode = false, palmare = false }) {
  const [date, setDate] = useState(todayIsoDate)
  const [fascia, setFascia] = useState('pranzo')
  const [rows, setRows] = useState(() => createEmptyGazzaSalaRows())
  const [history, setHistory] = useState([])
  const [savedAt, setSavedAt] = useState('')
  const [sending, setSending] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [copied, setCopied] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  const rowsRef = useRef(rows)
  const slotRef = useRef({ date, fascia })
  const pendingRef = useRef(new Set())
  const holdRef = useRef(new Set())
  const revRef = useRef({})
  const timersRef = useRef({})
  rowsRef.current = rows
  slotRef.current = { date, fascia }

  const viewRows = useMemo(
    () => (palmare ? rows.map((row) => gazzaSalaRowForPalmare(row)) : rows),
    [rows, palmare],
  )
  const totals = useMemo(() => gazzaSalaTotals(viewRows), [viewRows])
  const fasciaLabel = GAZZA_SALA_FASCE.find((f) => f.id === fascia)?.label || fascia
  const palmareUrl = palmareAbsoluteUrl()

  function noteSending() {
    setSending(pendingRef.current.size > 0)
  }

  function applyRemote(payload, { force = false } = {}) {
    if (!payload) return
    const slot = slotRef.current
    if (payload.date !== slot.date || payload.fascia !== slot.fascia) return
    const nextRows = force
      ? normalizeGazzaSalaRows(payload.tables)
      : mergeSalaRows(rowsRef.current, payload.tables, pendingRef.current, holdRef.current)
    const nextHistory = Array.isArray(payload.history) ? payload.history : []
    setRows(nextRows)
    setHistory(nextHistory)
    setSavedAt(payload.savedAt || '')
    writeLocalSheet(payload.date, payload.fascia, nextRows, payload.savedAt || '', nextHistory)
    noteSending()
  }

  async function flushRow(tableId, slot, rev) {
    const row = rowsRef.current.find((item) => Number(item.table_id) === Number(tableId))
    if (!row || !slot) return
    try {
      const payload = await saveGazzaSalaRow(slot.date, slot.fascia, row)
      if (revRef.current[tableId] === rev) pendingRef.current.delete(tableId)
      applyRemote(payload)
      setSyncError('')
    } catch {
      setSyncError('Invio non riuscito. Il tavolo resta su questo apparecchio finché la rete torna.')
      writeLocalSheet(slot.date, slot.fascia, rowsRef.current, savedAt, history)
    } finally {
      noteSending()
    }
  }

  function scheduleRowSave(tableId) {
    const slot = { ...slotRef.current }
    const rev = revRef.current[tableId]
    window.clearTimeout(timersRef.current[tableId])
    timersRef.current[tableId] = window.setTimeout(() => {
      flushRow(tableId, slot, rev)
    }, 400)
  }

  function updateCell(tableId, field, value) {
    revRef.current[tableId] = (revRef.current[tableId] || 0) + 1
    pendingRef.current.add(tableId)
    noteSending()
    setRows((prev) =>
      prev.map((row) => {
        if (Number(row.table_id) !== Number(tableId)) return row
        const base = palmare ? gazzaSalaRowForPalmare(row) : row
        return { ...base, [field]: value }
      }),
    )
    scheduleRowSave(tableId)
  }

  async function saveRowNow(tableId, nextRow) {
    window.clearTimeout(timersRef.current[tableId])
    pendingRef.current.delete(tableId)
    holdRef.current.add(tableId)
    noteSending()
    const slot = { ...slotRef.current }
    setRows((prev) => prev.map((row) => (Number(row.table_id) === Number(tableId) ? nextRow : row)))
    try {
      const payload = await saveGazzaSalaRow(slot.date, slot.fascia, nextRow)
      holdRef.current.delete(tableId)
      applyRemote(payload)
      setSyncError('')
    } catch {
      holdRef.current.delete(tableId)
      setSyncError('Invio non riuscito. Riprova tra un attimo.')
      writeLocalSheet(slot.date, slot.fascia, rowsRef.current, savedAt, history)
    } finally {
      noteSending()
    }
  }

  function clearTableRow(tableId) {
    const current = rows.find((r) => r.table_id === tableId)
    if (!gazzaSalaRowHasData(current)) return
    if (
      !window.confirm(
        `Cancellare prenotazione, clienti e fattura del tavolo ${tableId}? Il contatore resta.`,
      )
    ) {
      return
    }
    saveRowNow(tableId, createEmptyGazzaSalaRow(tableId, { keepPaidTotal: current.paid_total }))
  }

  function editTableCounter(tableId) {
    const current = rows.find((r) => Number(r.table_id) === Number(tableId))
    if (!current) return
    const typed = window.prompt(
      `Nuovo importo del contatore, tavolo ${tableId} (€)`,
      String(current.paid_total || '0'),
    )
    if (typed == null) return
    const amount = parseGazzaSalaAmount(typed)
    if (amount == null) {
      window.alert('Importo non valido.')
      return
    }
    saveRowNow(tableId, {
      ...current,
      paid_total: amount > 0 ? String(amount) : '',
      clear_counter: !(amount > 0),
    })
  }

  function resetTableCounter(tableId) {
    const current = rows.find((r) => Number(r.table_id) === Number(tableId))
    if (!current || parseGazzaSalaAmount(current.paid_total) === 0) return
    if (!window.confirm(`Azzerare il contatore del tavolo ${tableId} a fine serata?`)) return
    saveRowNow(tableId, { ...current, paid_total: '', clear_counter: true })
  }

  async function markTablePaid(tableId) {
    const current = rows.find((r) => Number(r.table_id) === Number(tableId))
    if (!current) return
    window.clearTimeout(timersRef.current[tableId])
    pendingRef.current.delete(tableId)
    holdRef.current.add(tableId)
    noteSending()
    const added = parseGazzaSalaAmount(current.paid) || 0
    const prevTotal = parseGazzaSalaAmount(current.paid_total) || 0
    const nextTotal = Math.round((prevTotal + added) * 100) / 100
    setRows((prev) =>
      prev.map((row) =>
        Number(row.table_id) === Number(tableId)
          ? { ...row, status: 'pagato', paid_total: nextTotal > 0 ? String(nextTotal) : row.paid_total }
          : row,
      ),
    )
    const slot = { ...slotRef.current }
    try {
      const payload = await markGazzaSalaPaid(slot.date, slot.fascia, tableId, current)
      window.setTimeout(() => {
        holdRef.current.delete(tableId)
        applyRemote(payload)
        setSyncError('')
      }, 450)
    } catch {
      holdRef.current.delete(tableId)
      setRows((prev) => prev.map((row) => (Number(row.table_id) === Number(tableId) ? current : row)))
      setSyncError('Pagato non registrato. Riprova.')
    } finally {
      noteSending()
    }
  }

  function onStatusChange(tableId, value) {
    if (value === 'pagato') {
      markTablePaid(tableId)
      return
    }
    updateCell(tableId, 'status', value)
  }

  function canMarkPaid(row) {
    if (!row || row.status === 'pagato') return false
    if (row.status === 'occupato' || row.status === 'conto' || row.status === 'chiuso') return true
    const paid = Number(String(row.paid ?? '').replace(',', '.'))
    return Number.isFinite(paid) && paid > 0
  }

  function canMarkConto(row) {
    if (!row || row.status === 'pagato' || row.status === 'conto') return false
    return row.status === 'occupato' || row.status === 'chiuso' || gazzaSalaRowHasData(row)
  }

  function markTableConto(tableId) {
    updateCell(tableId, 'status', 'conto')
  }

  async function onSave() {
    const ids = [...pendingRef.current]
    for (const id of ids) {
      window.clearTimeout(timersRef.current[id])
      await flushRow(id, { ...slotRef.current }, revRef.current[id])
    }
  }

  async function onResetSheet() {
    if (
      !window.confirm(
        `Azzerare tutti i ${GAZZA_SALA_TABLE_COUNT} tavoli per ${fasciaLabel} del ${date}? Lo storico dei pagati resta.`,
      )
    ) {
      return
    }
    Object.values(timersRef.current).forEach((timer) => window.clearTimeout(timer))
    pendingRef.current.clear()
    const slot = { ...slotRef.current }
    try {
      const payload = await resetGazzaSala(slot.date, slot.fascia)
      applyRemote(payload, { force: true })
      setSyncError('')
    } catch {
      setSyncError('Azzeramento non registrato. Riprova.')
    } finally {
      noteSending()
    }
  }

  function onExportExcel() {
    const aoa = gazzaSalaRowsToAoa(rows, { date, fascia })
    downloadWorkbookAsExcel({
      title: `Gazza_Ladra_Sala_${date}_${fascia}`,
      sheets: [{ name: `Sala ${fasciaLabel}`, rows: aoa }],
    })
  }

  function formatHistoryTime(iso) {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  }

  async function removeHistoryEntry(entry) {
    const name = entry.reservation_name || 'senza nome'
    const amount = formatSalaEur(parseGazzaSalaAmount(entry.paid) || 0)
    if (
      !window.confirm(
        `Togliere dallo storico il tavolo ${entry.table_id}, ${name}, ${amount}? Il contatore di quel tavolo scende dello stesso importo.`,
      )
    ) {
      return
    }
    const slot = { ...slotRef.current }
    try {
      const payload = await deleteGazzaSalaHistory(slot.date, slot.fascia, entry.id)
      applyRemote(payload, { force: true })
      setSyncError('')
    } catch {
      setSyncError('Eliminazione dallo storico non riuscita. Riprova.')
    }
  }

  function onOpenHistoryPdf() {
    const blob = buildGazzaSalaHistoryPdf({ date, fascia, entries: history })
    openGazzaSalaHistoryPdf(blob)
  }

  async function copyPalmareLink() {
    try {
      await navigator.clipboard.writeText(palmareUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copia il link del palmare', palmareUrl)
    }
  }

  useEffect(() => {
    let cancelled = false
    const slot = { date, fascia }
    slotRef.current = slot
    ;(async () => {
      const local = readLocalSheet(slot.date, slot.fascia)
      try {
        let remote = await fetchGazzaSala(slot.date, slot.fascia)
        const remoteEmpty = !localSheetHasData({
          tables: normalizeGazzaSalaRows(remote?.tables),
          history: Array.isArray(remote?.history) ? remote.history : [],
        })
        if (!cancelled && remoteEmpty && localSheetHasData(local)) {
          remote = await importGazzaSala(slot.date, slot.fascia, local.tables, local.history)
        }
        if (cancelled) return
        pendingRef.current.clear()
        holdRef.current.clear()
        applyRemote(remote, { force: true })
        setSyncError('')
      } catch {
        if (cancelled) return
        setRows(local.tables)
        setHistory(local.history)
        setSavedAt(local.savedAt)
        setSyncError('Sala non raggiungibile: vedi l’ultima copia di questo apparecchio.')
      }
    })()
    return () => {
      cancelled = true
    }
    // applyRemote legge i ref correnti
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, fascia])

  useEffect(() => {
    const timer = window.setInterval(async () => {
      if (document.hidden) return
      const slot = slotRef.current
      try {
        const remote = await fetchGazzaSala(slot.date, slot.fascia)
        applyRemote(remote)
        setSyncError('')
      } catch {
        /* il foglio aperto resta visibile */
      }
    }, 4000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, fascia])

  useEffect(
    () => () => {
      Object.values(timersRef.current).forEach((timer) => window.clearTimeout(timer))
    },
    [],
  )

  function renderField(row, col) {
    if (col.readonly || !col.editable) {
      return (
        <input
          className={['excel-cell', 'pagamenti-cell-readonly', col.numeric ? 'excel-cell-num' : '']
            .filter(Boolean)
            .join(' ')}
          value={gazzaSalaCellDisplay(row, col)}
          readOnly
          tabIndex={-1}
          aria-label={`${col.label} tavolo ${row.table_id}`}
        />
      )
    }
    if (col.inputType === 'select') {
      return (
        <select
          className={[
            'excel-cell',
            'excel-cell-select',
            col.id === 'status' ? gazzaSalaStatusRowClass(row.status) : '',
          ]
            .filter(Boolean)
            .join(' ')}
          value={row[col.id] ?? ''}
          onChange={(e) =>
            col.id === 'status'
              ? onStatusChange(row.table_id, e.target.value)
              : updateCell(row.table_id, col.id, e.target.value)
          }
          aria-label={`${col.label} tavolo ${row.table_id}`}
        >
          {(col.id === 'status' ? statusOptionsFor(row) : col.options || []).map((opt) => (
            <option key={opt.value || 'empty'} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )
    }
    return (
      <input
        type={col.inputType === 'number' ? 'number' : 'text'}
        inputMode={col.inputType === 'number' ? 'decimal' : 'text'}
        step={col.step}
        min={col.inputType === 'number' ? '0' : undefined}
        className={['excel-cell', col.numeric ? 'excel-cell-num' : ''].filter(Boolean).join(' ')}
        value={row[col.id] ?? ''}
        onChange={(e) => updateCell(row.table_id, col.id, e.target.value)}
        aria-label={`${col.label} tavolo ${row.table_id}`}
      />
    )
  }

  function renderActions(row) {
    return (
      <div className="gazza-sala-actions-btns">
        <button
          type="button"
          className="btn btn-sm gazza-sala-conto-btn"
          onClick={() => markTableConto(row.table_id)}
          disabled={!canMarkConto(row)}
        >
          Conto
        </button>
        <button
          type="button"
          className="btn btn-sm gazza-sala-paid-btn"
          onClick={() => markTablePaid(row.table_id)}
          disabled={!canMarkPaid(row)}
        >
          Pagato
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm gazza-sala-clear-btn"
          onClick={() => clearTableRow(row.table_id)}
          disabled={!gazzaSalaRowHasData(row)}
        >
          Cancella
        </button>
        <select
          className="form-control gazza-sala-counter-select"
          value=""
          aria-label={`Contatore tavolo ${row.table_id}`}
          onChange={(e) => {
            const action = e.target.value
            e.target.value = ''
            if (action === 'edit') editTableCounter(row.table_id)
            if (action === 'reset') resetTableCounter(row.table_id)
          }}
        >
          <option value="">Contatore</option>
          <option value="edit">Modifica importo</option>
          <option value="reset">Azzera contatore</option>
        </select>
      </div>
    )
  }

  const saveClass = syncError ? 'is-dirty' : sending ? 'is-dirty' : savedAt ? 'is-saved' : 'is-empty'
  const saveText = syncError
    ? syncError
    : sending
      ? 'Invio in corso…'
      : savedAt
        ? `In sala ${formatSalaSavedAt(savedAt)}`
        : 'In attesa del primo tavolo'

  return (
    <div className={palmare ? 'page gazza-sala-page is-palmare' : 'page gazza-sala-page'}>
      <header className="page-header-block" style={{ marginBottom: '1rem' }}>
        {operatorMode ? null : (
          <p className="analisi-machine-scope" style={{ marginBottom: '0.35rem' }}>
            <Link to="/gestione-locali">← Gestione locali</Link>
          </p>
        )}
        <h1 className="page-header staff-page-title">
          {palmare ? 'Sala palmare' : operatorMode ? 'Gestione sala' : 'Gazza Ladra · Gestisci sala'}
        </h1>
        {palmare ? (
          <p className="page-lead">
            Pagato libera questo tavolo. Nome, clienti, fattura, cameriere, metodo e conto restano in Gestione
            sala finché non inserisci il cliente successivo, e nello storico.
          </p>
        ) : null}
      </header>

      {palmare ? null : (
        <section className="card gazza-sala-link-card">
          <div>
            <strong>Link palmare camerieri</strong>
            <p>
              Aprilo sul telefono, accedi con la postazione Gazza e gestisci i tavoli. I dati finiscono in questa
              sala.
            </p>
            <a href={palmareUrl}>{palmareUrl}</a>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={copyPalmareLink}>
            {copied ? 'Link copiato' : 'Copia link'}
          </button>
        </section>
      )}

      <section className="card pagamenti-workbook-card">
        <div className="pagamenti-workbook-toolbar gazza-sala-toolbar">
          <div className="gazza-sala-toolbar-main">
            <span className="pagamenti-workbook-title">{GAZZA_SALA_WORKBOOK_TITLE}</span>
            <div className="gazza-sala-toolbar-date">
              <label className="gazza-sala-date-field">
                <span>Data</span>
                <input
                  className="form-control"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <div className="gazza-sala-fascia" role="group" aria-label="Fascia">
                {GAZZA_SALA_FASCE.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`btn btn-sm ${fascia === f.id ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setFascia(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="analisi-panel-actions" style={{ marginLeft: 'auto' }}>
            {palmare ? null : (
              <button type="button" className="btn btn-secondary btn-sm" onClick={onExportExcel}>
                Esporta Excel
              </button>
            )}
            <button
              type="button"
              className={`btn btn-sm ${historyOpen ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setHistoryOpen((open) => !open)}
            >
              Storico{history.length ? ` (${history.length})` : ''}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenHistoryPdf}>
              Storico PDF
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onResetSheet}>
              Azzera foglio
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={onSave}>
              Salva foglio
            </button>
          </div>
        </div>

        <div className="gazza-sala-stats" role="status">
          <div className="gazza-sala-stat gazza-sala-stat-covers">
            <span>Coperti</span>
            <strong>{totals.clients || 0}</strong>
          </div>
          <div className="gazza-sala-stat gazza-sala-stat-invoices">
            <span>Fatture</span>
            <strong>{totals.invoices || 0}</strong>
          </div>
          <div className="gazza-sala-stat gazza-sala-stat-counter">
            <span>Contatori</span>
            <strong>{formatSalaEur(totals.paidTotal)}</strong>
          </div>
          <div className="gazza-sala-stat gazza-sala-stat-open">
            <span>Conti aperti</span>
            <strong>{formatSalaEur(totals.openPaid)}</strong>
          </div>
          <p className={['gazza-sala-stat-save', saveClass].join(' ')}>{saveText}</p>
        </div>

        {historyOpen ? (
          <div className="gazza-sala-history">
            <p>Togli le prove e i conti inseriti per errore. Il contatore del tavolo scende di quell’importo.</p>
            {history.length === 0 ? (
              <p className="gazza-sala-history-empty">Nessun conto in questa fascia.</p>
            ) : (
              <ul>
                {[...history].reverse().map((entry) => (
                  <li key={entry.id}>
                    <span>
                      <strong>Tavolo {entry.table_id}</strong>
                      {' · '}
                      {entry.reservation_name || 'Senza nome'}
                      {' · '}
                      {entry.clients ? `${entry.clients} clienti` : 'clienti n.d.'}
                      {entry.invoice_number ? ` · fattura ${entry.invoice_number}` : ''}
                      {entry.waiter ? ` · ${entry.waiter}` : ''}
                      {' · '}
                      {formatSalaEur(parseGazzaSalaAmount(entry.paid) || 0)}
                      {entry.payment_type ? ` · ${gazzaSalaPaymentLabel(entry.payment_type)}` : ''}
                      {entry.paidAt ? ` · ${formatHistoryTime(entry.paidAt)}` : ''}
                    </span>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeHistoryEntry(entry)}>
                      Elimina
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {palmare ? (
          <div className="gazza-sala-cards">
            {viewRows.map((row) => (
              <article
                key={row.table_id}
                className={['gazza-sala-card', gazzaSalaStatusRowClass(row.status)].filter(Boolean).join(' ')}
              >
                <header className="gazza-sala-card-head">
                  <strong>Tavolo {row.table_id}</strong>
                  <span>Contatore {formatSalaEur(parseGazzaSalaAmount(row.paid_total) || 0)}</span>
                </header>
                <div className="gazza-sala-card-fields">
                  {GAZZA_SALA_COLUMNS.filter((col) => col.id !== 'table_id' && col.id !== 'paid_total').map((col) => (
                    <label key={col.id} className="gazza-sala-card-field">
                      <span>{col.label}</span>
                      {renderField(row, col)}
                    </label>
                  ))}
                </div>
                {renderActions(row)}
              </article>
            ))}
          </div>
        ) : (
          <div className="pagamenti-grid-wrap excel-wrap workbook-grid-wrap gazza-sala-grid-wrap">
            <table className="app-table excel-table pagamenti-grid workbook-grid gazza-sala-grid">
              <colgroup>
                {GAZZA_SALA_COLUMNS.map((col) => (
                  <col key={col.id} style={{ width: `${col.width}%` }} />
                ))}
                <col style={{ width: '18%' }} />
              </colgroup>
              <thead>
                <tr>
                  {GAZZA_SALA_COLUMNS.map((col) => (
                    <th
                      key={col.id}
                      className={[
                        col.numeric ? 'text-end' : '',
                        col.sticky === 'left' ? 'workbook-col-sticky-left' : '',
                        'pagamenti-hl-green',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {col.label}
                    </th>
                  ))}
                  <th className="pagamenti-hl-green gazza-sala-actions-col">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {viewRows.map((row) => (
                  <tr
                    key={row.table_id}
                    className={['workbook-grid-row', gazzaSalaStatusRowClass(row.status)].filter(Boolean).join(' ')}
                  >
                    {GAZZA_SALA_COLUMNS.map((col) => (
                      <td key={col.id} className={col.sticky === 'left' ? 'workbook-col-sticky-left' : ''}>
                        {renderField(row, col)}
                      </td>
                    ))}
                    <td className="gazza-sala-actions-col">{renderActions(row)}</td>
                  </tr>
                ))}
                <tr className="workbook-row-totals gazza-sala-totals-row">
                  {GAZZA_SALA_COLUMNS.map((col) => (
                    <td
                      key={`tot-${col.id}`}
                      className={[col.sticky === 'left' ? 'workbook-col-sticky-left' : '', 'pagamenti-hl-yellow']
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <input
                        className={[
                          'excel-cell',
                          'pagamenti-cell-readonly',
                          col.numeric ? 'excel-cell-num' : '',
                          'workbook-cell-total',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        value={gazzaSalaTotalsLabel(col.id, totals)}
                        readOnly
                        tabIndex={-1}
                      />
                    </td>
                  ))}
                  <td className="pagamenti-hl-yellow gazza-sala-actions-col" />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
