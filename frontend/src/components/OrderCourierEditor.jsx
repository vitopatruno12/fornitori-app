import React from 'react'
import { emptyCourierCarrier, setCourierInService } from '../utils/orderCourierContact.js'

export default function OrderCourierEditor({ carriers, setCarriers, onDirty }) {
  const list = Array.isArray(carriers) && carriers.length ? carriers : [emptyCourierCarrier()]

  function markDirty() {
    onDirty?.()
  }

  function updateCarrier(index, patch) {
    setCarriers((prev) => {
      const base = Array.isArray(prev) && prev.length ? prev : [emptyCourierCarrier()]
      return base.map((item, i) => (i === index ? { ...item, ...patch } : item))
    })
    markDirty()
  }

  function setInService(index) {
    setCarriers((prev) => setCourierInService(prev, index))
    markDirty()
  }

  function addCarrier() {
    setCarriers((prev) => {
      const base = Array.isArray(prev) ? [...prev] : []
      const next = [...base, emptyCourierCarrier()]
      if (!next.some((c) => c.inService)) next[0].inService = true
      return next
    })
    markDirty()
  }

  function removeCarrier(index) {
    setCarriers((prev) => {
      const base = Array.isArray(prev) ? prev : []
      const next = base.filter((_, i) => i !== index)
      return next.length ? setCourierInService(next, 0) : [emptyCourierCarrier()]
    })
    markDirty()
  }

  return (
    <div className="order-courier-editor">
      <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: 0, marginBottom: '0.65rem' }}>
        Aggiungi più trasportatori con relativi numeri. Seleziona <strong>In servizio</strong> per l&apos;ordine corrente;
        se il numero non è valido o non risponde, viene usato il prossimo trasportatore attivo.
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
            background: carrier.inService ? 'var(--surface-2, rgba(0,0,0,0.03))' : 'transparent',
          }}
        >
          <div
            className="form-row"
            style={{ alignItems: 'center', flexWrap: 'wrap', gap: '0.65rem', marginBottom: '0.5rem' }}
          >
            <label
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', margin: 0, cursor: 'pointer', flex: '0 0 auto' }}
              title="Trasportatore usato per WhatsApp ed email di questo ordine"
            >
              <input
                type="radio"
                name="order-courier-in-service"
                checked={Boolean(carrier.inService)}
                onChange={() => setInService(index)}
              />
              <span style={{ fontSize: '0.88rem', fontWeight: carrier.inService ? 600 : 400 }}>In servizio</span>
            </label>
            <label
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', margin: 0, cursor: 'pointer', flex: '0 0 auto' }}
              title="Disponibile come alternativa se il trasportatore in servizio non ha un numero valido"
            >
              <input
                type="checkbox"
                checked={carrier.enabled !== false}
                onChange={(e) => updateCarrier(index, { enabled: e.target.checked })}
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
