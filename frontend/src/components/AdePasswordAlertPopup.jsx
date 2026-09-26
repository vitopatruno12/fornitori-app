import React from 'react'
import {
  dismissAdePasswordAlert,
  fetchAdePasswordAlerts,
  updateAdeFisconlineCredentials,
} from '../services/invoicesService'

const POLL_MS = 20000
const HIDE_KEY = 'adePasswordAlertHide'

function levelTitle(item) {
  if (item?.level === 'expired') return 'Password scaduta'
  if (Number.isFinite(item?.days_left) && item.days_left > 0) {
    return `Scade tra ${item.days_left} giorni`
  }
  return 'Password in scadenza'
}

export default function AdePasswordAlertPopup({ enabled = true }) {
  const [items, setItems] = React.useState([])
  const [hidden, setHidden] = React.useState(() => {
    try {
      return sessionStorage.getItem(HIDE_KEY) === '1'
    } catch {
      return false
    }
  })
  const [drafts, setDrafts] = React.useState({})
  const [savingId, setSavingId] = React.useState('')
  const [error, setError] = React.useState('')
  const [savedId, setSavedId] = React.useState('')

  const refresh = React.useCallback(async () => {
    try {
      const data = await fetchAdePasswordAlerts()
      const next = Array.isArray(data?.items) ? data.items : []
      setItems(next)
      if (next.length === 0) {
        try {
          sessionStorage.removeItem(HIDE_KEY)
        } catch {
          /* ignore */
        }
        setHidden(false)
      }
    } catch {
      /* offline o endpoint non ancora pubblicato */
    }
  }, [])

  React.useEffect(() => {
    if (!enabled) return undefined
    refresh()
    const t = window.setInterval(refresh, POLL_MS)
    return () => window.clearInterval(t)
  }, [enabled, refresh])

  function hideForSession() {
    try {
      sessionStorage.setItem(HIDE_KEY, '1')
    } catch {
      /* ignore */
    }
    setHidden(true)
  }

  async function savePassword(item) {
    const profileId = item?.profile_id
    const password = String(drafts[profileId] || '').trim()
    if (!password) {
      setError('Inserisci la nuova password Fisconline')
      return
    }
    setSavingId(profileId)
    setError('')
    setSavedId('')
    try {
      await updateAdeFisconlineCredentials(profileId, { password })
      setDrafts((prev) => ({ ...prev, [profileId]: '' }))
      setSavedId(profileId)
      setItems((prev) => prev.filter((row) => row.profile_id !== profileId))
    } catch (e) {
      setError(e?.message || 'Salvataggio password fallito')
    } finally {
      setSavingId('')
    }
  }

  async function dismiss(profileId) {
    setItems((prev) => prev.filter((row) => row.profile_id !== profileId))
    try {
      await dismissAdePasswordAlert(profileId)
    } catch {
      /* resta nascosto in questa sessione */
    }
  }

  if (!enabled || hidden || items.length === 0) return null

  return (
    <div className="ade-password-alert" role="dialog" aria-modal="true" aria-labelledby="ade-password-alert-title">
      <div className="ade-password-alert-card">
        <header className="ade-password-alert-head">
          <h2 id="ade-password-alert-title">Password Agenzia delle Entrate</h2>
          <p>Avviso letto dal sito dell’Agenzia delle Entrate. Aggiorna la password qui: Atlas la userà al prossimo scarico.</p>
        </header>
        {error ? <div className="alert alert-danger">{error}</div> : null}
        <ul className="ade-password-alert-list">
          {items.map((item) => {
            const busy = savingId === item.profile_id
            return (
              <li key={item.profile_id} className={`ade-password-alert-item is-${item.level || 'expiring'}`}>
                <div className="ade-password-alert-item-head">
                  <strong>{item.label || item.profile_id}</strong>
                  <span>{levelTitle(item)}</span>
                </div>
                <p className="ade-password-alert-quote">{item.message}</p>
                {savedId === item.profile_id ? (
                  <p className="ade-password-alert-ok">Password aggiornata su Atlas.</p>
                ) : (
                  <label className="form-group">
                    <span>Nuova password Fisconline</span>
                    <input
                      type="password"
                      className="form-control"
                      autoComplete="new-password"
                      value={drafts[item.profile_id] || ''}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [item.profile_id]: e.target.value }))
                      }
                    />
                    <span className="ade-password-alert-actions">
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={busy}
                        onClick={() => void savePassword(item)}
                      >
                        {busy ? 'Salvataggio…' : 'Aggiorna password'}
                      </button>
                      <button type="button" className="btn btn-secondary" onClick={() => void dismiss(item.profile_id)}>
                        Nascondi
                      </button>
                    </span>
                  </label>
                )}
              </li>
            )
          })}
        </ul>
        <div className="ade-password-alert-footer">
          <button type="button" className="btn btn-secondary" onClick={hideForSession}>
            Più tardi
          </button>
        </div>
      </div>
    </div>
  )
}
