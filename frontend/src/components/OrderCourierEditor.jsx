import React from 'react'
import { emptyCourierCarrier, setCourierInService } from '../utils/orderCourierContact.js'

function applyCarriersChange(onCarriersChange, updater) {
  if (typeof onCarriersChange !== 'function') return
  onCarriersChange((prevState) => {
    const base = Array.isArray(prevState) && prevState.length ? prevState : [emptyCourierCarrier()]
    return updater(base)
  })
}

export default function OrderCourierEditor({ carriers, onCarriersChange, setCarriers, onDirty }) {
  const changeCarriers = onCarriersChange || setCarriers
  const list = Array.isArray(carriers) && carriers.length ? carriers : [emptyCourierCarrier()]

  function markDirty() {
    if (typeof onDirty === 'function') onDirty()
  }

  function updateCarriers(updater) {
    applyCarriersChange(changeCarriers, updater)
    markDirty()
  }

  function updateCarrier(index, patch) {
    updateCarriers((base) => base.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  function toggleInService(index) {
    updateCarriers((prev) => setCourierInService(prev, index))
  }

  function toggleEnabled(index, checked) {
    updateCarriers((base) =>
      base.map((item, i) => {
        if (i !== index) return item
        return {
          ...item,
          enabled: checked,
          inService: checked ? item.inService : false,
        }
      }),
    )
  }

  function addCarrier() {
    updateCarriers((prev) => [...prev, emptyCourierCarrier()])
  }

  function removeCarrier(index) {
    updateCarriers((prev) => {
      const next = prev.filter((_, i) => i !== index)
      return next.length ? next : [emptyCourierCarrier()]
    })
  }

  return (
    <div className="order-courier-editor">
      <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: 0, marginBottom: '0.65rem' }}>
        Aggiungi più trasportatori con relativi numeri. Spunta <strong>In servizio</strong> per l&apos;ordine corrente
        (clic di nuovo per togliere). Se nessuno è in servizio, viene usato il primo trasportatore attivo con cellulare valido.
      </p>
      {list.map((carrier, index) => (
        <div
          key={carrier._key || `courier-${index}`}
          className="order-courier-row"
          style={{
            border: '1px solid var(--border-subtle, rgba(0,0,0,0.08))',
            borderRadius: 8,
            padding: '0.65rem 0.75rem',
            marginBottom: '0.55rem',
            background: carrier.inService && carrier.enabled !== false ? 'var(--surface-2, rgba(0,0,0,0.03))' : 'transparent',
            opacity: carrier.enabled === false ? 0.72 : 1,
          }}
        >
          <div
            className="form-row"
            style={{ alignItems: 'center', flexWrap: 'wrap', gap: '0.65rem', marginBottom: '0.5rem' }}
          >
            <label
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', margin: 0, cursor: 'pointer', flex: '0 0 auto' }}
              title="Trasportatore usato per WhatsApp ed email (clic per attivare/disattivare)"
            >
              <input
                type="checkbox"
                checked={Boolean(carrier.inService)}
                disabled={carrier.enabled === false}
                onChange={() => toggleInService(index)}
              />
              <span style={{ fontSize: '0.88rem', fontWeight: carrier.inService ? 600 : 400 }}>In servizio</span>
            </label>
            <label
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', margin: 0, cursor: 'pointer', flex: '0 0 auto' }}
              title="Disponibile nell'elenco trasportatori"
            >
              <input
                type="checkbox"
                checked={carrier.enabled !== false}
                onChange={(e) => toggleEnabled(index, e.target.checked)}
              />
              <span style={{ fontSize: '0.88rem' }}>Attivo</span>
            </label>
            {list.length > 1 ? (
              <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => removeCarrier(index)}>
                Rimuovi
              </button>
            ) : null}
          </div>
          <div className="form-row" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: '0.65rem', marginBottom: 0 }}>
            <div className="form-group" style={{ flex: '1 1 180px', minWidth: 160, marginBottom: 0 }}>
              <label>Nome trasportatore</label>
              <input
                className="form-control"
                value={carrier.name || ''}
                onChange={(e) => updateCarrier(index, { name: e.target.value })}
                placeholder="es. Mario Trasporti"
              />
            </div>
            <div className="form-group" style={{ flex: '1 1 160px', minWidth: 140, marginBottom: 0 }}>
              <label>Cellulare *</label>
              <input
                className="form-control"
                value={carrier.phone || ''}
                onChange={(e) => updateCarrier(index, { phone: e.target.value })}
                placeholder="3331234567"
              />
            </div>
            <div className="form-group" style={{ flex: '1 1 220px', minWidth: 180, marginBottom: 0 }}>
              <label>Email</label>
              <input
                type="email"
                className="form-control"
                value={carrier.email || ''}
                onChange={(e) => updateCarrier(index, { email: e.target.value })}
                placeholder="copia in CC (email)"
              />
            </div>
          </div>
        </div>
      ))}
      <button type="button" className="btn btn-secondary btn-sm" onClick={addCarrier}>
        + Aggiungi trasportatore
      </button>
    </div>
  )
}
