import React from 'react'
import { fetchManagerInsights } from '../services/aiManagerService'

const POLL_INTERVAL_MS = 90_000
const DISMISS_KEY = 'aiManagerDismissedIds'
const MAX_DISMISSED_REMEMBERED = 200

function loadDismissed() {
  try {
    const raw = sessionStorage.getItem(DISMISS_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.map(String))
  } catch {
    return new Set()
  }
}

function saveDismissed(set) {
  try {
    const arr = Array.from(set).slice(-MAX_DISMISSED_REMEMBERED)
    sessionStorage.setItem(DISMISS_KEY, JSON.stringify(arr))
  } catch {
    /* ignore */
  }
}

function severityIcon(sev) {
  if (sev === 'critical') return '🚨'
  if (sev === 'warning') return '⚠️'
  return 'ℹ️'
}

function categoryLabel(cat) {
  switch (cat) {
    case 'orders':
      return 'Ordini'
    case 'deliveries':
      return 'Consegne'
    case 'invoices':
      return 'Fatture'
    case 'suppliers':
      return 'Fornitori'
    case 'staff':
      return 'Personale'
    case 'prima_nota':
      return 'Prima nota'
    default:
      return 'Sistema'
  }
}

export default function AiManagerPopups({ enabled = true }) {
  const [visible, setVisible] = React.useState([])
  const [panelOpen, setPanelOpen] = React.useState(false)
  const [allInsights, setAllInsights] = React.useState([])
  const [lastError, setLastError] = React.useState('')
  const [muted, setMuted] = React.useState(() => {
    try {
      return sessionStorage.getItem('aiManagerMuted') === '1'
    } catch {
      return false
    }
  })
  const dismissedRef = React.useRef(loadDismissed())
  const spokenRef = React.useRef(new Set())

  const speak = React.useCallback(
    (text) => {
      if (muted) return
      try {
        const utter = new SpeechSynthesisUtterance(text)
        utter.lang = 'it-IT'
        utter.rate = 1.05
        window.speechSynthesis?.cancel()
        window.speechSynthesis?.speak(utter)
      } catch {
        /* ignore */
      }
    },
    [muted],
  )

  const refresh = React.useCallback(async () => {
    try {
      const data = await fetchManagerInsights()
      const list = Array.isArray(data?.insights) ? data.insights : []
      setAllInsights(list)
      setLastError('')
      const dismissed = dismissedRef.current
      const fresh = list.filter((it) => it && it.id && !dismissed.has(String(it.id)))
      setVisible((prev) => {
        const prevIds = new Set(prev.map((x) => String(x.id)))
        const next = [...prev]
        for (const it of fresh) {
          if (!prevIds.has(String(it.id))) {
            next.unshift(it)
          }
        }
        return next.slice(0, 5)
      })
      const critical = fresh.find((it) => it.severity === 'critical')
      if (critical && !spokenRef.current.has(critical.id)) {
        spokenRef.current.add(critical.id)
        speak(`Attenzione: ${critical.title}`)
      }
    } catch (e) {
      setLastError(e?.message || 'Errore nel recupero insight')
    }
  }, [speak])

  React.useEffect(() => {
    if (!enabled) return undefined
    let timer = null
    refresh()
    timer = setInterval(refresh, POLL_INTERVAL_MS)
    return () => {
      if (timer) clearInterval(timer)
    }
  }, [enabled, refresh])

  React.useEffect(() => {
    function onForce() {
      refresh()
    }
    window.addEventListener('ai-manager-refresh', onForce)
    return () => window.removeEventListener('ai-manager-refresh', onForce)
  }, [refresh])

  const dismiss = React.useCallback((id) => {
    const set = dismissedRef.current
    set.add(String(id))
    saveDismissed(set)
    setVisible((prev) => prev.filter((x) => String(x.id) !== String(id)))
  }, [])

  const goTo = React.useCallback((insight) => {
    if (!insight) return
    if (insight.target_page) {
      try {
        window.dispatchEvent(
          new CustomEvent('navigate-app', { detail: { page: insight.target_page } }),
        )
      } catch {
        /* ignore */
      }
    }
    dismiss(insight.id)
    setPanelOpen(false)
  }, [dismiss])

  const toggleMuted = React.useCallback(() => {
    setMuted((m) => {
      const next = !m
      try {
        sessionStorage.setItem('aiManagerMuted', next ? '1' : '0')
      } catch {
        /* ignore */
      }
      if (!next) {
        try {
          window.speechSynthesis?.cancel()
        } catch {
          /* ignore */
        }
      }
      return next
    })
  }, [])

  const totalActive = allInsights.filter(
    (it) => it && it.id && !dismissedRef.current.has(String(it.id)),
  ).length
  const critCount = allInsights.filter((it) => it.severity === 'critical').length

  if (!enabled) return null

  return (
    <>
      <div className="ai-manager-popups" aria-live="polite">
        {visible.map((it) => (
          <div key={it.id} className={`ai-manager-toast severity-${it.severity}`}>
            <div className="ai-manager-toast-head">
              <span className="ai-manager-toast-icon" aria-hidden>{severityIcon(it.severity)}</span>
              <span className="ai-manager-toast-cat">{categoryLabel(it.category)}</span>
              <button
                type="button"
                className="ai-manager-toast-close"
                onClick={() => dismiss(it.id)}
                aria-label="Chiudi"
              >
                ×
              </button>
            </div>
            <div className="ai-manager-toast-title">{it.title}</div>
            <div className="ai-manager-toast-msg">{it.message}</div>
            <div className="ai-manager-toast-actions">
              {it.target_page ? (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => goTo(it)}>
                  Vai →
                </button>
              ) : null}
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => dismiss(it.id)}>
                Ignora
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        className={`ai-manager-fab ${critCount ? 'has-critical' : ''}`}
        onClick={() => setPanelOpen((v) => !v)}
        title="Manager AI: avvisi e suggerimenti"
        aria-label={`AI Manager: ${totalActive} avvisi`}
      >
        <span aria-hidden className="ai-manager-fab-emoji">🧑‍💼</span>
        {totalActive > 0 ? <span className="ai-manager-fab-count">{totalActive}</span> : null}
      </button>

      {panelOpen ? (
        <div className="ai-manager-panel-backdrop" onClick={() => setPanelOpen(false)}>
          <div className="ai-manager-panel" onClick={(e) => e.stopPropagation()}>
            <div className="ai-manager-panel-head">
              <strong>AI Manager — Avvisi e suggerimenti</strong>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={toggleMuted}
                  title={muted ? 'Riattiva voce' : 'Silenzia voce'}
                >
                  {muted ? '🔇' : '🔊'}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={refresh}
                  title="Aggiorna"
                >
                  ⟳
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => setPanelOpen(false)}
                  aria-label="Chiudi pannello"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="ai-manager-panel-body">
              {lastError ? <div className="alert alert-warning">{lastError}</div> : null}
              {allInsights.length === 0 ? (
                <div className="alert alert-info">Tutto sotto controllo. Nessun avviso al momento.</div>
              ) : (
                <ul className="ai-manager-panel-list">
                  {allInsights.map((it) => (
                    <li key={it.id} className={`ai-manager-panel-item severity-${it.severity}`}>
                      <div className="ai-manager-panel-item-head">
                        <span aria-hidden>{severityIcon(it.severity)}</span>
                        <span className="ai-manager-panel-item-cat">{categoryLabel(it.category)}</span>
                        <strong>{it.title}</strong>
                      </div>
                      <div className="ai-manager-panel-item-msg">{it.message}</div>
                      <div className="ai-manager-panel-item-actions">
                        {it.target_page ? (
                          <button type="button" className="btn btn-sm btn-primary" onClick={() => goTo(it)}>
                            Vai →
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary"
                          onClick={() => dismiss(it.id)}
                        >
                          Ignora
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
