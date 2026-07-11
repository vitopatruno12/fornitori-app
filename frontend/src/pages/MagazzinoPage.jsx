import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import QuickProductPicker from '../components/QuickProductPicker.jsx'
import {
  WAREHOUSE_DESTINATION_OPTIONS,
  WAREHOUSE_SOURCE_LABEL,
  warehouseDestinationOptionsWithCurrent,
} from '../constants/warehouseDestinations.js'
import {
  createWarehouseMovement,
  deleteWarehouseMovement,
  fetchWarehouseMovements,
} from '../services/warehouseService.js'
import {
  WAREHOUSE_MOVEMENTS_COLUMNS,
  WAREHOUSE_MOVEMENTS_WORKBOOK_TITLE,
  warehouseMovementCellValue,
  warehouseMovementTypeTone,
  warehouseMovementsTotals,
  warehouseMovementsTotalsLabel,
} from '../utils/warehouseMovementsWorkbook.js'

const WAREHOUSE_OPERATOR_LS = 'atlas_warehouse_operator_v1'
const WAREHOUSE_SIGNATURE_LS = 'atlas_warehouse_signature_v1'

const MERCHANDISE_CONDITIONS = [
  'Fresco',
  'Refrigerato',
  'Surgelato',
  'Secco',
  'In scadenza',
  'Danneggiato',
  'Altro',
]

function pad2(n) {
  return String(n).padStart(2, '0')
}

function localDatetimeInputValue(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function localDatetimeInputToIso(value) {
  if (!value) return new Date().toISOString()
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

function formatDateTimeIt(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function readStored(key) {
  try {
    return localStorage.getItem(key) || ''
  } catch {
    return ''
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore
  }
}

export default function MagazzinoPage({ operatorMode = false, onBackToDelivery }) {
  const navigate = useNavigate()
  const [operatorName, setOperatorName] = useState(() => readStored(WAREHOUSE_OPERATOR_LS))
  const [signature, setSignature] = useState(() => readStored(WAREHOUSE_SIGNATURE_LS))
  const [movements, setMovements] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterDate, setFilterDate] = useState(todayIso())
  const [filterDestination, setFilterDestination] = useState('')
  const [movementEditor, setMovementEditor] = useState(null)

  const movementTotals = useMemo(() => warehouseMovementsTotals(movements), [movements])

  const refreshMovements = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchWarehouseMovements({
        location: filterDestination || undefined,
        movementType: filterType === 'in' || filterType === 'out' ? filterType : undefined,
        dateFrom: filterDate || undefined,
        dateTo: filterDate || undefined,
        limit: 300,
      })
      setMovements(Array.isArray(data) ? data : [])
    } catch {
      setError('Impossibile caricare i movimenti di magazzino')
    } finally {
      setLoading(false)
    }
  }, [filterType, filterDate, filterDestination])

  useEffect(() => {
    void refreshMovements()
  }, [refreshMovements])

  useEffect(() => {
    writeStored(WAREHOUSE_OPERATOR_LS, operatorName)
  }, [operatorName])

  useEffect(() => {
    writeStored(WAREHOUSE_SIGNATURE_LS, signature)
  }, [signature])

  const canRegister = useMemo(
    () => Boolean(operatorName.trim() && signature.trim()),
    [operatorName, signature],
  )

  function openMovementEditor(product) {
    if (!canRegister) {
      setError('Inserisci nome operatore e firma prima di prelevare o registrare merce')
      return
    }
    setError('')
    setMovementEditor({
      product,
      movementType: 'out',
      destination: WAREHOUSE_DESTINATION_OPTIONS[0]?.value || '',
      movementAt: localDatetimeInputValue(),
      pieces: '',
      weight_kg: '',
      volume_liters: '',
      merchandiseCondition: MERCHANDISE_CONDITIONS[0],
      note: '',
    })
  }

  function closeMovementEditor() {
    setMovementEditor(null)
  }

  function updateMovementEditorField(field, value) {
    setMovementEditor((prev) => (prev ? { ...prev, [field]: value } : prev))
  }

  async function saveMovementEditor() {
    if (!movementEditor) return
    const product = (movementEditor.product || '').trim()
    if (!product) return
    if (!operatorName.trim()) {
      setError('Inserisci il nome operatore')
      return
    }
    if (!signature.trim()) {
      setError('Inserisci la firma')
      return
    }
    const isOut = movementEditor.movementType !== 'in'
    const destination = (movementEditor.destination || '').trim()
    if (isOut && !destination) {
      setError('Seleziona la sede di destinazione')
      return
    }
    const hasPieces =
      movementEditor.pieces !== '' &&
      movementEditor.pieces != null &&
      !Number.isNaN(Number(movementEditor.pieces))
    const hasKg =
      movementEditor.weight_kg !== '' &&
      movementEditor.weight_kg != null &&
      !Number.isNaN(Number(movementEditor.weight_kg))
    const hasLiters =
      movementEditor.volume_liters !== '' &&
      movementEditor.volume_liters != null &&
      !Number.isNaN(Number(movementEditor.volume_liters))
    const note = String(movementEditor.note || '').trim()
    if (!hasPieces && !hasKg && !hasLiters && !note) {
      setError('Inserisci almeno pezzi, kg, litri o una nota')
      return
    }
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await createWarehouseMovement({
        movement_type: movementEditor.movementType === 'in' ? 'in' : 'out',
        movement_at: localDatetimeInputToIso(movementEditor.movementAt),
        operator_name: operatorName.trim(),
        signature: signature.trim(),
        product_description: product,
        pieces: hasPieces ? Number(movementEditor.pieces) : null,
        weight_kg: hasKg ? Number(movementEditor.weight_kg) : null,
        volume_liters: hasLiters ? Number(movementEditor.volume_liters) : null,
        merchandise_condition: movementEditor.merchandiseCondition || null,
        location: isOut ? destination : WAREHOUSE_SOURCE_LABEL,
        note: note || null,
      })
      closeMovementEditor()
      setSuccess(
        movementEditor.movementType === 'in'
          ? `Entrata magazzino registrata: ${product}`
          : `Uscita verso ${destination}: ${product}`,
      )
      await refreshMovements()
    } catch (err) {
      setError(err?.message || 'Registrazione movimento non riuscita')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteMovement(row) {
    if (!window.confirm(`Eliminare il movimento del ${formatDateTimeIt(row.movement_at)} (${row.product_description})?`)) {
      return
    }
    setError('')
    try {
      await deleteWarehouseMovement(row.id)
      setSuccess('Movimento eliminato')
      await refreshMovements()
    } catch {
      setError('Eliminazione non riuscita')
    }
  }

  function handleBack() {
    if (operatorMode && onBackToDelivery) {
      onBackToDelivery()
      return
    }
    navigate('/new-delivery')
  }

  return (
    <div>
      <section className="staff-page-hero">
        <div className="delivery-hero-row">
          <div className="delivery-hero-copy">
            <h1 className="page-header staff-page-title">Magazzino</h1>
            <p className="staff-page-lead">
              Registra <strong>entrata</strong> e <strong>uscita</strong> merce dal magazzino. Per le uscite indica la{' '}
              <strong>sede di destinazione</strong>, quantità, condizione della merce, operatore e firma.
            </p>
          </div>
          <button type="button" className="btn btn-secondary delivery-hero-action-btn" onClick={handleBack}>
            ← Nuova consegna
          </button>
        </div>
      </section>

      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <section className="card" style={{ marginBottom: '1rem' }}>
        <h2 className="page-subheader" style={{ marginTop: 0 }}>
          Operatore
        </h2>
        <div className="form-row">
          <div className="form-group" style={{ flex: '1 1 240px' }}>
            <label htmlFor="warehouse-operator-name">Nome operatore *</label>
            <input
              id="warehouse-operator-name"
              className="form-control"
              value={operatorName}
              onChange={(e) => setOperatorName(e.target.value)}
              placeholder="Chi preleva / registra la merce"
            />
          </div>
          <div className="form-group" style={{ flex: '1 1 240px' }}>
            <label htmlFor="warehouse-signature">Firma *</label>
            <input
              id="warehouse-signature"
              className="form-control"
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              placeholder="Nome e cognome (firma)"
            />
          </div>
        </div>
        {!canRegister && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 0 }}>
            Compila operatore e firma per abilitare i pulsanti prodotto.
          </p>
        )}
      </section>

      <section className="card" style={{ marginBottom: '1rem' }}>
        <h2 className="page-subheader" style={{ marginTop: 0 }}>
          Prodotti
        </h2>
        <QuickProductPicker disabled={!canRegister || saving} onSelect={openMovementEditor} />
      </section>

      <section className="card pagamenti-workbook-card suppliers-workbook-card">
        <div className="pagamenti-workbook-toolbar">
          <div className="pagamenti-workbook-toolbar-left">
            <span className="pagamenti-workbook-title">{WAREHOUSE_MOVEMENTS_WORKBOOK_TITLE}</span>
            <span className="pagamenti-workbook-sheet-label">
              {movements.length} movimenti
            </span>
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Giorno</label>
              <input
                type="date"
                className="form-control"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Tipo</label>
              <select className="form-control" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                <option value="">Tutti</option>
                <option value="in">Entrata</option>
                <option value="out">Uscita</option>
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Sede</label>
              <select
                className="form-control"
                value={filterDestination}
                onChange={(e) => setFilterDestination(e.target.value)}
              >
                <option value="">Tutte</option>
                <option value={WAREHOUSE_SOURCE_LABEL}>{WAREHOUSE_SOURCE_LABEL}</option>
                {WAREHOUSE_DESTINATION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {loading && <p className="loading pagamenti-loading">Caricamento movimenti…</p>}
        {!loading && (
          <div className="pagamenti-grid-wrap excel-wrap workbook-grid-wrap">
            <table className="app-table excel-table pagamenti-grid workbook-grid warehouse-movements-grid">
              <colgroup>
                {WAREHOUSE_MOVEMENTS_COLUMNS.map((col) => (
                  <col key={col.id} style={{ minWidth: col.width }} />
                ))}
                <col style={{ minWidth: 110 }} />
              </colgroup>
              <thead>
                <tr>
                  {WAREHOUSE_MOVEMENTS_COLUMNS.map((col) => (
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
                  <th className="sup-actions-col">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((row, rowIndex) => (
                  <tr key={row.id} className="workbook-grid-row">
                    {WAREHOUSE_MOVEMENTS_COLUMNS.map((col) => (
                      <td
                        key={col.id}
                        className={col.sticky === 'left' ? 'workbook-col-sticky-left' : ''}
                      >
                        <input
                          className={[
                            'excel-cell',
                            'pagamenti-cell-readonly',
                            col.numeric ? 'excel-cell-num' : '',
                            col.emphasis ? 'workbook-cell-emphasis' : '',
                            col.id === 'movement_type' ? warehouseMovementTypeTone(row.movement_type) : '',
                          ].filter(Boolean).join(' ')}
                          value={warehouseMovementCellValue(row, col, { rowIndex })}
                          readOnly
                          tabIndex={-1}
                          aria-label={`${col.label} movimento ${rowIndex + 1}`}
                        />
                      </td>
                    ))}
                    <td className="sup-actions-col">
                      <div className="sup-actions-btns">
                        <button
                          type="button"
                          className="btn btn-outline-danger btn-sm"
                          onClick={() => void handleDeleteMovement(row)}
                        >
                          Elimina
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {movements.length === 0 ? (
                  <tr>
                    <td colSpan={WAREHOUSE_MOVEMENTS_COLUMNS.length + 1} className="empty-state">
                      Nessun movimento per i filtri selezionati.
                    </td>
                  </tr>
                ) : (
                  <tr className="workbook-row-totals">
                    {WAREHOUSE_MOVEMENTS_COLUMNS.map((col) => (
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
                          ].filter(Boolean).join(' ')}
                          value={warehouseMovementsTotalsLabel(col.id, movementTotals)}
                          readOnly
                          tabIndex={-1}
                        />
                      </td>
                    ))}
                    <td className="sup-actions-col" />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {movementEditor && (
        <div className="staff-report-modal-backdrop" role="presentation" onClick={closeMovementEditor}>
          <div
            className="card staff-report-modal order-line-editor-modal warehouse-movement-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="warehouse-movement-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="warehouse-movement-title" className="page-subheader" style={{ marginTop: 0 }}>
              {movementEditor.movementType === 'in' ? 'Entrata' : 'Uscita'}: {movementEditor.product}
            </h3>
            <div className="form-row" style={{ marginBottom: '0.75rem' }}>
              <div className="form-group" style={{ flex: '1 1 140px', marginBottom: 0 }}>
                <label htmlFor="warehouse-move-type">Movimento</label>
                <select
                  id="warehouse-move-type"
                  className="form-control"
                  value={movementEditor.movementType}
                  onChange={(e) => {
                    const nextType = e.target.value
                    setMovementEditor((prev) => {
                      if (!prev) return prev
                      if (nextType === 'in') {
                        return { ...prev, movementType: nextType, destination: WAREHOUSE_SOURCE_LABEL }
                      }
                      const dest =
                        prev.destination && prev.destination !== WAREHOUSE_SOURCE_LABEL
                          ? prev.destination
                          : WAREHOUSE_DESTINATION_OPTIONS[0]?.value || ''
                      return { ...prev, movementType: nextType, destination: dest }
                    })
                  }}
                >
                  <option value="out">Uscita (prelievo)</option>
                  <option value="in">Entrata</option>
                </select>
              </div>
              <div className="form-group" style={{ flex: '1 1 200px', marginBottom: 0 }}>
                <label htmlFor="warehouse-move-at">Data e ora</label>
                <input
                  id="warehouse-move-at"
                  type="datetime-local"
                  className="form-control"
                  value={movementEditor.movementAt}
                  onChange={(e) => updateMovementEditorField('movementAt', e.target.value)}
                />
              </div>
            </div>
            {movementEditor.movementType === 'out' ? (
              <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                <label htmlFor="warehouse-move-destination">Sede destinazione *</label>
                <select
                  id="warehouse-move-destination"
                  className="form-control"
                  value={movementEditor.destination || ''}
                  onChange={(e) => updateMovementEditorField('destination', e.target.value)}
                >
                  {warehouseDestinationOptionsWithCurrent(movementEditor.destination).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 0, marginBottom: '0.75rem' }}>
                Destinazione: <strong>{WAREHOUSE_SOURCE_LABEL}</strong> (entrata in magazzino)
              </p>
            )}
            <div className="form-row" style={{ marginBottom: '0.75rem' }}>
              <div className="form-group" style={{ flex: '1 1 90px', marginBottom: 0 }}>
                <label htmlFor="warehouse-move-pcs">Pezzi</label>
                <input
                  id="warehouse-move-pcs"
                  type="number"
                  min="0"
                  className="form-control"
                  value={movementEditor.pieces}
                  onChange={(e) => updateMovementEditorField('pieces', e.target.value)}
                  placeholder="opz."
                />
              </div>
              <div className="form-group" style={{ flex: '1 1 90px', marginBottom: 0 }}>
                <label htmlFor="warehouse-move-kg">Kg</label>
                <input
                  id="warehouse-move-kg"
                  type="number"
                  min="0"
                  step="0.001"
                  className="form-control"
                  value={movementEditor.weight_kg}
                  onChange={(e) => updateMovementEditorField('weight_kg', e.target.value)}
                  placeholder="opz."
                />
              </div>
              <div className="form-group" style={{ flex: '1 1 90px', marginBottom: 0 }}>
                <label htmlFor="warehouse-move-lit">Litri</label>
                <input
                  id="warehouse-move-lit"
                  type="number"
                  min="0"
                  step="0.001"
                  className="form-control"
                  value={movementEditor.volume_liters}
                  onChange={(e) => updateMovementEditorField('volume_liters', e.target.value)}
                  placeholder="opz."
                />
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: '0.75rem' }}>
              <label htmlFor="warehouse-move-condition">Condizione merce</label>
              <select
                id="warehouse-move-condition"
                className="form-control"
                value={movementEditor.merchandiseCondition}
                onChange={(e) => updateMovementEditorField('merchandiseCondition', e.target.value)}
              >
                {MERCHANDISE_CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: '1rem' }}>
              <label htmlFor="warehouse-move-note">Note</label>
              <input
                id="warehouse-move-note"
                className="form-control"
                value={movementEditor.note}
                onChange={(e) => updateMovementEditorField('note', e.target.value)}
                placeholder="opzionale"
              />
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '-0.35rem', marginBottom: '1rem' }}>
              Operatore: <strong>{operatorName || '—'}</strong> · Firma: <strong>{signature || '—'}</strong>
            </p>
            <div className="btn-group" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void saveMovementEditor()}>
                {saving ? 'Salvataggio…' : 'Registra movimento'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={closeMovementEditor}>
                Annulla
              </button>
            </div>
          </div>
        </div>
      )}

      {!operatorMode && (
        <p style={{ marginTop: '1rem', fontSize: '0.88rem' }}>
          <Link to="/new-delivery">← Torna a Nuova consegna</Link>
        </p>
      )}
    </div>
  )
}
