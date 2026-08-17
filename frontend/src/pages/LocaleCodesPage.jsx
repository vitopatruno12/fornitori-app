import React, { useEffect, useMemo, useState } from 'react'
import { fetchPrimaNotaLocalePacks } from '../services/cashService'
import { fetchStaffLocalePacks, lookupLocaleAccessCodes } from '../services/staffService'

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

function localeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
}

/** Locali/registri noti (fallback se l’API non risponde o il pack non esiste ancora). */
const FALLBACK_LOCALE_OPTIONS = [
  { value: 'Bar-momento', label: 'Bar-momento', source: 'personale' },
  { value: 'La mediazione via zanardelli', label: 'La mediazione via zanardelli', source: 'personale' },
  { value: 'Mediazione via abba', label: 'Mediazione via abba', source: 'personale' },
  { value: 'La Via Lattea', label: 'La Via Lattea', source: 'personale' },
  { value: 'Risacca', label: 'Risacca', source: 'prima_nota' },
  { value: 'Via Zanardelli', label: 'Via Zanardelli', source: 'prima_nota' },
  { value: 'Via Abba', label: 'Via Abba', source: 'prima_nota' },
  { value: 'Via Lattea', label: 'Via Lattea', source: 'prima_nota' },
]

function mergeLocaleOptions(staffRows, primaNotaRows) {
  const merged = new Map()

  function addOption(option) {
    const value = String(option?.value || '').trim()
    if (!value) return
    const key = localeKey(value)
    if (!key || merged.has(key)) return
    merged.set(key, {
      value,
      label: String(option.label || value).trim(),
      source: option.source || 'personale',
    })
  }

  for (const row of staffRows || []) {
    const name = String(row?.locale_name || '').trim()
    if (!name) continue
    addOption({
      value: name,
      label: row?.requires_access_code ? `${name} (Personale)` : name,
      source: 'personale',
    })
  }

  for (const row of primaNotaRows || []) {
    const slug = String(row?.activity_slug || '').trim()
    const label = String(row?.label || slug).trim()
    if (!label) continue
    addOption({
      value: label,
      label: row?.requires_access_code ? `${label} (Prima Nota)` : `${label} (Prima Nota)`,
      source: 'prima_nota',
    })
    if (slug && localeKey(slug) !== localeKey(label)) {
      addOption({
        value: slug,
        label: `${slug} (registro)`,
        source: 'prima_nota',
      })
    }
  }

  for (const option of FALLBACK_LOCALE_OPTIONS) addOption(option)

  return Array.from(merged.values()).sort((a, b) => a.label.localeCompare(b.label, 'it'))
}

export default function LocaleCodesPage() {
  const [query, setQuery] = useState('')
  const [localeOptions, setLocaleOptions] = useState(FALLBACK_LOCALE_OPTIONS)
  const [optionsLoading, setOptionsLoading] = useState(true)
  const [unlockPassword, setUnlockPassword] = useState('')
  const [hits, setHits] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [copiedCode, setCopiedCode] = useState('')

  useEffect(() => {
    let cancelled = false
    async function loadOptions() {
      setOptionsLoading(true)
      try {
        const [staffRows, primaNotaRows] = await Promise.all([
          fetchStaffLocalePacks().catch(() => []),
          fetchPrimaNotaLocalePacks().catch(() => []),
        ])
        if (!cancelled) {
          setLocaleOptions(mergeLocaleOptions(staffRows, primaNotaRows))
        }
      } finally {
        if (!cancelled) setOptionsLoading(false)
      }
    }
    void loadOptions()
    return () => {
      cancelled = true
    }
  }, [])

  const selectedOption = useMemo(
    () => localeOptions.find((option) => localeKey(option.value) === localeKey(query)),
    [localeOptions, query],
  )

  async function handleLookup(e) {
    e?.preventDefault?.()
    const q = String(query || '').trim()
    const password = String(unlockPassword || '').trim()
    if (!q) {
      setError('Seleziona un locale o registro dalla lista (non username o email).')
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
        setError('Nessun codice configurato per questo locale. Verifica che il pack abbia un codice a 6 cifre.')
      } else {
        setSuccess(`Codice per «${selectedOption?.label || q}». Password azzerata.`)
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

  function handleLocaleChange(nextValue) {
    setQuery(nextValue)
    setUnlocked(false)
    setHits([])
    setUnlockPassword('')
    setError('')
    setSuccess('')
  }

  return (
    <div className="pagamenti-page">
      <section className="staff-page-hero">
        <h1 className="page-header staff-page-title">Link codici</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', margin: 0, maxWidth: 760, lineHeight: 1.5 }}>
          Scegli il <strong>locale Personale</strong> o il <strong>registro Prima Nota</strong> dal menu,
          inserisci la password di sblocco e premi <strong>Mostra</strong>. Non usare username o email (es.{' '}
          michele.giliberti@gmail.com).
        </p>
      </section>

      {error ? <div className="alert alert-danger">{error}</div> : null}
      {success ? <div className="alert alert-success">{success}</div> : null}

      <section className="card" style={{ padding: '1rem 1.15rem', marginBottom: '1rem' }}>
        <form onSubmit={handleLookup} className="form-row" style={{ alignItems: 'end', gap: '0.75rem' }}>
          <div className="form-group" style={{ flex: '1 1 320px', marginBottom: 0 }}>
            <label htmlFor="locale-code-query">Locale o registro</label>
            <select
              id="locale-code-query"
              className="form-control"
              value={query}
              onChange={(e) => handleLocaleChange(e.target.value)}
              disabled={loading || optionsLoading}
            >
              <option value="">
                {optionsLoading ? 'Caricamento locali…' : '— Seleziona locale o registro —'}
              </option>
              {localeOptions.map((option) => (
                <option key={`${option.source}-${option.value}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ flex: '0 1 220px', marginBottom: 0 }}>
            <label htmlFor="locale-code-password">Password di sblocco</label>
            <input
              id="locale-code-password"
              type="password"
              className="form-control"
              value={unlockPassword}
              onChange={(e) => setUnlockPassword(e.target.value)}
              placeholder="Password di sblocco"
              autoComplete="current-password"
              disabled={loading}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || optionsLoading || !String(query || '').trim() || !String(unlockPassword || '').trim()}
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
          Esempi validi: <strong>Bar-momento</strong>, <strong>Risacca</strong>, <strong>Via Zanardelli</strong>.
          Dopo <strong>Mostra</strong> vedi il codice a 6 cifre; la password viene azzerata.
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
