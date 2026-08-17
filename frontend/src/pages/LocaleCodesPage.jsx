import React, { useState } from 'react'
import { lookupLocaleAccessCodes } from '../services/staffService'

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    try {
      const el = document.createElement('textarea')
      el.value = value
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      return true
    } catch {
      return false
    }
  }
}

function sourceLabel(source) {
  if (source === 'personale') return 'Personale'
  if (source === 'prima_nota') return 'Prima Nota'
  return source || '—'
}

export default function LocaleCodesPage() {
  const [query, setQuery] = useState('')
  const [unlockPassword, setUnlockPassword] = useState('')
  const [hits, setHits] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [copiedCode, setCopiedCode] = useState('')

  async function handleLookup(e) {
    e?.preventDefault?.()
    const q = String(query || '').trim()
    const password = String(unlockPassword || '').trim()
    if (q.length < 2) {
      setError('Inserisci almeno 2 caratteri (nome locale Personale o registro Prima Nota).')
      setHits([])
      setUnlocked(false)
      return
    }
    if (!password) {
      setError('Inserisci la password di sblocco.')
      setHits([])
      setUnlocked(false)
      return
    }
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const data = await lookupLocaleAccessCodes(q, password)
      const rows = Array.isArray(data?.hits) ? data.hits : []
      setHits(rows)
      setUnlocked(rows.length > 0)
      setUnlockPassword('')
      if (!rows.length) {
        setError('Nessuna credenziale trovata per questo nome.')
      } else {
        setSuccess(`Codice locale per «${q}». La password è stata azzerata.`)
      }
    } catch (err) {
      setHits([])
      setUnlocked(false)
      setUnlockPassword('')
      setError(err?.message || 'Impossibile recuperare i codici.')
    } finally {
      setLoading(false)
    }
  }

  async function handleCopy(code) {
    const ok = await copyText(code)
    if (!ok) return
    setCopiedCode(code)
    window.setTimeout(() => setCopiedCode(''), 2500)
  }

  function handleReset() {
    setHits([])
    setUnlocked(false)
    setError('')
    setSuccess('')
    setQuery('')
    setUnlockPassword('')
  }

  return (
    <div className="pagamenti-page">
      <section className="staff-page-hero">
        <h1 className="page-header staff-page-title">Link codici</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', margin: 0, maxWidth: 760, lineHeight: 1.5 }}>
          Scegli il <strong>nome locale</strong> o <strong>registro</strong>, inserisci la{' '}
          <strong>password di sblocco</strong> e premi <strong>Mostra</strong>. La password viene azzerata dopo
          l&apos;uso. OTP WhatsApp temporaneamente disattivato.
        </p>
      </section>

      {error ? <div className="alert alert-danger">{error}</div> : null}
      {success ? <div className="alert alert-success">{success}</div> : null}

      <section className="card" style={{ padding: '1rem 1.15rem', marginBottom: '1rem' }}>
        <form onSubmit={handleLookup} className="form-row" style={{ alignItems: 'end', gap: '0.75rem' }}>
          <div className="form-group" style={{ flex: '1 1 260px', marginBottom: 0 }}>
            <label htmlFor="locale-code-query">Nome locale o registro</label>
            <input
              id="locale-code-query"
              className="form-control"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setUnlocked(false)
                setHits([])
                setUnlockPassword('')
              }}
              placeholder="Es. Bar-momento oppure Risacca"
              autoComplete="off"
              disabled={loading}
            />
          </div>
          <div className="form-group" style={{ flex: '0 1 220px', marginBottom: 0 }}>
            <label htmlFor="locale-code-password">Password di sblocco</label>
            <input
              id="locale-code-password"
              type="password"
              className="form-control"
              value={unlockPassword}
              onChange={(e) => setUnlockPassword(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              disabled={loading}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={
                loading ||
                String(query || '').trim().length < 2 ||
                !String(unlockPassword || '').trim()
              }
            >
              {loading ? 'Verifica…' : 'Mostra'}
            </button>
          </div>
          {unlocked ? (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <button type="button" className="btn btn-secondary" onClick={handleReset} disabled={loading}>
                Chiudi
              </button>
            </div>
          ) : null}
        </form>
        <p style={{ margin: '0.75rem 0 0', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
          Dopo <strong>Mostra</strong> vedi il codice a 6 cifre del locale scelto. Per un altro locale cambia
          nome e reinserisci la password.
        </p>
      </section>

      {unlocked ? (
        <section className="card" style={{ padding: '1rem 1.15rem' }}>
          <h2 className="page-subheader" style={{ marginTop: 0 }}>
            Credenziali trovate
          </h2>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {hits.map((hit) => (
              <div
                key={`${hit.source}-${hit.name}-${hit.activity_slug || ''}`}
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.75rem',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: '1px solid var(--border)',
                  paddingBottom: '0.75rem',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{hit.name}</div>
                  <div style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                    {sourceLabel(hit.source)}
                    {hit.activity_slug ? ` · slug ${hit.activity_slug}` : ''}
                    {hit.linked_name ? ` · collegato a «${hit.linked_name}»` : ''}
                  </div>
                  <div
                    style={{
                      marginTop: '0.35rem',
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: '1.25rem',
                      letterSpacing: '0.08em',
                    }}
                  >
                    {hit.access_code}
                  </div>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleCopy(hit.access_code)}>
                  {copiedCode === hit.access_code ? 'Copiato' : 'Copia codice'}
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
