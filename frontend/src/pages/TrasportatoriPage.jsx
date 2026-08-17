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
    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      is_active: form.out_of_service ? false : Boolean(form.is_active),
      out_of_service: Boolean(form.out_of_service),
      in_service: form.out_of_service || !form.is_active ? false : Boolean(form.in_service),
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
    <div>
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
      <section className="card" style={{ marginBottom: '1rem', padding: '0.85rem' }}>
        <div style={{ display: 'grid', gap: '0.6rem', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          <div style={{ border: '1px solid var(--border-subtle, rgba(0,0,0,0.08))', borderRadius: 8, padding: '0.6rem' }}>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Totale trasportatori</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{dashboardStats.total}</div>
          </div>
          <div style={{ border: `1px solid ${TRAFFIC.green}44`, borderRadius: 8, padding: '0.6rem' }}>
            <div style={{ fontSize: '0.78rem', color: TRAFFIC.green }}>Verde · in servizio</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: TRAFFIC.green }}>{dashboardStats.green}</div>
          </div>
          <div style={{ border: `1px solid ${TRAFFIC.yellow}44`, borderRadius: 8, padding: '0.6rem' }}>
            <div style={{ fontSize: '0.78rem', color: TRAFFIC.yellow }}>Giallo · disponibile</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: TRAFFIC.yellow }}>{dashboardStats.yellow}</div>
          </div>
          <div style={{ border: `1px solid ${TRAFFIC.red}44`, borderRadius: 8, padding: '0.6rem' }}>
            <div style={{ fontSize: '0.78rem', color: TRAFFIC.red }}>Rosso · non operativo</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: TRAFFIC.red }}>{dashboardStats.red}</div>
          </div>
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 320px) 1fr', gap: '1rem', alignItems: 'start' }}>
        <section className="card">
          <h2 className="page-subheader" style={{ marginTop: 0 }}>Elenco</h2>
          {!list.length && !loading ? (
            <p className="empty-state">Nessun trasportatore. Creane uno.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {list.map((c) => {
                const st = getCourierTrafficStatus(mapCarrierForStatus(c))
                const active = String(selectedId) === String(c.id)
                return (
                  <li key={c.id} style={{ marginBottom: '0.45rem' }}>
                    <button
                      type="button"
                      className={`btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}
                      onClick={() => startEdit(c)}
                    >
                      <span>{c.name}</span>
                      <span style={{ color: TRAFFIC[st.color], fontWeight: 700 }}>{st.label}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <section className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
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
              <div className="form-row" style={{ flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
                <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', margin: 0 }}>
                  <input type="checkbox" checked={form.is_active && !form.out_of_service} disabled={form.out_of_service} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} />
                  Attivo
                </label>
                <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', margin: 0 }}>
                  <input type="checkbox" checked={form.out_of_service} onChange={(e) => setForm((f) => ({ ...f, out_of_service: e.target.checked, is_active: e.target.checked ? false : f.is_active, in_service: false }))} />
                  Fuori servizio
                </label>
                <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', margin: 0 }}>
                  <input type="checkbox" checked={form.in_service} disabled={form.out_of_service || !form.is_active} onChange={(e) => setForm((f) => ({ ...f, in_service: e.target.checked }))} />
                  In servizio
                </label>
              </div>
              <div className="form-group">
                <label>Note / disponibilità</label>
                <textarea className="form-control" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Salvataggio…' : 'Salva anagrafica'}</button>
                {editingId ? (
                  <>
                    <button type="button" className="btn btn-secondary" onClick={() => handleToggleInService(editingId, true)}>Metti in servizio</button>
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
