import React from 'react'
import { apiFetch } from '../services/api'
import { AnalisiLoadingBar } from './AnalisiShared'

const POLL_MS = 2000
const STALE_MS = 3 * 60 * 1000

function phaseTitle(phase, mode) {
  if (phase === 'connecting') return "Collegamento all'Agenzia delle Entrate…"
  if (phase === 'request') return 'Fase richiesta fatture in corso…'
  if (phase === 'download') return 'Fase scarico fatture in corso…'
  if (phase === 'sync') return 'Aggiornamento fatture AdE…'
  if (mode === 'request') return 'Richiesta fatture AdE…'
  if (mode === 'download') return 'Scarico fatture AdE…'
  return 'Operazioni AdE in corso…'
}

function notifyAssistant(message, kind = 'info') {
  try {
    window.dispatchEvent(
      new CustomEvent('atlas-ai-toast', {
        detail: { message: String(message || ''), kind },
      }),
    )
  } catch {
    /* ignore */
  }
}

export default function AdeAgentOverlay({ enabled = true }) {
  const [status, setStatus] = React.useState(null)
  const lastToastKey = React.useRef('')

  const refresh = React.useCallback(async () => {
    try {
      const data = await apiFetch('/ade/agent/status')
      setStatus(data && typeof data === 'object' ? data : null)
    } catch {
      /* ignore offline */
    }
  }, [])

  React.useEffect(() => {
    if (!enabled) return undefined
    refresh()
    const t = window.setInterval(refresh, POLL_MS)
    return () => window.clearInterval(t)
  }, [enabled, refresh])

  const running = Boolean(status?.running)
  const updatedAt = status?.updated_at ? Date.parse(status.updated_at) : 0
  const fresh = updatedAt && Date.now() - updatedAt < STALE_MS
  const showBar = running && fresh

  React.useEffect(() => {
    if (!status || running) return
    if (!status.finished_at && status.phase !== 'done' && status.phase !== 'error') return
    const key = `${status.finished_at || ''}|${status.phase}|${status.message || ''}`
    if (!key || key === lastToastKey.current) return
    // solo eventi recenti
    const fin = status.finished_at ? Date.parse(status.finished_at) : updatedAt
    if (fin && Date.now() - fin > STALE_MS) return
    lastToastKey.current = key
    if (status.ok === false || status.phase === 'error') {
      notifyAssistant(
        status.error || status.message || 'Errore aggiornamento fatture AdE',
        'error',
      )
    } else if (status.ok === true || status.phase === 'done') {
      notifyAssistant(
        status.message || 'Fatture aggiornate — nuovo scarico completato.',
        'success',
      )
    }
  }, [status, running, updatedAt])

  if (!enabled || !showBar) return null

  const label = phaseTitle(status.phase, status.mode)
  const detail = status.message || label
  const pct = Math.max(8, Math.min(96, Number(status.progress) || 12))

  return (
    <div className="ade-agent-overlay" role="status" aria-live="polite">
      <div className="ade-agent-overlay-card">
        <div className="ade-agent-overlay-title">{label}</div>
        <p className="ade-agent-overlay-msg">{detail}</p>
        <AnalisiLoadingBar active label={label} variant="subtle" />
        <div className="ade-agent-overlay-pct" aria-hidden>
          {pct}%
        </div>
      </div>
    </div>
  )
}
