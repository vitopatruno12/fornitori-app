import React, { useState } from 'react'
import { lookupLocaleAccessCodes, requestLocaleAccessCodesOtp } from '../services/staffService'

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

const PHONE_STORAGE_KEY = 'atlas-link-codici-phone'

export default function LocaleCodesPage() {
  const [query, setQuery] = useState('')
  const [phone, setPhone] = useState(() => {
    try {
      return localStorage.getItem(PHONE_STORAGE_KEY) || ''
    } catch {
      return ''
    }
  })
  const [otp, setOtp] = useState('')
  const [hits, setHits] = useState([])
  const [loading, setLoading] = useState(false)
  const [otpBusy, setOtpBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [copiedCode, setCopiedCode] = useState('')
  const [otpSentHint, setOtpSentHint] = useState('')
  const [debugOtp, setDebugOtp] = useState('')

  async function handleRequestOtp(e) {
    e?.preventDefault?.()
    const q = String(query || '').trim()
    const tel = String(phone || '').replace(/\D/g, '')
    if (q.length < 2) {
      setError('Inserisci almeno 2 caratteri (nome locale Personale o registro Prima Nota).')
      return
    }
    if (tel.length < 10) {
      setError('Inserisci il cellulare (es. 3331234567) per ricevere l’OTP su WhatsApp.')
      return
    }
    setOtpBusy(true)
    setError('')
    setSuccess('')
    setHits([])
    setUnlocked(false)
    setDebugOtp('')
    try {
      try {
        localStorage.setItem(PHONE_STORAGE_KEY, tel)
      } catch {
        /* ignore */
      }
      const data = await requestLocaleAccessCodesOtp(q, tel)
      const hint = data?.phone_hint || 'il telefono configurato'
      setOtpSentHint(hint)
      setOtp('')
      if (data?.debug_otp) {
        setDebugOtp(String(data.debug_otp))
        setSuccess(
          `OTP inviato (modalità debug). Codice: ${data.debug_otp}. Inseriscilo sotto e apri i codici locale.`,
        )
      } else {
        setSuccess(`OTP monouso inviato a ${hint}. Inseriscilo per visualizzare i codici.`)
      }
    } catch (err) {
      setOtpSentHint('')
      setError(err?.message || 'Impossibile inviare l’OTP.')
    } finally {
      setOtpBusy(false)
    }
  }

  async function handleLookup(e) {
    e?.preventDefault?.()
    const q = String(query || '').trim()
    const code = String(otp || '').replace(/\D/g, '').slice(0, 6)
    if (q.length < 2) {
      setError('Inserisci almeno 2 caratteri (nome locale Personale o registro Prima Nota).')
      setHits([])
      setUnlocked(false)
      return
    }
    if (code.length !== 6) {
      setError('Inserisci il codice OTP a 6 cifre ricevuto sul telefono.')
      setHits([])
      setUnlocked(false)
      return
    }
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const data = await lookupLocaleAccessCodes(q, code)
      const rows = Array.isArray(data?.hits) ? data.hits : []
      setHits(rows)
      setUnlocked(rows.length > 0)
      setOtp('')
      setDebugOtp('')
      if (!rows.length) {
        setError('Nessuna credenziale trovata per questo nome.')
      } else {
        setSuccess(`Trovate ${rows.length} credenziali per «${q}». L’OTP è stato consumato.`)
      }
    } catch (err) {
      setHits([])
      setUnlocked(false)
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
    setOtp('')
    setOtpSentHint('')
    setDebugOtp('')
  }

  return (
    <div className="pagamenti-page">
      <section className="staff-page-hero">
        <h1 className="page-header staff-page-title">Link codici</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', margin: 0, maxWidth: 760, lineHeight: 1.5 }}>
          Inserisci il <strong>nome locale</strong> o <strong>registro</strong> e il <strong>cellulare</strong>,
          poi <strong>Invia WhatsApp</strong>. Ricevi l’OTP a 6 cifre, inseriscilo e premi <strong>Mostra codice</strong>.
        </p>
      </section>

      {error ? <div className="alert alert-danger">{error}</div> : null}
      {success ? <div className="alert alert-success">{success}</div> : null}

      <section className="card" style={{ padding: '1rem 1.15rem', marginBottom: '1rem' }}>
        <form onSubmit={handleLookup} className="form-row" style={{ alignItems: 'end', gap: '0.75rem' }}>
          <div className="form-group" style={{ flex: '1 1 240px', marginBottom: 0 }}>
            <label htmlFor="locale-code-query">Nome locale o registro</label>
            <input
              id="locale-code-query"
              className="form-control"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setUnlocked(false)
                setHits([])
              }}
              placeholder="Es. Bar-momento oppure Risacca"
              autoComplete="off"
              disabled={loading || otpBusy}
            />
          </div>
          <div className="form-group" style={{ flex: '0 1 170px', marginBottom: 0 }}>
            <label htmlFor="locale-code-phone">Cellulare</label>
            <input
              id="locale-code-phone"
              className="form-control"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^\d+\s]/g, '').slice(0, 16))}
              placeholder="3331234567"
              inputMode="tel"
              autoComplete="tel"
              disabled={loading || otpBusy}
            />
          </div>
          <div className="form-group" style={{ flex: '0 1 140px', marginBottom: 0 }}>
            <label htmlFor="locale-code-otp">OTP (6 cifre)</label>
            <input
              id="locale-code-otp"
              className="form-control"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              disabled={loading || otpBusy}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <button
              type="button"
              className="btn btn-whatsapp"
              disabled={loading || otpBusy || String(query || '').trim().length < 2}
              onClick={() => void handleRequestOtp()}
            >
              {otpBusy ? 'Invio WhatsApp…' : 'Invia WhatsApp'}
            </button>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || otpBusy || String(otp || '').replace(/\D/g, '').length !== 6}
            >
              {loading ? 'Verifica…' : 'Mostra codice'}
            </button>
          </div>
          {unlocked ? (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <button type="button" className="btn btn-secondary" onClick={handleReset} disabled={loading || otpBusy}>
                Chiudi
              </button>
            </div>
          ) : null}
        </form>
        {otpSentHint ? (
          <p style={{ margin: '0.75rem 0 0', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
            OTP inviato a <strong>{otpSentHint}</strong>
            {debugOtp ? (
              <>
                {' '}
                · debug: <code>{debugOtp}</code>
              </>
            ) : null}
            . Il codice è monouso e scade in pochi minuti.
          </p>
        ) : (
          <p style={{ margin: '0.75rem 0 0', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
            Prima inserisci il cellulare e clicca <strong>Invia WhatsApp</strong>, poi metti l’OTP e premi{' '}
            <strong>Mostra codice</strong>.
          </p>
        )}
      </section>

      {unlocked ? (
        <section className="card" style={{ padding: '1rem 1.15rem' }}>
          <h2 className="page-subheader" style={{ marginTop: 0 }}>Credenziali trovate</h2>
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
