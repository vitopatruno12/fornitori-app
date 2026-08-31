import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AnalisiPageShell,
  AnalisiSyncStatus,
  HeatmapGrid,
  MachineCompareCharts,
  PopularTimesChart,
  SeriesBars,
  TopSlotsColumnChart,
  VneStatusSemaphore,
  resolveAnalisiVneSemaphoreLight,
  eur,
} from '../components/AnalisiShared.jsx'
import { AnalisiTrendToolbar, useAnalisiMachineFilter } from '../components/AnalisiMachineFilter.jsx'
import {
  fetchAnalyticsDaily,
  fetchAnalyticsHourly,
  fetchAnalyticsMonthly,
  fetchAnalyticsOverview,
  fetchAnalyticsStaffing,
  fetchAnalyticsWeekly,
} from '../services/analyticsService'
import { EasyRetailPosImportPanel } from '../components/EasyRetailPosImportPanel.jsx'
import { AnalisiMachineCard } from '../components/AnalisiMachineCard.jsx'

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

function AnalisiVneSemaphore({ data, loading = false, refreshing = false, error = '' }) {
  const light = resolveAnalisiVneSemaphoreLight({
    data,
    loading,
    refreshing,
    error,
    expectedMachines: 3,
  })
  return <VneStatusSemaphore light={light} show />
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
      lead="Incassi e traffico per locale: VNE (Risacca, Mani in Pasta Via Zanardelli, Mucche Volanti) + scontrini EasyRetail (Mani Via Abba) + Gazza Ladra (POS Poste, struttura pronta)."
      vneStatus={<AnalisiVneSemaphore data={data} loading={loading} refreshing={refreshing} error={error} />}
      actions={
        <button type="button" className="btn btn-secondary btn-sm" onClick={refreshNow} disabled={refreshing || loading}>
          {refreshing || loading ? 'Aggiorno…' : 'Aggiorna ora'}
        </button>
      }
    >
      <AnalisiSyncStatus loading={loading} refreshing={refreshing} lastSyncAt={lastSyncAt} />
      {error && <div className="alert alert-danger">{error}</div>}
      <DataNote text={data?.data_note} />

      <EasyRetailPosImportPanel onImported={() => refreshNow()} />

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
            <div className="dashboard-kpi-hint">VNE + Abba + Gazza Ladra (quando importati)</div>
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

      {machines.length > 0 ? <MachineCompareCharts machines={machines} /> : null}

      {machines.length > 0 && (
        <div className="analisi-machine-grid">
          {machines.map((m) => (
            <AnalisiMachineCard key={m.model_id} machine={m} />
          ))}
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
  const { modelId, setModelId, maniViewId, setManiViewId, location, machineLabel } = useAnalisiMachineFilter()
  const { data, loading, refreshing, error, lastSyncAt, refreshNow } = useAnalisiFetch(
    `daily:days=30:${modelId}:${maniViewId}`,
    () => fetchAnalyticsDaily({ days: 30, modelId, location }),
    [modelId, maniViewId],
  )
  return (
    <AnalisiPageShell
      title={`Andamento giornaliero — ${machineLabel}`}
      lead={`Incassi giorno per giorno da chiusure cassa VNE della macchina ${machineLabel}.`}
      vneStatus={<AnalisiVneSemaphore data={data} loading={loading} refreshing={refreshing} error={error} />}
      actions={
        <AnalisiTrendToolbar
          selectId="analisi-daily-machine"
          maniSelectId="analisi-daily-mani-view"
          modelId={modelId}
          onModelChange={setModelId}
          maniViewId={maniViewId}
          onManiViewChange={setManiViewId}
          onRefresh={refreshNow}
          refreshing={refreshing}
          loading={loading}
        />
      }
    >
      <AnalisiSyncStatus loading={loading} refreshing={refreshing} lastSyncAt={lastSyncAt} />
      {error && <div className="alert alert-danger">{error}</div>}
      <DataNote text={data?.data_note} />
      {data && (
        <section className="card analisi-panel">
          <h2 className="analisi-panel-title">Flusso giornaliero · {machineLabel}</h2>
          <p className="analisi-total">
            Totale periodo ({machineLabel}): <strong>{eur(data.total_incasso)}</strong>
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
  const { modelId, setModelId, maniViewId, setManiViewId, location, machineLabel } = useAnalisiMachineFilter()
  const { data, loading, refreshing, error, lastSyncAt, refreshNow } = useAnalisiFetch(
    `weekly:weeks=12:${modelId}:${maniViewId}`,
    () => fetchAnalyticsWeekly({ weeks: 12, modelId, location }),
    [modelId, maniViewId],
  )
  return (
    <AnalisiPageShell
      title={`Andamento settimanale — ${machineLabel}`}
      lead={`Confronto settimane per ${machineLabel} (VNE o scontrini a seconda della sede).`}
      vneStatus={<AnalisiVneSemaphore data={data} loading={loading} refreshing={refreshing} error={error} />}
      actions={
        <AnalisiTrendToolbar
          selectId="analisi-weekly-machine"
          maniSelectId="analisi-weekly-mani-view"
          modelId={modelId}
          onModelChange={setModelId}
          maniViewId={maniViewId}
          onManiViewChange={setManiViewId}
          onRefresh={refreshNow}
          refreshing={refreshing}
          loading={loading}
        />
      }
    >
      <AnalisiSyncStatus loading={loading} refreshing={refreshing} lastSyncAt={lastSyncAt} />
      {error && <div className="alert alert-danger">{error}</div>}
      <DataNote text={data?.data_note} />
      {data && (
        <section className="card analisi-panel">
          <h2 className="analisi-panel-title">Flusso settimanale · {machineLabel}</h2>
          <p className="analisi-total">
            Totale periodo ({machineLabel}): <strong>{eur(data.total_incasso)}</strong>
          </p>
          <SeriesBars rows={data.rows || []} labelKey="label" />
        </section>
      )}
    </AnalisiPageShell>
  )
}

export function AnalisiMensilePage() {
  const { modelId, setModelId, maniViewId, setManiViewId, location, machineLabel } = useAnalisiMachineFilter()
  const { data, loading, refreshing, error, lastSyncAt, refreshNow } = useAnalisiFetch(
    `monthly:months=6:${modelId}:${maniViewId}`,
    () => fetchAnalyticsMonthly({ months: 6, modelId, location }),
    [modelId, maniViewId],
  )
  return (
    <AnalisiPageShell
      title={`Andamento mensile — ${machineLabel}`}
      lead={`Incassi mensili per ${machineLabel} (VNE Via Zanardelli o scontrini Via Abba).`}
      vneStatus={<AnalisiVneSemaphore data={data} loading={loading} refreshing={refreshing} error={error} />}
      actions={
        <AnalisiTrendToolbar
          selectId="analisi-monthly-machine"
          maniSelectId="analisi-monthly-mani-view"
          modelId={modelId}
          onModelChange={setModelId}
          maniViewId={maniViewId}
          onManiViewChange={setManiViewId}
          onRefresh={refreshNow}
          refreshing={refreshing}
          loading={loading}
        />
      }
    >
      <AnalisiSyncStatus loading={loading} refreshing={refreshing} lastSyncAt={lastSyncAt} />
      {error && <div className="alert alert-danger">{error}</div>}
      <DataNote text={data?.data_note} />
      {data && (
        <section className="card analisi-panel">
          <h2 className="analisi-panel-title">Flusso mensile · {machineLabel}</h2>
          <p className="analisi-total">
            Totale periodo ({machineLabel}): <strong>{eur(data.total_incasso)}</strong>
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
  const machines = Array.isArray(data?.by_machine) ? data.by_machine : []
  const machineLabels =
    (Array.isArray(data?.machines) && data.machines.length
      ? data.machines
      : machines.map((m) => m.model_label).filter(Boolean)) || []

  return (
    <AnalisiPageShell
      title="Analisi oraria"
      lead="Heatmap e flusso traffico VNE per macchina: intensità = storico operazioni. Il numero è gli operatori consigliati."
      vneStatus={<AnalisiVneSemaphore data={data} loading={loading} refreshing={refreshing} error={error} />}
      actions={
        <button type="button" className="btn btn-secondary btn-sm" onClick={refreshNow} disabled={refreshing}>
          {refreshing ? 'Aggiorno…' : 'Aggiorna ora'}
        </button>
      }
    >
      <AnalisiSyncStatus loading={loading} refreshing={refreshing} lastSyncAt={lastSyncAt} />
      {error && <div className="alert alert-danger">{error}</div>}
      <DataNote text={data?.data_note} />
      {data && (
        <>
          <section className="card analisi-panel">
            <h2 className="analisi-panel-title">Heatmap e flusso — tutte le macchine</h2>
            <p className="analisi-machine-scope" role="status">
              {machineLabels.length
                ? `Macchine nel flusso: ${machineLabels.join(' · ')}`
                : 'Macchine nel flusso: aggregato VNE'}
            </p>
            <HeatmapGrid hours={data.hours} weekdays={data.weekdays} cells={data.cells} />
            <PopularTimesChart
              cells={data.cells}
              hours={data.hours}
              weekdays={data.weekdays}
              title="Orari di punta — tutte le macchine"
            />
            <h3 className="analisi-machine-subtitle">Top fasce — tutte le macchine</h3>
            <TopSlotsColumnChart suggestions={data.suggestions} />
          </section>

          {machines.length > 0 ? (
            <div className="analisi-machine-grid" style={{ marginTop: '1rem' }}>
              {machines.map((m) => (
                <section key={m.model_id} className="card analisi-panel analisi-machine-card">
                  <h2 className="analisi-panel-title">Heatmap e flusso — {m.model_label}</h2>
                  <p className="analisi-machine-scope" role="status">
                    Macchina: <strong>{m.model_label}</strong>
                  </p>
                  <HeatmapGrid
                    hours={m.hours || data.hours}
                    weekdays={m.weekdays || data.weekdays}
                    cells={m.cells || []}
                  />
                  <PopularTimesChart
                    cells={m.cells}
                    hours={m.hours || data.hours}
                    weekdays={m.weekdays || data.weekdays}
                    title={`Orari di punta · ${m.model_label}`}
                  />
                  <h3 className="analisi-machine-subtitle">Top fasce · {m.model_label}</h3>
                  <TopSlotsColumnChart
                    suggestions={m.suggestions}
                    emptyText="Pochi dati operazioni per questa macchina."
                  />
                </section>
              ))}
            </div>
          ) : null}
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
      vneStatus={<AnalisiVneSemaphore data={data} loading={loading} refreshing={refreshing} error={error} />}
      actions={
        <button type="button" className="btn btn-secondary btn-sm" onClick={refreshNow} disabled={refreshing}>
          {refreshing ? 'Aggiorno…' : 'Aggiorna ora'}
        </button>
      }
    >
      <AnalisiSyncStatus loading={loading} refreshing={refreshing} lastSyncAt={lastSyncAt} />
      {error && <div className="alert alert-danger">{error}</div>}
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
