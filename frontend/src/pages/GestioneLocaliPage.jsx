import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { buildGazzaSalaHistoryPdf, openGazzaSalaHistoryPdf } from '../utils/gazzaSalaHistoryPdf.js'
import { downloadWorkbookAsExcel } from '../utils/pagamentiExcel.js'
import {
  GAZZA_SALA_COLUMNS,
  GAZZA_SALA_FASCE,
  GAZZA_SALA_STATUS_SELECT_OPTIONS,
  GAZZA_SALA_TABLE_COUNT,
  GAZZA_SALA_WORKBOOK_TITLE,
  addGazzaSalaPaidTotal,
  appendGazzaSalaEveningHistory,
  createEmptyGazzaSalaRow,
  createEmptyGazzaSalaRows,
  gazzaSalaCellDisplay,
  gazzaSalaRowHasData,
  gazzaSalaRowsToAoa,
  gazzaSalaStatusRowClass,
  gazzaSalaStorageKey,
  gazzaSalaTotals,
  gazzaSalaTotalsLabel,
  loadGazzaSalaEveningHistory,
  normalizeGazzaSalaRows,
  parseGazzaSalaAmount,
  snapshotGazzaSalaEveningEntry,
} from '../utils/gazzaSalaWorkbook.js'

const LOCALI = [
  {
    id: 'gazza_ladra',
    label: 'Gazza Ladra',
    kind: 'Ristorante',
    note: 'Gestione sala e coperti (senza VNE · POS Poste in arrivo)',
    to: '/gestione-locali/gazza-ladra',
    cta: 'Gestisci sala',
    ready: true,
  },
  {
    id: 'risacca',
    label: 'La Risacca',
    kind: 'Bar / locale',
    note: 'Collegato a VNE e Analisi — gestione sala non ancora attiva',
    to: null,
    cta: 'Presto',
    ready: false,
  },
  {
    id: 'mani_pasta',
    label: 'Mani in Pasta',
    kind: 'Due sedi (Abba + Zanardelli)',
    note: 'Operatività già su postazioni e Analisi — sala dedicata in seguito',
    to: null,
    cta: 'Presto',
    ready: false,
  },
  {
    id: 'mucche',
    label: 'Le Mucche Volanti',
    kind: 'Locale',
    note: 'Collegato a VNE e Analisi — gestione sala non ancora attiva',
    to: null,
    cta: 'Presto',
    ready: false,
  },
]

export default function GestioneLocaliPage() {
  return (
    <div className="page">
      <header className="page-header-block" style={{ marginBottom: '1rem' }}>
        <h1 className="page-header staff-page-title">Gestione locali</h1>
        <p className="page-lead" style={{ maxWidth: '42rem' }}>
          Hub operativo per le sedi: sala, coperti e strumenti di gestione. Gli incassi e le
          statistiche restano in <Link to="/analisi">Analisi</Link>.
        </p>
      </header>

      <div className="analisi-machine-grid">
        {LOCALI.map((locale) => (
          <section key={locale.id} className="card analisi-panel analisi-machine-card">
            <h2 className="analisi-panel-title">{locale.label}</h2>
            <p className="analisi-machine-scope" style={{ marginTop: '-0.25rem' }}>
              {locale.kind}
            </p>
            <p className="analisi-note" style={{ marginBottom: '0.85rem' }}>
              {locale.note}
            </p>
            <div className="analisi-panel-actions">
              {locale.ready && locale.to ? (
                <Link className="btn btn-primary btn-sm" to={locale.to}>
                  {locale.cta}
                </Link>
              ) : (
                <button type="button" className="btn btn-secondary btn-sm" disabled>
                  {locale.cta}
                </button>
              )}
              {locale.id === 'gazza_ladra' ? (
                <Link className="btn btn-secondary btn-sm" to="/analisi">
                  Vai ad Analisi
                </Link>
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

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

/** Sala Gazza Ladra: griglia Excel 15 tavoli (giallo / verde). */
export function GazzaLadraSalaPage({ operatorMode = false }) {
  const [date, setDate] = useState(todayIsoDate)
  const [fascia, setFascia] = useState('pranzo')
  const [rows, setRows] = useState(() => createEmptyGazzaSalaRows())
  const [savedAt, setSavedAt] = useState('')
  const [dirty, setDirty] = useState(false)

  const totals = useMemo(() => gazzaSalaTotals(rows), [rows])
  const fasciaLabel = GAZZA_SALA_FASCE.find((f) => f.id === fascia)?.label || fascia

  const loadSheet = useCallback((nextDate, nextFascia) => {
    try {
      const raw = localStorage.getItem(gazzaSalaStorageKey(nextDate, nextFascia))
      if (!raw) {
        setRows(createEmptyGazzaSalaRows())
        setSavedAt('')
        setDirty(false)
        return
      }
      const parsed = JSON.parse(raw)
      setRows(normalizeGazzaSalaRows(parsed.tables ?? parsed.rows))
      setSavedAt(parsed.savedAt || '')
      setDirty(false)
    } catch {
      setRows(createEmptyGazzaSalaRows())
      setSavedAt('')
      setDirty(false)
    }
  }, [])

  useEffect(() => {
    loadSheet(date, fascia)
  }, [date, fascia, loadSheet])

  function persistRows(nextRows, { markDirty = false } = {}) {
    try {
      const payload = {
        date,
        fascia,
        tables: nextRows,
        savedAt: new Date().toISOString(),
      }
      localStorage.setItem(gazzaSalaStorageKey(date, fascia), JSON.stringify(payload))
      setSavedAt(payload.savedAt)
      setDirty(Boolean(markDirty))
    } catch {
      setDirty(true)
    }
  }

  function updateCell(tableId, field, value) {
    setRows((prev) =>
      prev.map((row) => (row.table_id === tableId ? { ...row, [field]: value } : row)),
    )
    setDirty(true)
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
    const nextRows = rows.map((row) =>
      row.table_id === tableId
        ? createEmptyGazzaSalaRow(tableId, { keepPaidTotal: current.paid_total })
        : row,
    )
    setRows(nextRows)
    persistRows(nextRows)
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
    const nextRows = rows.map((row) =>
      Number(row.table_id) === Number(tableId)
        ? { ...row, paid_total: amount > 0 ? String(amount) : '' }
        : row,
    )
    setRows(nextRows)
    persistRows(nextRows)
  }

  function resetTableCounter(tableId) {
    const current = rows.find((r) => Number(r.table_id) === Number(tableId))
    if (!current || parseGazzaSalaAmount(current.paid_total) === 0) return
    if (!window.confirm(`Azzerare il contatore del tavolo ${tableId} a fine serata?`)) return
    const nextRows = rows.map((row) =>
      Number(row.table_id) === Number(tableId) ? { ...row, paid_total: '' } : row,
    )
    setRows(nextRows)
    persistRows(nextRows)
  }

  function markTablePaid(tableId) {
    const current = rows.find((r) => Number(r.table_id) === Number(tableId))
    if (!current) return
    appendGazzaSalaEveningHistory(date, fascia, snapshotGazzaSalaEveningEntry(current))
    // Mostra subito il verde "Pagato", poi aggiorna contatore e libera.
    const payingRows = rows.map((row) =>
      Number(row.table_id) === Number(tableId) ? { ...row, status: 'pagato' } : row,
    )
    setRows(payingRows)
    const nextTotal = addGazzaSalaPaidTotal(current.paid_total, current.paid)
    window.setTimeout(() => {
      setRows((prev) => {
        const nextRows = prev.map((row) =>
          Number(row.table_id) === Number(tableId)
            ? createEmptyGazzaSalaRow(tableId, { keepPaidTotal: nextTotal })
            : row,
        )
        persistRows(nextRows)
        return nextRows
      })
    }, 450)
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

  function onSave() {
    persistRows(rows)
  }

  function onResetSheet() {
    if (
      !window.confirm(
        `Azzerare tutti i ${GAZZA_SALA_TABLE_COUNT} tavoli per ${fasciaLabel} del ${date}?`,
      )
    ) {
      return
    }
    const nextRows = createEmptyGazzaSalaRows()
    setRows(nextRows)
    persistRows(nextRows, { markDirty: false })
  }

  function onExportExcel() {
    const aoa = gazzaSalaRowsToAoa(rows, { date, fascia })
    downloadWorkbookAsExcel({
      title: `Gazza_Ladra_Sala_${date}_${fascia}`,
      sheets: [{ name: `Sala ${fasciaLabel}`, rows: aoa }],
    })
  }

  function onOpenHistoryPdf() {
    const entries = loadGazzaSalaEveningHistory(date, fascia)
    const blob = buildGazzaSalaHistoryPdf({ date, fascia, entries })
    openGazzaSalaHistoryPdf(blob)
  }

  return (
    <div className="page">
      <header className="page-header-block" style={{ marginBottom: '1rem' }}>
        {operatorMode ? null : (
          <p className="analisi-machine-scope" style={{ marginBottom: '0.35rem' }}>
            <Link to="/gestione-locali">← Gestione locali</Link>
          </p>
        )}
        <h1 className="page-header staff-page-title">
          {operatorMode ? 'Gestione sala' : 'Gazza Ladra · Gestisci sala'}
        </h1>
      </header>

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
            <button type="button" className="btn btn-secondary btn-sm" onClick={onExportExcel}>
              Esporta Excel
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
            <strong>{formatSalaEur(totals.paid)}</strong>
          </div>
          <p
            className={[
              'gazza-sala-stat-save',
              dirty ? 'is-dirty' : savedAt ? 'is-saved' : 'is-empty',
            ].join(' ')}
          >
            {dirty
              ? 'Modifiche non salvate'
              : savedAt
                ? `Salvato ${formatSalaSavedAt(savedAt)}`
                : 'Non ancora salvato'}
          </p>
        </div>

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
              {rows.map((row) => (
                <tr
                  key={row.table_id}
                  className={['workbook-grid-row', gazzaSalaStatusRowClass(row.status)]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {GAZZA_SALA_COLUMNS.map((col) => {
                    const tdClass = col.sticky === 'left' ? 'workbook-col-sticky-left' : ''

                    if (col.readonly || !col.editable) {
                      return (
                        <td key={col.id} className={tdClass}>
                          <input
                            className={[
                              'excel-cell',
                              'pagamenti-cell-readonly',
                              col.numeric ? 'excel-cell-num' : '',
                              col.emphasis ? 'workbook-cell-emphasis' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            value={gazzaSalaCellDisplay(row, col)}
                            readOnly
                            tabIndex={-1}
                            aria-label={`${col.label} tavolo ${row.table_id}`}
                          />
                        </td>
                      )
                    }

                    if (col.inputType === 'select') {
                      return (
                        <td key={col.id} className={tdClass}>
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
                            {(col.id === 'status'
                              ? GAZZA_SALA_STATUS_SELECT_OPTIONS
                              : col.options || []
                            ).map((opt) => (
                              <option key={opt.value || 'empty'} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      )
                    }

                    return (
                      <td key={col.id} className={tdClass}>
                        <input
                          type={col.inputType === 'number' ? 'number' : 'text'}
                          step={col.step}
                          min={col.inputType === 'number' ? '0' : undefined}
                          className={['excel-cell', col.numeric ? 'excel-cell-num' : '']
                            .filter(Boolean)
                            .join(' ')}
                          value={row[col.id] ?? ''}
                          onChange={(e) => updateCell(row.table_id, col.id, e.target.value)}
                          aria-label={`${col.label} tavolo ${row.table_id}`}
                        />
                      </td>
                    )
                  })}
                  <td className="gazza-sala-actions-col">
                    <div className="gazza-sala-actions-btns">
                      <button
                        type="button"
                        className="btn btn-sm gazza-sala-conto-btn"
                        onClick={() => markTableConto(row.table_id)}
                        disabled={!canMarkConto(row)}
                        title={`Segna conto (in uscita) tavolo ${row.table_id}`}
                      >
                        Conto
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm gazza-sala-paid-btn"
                        onClick={() => markTablePaid(row.table_id)}
                        disabled={!canMarkPaid(row)}
                        title={`Segna pagato tavolo ${row.table_id}`}
                      >
                        Pagato
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm gazza-sala-clear-btn"
                        onClick={() => clearTableRow(row.table_id)}
                        disabled={!gazzaSalaRowHasData(row)}
                        title={`Cancella prenotazione, clienti e fattura del tavolo ${row.table_id}. Il contatore resta.`}
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
                  </td>
                </tr>
              ))}
              <tr className="workbook-row-totals gazza-sala-totals-row">
                {GAZZA_SALA_COLUMNS.map((col) => (
                  <td
                    key={`tot-${col.id}`}
                    className={[
                      col.sticky === 'left' ? 'workbook-col-sticky-left' : '',
                      'pagamenti-hl-yellow',
                    ]
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
      </section>
    </div>
  )
}
