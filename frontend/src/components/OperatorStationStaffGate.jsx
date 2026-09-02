import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchStaffLocalePack, fetchStaffLocalePacks } from '../services/staffService.js'
import { getOperatorStationStaffLocaleName, getOperatorStationActivitySlug } from '../utils/operatorStationLocale.js'
import {
  closeOtherOperatorStationStaffSessions,
  isOperatorStationStaffSessionOpen,
  setOperatorStationStaffSession,
} from '../utils/operatorStationStaffSession.js'
import {
  isValidLocaleAccessCode,
  normalizeLocaleAccessCode,
  verifyLocaleAccessCode,
} from '../utils/staffLocaleAccessCode.js'
import { matchStaffLocaleName, staffLocaleCompareKey } from '../utils/primaNotaStaffLocaleLink.js'
import { readStaffLocaleStore, upsertStoredLocaleAccessCode } from '../utils/staffLocaleStore.js'
import { getLockedOperatorStationId } from '../utils/operatorMode.ts'

function localeNameCompareKey(value) {
  return staffLocaleCompareKey(value)
}

async function readStoredLocaleAccessCode(localeName) {
  const store = await readStaffLocaleStore()
  const target = localeNameCompareKey(localeName)
  for (const [rawKey, pack] of Object.entries(store || {})) {
    const packKey = localeNameCompareKey(rawKey)
    if (packKey === target || packKey.includes(target) || target.includes(packKey)) {
      return normalizeLocaleAccessCode(pack?.access_code)
    }
  }
  return ''
}

function resolveCanonicalLocaleName(localeName, summaries, activitySlug = '') {
  const names = (summaries || []).map((row) => row?.locale_name).filter(Boolean)
  return matchStaffLocaleName(localeName, names, activitySlug) || String(localeName || '').trim()
}

async function verifyLocaleZoneAccess(localeName, code, summaries, activitySlug = '') {
  const canonicalName = resolveCanonicalLocaleName(localeName, summaries, activitySlug)
  try {
    const rows = summaries || []
    const hit = rows.find(
      (row) => localeNameCompareKey(row?.locale_name) === localeNameCompareKey(canonicalName),
    )
    if (hit?.requires_access_code) {
      await fetchStaffLocalePack(canonicalName, code)
      return { ok: true, localeName: canonicalName }
    }
    if (hit) return { ok: true, localeName: canonicalName }
  } catch {
    const stored = await readStoredLocaleAccessCode(canonicalName)
    if (stored && verifyLocaleAccessCode(stored, code)) {
      return { ok: true, localeName: canonicalName }
    }
    return { ok: false, wrongCode: true, localeName: canonicalName }
  }
  const stored = await readStoredLocaleAccessCode(canonicalName)
  if (stored && verifyLocaleAccessCode(stored, code)) {
    return { ok: true, localeName: canonicalName }
  }
  return { ok: false, wrongCode: true, localeName: canonicalName }
}

export default function OperatorStationStaffGate({
  stationId: stationIdProp = null,
  children,
  title = 'Accesso personale',
  banner = null,
  onSessionChange,
}) {
  const stationId = stationIdProp || getLockedOperatorStationId()
  const [savedLocaleNames, setSavedLocaleNames] = useState([])
  const [localeAccessCode, setLocaleAccessCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [sessionTick, setSessionTick] = useState(0)

  const stationStaffLocaleName = useMemo(
    () => getOperatorStationStaffLocaleName(stationId, savedLocaleNames),
    [stationId, savedLocaleNames],
  )
  const activitySlug = useMemo(() => getOperatorStationActivitySlug(stationId), [stationId])
  const [localeSummaries, setLocaleSummaries] = useState([])

  const sessionOpen = useMemo(() => {
    void sessionTick
    return isOperatorStationStaffSessionOpen(stationId, stationStaffLocaleName)
  }, [stationId, stationStaffLocaleName, sessionTick])

  const refreshLocaleNames = useCallback(async () => {
    try {
      const store = await readStaffLocaleStore()
      const names = new Set(Object.keys(store || {}))
      let summaries = []
      try {
        summaries = await fetchStaffLocalePacks()
        setLocaleSummaries(Array.isArray(summaries) ? summaries : [])
        for (const row of summaries || []) {
          const n = String(row?.locale_name || '').trim()
          if (n) names.add(n)
        }
      } catch {
        setLocaleSummaries([])
        // server assente
      }
      setSavedLocaleNames([...names].sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' })))
    } catch {
      setSavedLocaleNames([])
      setLocaleSummaries([])
    }
  }, [])

  useEffect(() => {
    closeOtherOperatorStationStaffSessions(stationId)
    void refreshLocaleNames()
  }, [stationId, refreshLocaleNames])

  useEffect(() => {
    if (!stationStaffLocaleName) return
    void (async () => {
      const stored = await readStoredLocaleAccessCode(stationStaffLocaleName)
      if (isValidLocaleAccessCode(stored)) {
        setLocaleAccessCode(stored)
      }
    })()
  }, [stationStaffLocaleName])

  async function handleOpen() {
    const localeName = resolveCanonicalLocaleName(
      stationStaffLocaleName,
      localeSummaries.length ? localeSummaries : await fetchStaffLocalePacks().catch(() => []),
      activitySlug,
    )
    if (!localeName) {
      setError('Locale personale non configurato per questa postazione.')
      return
    }
    if (sessionOpen) {
      setSuccess(`Locale «${localeName}» già aperto.`)
      return
    }
    const code = normalizeLocaleAccessCode(localeAccessCode)
    if (!isValidLocaleAccessCode(code)) {
      setError('Inserisci il codice a 6 cifre del locale.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const summaries = localeSummaries.length ? localeSummaries : await fetchStaffLocalePacks().catch(() => [])
      const access = await verifyLocaleZoneAccess(localeName, code, summaries, activitySlug)
      if (!access.ok) {
        setError(`Codice errato per «${access.localeName || localeName}».`)
        return
      }
      setOperatorStationStaffSession(stationId, access.localeName || localeName, true)
      setSessionTick((n) => n + 1)
      await upsertStoredLocaleAccessCode(access.localeName || localeName, code)
      onSessionChange?.(true)
      setSuccess(`Locale «${access.localeName || localeName}» aperto.`)
    } finally {
      setBusy(false)
    }
  }

  function handleClose() {
    const localeName = stationStaffLocaleName
    if (!localeName) return
    setOperatorStationStaffSession(stationId, localeName, false)
    setLocaleAccessCode('')
    setSessionTick((n) => n + 1)
    onSessionChange?.(false)
    setError('')
    setSuccess(`Locale «${localeName}» chiuso.`)
  }

  return (
    <div className="operator-station-staff-gate">
      {banner}
      <section className="card operator-station-staff-gate-card" style={{ marginBottom: '1rem' }}>
        <h2 className="page-subheader" style={{ marginTop: 0 }}>
          {banner ? 'Accesso personale' : title}
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: '-0.35rem', marginBottom: '0.85rem' }}>
          Locale: <strong>{stationStaffLocaleName || '—'}</strong>. Inserisci il codice e clicca <strong>Accedi</strong> per
          visualizzare i dati di questa sede.
        </p>
        {error ? <div className="alert alert-danger">{error}</div> : null}
        {success ? <div className="alert alert-info">{success}</div> : null}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ marginBottom: 0, flex: '0 1 150px', minWidth: 140 }}>
            <label>Codice zona (6 cifre)</label>
            <input
              className="form-control"
              value={localeAccessCode}
              onChange={(e) => setLocaleAccessCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              disabled={sessionOpen || busy}
              readOnly={sessionOpen}
            />
          </div>
          <button
            type="button"
            className={`btn prima-nota-accedi-btn${sessionOpen ? ' is-register-open' : ''}`}
            disabled={busy || sessionOpen || !stationStaffLocaleName}
            onClick={() => void handleOpen()}
          >
            {busy ? 'Accesso…' : sessionOpen ? 'Bloccato' : 'Accedi'}
          </button>
          <button type="button" className="btn btn-outline-danger prima-nota-chiudi-btn" onClick={handleClose} disabled={busy}>
            Chiudi
          </button>
          <p style={{ flex: '1 1 100%', margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            Stato: <strong style={{ color: sessionOpen ? '#047857' : '#b45309' }}>{sessionOpen ? 'APERTO' : 'CHIUSO'}</strong>
          </p>
        </div>
        {!sessionOpen ? (
          <div className="alert alert-warning" style={{ marginTop: '0.85rem', marginBottom: 0 }}>
            I dati personale di <strong>{stationStaffLocaleName || 'questa postazione'}</strong> sono nascosti finché non apri il
            locale.
          </div>
        ) : null}
      </section>
      {sessionOpen ? children : null}
    </div>
  )
}
