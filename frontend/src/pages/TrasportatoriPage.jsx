import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  createCarrier,
  createCarrierFuel,
  createCarrierMaintenance,
  createCarrierOtherExpense,
  deleteCarrier,
  deleteCarrierFuel,
  deleteCarrierMaintenance,
  deleteCarrierOtherExpense,
  fetchCarrier,
  fetchCarriers,
  setCarrierInService,
  updateCarrier,
} from '../services/carriersService'
import { AnalisiLoadingBar } from '../components/AnalisiShared.jsx'
import {
  COURIER_WEEKDAY_OPTIONS,
  getCourierTrafficStatus,
  getRestDayLabel,
  isCourierRestDayToday,
} from '../utils/orderCourierContact.js'
import CarrierAttributeTable from '../components/CarrierAttributeTable.jsx'
import {
  CARRIER_FUEL_COLUMNS,
  CARRIER_FUEL_WORKBOOK_TITLE,
  CARRIER_MAINTENANCE_COLUMNS,
  CARRIER_MAINTENANCE_WORKBOOK_TITLE,
  CARRIER_OTHER_COLUMNS,
  CARRIER_OTHER_WORKBOOK_TITLE,
  carrierFuelCellValue,
  carrierMaintenanceCellValue,
  carrierOtherCellValue,
} from '../utils/carriersWorkbook.js'

const emptyForm = () => ({
  name: '',
  phone: '',
  email: '',
  is_active: true,
  out_of_service: false,
  in_service: false,
  rest_day: '',
  van_label: '',
  van_plate: '',
  notes: '',
})

function toYmd(d = new Date()) {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

function mapCarrierForStatus(c) {
  return {
    enabled: c?.is_active !== false,
    outOfService: Boolean(c?.out_of_service),
    inService: Boolean(c?.in_service),
    restDay: c?.rest_day,
  }
}

const TRAFFIC = { green: '#16a34a', yellow: '#ca8a04', red: '#dc2626' }

export default function TrasportatoriPage({ operatorMode = false }) {
  const [list, setList] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)

  const emptyMaintDraft = () => ({
    service_date: toYmd(),
    description: '',
    odometer_km: '',
  })
  const emptyFuelDraft = () => ({
    expense_date: toYmd(),
    liters: '',
    amount_eur: '',
  })
  const emptyOtherDraft = () => ({
    expense_date: toYmd(),
    description: '',
    amount_eur: '',
  })

  const [maintDraft, setMaintDraft] = useState(emptyMaintDraft)
  const [fuelDraft, setFuelDraft] = useState(emptyFuelDraft)
  const [otherDraft, setOtherDraft] = useState(emptyOtherDraft)

  const loadList = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const rows = await fetchCarriers()
      setList(Array.isArray(rows) ? rows : [])
    } catch (e) {
      setError(e?.message || 'Errore caricamento trasportatori')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadDetail = useCallback(async (id) => {
    if (!id) {
      setDetail(null)
      return
    }
    setDetailLoading(true)
    try {
      const row = await fetchCarrier(id)
      setDetail(row)
    } catch (e) {
      setError(e?.message || 'Errore dettaglio trasportatore')
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    loadList()
  }, [loadList])

  useEffect(() => {
    if (selectedId) loadDetail(selectedId)
    else setDetail(null)
  }, [selectedId, loadDetail])

  useEffect(() => {
    setMaintDraft(emptyMaintDraft())
    setFuelDraft(emptyFuelDraft())
    setOtherDraft(emptyOtherDraft())
  }, [selectedId])

  const selectedStatus = useMemo(() => {
    const src = detail || list.find((c) => String(c.id) === String(selectedId))
    return src ? getCourierTrafficStatus(mapCarrierForStatus(src)) : null
  }, [detail, list, selectedId])

  const formRestingToday = useMemo(
    () => isCourierRestDayToday({ restDay: form.rest_day === '' ? null : Number(form.rest_day) }),
    [form.rest_day],
  )

  const formRestDayLabel = useMemo(() => getRestDayLabel(form.rest_day), [form.rest_day])

  const dashboardStats = useMemo(() => {
    let green = 0
    let yellow = 0
    let red = 0
    for (const carrier of list) {
      const status = getCourierTrafficStatus(mapCarrierForStatus(carrier))
      if (status.color === 'green') green += 1
      else if (status.color === 'yellow') yellow += 1
      else red += 1
    }
    return { total: list.length, green, yellow, red }
  }, [list])

  const maintenanceRows = detail?.maintenance_logs || []
  const fuelRows = detail?.fuel_expenses || []
  const otherRows = detail?.other_expenses || []

  function startCreate() {
    setEditingId(null)
    setForm(emptyForm())
    setSelectedId('')
    setSuccess('')
    setError('')
  }

  function startEdit(row) {
    setEditingId(row.id)
    setSelectedId(String(row.id))
    setForm({
      name: row.name || '',
      phone: row.phone || '',
      email: row.email || '',
      is_active: row.is_active !== false,
      out_of_service: Boolean(row.out_of_service),
      in_service: Boolean(row.in_service),
      rest_day: row.rest_day == null ? '' : String(row.rest_day),
      van_label: row.van_label || '',
      van_plate: row.van_plate || '',
      notes: row.notes || '',
    })
    setSuccess('')
    setError('')
  }

  async function handleSaveAnagrafica(e) {
    e.preventDefault()
    if (!form.name.trim()) {
      setError('Inserisci il nome del trasportatore')
      return
    }
    setSaving(true)
    setError('')
    setSuccess('')
    const restingToday = isCourierRestDayToday({ restDay: form.rest_day === '' ? null : Number(form.rest_day) })
    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      is_active: form.out_of_service ? false : Boolean(form.is_active),
      out_of_service: Boolean(form.out_of_service),
      in_service: restingToday || form.out_of_service || !form.is_active ? false : Boolean(form.in_service),
      rest_day: form.rest_day === '' ? null : Number(form.rest_day),
      van_label: form.van_label.trim() || null,
      van_plate: form.van_plate.trim() || null,
      notes: form.notes.trim() || null,
    }
    try {
      if (editingId) {
        const updated = await updateCarrier(editingId, payload)
        setSuccess('Trasportatore aggiornato')
        await loadList()
        setSelectedId(String(updated.id))
        startEdit(updated)
      } else {
        const created = await createCarrier(payload)
        setSuccess('Trasportatore creato')
        await loadList()
        setSelectedId(String(created.id))
        startEdit(created)
      }
    } catch (err) {
      setError(err?.message || 'Errore salvataggio')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Eliminare questo trasportatore e tutte le schede/spese collegate?')) return
    try {
      await deleteCarrier(id)
      setSuccess('Trasportatore eliminato')
      if (String(selectedId) === String(id)) {
        setSelectedId('')
        setEditingId(null)
        setForm(emptyForm())
        setDetail(null)
      }
      await loadList()
    } catch (err) {
      setError(err?.message || 'Errore eliminazione')
    }
  }

  async function handleToggleInService(id, value) {
    try {
      await setCarrierInService(id, value)
      await loadList()
      if (String(selectedId) === String(id)) await loadDetail(id)
      setSuccess(value ? 'Impostato in servizio' : 'Rimosso da in servizio')
    } catch (err) {
      setError(err?.message || 'Errore aggiornamento servizio')
    }
  }

  async function addMaintenance() {
    if (!selectedId || !maintDraft.description.trim()) {
      setError('Inserisci la descrizione manutenzione')
      return
    }
    try {
      await createCarrierMaintenance(Number(selectedId), {
        service_date: maintDraft.service_date,
        description: maintDraft.description.trim(),
        odometer_km: maintDraft.odometer_km === '' ? null : Number(maintDraft.odometer_km),
      })
      setMaintDraft(emptyMaintDraft())
      await loadDetail(selectedId)
      setSuccess('Manutenzione aggiunta')
      setError('')
    } catch (err) {
      setError(err?.message || 'Errore manutenzione')
    }
  }

  async function addFuel() {
    if (!selectedId) return
    if (fuelDraft.amount_eur === '') {
      setError('Inserisci importo carburante')
      return
    }
    try {
      await createCarrierFuel(Number(selectedId), {
        expense_date: fuelDraft.expense_date,
        amount_eur: Number(fuelDraft.amount_eur),
        liters: fuelDraft.liters === '' ? null : Number(fuelDraft.liters),
      })
      setFuelDraft(emptyFuelDraft())
      await loadDetail(selectedId)
      setSuccess('Spesa carburante aggiunta')
      setError('')
    } catch (err) {
      setError(err?.message || 'Errore carburante')
    }
  }

  async function addOther() {
    if (!selectedId || otherDraft.amount_eur === '') {
      setError('Inserisci importo spesa')
      return
    }
    try {
      await createCarrierOtherExpense(Number(selectedId), {
        expense_date: otherDraft.expense_date,
        amount_eur: Number(otherDraft.amount_eur),
        description: otherDraft.description.trim() || null,
      })
      setOtherDraft(emptyOtherDraft())
      await loadDetail(selectedId)
      setSuccess('Spesa aggiunta')
      setError('')
    } catch (err) {
      setError(err?.message || 'Errore spesa')
    }
  }

  return (
    <div className="carriers-page">
      <section className="staff-page-hero">
        <div className="delivery-hero-row">
          <div className="delivery-hero-copy">
            <h1 className="page-header staff-page-title">Trasportatori</h1>
            <p className="staff-page-lead">
              {operatorMode ? (
                <>
                  Anagrafica, disponibilità, furgone, manutenzione e spese. Lo stato «In servizio» vale per{' '}
                  <strong>Nuovo ordine</strong> e consegne dalla stessa postazione operativa.
                </>
              ) : (
                <>
                  Anagrafica, disponibilità, furgone, manutenzione e spese. L&apos;attivo/non attivo qui regola{' '}
                  <Link to="/new-order">Nuovo ordine</Link> e <Link to="/new-delivery">Nuova consegna</Link>.
                </>
              )}
            </p>
          </div>
          <button type="button" className="btn btn-secondary delivery-hero-action-btn" onClick={startCreate}>
            + Nuovo trasportatore
          </button>
        </div>
      </section>

      {loading && <AnalisiLoadingBar active label="Caricamento trasportatori" variant="subtle" />}
      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}
      <section className="card carriers-kpi-card">
        <div className="carriers-kpi-grid">
          <div className="carriers-kpi">
            <div className="carriers-kpi-label">Totale trasportatori</div>
            <div className="carriers-kpi-value">{dashboardStats.total}</div>
          </div>
          <div className="carriers-kpi carriers-kpi--green">
            <div className="carriers-kpi-label" style={{ color: TRAFFIC.green }}>Verde · in servizio</div>
            <div className="carriers-kpi-value" style={{ color: TRAFFIC.green }}>{dashboardStats.green}</div>
          </div>
          <div className="carriers-kpi carriers-kpi--yellow">
            <div className="carriers-kpi-label" style={{ color: TRAFFIC.yellow }}>Giallo · disponibile</div>
            <div className="carriers-kpi-value" style={{ color: TRAFFIC.yellow }}>{dashboardStats.yellow}</div>
          </div>
          <div className="carriers-kpi carriers-kpi--red">
            <div className="carriers-kpi-label" style={{ color: TRAFFIC.red }}>Rosso · non operativo</div>
            <div className="carriers-kpi-value" style={{ color: TRAFFIC.red }}>{dashboardStats.red}</div>
          </div>
        </div>
      </section>

      <div className="carriers-layout">
        <section className="card carriers-list-panel">
          <h2 className="page-subheader" style={{ marginTop: 0 }}>Elenco</h2>
          {!list.length && !loading ? (
            <p className="empty-state">Nessun trasportatore. Creane uno.</p>
          ) : (
            <ul className="carriers-list">
              {list.map((c) => {
                const st = getCourierTrafficStatus(mapCarrierForStatus(c))
                const active = String(selectedId) === String(c.id)
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={`btn btn-sm carriers-list-btn ${active ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => startEdit(c)}
                    >
                      <span className="carriers-list-name">{c.name}</span>
                      <span className="carriers-list-status" style={{ color: TRAFFIC[st.color] }}>{st.label}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <div className="carriers-detail-panel">
          <section className="card">
            <div className="carriers-detail-header">
              <h2 className="page-subheader" style={{ marginTop: 0, marginBottom: 0 }}>
                {editingId ? 'Modifica anagrafica' : 'Nuovo trasportatore'}
              </h2>
              {selectedStatus ? (
                <span style={{ fontWeight: 700, color: TRAFFIC[selectedStatus.color] }}>{selectedStatus.label}</span>
              ) : null}
            </div>
            <form onSubmit={handleSaveAnagrafica} style={{ marginTop: '0.75rem' }}>
              <div className="form-row" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
                <div className="form-group" style={{ flex: '1 1 200px' }}>
                  <label>Nome *</label>
                  <input className="form-control" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="form-group" style={{ flex: '1 1 140px' }}>
                  <label>Telefono</label>
                  <input className="form-control" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
                </div>
                <div className="form-group" style={{ flex: '1 1 180px' }}>
                  <label>Email</label>
                  <input type="email" className="form-control" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
                </div>
              </div>
              <div className="form-row" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
                <div className="form-group" style={{ flex: '1 1 160px' }}>
                  <label>Furgone</label>
                  <input className="form-control" value={form.van_label} onChange={(e) => setForm((f) => ({ ...f, van_label: e.target.value }))} placeholder="modello / descrizione" />
                </div>
                <div className="form-group" style={{ flex: '1 1 120px' }}>
                  <label>Targa</label>
                  <input className="form-control" value={form.van_plate} onChange={(e) => setForm((f) => ({ ...f, van_plate: e.target.value }))} />
                </div>
                <div className="form-group" style={{ flex: '1 1 160px' }}>
                  <label>Giorno di riposo</label>
                  <select className="form-control" value={form.rest_day} onChange={(e) => setForm((f) => ({ ...f, rest_day: e.target.value }))}>
                    <option value="">Nessuno</option>
                    {COURIER_WEEKDAY_OPTIONS.map((d) => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-row carriers-flags-row">
                {formRestingToday ? (
                  <p className="alert alert-warning" style={{ flex: '1 1 100%', margin: 0, fontSize: '0.86rem' }}>
                    Oggi è giorno di riposo{formRestDayLabel ? ` (${formRestDayLabel})` : ''}: il trasportatore compare come{' '}
                    <strong>Riposo</strong> e non può andare «In servizio». Domani torna disponibile automaticamente.{' '}
                    <strong>Fuori servizio</strong> è un’impostazione manuale separata: toglila se l’avevi attivata per errore.
                  </p>
                ) : null}
                <label className="carriers-flag">
                  <input type="checkbox" checked={form.is_active && !form.out_of_service} disabled={form.out_of_service} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} />
                  Attivo
                </label>
                <label className="carriers-flag">
                  <input
                    type="checkbox"
                    checked={form.out_of_service}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        out_of_service: e.target.checked,
                        is_active: e.target.checked ? false : true,
                        in_service: false,
                      }))
                    }
                  />
                  Fuori servizio
                </label>
                <label className="carriers-flag">
                  <input
                    type="checkbox"
                    checked={form.in_service}
                    disabled={formRestingToday || form.out_of_service || !form.is_active}
                    onChange={(e) => setForm((f) => ({ ...f, in_service: e.target.checked }))}
                  />
                  In servizio
                </label>
              </div>
              <div className="form-group">
                <label>Note / disponibilità</label>
                <textarea className="form-control" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
              <div className="carriers-actions">
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Salvataggio…' : 'Salva anagrafica'}</button>
                {editingId ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={formRestingToday || form.out_of_service || !form.is_active}
                      onClick={() => handleToggleInService(editingId, true)}
                    >
                      Metti in servizio
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => handleToggleInService(editingId, false)}>Togli servizio</button>
                    <button type="button" className="btn btn-outline-danger" onClick={() => handleDelete(editingId)}>Elimina</button>
                  </>
                ) : null}
              </div>
            </form>
          </section>

          {selectedId ? (
            <>
              <CarrierAttributeTable
                title={CARRIER_MAINTENANCE_WORKBOOK_TITLE}
                columns={CARRIER_MAINTENANCE_COLUMNS}
                rows={maintenanceRows}
                draftRow={maintDraft}
                onDraftChange={(field, value) => setMaintDraft((d) => ({ ...d, [field]: value }))}
                onAddRow={addMaintenance}
                onDeleteSaved={async (row) => {
                  await deleteCarrierMaintenance(row.id)
                  await loadDetail(selectedId)
                }}
                loading={detailLoading}
                loadingLabel="Caricamento manutenzioni"
                cellValue={carrierMaintenanceCellValue}
              />

              <CarrierAttributeTable
                title={CARRIER_FUEL_WORKBOOK_TITLE}
                columns={CARRIER_FUEL_COLUMNS}
                rows={fuelRows}
                draftRow={fuelDraft}
                onDraftChange={(field, value) => setFuelDraft((d) => ({ ...d, [field]: value }))}
                onAddRow={addFuel}
                onDeleteSaved={async (row) => {
                  await deleteCarrierFuel(row.id)
                  await loadDetail(selectedId)
                }}
                loading={detailLoading}
                loadingLabel="Caricamento spese carburante"
                cellValue={carrierFuelCellValue}
              />

              <CarrierAttributeTable
                title={CARRIER_OTHER_WORKBOOK_TITLE}
                columns={CARRIER_OTHER_COLUMNS}
                rows={otherRows}
                draftRow={otherDraft}
                onDraftChange={(field, value) => setOtherDraft((d) => ({ ...d, [field]: value }))}
                onAddRow={addOther}
                onDeleteSaved={async (row) => {
                  await deleteCarrierOtherExpense(row.id)
                  await loadDetail(selectedId)
                }}
                loading={detailLoading}
                loadingLabel="Caricamento altre spese"
                cellValue={carrierOtherCellValue}
              />
            </>
          ) : (
            <section className="card">
              <p className="empty-state" style={{ margin: 0 }}>
                Seleziona un trasportatore dall&apos;elenco (o creane uno) per gestire manutenzione, carburante e altre spese.
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
