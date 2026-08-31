import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { downloadWorkbookAsExcel } from '../utils/pagamentiExcel.js'
import {
  GAZZA_SALA_COLUMNS,
  GAZZA_SALA_FASCE,
  GAZZA_SALA_TABLE_COUNT,
  GAZZA_SALA_WORKBOOK_TITLE,
  createEmptyGazzaSalaRows,
  gazzaSalaCellDisplay,
  gazzaSalaResidual,
  gazzaSalaRowsToAoa,
  gazzaSalaStorageKey,
  gazzaSalaTotals,
  gazzaSalaTotalsLabel,
  normalizeGazzaSalaRows,
  residualToneClass,
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

function todayIsoDate() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Sala Gazza Ladra: griglia Excel 15 tavoli (giallo / verde). */
export function GazzaLadraSalaPage() {
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

  function updateCell(tableId, field, value) {
    setRows((prev) =>
      prev.map((row) => (row.table_id === tableId ? { ...row, [field]: value } : row)),
    )
    setDirty(true)
  }

  function onSave() {
    try {
      const payload = {
        date,
        fascia,
        tables: rows,
        savedAt: new Date().toISOString(),
      }
      localStorage.setItem(gazzaSalaStorageKey(date, fascia), JSON.stringify(payload))
      setSavedAt(payload.savedAt)
      setDirty(false)
    } catch {
      /* ignore quota */
    }
  }

  function onResetSheet() {
    if (
      !window.confirm(
        `Azzerare tutti i ${GAZZA_SALA_TABLE_COUNT} tavoli per ${fasciaLabel} del ${date}?`,
      )
    ) {
      return
    }
    setRows(createEmptyGazzaSalaRows())
    setDirty(true)
  }

  function onExportExcel() {
    const aoa = gazzaSalaRowsToAoa(rows, { date, fascia })
    downloadWorkbookAsExcel({
      title: `Gazza_Ladra_Sala_${date}_${fascia}`,
      sheets: [{ name: `Sala ${fasciaLabel}`, rows: aoa }],
    })
  }

  return (
    <div className="page">
      <header className="page-header-block" style={{ marginBottom: '1rem' }}>
        <p className="analisi-machine-scope" style={{ marginBottom: '0.35rem' }}>
          <Link to="/gestione-locali">← Gestione locali</Link>
        </p>
        <h1 className="page-header staff-page-title">Gazza Ladra · Gestisci sala</h1>
        <p className="page-lead" style={{ maxWidth: '48rem' }}>
          Modello Excel della sala ({GAZZA_SALA_TABLE_COUNT} tavoli): ID tavolo, clienti, menu,
          conti e pagamenti. Intestazione <strong>verde</strong>, righe dati bianche, riga totali{' '}
          <strong>gialla</strong>. Salvataggio sul dispositivo finché non c’è API / POS Poste.
        </p>
      </header>

      <section className="card pagamenti-workbook-card">
        <div className="pagamenti-workbook-toolbar" style={{ flexWrap: 'wrap', gap: '0.65rem' }}>
          <div className="pagamenti-workbook-toolbar-left" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
            <span className="pagamenti-workbook-title">{GAZZA_SALA_WORKBOOK_TITLE}</span>
            <span className="pagamenti-workbook-sheet-label">
              {fasciaLabel} · {date}
            </span>
            <label className="analisi-machine-scope" style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center' }}>
              Data
              <input
                className="form-control"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={{ width: 'auto', minWidth: '9.5rem' }}
              />
            </label>
            <div className="analisi-panel-actions" role="group" aria-label="Fascia">
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
          <div className="analisi-panel-actions" style={{ marginLeft: 'auto' }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onExportExcel}>
              Esporta Excel
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onResetSheet}>
              Azzera foglio
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={onSave}>
              Salva foglio
            </button>
          </div>
        </div>

        <p className="analisi-machine-scope" role="status" style={{ padding: '0 0.85rem 0.35rem' }}>
          Coperti: <strong>{totals.clients}</strong>
          {' · '}
          Conti: <strong>{totals.bill ? totals.bill.toLocaleString('it-IT', { minimumFractionDigits: 2 }) : '0,00'} €</strong>
          {' · '}
          Importo pagamenti: <strong>{totals.paid ? totals.paid.toLocaleString('it-IT', { minimumFractionDigits: 2 }) : '0,00'} €</strong>
          {' · '}
          Residuo: <strong>{totals.residual.toLocaleString('it-IT', { minimumFractionDigits: 2 })} €</strong>
          {savedAt
            ? ` · salvato ${new Date(savedAt).toLocaleString('it-IT')}`
            : ' · non ancora salvato'}
          {dirty ? ' · modifiche non salvate' : ''}
        </p>

        <div className="pagamenti-grid-wrap excel-wrap workbook-grid-wrap gazza-sala-grid-wrap">
          <table className="app-table excel-table pagamenti-grid workbook-grid gazza-sala-grid">
            <colgroup>
              {GAZZA_SALA_COLUMNS.map((col) => (
                <col key={col.id} style={{ width: `${col.width}%` }} />
              ))}
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
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.table_id} className="workbook-grid-row">
                  {GAZZA_SALA_COLUMNS.map((col) => {
                    const tdClass = col.sticky === 'left' ? 'workbook-col-sticky-left' : ''

                    if (col.readonly || !col.editable) {
                      const residual = col.id === 'residual' ? residualToneClass(row) : ''
                      return (
                        <td key={col.id} className={tdClass}>
                          <input
                            className={[
                              'excel-cell',
                              'pagamenti-cell-readonly',
                              col.numeric ? 'excel-cell-num' : '',
                              col.emphasis ? 'workbook-cell-emphasis' : '',
                              residual,
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            value={gazzaSalaCellDisplay(row, col)}
                            readOnly
                            tabIndex={-1}
                            aria-label={`${col.label} tavolo ${row.table_id}`}
                            title={
                              col.id === 'residual' && gazzaSalaResidual(row) != null
                                ? `Conto − pagato = ${gazzaSalaCellDisplay(row, col)} €`
                                : undefined
                            }
                          />
                        </td>
                      )
                    }

                    if (col.inputType === 'select') {
                      return (
                        <td key={col.id} className={tdClass}>
                          <select
                            className="excel-cell excel-cell-select"
                            value={row[col.id] ?? ''}
                            onChange={(e) => updateCell(row.table_id, col.id, e.target.value)}
                            aria-label={`${col.label} tavolo ${row.table_id}`}
                          >
                            {(col.options || []).map((opt) => (
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
                          placeholder={col.id === 'menu' ? 'es. menù degustazione' : undefined}
                        />
                      </td>
                    )
                  })}
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
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <p className="analisi-note" style={{ marginTop: '0.85rem', maxWidth: '48rem' }}>
        Ogni fascia (pranzo / cena) ha un foglio separato con i {GAZZA_SALA_TABLE_COUNT} tavoli.
        Usa <em>Esporta Excel</em> per scaricare il modello compilato; il salvataggio in app resta
        locale al browser.
      </p>
    </div>
  )
}
