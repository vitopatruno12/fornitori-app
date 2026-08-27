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
  if (source === 'prima_nota') return 'Registro'
  return source || '—'
}

function localeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
}

/** Solo slug grezzi (via_abba), non etichette umane (Via Abba / Mediazione via abba). */
function isBareActivitySlug(value) {
  const raw = String(value || '').trim()
  return /^(via_abba|via_lattea|via_zanardelli|risacca)$/i.test(raw)
}

/** Ordine sedi note: per ogni sede Registro poi Personale. */
const LOCATION_ORDER = [
  'br risacca',
  'risacca',
  'la via lattea registro',
  'mucche volanti',
  'la via lattea',
  'via lattea',
  'via abba mediazione',
  'mediazione via abba',
  'via abba',
  'via zanardelli mediazione',
  'mediazione via zanardelli',
  'la mediazione via zanardelli',
  'via zanardelli',
  'bar momento',
]

function locationRank(value) {
  const key = localeKey(value)
  const idx = LOCATION_ORDER.findIndex((k) => key === k || key.includes(k) || k.includes(key))
  return idx === -1 ? 500 : idx
}

/** Locali/registri noti (fallback se l’API non risponde o il pack non esiste ancora). */
const FALLBACK_LOCALE_OPTIONS = [
  { value: 'BR Risacca', label: 'BR Risacca · Registro', source: 'prima_nota' },
  { value: 'Risacca', label: 'BR Risacca · Personale', source: 'personale' },
  { value: 'Via Lattea', label: 'La Via Lattea Registro · Registro', source: 'prima_nota' },
  { value: 'La Via Lattea', label: 'Mucche Volanti · Personale', source: 'personale' },
  { value: 'Via Abba', label: 'Via Abba Mediazione · Registro', source: 'prima_nota' },
  { value: 'Mediazione via abba', label: 'Via Abba Mediazione · Personale', source: 'personale' },
  { value: 'Via Zanardelli', label: 'Via Zanardelli Mediazione · Registro', source: 'prima_nota' },
  { value: 'La mediazione via zanardelli', label: 'Via Zanardelli Mediazione · Personale', source: 'personale' },
  { value: 'Bar-momento', label: 'Bar-momento · Personale', source: 'personale' },
]

function displayNameFor(value, source = '') {
  const key = localeKey(value)
  if (key.includes('risacca') || key === 'br risacca') return 'BR Risacca'
  if (key.includes('abba')) return 'Via Abba Mediazione'
  if (key.includes('zanardelli')) return 'Via Zanardelli Mediazione'
  if (key.includes('bar momento') || key.includes('bar-momento')) return 'Bar-momento'
  // Via Lattea: Registro → «La Via Lattea Registro»; Personale → Mucche Volanti
  if (key.includes('mucche')) return 'Mucche Volanti'
  if (key.includes('lattea')) {
    if (source === 'personale') return 'Mucche Volanti'
    return 'La Via Lattea Registro'
  }
  const raw = String(value || '').trim()
  return raw || '—'
}

function mergeLocaleOptions(staffRows, primaNotaRows) {
  const merged = new Map()

  function addOption(option) {
    const value = String(option?.value || '').trim()
    if (!value) return
    // Niente voci duplicate tipo via_abba / via_lattea / via_zanardelli
    if (isBareActivitySlug(value)) return

    const source = option.source || 'personale'
    const kind = source === 'prima_nota' ? 'registro' : 'personale'
    const baseName = displayNameFor(option.label || value, source)
    const dedupeKey = `${localeKey(baseName)}::${kind}`
    if (merged.has(dedupeKey)) return

    const suffix = kind === 'registro' ? 'Registro' : 'Personale'
    merged.set(dedupeKey, {
      value,
      label: `${baseName} · ${suffix}`,
      source,
      sortLocation: locationRank(baseName),
      sortKind: kind === 'registro' ? 0 : 1,
    })
  }

  for (const row of staffRows || []) {
    const name = String(row?.locale_name || '').trim()
    if (!name) continue
    if (isBareActivitySlug(name)) continue
    addOption({
      value: name,
      label: name,
      source: 'personale',
    })
  }

  for (const row of primaNotaRows || []) {
    const label = String(row?.label || row?.activity_slug || '').trim()
    if (!label) continue
    if (isBareActivitySlug(label)) continue
    // Solo etichetta umana (es. BR Risacca): non aggiungere lo slug come seconda voce
    addOption({
      value: label,
      label,
      source: 'prima_nota',
    })
  }

  for (const option of FALLBACK_LOCALE_OPTIONS) addOption(option)

  return Array.from(merged.values()).sort((a, b) => {
    if (a.sortLocation !== b.sortLocation) return a.sortLocation - b.sortLocation
    if (a.sortKind !== b.sortKind) return a.sortKind - b.sortKind
    return a.label.localeCompare(b.label, 'it')
  })
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
                <option key={`${option.source}-${option.value}-${option.label}`} value={option.value}>
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
          Esempi: <strong>BR Risacca · Registro</strong>, <strong>Via Abba Mediazione · Personale</strong>.
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
