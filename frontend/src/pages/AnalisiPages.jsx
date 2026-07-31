import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AnalisiPageShell,
  AnalisiSyncStatus,
  HeatmapGrid,
  SeriesBars,
  eur,
} from '../components/AnalisiShared.jsx'
import {
  fetchAnalyticsDaily,
  fetchAnalyticsHourly,
  fetchAnalyticsMonthly,
  fetchAnalyticsOverview,
  fetchAnalyticsStaffing,
  fetchAnalyticsWeekly,
} from '../services/analyticsService'

const ANALISI_CACHE_PREFIX = 'analisi_cache_v2:'
const ANALISI_REFRESH_EVERY_MS = 20 * 60 * 1000 // 20 min
const ANALISI_MORNING_HOUR = 7
const ANALISI_BACKGROUND_CHECK_MS = 60 * 1000 // 1 min: controlla se serve refresh

function readAnalisiCache(cacheKey) {
  try {
    const raw = localStorage.getItem(`${ANALISI_CACHE_PREFIX}${cacheKey}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const savedAt = Number(parsed.savedAt || 0)
    if (!Number.isFinite(savedAt) || !parsed.data) return null
    return { savedAt, data: parsed.data }
  } catch {
    return null
  }
}

function writeAnalisiCache(cacheKey, data) {
  try {
    localStorage.setItem(
      `${ANALISI_CACHE_PREFIX}${cacheKey}`,
      JSON.stringify({
        savedAt: Date.now(),
        data,
      }),
    )
  } catch {
    // ignore quota/storage errors
  }
}

function shouldRefreshAnalytics(savedAtMs) {
  if (!savedAtMs) return true
  const now = Date.now()
  if (now - savedAtMs >= ANALISI_REFRESH_EVERY_MS) return true

  const nowDate = new Date(now)
  const savedDate = new Date(savedAtMs)
  const todayKey = `${nowDate.getFullYear()}-${nowDate.getMonth()}-${nowDate.getDate()}`
  const savedKey = `${savedDate.getFullYear()}-${savedDate.getMonth()}-${savedDate.getDate()}`
  if (todayKey !== savedKey && nowDate.getHours() >= ANALISI_MORNING_HOUR) return true

  return false
}

function isFailedEmptyAnalytics(data) {
  if (!data || typeof data !== 'object') return false
  const warnings = Array.isArray(data.warnings) ? data.warnings : []
  if (!warnings.length) return false
  const snap = data.snapshot || data
  const incasso =
    Number(snap?.incasso_oggi ?? data?.total_incasso ?? data?.total ?? 0) || 0
  const movimenti = Number(snap?.movimenti_oggi ?? data?.total_movimenti ?? 0) || 0
  const rows = Array.isArray(data.rows) ? data.rows : []
  const rowSum = rows.reduce((acc, r) => acc + (Number(r?.incasso || r?.amount || 0) || 0), 0)
  return incasso === 0 && movimenti === 0 && rowSum === 0
}

function useAnalisiFetch(cacheKey, loader, deps = []) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState(0)
  const [fromCache, setFromCache] = useState(false)
  const [error, setError] = useState('')
  const [refreshTick, setRefreshTick] = useState(0)

  const forceRefresh = React.useCallback(() => {
    setRefreshTick((v) => v + 1)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function runRefresh({ force = false } = {}) {
      const cached = readAnalisiCache(cacheKey)
      const cachedIsBad = cached && isFailedEmptyAnalytics(cached.data)
      if (!force && cached && !cachedIsBad && !shouldRefreshAnalytics(cached.savedAt)) return
      if (!cancelled) {
        setRefreshing(true)
        if (!cached) setLoading(true)
      }
      try {
        const res = await loader()
        if (cancelled) return
        setData(res)
        setError('')
        setFromCache(false)
        setLastSyncAt(Date.now())
        // Non salvare risposte a zero con errori VNE: altrimenti restano 0 per ore.
        if (isFailedEmptyAnalytics(res)) {
          try {
            localStorage.removeItem(`${ANALISI_CACHE_PREFIX}${cacheKey}`)
          } catch {
            // ignore
          }
        } else {
          writeAnalisiCache(cacheKey, res)
        }
      } catch (e) {
        if (cancelled) return
        if (!cached) {
          setData(null)
          setError(e?.message || 'Errore caricamento analisi VNE')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    }

    ;(async () => {
      setError('')
      const cached = readAnalisiCache(cacheKey)
      if (cached) {
        setData(cached.data)
        setLastSyncAt(cached.savedAt)
        setFromCache(true)
        setLoading(false)
      } else {
        setLoading(true)
      }
      await runRefresh({ force: refreshTick > 0 || isFailedEmptyAnalytics(cached?.data) })
    })()

    const timer = window.setInterval(() => {
      void runRefresh({ force: false })
    }, ANALISI_BACKGROUND_CHECK_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, refreshTick, ...deps])

  return { data, loading, refreshing, error, lastSyncAt, fromCache, refreshNow: forceRefresh }
}

function classifyVneLight(warnings, data) {
  const items = (Array.isArray(warnings) ? warnings : [])
    .map((w) => String(w || '').trim())
    .filter(Boolean)
  const blob = items.join('\n').toLowerCase()
  const hardError =
    isFailedEmptyAnalytics(data) ||
    /403|forbidden|accesso negato|credenzial|csrf|http error|errore query|non validi|sessione/.test(
      blob,
    )
  const delayed =
    /timeout|rallent|ritardo|non accessibile|lenta|504|troppo lenta/.test(blob) ||
    (items.length > 0 && !hardError)

  if (hardError) return 'red'
  if (delayed) return 'yellow'
  return 'green'
}

/** Semaforo stato VNE: verde ok, giallo ritardo, rosso errore. */
function VneStatusSemaphore({ warnings, data }) {
  if (data == null) return null
  const light = classifyVneLight(warnings, data)
  const labels = {
    green: 'Operativo',
    yellow: 'Rallentamento o in ritardo',
    red: 'Errore',
  }

  return (
    <div
      className={`analisi-vne-semaphore analisi-vne-semaphore--${light}`}
      role="status"
      aria-label={`Stato VNE: ${labels[light]}`}
    >
      <div className="analisi-vne-semaphore-housing" aria-hidden>
        <span className={`analisi-vne-light analisi-vne-light--red${light === 'red' ? ' is-on' : ''}`} />
        <span className={`analisi-vne-light analisi-vne-light--yellow${light === 'yellow' ? ' is-on' : ''}`} />
        <span className={`analisi-vne-light analisi-vne-light--green${light === 'green' ? ' is-on' : ''}`} />
      </div>
      <ul className="analisi-vne-semaphore-legend">
        <li className={light === 'green' ? 'is-active' : ''}>
          <span className="analisi-vne-legend-dot analisi-vne-legend-dot--green" />
          Verde — operativo
        </li>
        <li className={light === 'yellow' ? 'is-active' : ''}>
          <span className="analisi-vne-legend-dot analisi-vne-legend-dot--yellow" />
          Giallo — rallentamento o in ritardo
        </li>
        <li className={light === 'red' ? 'is-active' : ''}>
          <span className="analisi-vne-legend-dot analisi-vne-legend-dot--red" />
          Rosso — errore
        </li>
      </ul>
    </div>
  )
}

function DataNote({ text }) {
  if (!text) return null
  // Evita note vecchie ancora in cache browser (cache ~20 min / portale remoto).
  const cleaned = String(text)
    .replace(/\s*Aggiornamento live dal portale remoto;?\s*risultati in cache\s*~?\s*20\s*minuti\.?/gi, '')
    .replace(/\s*risultati in cache\s*~?\s*20\s*minuti\.?/gi, '')
    .trim()
  if (!cleaned) return null
  return <p className="analisi-note">{cleaned}</p>
}

export function AnalisiDashboardPage() {
  const { data, loading, refreshing, error, lastSyncAt, refreshNow } = useAnalisiFetch(
    'overview:months=3',
    () => fetchAnalyticsOverview({ months: 3 }),
    [],
  )
  const snap = data?.snapshot
  const machines = Array.isArray(data?.by_machine) ? data.by_machine : []

  return (
    <AnalisiPageShell
      title="Dashboard Analitica"
      lead="Incassi e traffico VNE divisi per macchina: La Risacca, Mani in Pasta, Le Mucche Volanti."
      actions={
        <button type="button" className="btn btn-secondary btn-sm" onClick={refreshNow} disabled={refreshing || loading}>
          {refreshing || loading ? 'Aggiorno…' : 'Aggiorna ora'}
        </button>
      }
    >
      <AnalisiSyncStatus loading={loading} refreshing={refreshing} lastSyncAt={lastSyncAt} />
      {error && <div className="alert alert-danger">{error}</div>}
      <VneStatusSemaphore warnings={data?.warnings} data={data} />
      <DataNote text={data?.data_note} />

      {loading && !snap ? (
        <div className="analisi-skeleton-grid" aria-hidden>
          <div className="analisi-skeleton-card" />
          <div className="analisi-skeleton-card" />
          <div className="analisi-skeleton-card" />
        </div>
      ) : null}

      {snap && (
        <section className="dashboard-kpi-grid analisi-kpi-grid" style={{ marginBottom: '1rem' }}>
          <div className="dashboard-kpi dashboard-kpi--primary">
            <div className="dashboard-kpi-label">Totale incasso oggi</div>
            <div className="dashboard-kpi-value">{eur(snap.incasso_oggi)}</div>
            <div className="dashboard-kpi-hint">Somma di tutte le macchine</div>
          </div>
          <div className="dashboard-kpi">
            <div className="dashboard-kpi-label">Operazioni oggi</div>
            <div className="dashboard-kpi-value">{snap.movimenti_oggi}</div>
            <div className="dashboard-kpi-hint">Tutte le macchine</div>
          </div>
          <div className="dashboard-kpi dashboard-kpi--secondary">
            <div className="dashboard-kpi-label">Macchine</div>
            <div className="dashboard-kpi-value">{machines.length || snap.machines?.length || 0}</div>
            <div className="dashboard-kpi-hint">Schede sotto</div>
          </div>
        </section>
      )}

      {machines.length > 0 && (
        <div className="analisi-machine-grid">
          {machines.map((m) => {
            const s = m.snapshot || {}
            return (
              <section key={m.model_id} className="card analisi-panel analisi-machine-card">
                <h2 className="analisi-panel-title">{m.model_label}</h2>
                <div className="analisi-machine-kpis">
                  <div>
                    <div className="dashboard-kpi-label">Incasso oggi</div>
                    <div className="dashboard-kpi-value" style={{ fontSize: '1.25rem' }}>
                      {eur(s.incasso_oggi)}
                    </div>
                  </div>
                  <div>
                    <div className="dashboard-kpi-label">Operazioni</div>
                    <div className="dashboard-kpi-value" style={{ fontSize: '1.25rem' }}>
                      {s.movimenti_oggi ?? 0}
                    </div>
                  </div>
                  <div>
                    <div className="dashboard-kpi-label">Picco</div>
                    <div className="dashboard-kpi-value" style={{ fontSize: '1rem' }}>
                      {s.picco_previsto?.slot_label || '—'}
                    </div>
                    <div className="dashboard-kpi-sub">
                      {s.picco_previsto?.operatori_consigliati || 1} op. consigliati
                    </div>
                  </div>
                </div>
                <p className="analisi-home-peak" style={{ marginTop: '0.65rem' }}>
                  {s.picco_previsto?.message || 'Nessun picco storico disponibile.'}
                </p>
                <h3 className="analisi-machine-subtitle">Fasce consigliate</h3>
                <ul className="analisi-suggestions">
                  {(m.top_slots || []).map((slot) => (
                    <li key={`${m.model_id}-${slot.weekday_label}-${slot.slot_label}`}>{slot.message}</li>
                  ))}
                  {!m.top_slots?.length ? <li>Pochi dati operazioni per questa macchina.</li> : null}
                </ul>
                <h3 className="analisi-machine-subtitle">Andamento settimanale</h3>
                <SeriesBars
                  rows={(m.weekly?.rows || []).map((r) => ({ ...r, label: r.label }))}
                  labelKey="label"
                />
                <div className="analisi-panel-actions">
                  <Link className="btn btn-secondary btn-sm" to={`/analisi/oraria`}>
                    Heatmap
                  </Link>
                  <Link className="btn btn-secondary btn-sm" to="/vne">
                    Apri VNE
                  </Link>
                </div>
              </section>
            )
          })}
        </div>
      )}

      {data?.monthly?.rows?.length ? (
        <section className="card analisi-panel" style={{ marginTop: '1rem' }}>
          <h2 className="analisi-panel-title">Andamento mensile (tutte le macchine)</h2>
          <SeriesBars rows={data.monthly.rows || []} labelKey="month_label" />
        </section>
      ) : null}
    </AnalisiPageShell>
  )
}

export function AnalisiGiornalieroPage() {
  const { data, loading, refreshing, error, lastSyncAt, refreshNow } = useAnalisiFetch(
    'daily:days=30',
    () => fetchAnalyticsDaily({ days: 30 }),
    [],
  )
  return (
    <AnalisiPageShell
      title="Andamento giornaliero"
      lead="Incassi giorno per giorno da chiusure cassa VNE (e operazioni se mancano chiusure)."
      actions={
        <button type="button" className="btn btn-secondary btn-sm" onClick={refreshNow} disabled={refreshing}>
          {refreshing ? 'Aggiorno…' : 'Aggiorna ora'}
        </button>
      }
    >
      <AnalisiSyncStatus loading={loading} refreshing={refreshing} lastSyncAt={lastSyncAt} />
      {error && <div className="alert alert-danger">{error}</div>}
      <VneStatusSemaphore warnings={data?.warnings} data={data} />
      <DataNote text={data?.data_note} />
      {data && (
        <section className="card analisi-panel">
          <p className="analisi-total">
            Totale periodo: <strong>{eur(data.total_incasso)}</strong>
          </p>
          <SeriesBars
            rows={(data.rows || []).map((r) => ({
              ...r,
              label: `${r.weekday_label?.slice(0, 3) || ''} ${r.date?.slice(5) || ''}`.trim(),
            }))}
          />
        </section>
      )}
    </AnalisiPageShell>
  )
}

export function AnalisiSettimanalePage() {
  const { data, loading, refreshing, error, lastSyncAt, refreshNow } = useAnalisiFetch(
    'weekly:weeks=12',
    () => fetchAnalyticsWeekly({ weeks: 12 }),
    [],
  )
  return (
    <AnalisiPageShell
      title="Andamento settimanale"
      lead="Confronto settimane da dati VNE."
      actions={
        <button type="button" className="btn btn-secondary btn-sm" onClick={refreshNow} disabled={refreshing}>
          {refreshing ? 'Aggiorno…' : 'Aggiorna ora'}
        </button>
      }
    >
      <AnalisiSyncStatus loading={loading} refreshing={refreshing} lastSyncAt={lastSyncAt} />
      {error && <div className="alert alert-danger">{error}</div>}
      <VneStatusSemaphore warnings={data?.warnings} data={data} />
      <DataNote text={data?.data_note} />
      {data && (
        <section className="card analisi-panel">
          <p className="analisi-total">
            Totale periodo: <strong>{eur(data.total_incasso)}</strong>
          </p>
          <SeriesBars rows={data.rows || []} labelKey="label" />
        </section>
      )}
    </AnalisiPageShell>
  )
}

export function AnalisiMensilePage() {
  const { data, loading, refreshing, error, lastSyncAt, refreshNow } = useAnalisiFetch(
    'monthly:months=6',
    () => fetchAnalyticsMonthly({ months: 6 }),
    [],
  )
  return (
    <AnalisiPageShell
      title="Andamento mensile"
      lead="Incassi mensili aggregati da chiusure/operazioni VNE."
      actions={
        <button type="button" className="btn btn-secondary btn-sm" onClick={refreshNow} disabled={refreshing}>
          {refreshing ? 'Aggiorno…' : 'Aggiorna ora'}
        </button>
      }
    >
      <AnalisiSyncStatus loading={loading} refreshing={refreshing} lastSyncAt={lastSyncAt} />
      {error && <div className="alert alert-danger">{error}</div>}
      <VneStatusSemaphore warnings={data?.warnings} data={data} />
      <DataNote text={data?.data_note} />
      {data && (
        <section className="card analisi-panel">
          <p className="analisi-total">
            Totale periodo: <strong>{eur(data.total_incasso)}</strong>
          </p>
          <SeriesBars rows={data.rows || []} labelKey="month_label" />
        </section>
      )}
    </AnalisiPageShell>
  )
}

export function AnalisiOrariaPage() {
  const { data, loading, refreshing, error, lastSyncAt, refreshNow } = useAnalisiFetch(
    'hourly:months=3',
    () => fetchAnalyticsHourly({ months: 3 }),
    [],
  )
  return (
    <AnalisiPageShell
      title="Analisi oraria"
      lead="Heatmap dalle operazioni VNE: intensità = traffico storico. Il numero è gli operatori consigliati."
      actions={
        <button type="button" className="btn btn-secondary btn-sm" onClick={refreshNow} disabled={refreshing}>
          {refreshing ? 'Aggiorno…' : 'Aggiorna ora'}
        </button>
      }
    >
      <AnalisiSyncStatus loading={loading} refreshing={refreshing} lastSyncAt={lastSyncAt} />
      {error && <div className="alert alert-danger">{error}</div>}
      <VneStatusSemaphore warnings={data?.warnings} data={data} />
      <DataNote text={data?.data_note} />
      {data && (
        <>
          <section className="card analisi-panel">
            <HeatmapGrid hours={data.hours} weekdays={data.weekdays} cells={data.cells} />
          </section>
          <section className="card analisi-panel">
            <h2 className="analisi-panel-title">Top fasce</h2>
            <ul className="analisi-suggestions">
              {(data.suggestions || []).map((s) => (
                <li key={`${s.weekday_label}-${s.slot_label}`}>
                  {s.message} · media {eur(s.avg_amount)}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </AnalisiPageShell>
  )
}

export function AnalisiPianificazionePage() {
  const { data, loading, refreshing, error, lastSyncAt, refreshNow } = useAnalisiFetch(
    'staffing:months=3',
    () => fetchAnalyticsStaffing({ months: 3 }),
    [],
  )
  return (
    <AnalisiPageShell
      title="Pianificazione personale"
      lead="Copertura consigliata per fascia, calcolata sul traffico delle operazioni VNE."
      actions={
        <button type="button" className="btn btn-secondary btn-sm" onClick={refreshNow} disabled={refreshing}>
          {refreshing ? 'Aggiorno…' : 'Aggiorna ora'}
        </button>
      }
    >
      <AnalisiSyncStatus loading={loading} refreshing={refreshing} lastSyncAt={lastSyncAt} />
      {error && <div className="alert alert-danger">{error}</div>}
      <VneStatusSemaphore warnings={data?.warnings} data={data} />
      {data && (
        <>
          <p className="analisi-note">{data.note}</p>
          <div className="analisi-staffing-grid">
            {(data.days || []).map((day) => (
              <section key={day.weekday} className="card analisi-panel analisi-staffing-day">
                <h2 className="analisi-panel-title">
                  {day.weekday_label}
                  <span className="analisi-peak-pill">picco {day.peak_operators} op.</span>
                </h2>
                {day.slots?.length ? (
                  <ul className="analisi-suggestions">
                    {day.slots.map((s) => (
                      <li key={s.slot_label}>
                        <strong>{s.slot_label}</strong> — {s.message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="empty-state">Poco traffico storico: copertura minima.</p>
                )}
              </section>
            ))}
          </div>
        </>
      )}
    </AnalisiPageShell>
  )
}
