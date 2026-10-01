import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import StaffGestionaleLocaleSelect from './StaffGestionaleLocaleSelect.jsx'
import { fetchStaffLocaleAccessCode, fetchStaffLocalePack, fetchStaffLocalePacks } from '../services/staffService.js'
import {
  closeOtherGestionaleStaffLocaleSessions,
  isGestionaleStaffLocaleSessionOpen,
  setGestionaleStaffLocaleSessionOpen,
} from '../utils/gestionaleStaffLocaleSession.js'
import {
  gestionaleLocaleNamesEqual,
  listGestionaleStaffLocaleNames,
  readGestionaleStaffLocale,
  writeGestionaleStaffLocale,
} from '../utils/gestionaleStaffLocale.js'
import {
  isValidLocaleAccessCode,
  normalizeLocaleAccessCode,
  verifyLocaleAccessCode,
} from '../utils/staffLocaleAccessCode.js'
import { staffLocaleCompareKey } from '../utils/primaNotaStaffLocaleLink.js'
import { readStaffLocaleStore, upsertStoredLocaleAccessCode } from '../utils/staffLocaleStore.js'

function localeNameCompareKey(value) {
  return staffLocaleCompareKey(value)
}

async function readStoredLocaleAccessCode(localeName) {
  const store = await readStaffLocaleStore()
  const target = localeNameCompareKey(localeName)
  if (!target) return ''
  for (const [rawKey, pack] of Object.entries(store || {})) {
    if (localeNameCompareKey(rawKey) === target) {
      return normalizeLocaleAccessCode(pack?.access_code)
    }
  }
  return ''
}

async function verifyLocaleZoneAccess(localeName, code, summaries) {
  const canonicalName = String(localeName || '').trim()
  const rows = summaries || []
  const hit = rows.find(
    (row) => localeNameCompareKey(row?.locale_name) === localeNameCompareKey(canonicalName),
  )

  if (hit) {
    if (!hit.requires_access_code) {
      return { ok: true, localeName: canonicalName }
    }
    try {
      await fetchStaffLocalePack(canonicalName, code)
      return { ok: true, localeName: canonicalName }
    } catch {
      const stored = await readStoredLocaleAccessCode(canonicalName)
      if (stored && verifyLocaleAccessCode(stored, code)) {
        return { ok: true, localeName: canonicalName }
      }
      return { ok: false, wrongCode: true, localeName: canonicalName }
    }
  }

  const stored = await readStoredLocaleAccessCode(canonicalName)
  if (!stored) {
    return { ok: true, localeName: canonicalName }
  }
  if (verifyLocaleAccessCode(stored, code)) {
    return { ok: true, localeName: canonicalName }
  }
  return { ok: false, wrongCode: true, localeName: canonicalName }
}

/**
 * Gate gestionale: scegli locale + codice a 6 cifre, poi Accedi.
 * I children (Report / Stipendi / …) restano nascosti finché la sessione non è aperta.
 */
export default function GestionaleStaffLocaleGate({
  children,
  title = 'Accesso personale',
  banner = null,
  onSessionChange,
  onLocaleChange,
}) {
  const [localeNames, setLocaleNames] = useState([])
  const [localeName, setLocaleNameState] = useState(() => readGestionaleStaffLocale())
  const [localeSummaries, setLocaleSummaries] = useState([])
  const [localeAccessCode, setLocaleAccessCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadingLocales, setLoadingLocales] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [sessionTick, setSessionTick] = useState(0)
  const suppressAutoOpenRef = useRef('')
  const onSessionChangeRef = useRef(onSessionChange)
  onSessionChangeRef.current = onSessionChange

  const sessionOpen = useMemo(() => {
    void sessionTick
    return isGestionaleStaffLocaleSessionOpen(localeName)
  }, [localeName, sessionTick])

  const setLocaleName = useCallback(
    (name) => {
      const next = String(name || '').trim()
      const prev = String(localeName || '').trim()
      if (prev && !gestionaleLocaleNamesEqual(prev, next)) {
        setGestionaleStaffLocaleSessionOpen(prev, false)
      }
      writeGestionaleStaffLocale(next)
      setLocaleNameState(next)
      suppressAutoOpenRef.current = ''
      setLocaleAccessCode('')
      setError('')
      setSuccess('')
      setSessionTick((n) => n + 1)
      onLocaleChange?.(next)
      onSessionChange?.(false)
    },
    [localeName, onLocaleChange, onSessionChange],
  )

  const refreshLocaleNames = useCallback(async () => {
    setLoadingLocales(true)
    try {
      const names = await listGestionaleStaffLocaleNames()
      setLocaleNames(names)
      const stored = readGestionaleStaffLocale()
      if (stored && names.some((n) => gestionaleLocaleNamesEqual(n, stored))) {
        setLocaleNameState(stored)
      } else if (stored && !names.some((n) => gestionaleLocaleNamesEqual(n, stored))) {
        setLocaleNameState('')
        writeGestionaleStaffLocale('')
      }
      try {
        const summaries = await fetchStaffLocalePacks()
        setLocaleSummaries(Array.isArray(summaries) ? summaries : [])
      } catch {
        setLocaleSummaries([])
      }
    } finally {
      setLoadingLocales(false)
    }
  }, [])

  useEffect(() => {
    void refreshLocaleNames()
  }, [refreshLocaleNames])

  // Se la sessione era già aperta (navigazione tra pagine), avvisa il parent con locale/codice.
  useEffect(() => {
    if (!sessionOpen || !localeName) return
    let cancelled = false
    void (async () => {
      const stored = await readStoredLocaleAccessCode(localeName)
      if (cancelled) return
      const code = isValidLocaleAccessCode(stored) ? stored : normalizeLocaleAccessCode(localeAccessCode)
      onSessionChange?.(true, localeName, code || '')
    })()
    return () => {
      cancelled = true
    }
    // Solo al mount / cambio locale+sessione, non a ogni digitazione codice
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionOpen, localeName])

  useEffect(() => {
    if (!localeName || sessionOpen) return undefined
    if (
      suppressAutoOpenRef.current
      && gestionaleLocaleNamesEqual(suppressAutoOpenRef.current, localeName)
    ) {
      return undefined
    }
    let cancelled = false
    void (async () => {
      let code = await readStoredLocaleAccessCode(localeName)
      if (!isValidLocaleAccessCode(code)) {
        code = await fetchStaffLocaleAccessCode(localeName)
      }
      if (cancelled || !isValidLocaleAccessCode(code)) return
      if (
        suppressAutoOpenRef.current
        && gestionaleLocaleNamesEqual(suppressAutoOpenRef.current, localeName)
      ) {
        return
      }
      setLocaleAccessCode(code)
      setBusy(true)
      setError('')
      try {
        const summaries =
          localeSummaries.length > 0 ? localeSummaries : await fetchStaffLocalePacks().catch(() => [])
        const access = await verifyLocaleZoneAccess(localeName, code, summaries)
        if (cancelled || !access.ok) return
        const openName = access.localeName || localeName
        closeOtherGestionaleStaffLocaleSessions(openName)
        setGestionaleStaffLocaleSessionOpen(openName, true)
        await upsertStoredLocaleAccessCode(openName, code)
        setSessionTick((n) => n + 1)
        onSessionChangeRef.current?.(true, openName, code)
        setSuccess(`Locale «${openName}» aperto.`)
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [localeName, sessionOpen, localeSummaries])

  async function handleOpen() {
    const name = String(localeName || '').trim()
    if (!name) {
      setError('Seleziona il locale dal menu.')
      return
    }
    if (sessionOpen) {
      setSuccess(`Locale «${name}» già aperto.`)
      return
    }
    suppressAutoOpenRef.current = ''
    let code = normalizeLocaleAccessCode(localeAccessCode)
    if (!isValidLocaleAccessCode(code)) {
      code = await fetchStaffLocaleAccessCode(name)
      if (isValidLocaleAccessCode(code)) setLocaleAccessCode(code)
    }
    if (!isValidLocaleAccessCode(code)) {
      setError('Nessun codice salvato per questo locale.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const summaries =
        localeSummaries.length > 0 ? localeSummaries : await fetchStaffLocalePacks().catch(() => [])
      const access = await verifyLocaleZoneAccess(name, code, summaries)
      if (!access.ok) {
        setError(`Codice errato per «${access.localeName || name}».`)
        return
      }
      const openName = access.localeName || name
      closeOtherGestionaleStaffLocaleSessions(openName)
      setGestionaleStaffLocaleSessionOpen(openName, true)
      await upsertStoredLocaleAccessCode(openName, code)
      setSessionTick((n) => n + 1)
      onSessionChange?.(true, openName, code)
      setSuccess(`Locale «${openName}» aperto.`)
    } finally {
      setBusy(false)
    }
  }

  function handleClose() {
    const name = String(localeName || '').trim()
    if (!name) return
    setGestionaleStaffLocaleSessionOpen(name, false)
    suppressAutoOpenRef.current = name
    setLocaleAccessCode('')
    setSessionTick((n) => n + 1)
    onSessionChange?.(false, name, '')
    setError('')
    setSuccess(`Locale «${name}» chiuso.`)
  }

  return (
    <div className="gestionale-staff-locale-gate">
      {banner}
      <section className="card gestionale-staff-locale-gate-card" style={{ marginBottom: '1rem' }}>
        <h2 className="page-subheader" style={{ marginTop: 0 }}>
          {title}
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: '-0.35rem', marginBottom: '0.85rem' }}>
          Scegli la <strong>società / locale</strong>: il codice a 6 cifre si applica da solo e il locale si apre.
          Buste paga, contratti e documenti restano divisi per sede.
        </p>
        {error ? <div className="alert alert-danger">{error}</div> : null}
        {success ? <div className="alert alert-info">{success}</div> : null}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 220px', minWidth: 200 }}>
            <StaffGestionaleLocaleSelect
              localeNames={localeNames}
              value={localeName}
              onChange={setLocaleName}
              loading={loadingLocales}
              disabled={sessionOpen || busy}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0, flex: '0 1 150px', minWidth: 140 }}>
            <label>Codice zona (6 cifre)</label>
            <input
              className="form-control"
              value={localeAccessCode}
              onChange={(e) => setLocaleAccessCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(ev) => {
                if (ev.key !== 'Enter' || sessionOpen || busy) return
                ev.preventDefault()
                void handleOpen()
              }}
              placeholder="123456"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              disabled={sessionOpen || busy || !localeName}
              readOnly={sessionOpen}
            />
          </div>
          <button
            type="button"
            className={`btn prima-nota-accedi-btn${sessionOpen ? ' is-register-open' : ''}`}
            disabled={busy || sessionOpen || !localeName}
            onClick={() => void handleOpen()}
          >
            {busy ? 'Accesso…' : sessionOpen ? 'Bloccato' : 'Accedi'}
          </button>
          <button type="button" className="btn btn-outline-danger prima-nota-chiudi-btn" onClick={handleClose} disabled={busy}>
            Chiudi
          </button>
          <p style={{ flex: '1 1 100%', margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            Stato:{' '}
            <strong style={{ color: sessionOpen ? '#047857' : '#b45309' }}>{sessionOpen ? 'APERTO' : 'CHIUSO'}</strong>
            {localeName ? (
              <>
                {' '}
                — locale <strong>{localeName}</strong>
              </>
            ) : null}
          </p>
        </div>
        {!sessionOpen ? (
          <div className="alert alert-warning" style={{ marginTop: '0.85rem', marginBottom: 0 }}>
            Seleziona il locale: se il codice è già noto, l’accesso si apre da solo. Il personale di altri locali non viene mostrato.
          </div>
        ) : null}
      </section>
      {sessionOpen ? children : null}
    </div>
  )
}
