import React from 'react'
import { Link } from 'react-router-dom'
import { useBancaBase } from './BancaShared.jsx'

const COMPANY_SHORT = {
  mediazione_a: 'Abba',
  mediazione_z: 'Zanardelli',
  via_lattea: 'Via Lattea',
  risacca: 'Risacca',
  pg: 'PG',
}

function bankShort(label) {
  const raw = String(label || '').split('·')[0].trim()
  const up = raw.toUpperCase()
  if (up.includes('INTESA')) return 'Intesa'
  if (up.includes('BCC') || up.includes('OTRANTO')) return 'BCC'
  if (up.includes('BPPB') || up.includes('POPOLARE')) return 'BPPB'
  return raw.replace(/\d{4,}/g, '').trim() || 'Conto'
}

function lightLabel(row) {
  const bank = bankShort(row?.label)
  const company = COMPANY_SHORT[row?.company] || ''
  return [bank, company].filter(Boolean).join(' · ')
}

function lightIsOn(row) {
  const status = String(row?.status || '')
  if (!row?.connected) return false
  return !['disconnected', 'expired', 'detached', 'error'].includes(status)
}

function formatConsentDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return String(iso).slice(0, 10)
  }
}

/**
 * Contatore scadenze consenso Enable Banking (banner verde Banca).
 * Avvisa da 5 giorni prima e quando il consenso è scaduto.
 */
export default function EbConsentMonitor({ consent, compact = false }) {
  const bancaBase = useBancaBase()
  if (!consent || !Number(consent.connected || 0)) return null

  const needs = Number(consent.needs_action || 0)
  const next = consent.next || null
  const warnDays = Number(consent.warn_days || 5)
  const tone =
    needs > 0
      ? 'is-warn'
      : Number(consent.unknown || 0) > 0
        ? 'is-unknown'
        : 'is-ok'

  const headline = (() => {
    if (needs > 0) {
      return `${needs} conto/i da ricollegare (entro ${warnDays} g o scaduti)`
    }
    if (next && next.days_left != null) {
      return `Prossimo ricollegamento tra ${next.days_left} g`
    }
    if (Number(consent.unknown || 0) > 0) {
      return `${consent.unknown} conto/i senza data scadenza — ricollega per attivare il contatore`
    }
    return 'Consensi Enable Banking in regola'
  })()

  const actionItems = (consent.items || []).filter(
    (row) => row.connected && (row.status === 'warn' || row.status === 'expired' || row.status === 'unknown'),
  )
  const lights = Array.isArray(consent.items) ? consent.items : []

  return (
    <div className={`banca-eb-consent ${tone}`} aria-label="Monitoraggio consenso Enable Banking">
      <div className="banca-eb-consent-head">
        <div>
          <p className="banca-eb-consent-kicker">Enable Banking · ricollegamento conti</p>
          <p className="banca-eb-consent-title">{headline}</p>
          {next?.valid_until && next.status === 'ok' ? (
            <p className="banca-eb-consent-sub">
              {next.label}: scadenza {formatConsentDate(next.valid_until)}
            </p>
          ) : null}
        </div>
        <div className="banca-eb-consent-counter" title="Giorni al prossimo ricollegamento">
          <span className="banca-eb-consent-counter-value">
            {next?.days_left != null ? Math.max(0, Number(next.days_left)) : '—'}
          </span>
          <span className="banca-eb-consent-counter-unit">giorni</span>
        </div>
      </div>
      {lights.length ? (
        <ul className="banca-eb-lights" aria-label="Stato collegamento di ogni conto">
          {lights.map((row) => {
            const on = lightIsOn(row)
            const name = lightLabel(row)
            return (
              <li key={row.account_id} className={`banca-eb-light ${on ? 'is-on' : 'is-off'}`}>
                <span className="banca-eb-light-dot" aria-hidden />
                <span>{name}</span>
                <span className="banca-eb-light-state">{on ? 'attivo' : 'staccato'}</span>
              </li>
            )
          })}
        </ul>
      ) : null}
      {!compact && actionItems.length ? (
        <ul className="banca-eb-consent-list">
          {actionItems.slice(0, 6).map((row) => (
            <li key={row.account_id}>
              <span>{row.label}</span>
              <strong>{row.message}</strong>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="banca-eb-consent-actions">
        <Link to={`${bancaBase}/conti`} className="btn btn-secondary btn-sm">
          Vai ai conti
        </Link>
      </div>
    </div>
  )
}
