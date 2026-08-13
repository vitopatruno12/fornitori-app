import React, { useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  getCourierTrafficStatus,
  isCourierOperational,
} from '../utils/orderCourierContact.js'

const TRAFFIC_COLORS = {
  green: '#16a34a',
  yellow: '#ca8a04',
  red: '#dc2626',
}

function CourierTrafficLight({ status }) {
  const color = TRAFFIC_COLORS[status.color] || TRAFFIC_COLORS.red
  return (
    <span
      className="order-courier-traffic"
      title={status.label}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', flex: '0 0 auto' }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 12,
          height: 12,
          borderRadius: '50%',
          background: color,
          boxShadow: `0 0 0 2px ${color}33`,
          flex: '0 0 auto',
        }}
      />
      <span style={{ fontSize: '0.82rem', fontWeight: 600, color }}>{status.label}</span>
    </span>
  )
}

/**
 * Elenco trasportatori da anagrafica API (pagina Trasportatori).
 * Qui si sceglie solo «In servizio» per l'ordine; attivo/riposo/fuori servizio si gestiscono in /trasportatori.
 */
export default function OrderCourierEditor({ carriers, onToggleInService, loading }) {
  const list = Array.isArray(carriers) ? carriers : []

  const toggleInService = useCallback(
    (carrier) => {
      if (typeof onToggleInService !== 'function' || !carrier?.id) return
      if (!isCourierOperational(carrier) && !carrier.inService) return
      onToggleInService(carrier, !carrier.inService)
    },
    [onToggleInService],
  )

  if (loading) {
    return <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Caricamento trasportatori…</p>
  }

  if (!list.length) {
    return (
      <div className="order-courier-editor">
        <p className="alert alert-warning" style={{ fontSize: '0.85rem' }}>
          Nessun trasportatore in anagrafica.{' '}
          <Link to="/trasportatori">Apri Trasportatori</Link> per crearne uno (telefono, riposo, furgone, spese).
        </p>
      </div>
    )
  }

  return (
    <div className="order-courier-editor">
      <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: 0, marginBottom: '0.65rem' }}>
        Semaforo da anagrafica:{' '}
        <strong style={{ color: TRAFFIC_COLORS.green }}>verde</strong> in servizio,{' '}
        <strong style={{ color: TRAFFIC_COLORS.yellow }}>giallo</strong> disponibile,{' '}
        <strong style={{ color: TRAFFIC_COLORS.red }}>rosso</strong> riposo / fuori servizio / non attivo.
        Attivo e giorno di riposo si impostano in{' '}
        <Link to="/trasportatori">Trasportatori</Link>. Spunta <strong>In servizio</strong> per WhatsApp/email di questo ordine.
      </p>
      {list.map((carrier) => {
        const status = getCourierTrafficStatus(carrier)
        const operational = isCourierOperational(carrier)
        const borderColor =
          status.color === 'green'
            ? 'rgba(22, 163, 74, 0.35)'
            : status.color === 'yellow'
              ? 'rgba(202, 138, 4, 0.35)'
              : 'rgba(220, 38, 38, 0.35)'
        return (
          <div
            key={carrier._key || carrier.id}
            className="order-courier-row"
            style={{
              border: `1px solid ${borderColor}`,
              borderRadius: 8,
              padding: '0.65rem 0.75rem',
              marginBottom: '0.55rem',
              background:
                status.color === 'green'
                  ? 'rgba(22, 163, 74, 0.06)'
                  : status.color === 'red'
                    ? 'rgba(220, 38, 38, 0.05)'
                    : 'transparent',
              opacity: status.color === 'red' ? 0.88 : 1,
            }}
          >
            <div
              className="form-row"
              style={{ alignItems: 'center', flexWrap: 'wrap', gap: '0.65rem', marginBottom: '0.35rem' }}
            >
              <CourierTrafficLight status={status} />
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  margin: 0,
                  cursor: operational || carrier.inService ? 'pointer' : 'not-allowed',
                  flex: '0 0 auto',
                }}
              >
                <input
                  type="checkbox"
                  checked={Boolean(carrier.inService)}
                  disabled={!operational && !carrier.inService}
                  onChange={() => toggleInService(carrier)}
                />
                <span style={{ fontSize: '0.88rem', fontWeight: carrier.inService ? 600 : 400 }}>In servizio</span>
              </label>
              {carrier.vanLabel || carrier.vanPlate ? (
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Furgone: {[carrier.vanLabel, carrier.vanPlate].filter(Boolean).join(' · ')}
                </span>
              ) : null}
            </div>
            <div style={{ fontSize: '0.9rem' }}>
              <strong>{carrier.name || '—'}</strong>
              {carrier.phone ? ` · ${carrier.phone}` : ''}
              {carrier.email ? ` · ${carrier.email}` : ''}
            </div>
          </div>
        )
      })}
      <Link to="/trasportatori" className="btn btn-secondary btn-sm">
        Gestisci anagrafica trasportatori
      </Link>
    </div>
  )
}
