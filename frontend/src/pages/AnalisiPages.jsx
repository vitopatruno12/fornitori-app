import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AnalisiPageShell,
  AnalisiSyncStatus,
  AnalisiIncassoAttrPanel,
  AnalisiAttrTag,
  HeatmapGrid,
  MachineCompareCharts,
  PopularTimesChart,
  SeriesBars,
  TopSlotsColumnChart,
  VneStatusSemaphore,
  resolveAgentCassaSemaphoreLight,
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
  fetchPosPaymentSummary,
  fetchPosReceiptSyncStatus,
} from '../services/analyticsService'
import { EasyRetailPosImportPanel } from '../components/EasyRetailPosImportPanel.jsx'
import { AnalisiMachineCard } from '../components/AnalisiMachineCard.jsx'

const ANALISI_CACHE_PREFIX = 'analisi_cache_v3:'
const LOCALE_KPI_ALL = 'all'
const ANALISI_REFRESH_EVERY_MS = 20 * 60 * 1000 // 20 min
const ANALISI_MORNING_HOUR = 7
const ANALISI_BACKGROUND_CHECK_MS = 60 * 1000 // 1 min: controlla se serve refresh

function isoDate(d) {
  return d.toISOString().slice(0, 10)
}

function todayIsoLocal() {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  return isoDate(d)
}

/** Range date allineato alle pagine giornaliero / settimanale / mensile. */
function analisiPeriodRange({ days, weeks, months } = {}) {
  const to = new Date()
  to.setHours(12, 0, 0, 0)
  const from = new Date(to)
  if (days) from.setDate(from.getDate() - (Number(days) - 1))
  else if (weeks) from.setDate(from.getDate() - Number(weeks) * 7 + 1)
  else if (months) from.setMonth(from.getMonth() - (Number(months) - 1))
  return { dateFrom: isoDate(from), dateTo: isoDate(to) }
}

function splitFromPayOrAnalytics(payData, analyticsData) {
  const totals = payData?.totals && typeof payData.totals === 'object' ? payData.totals : null
  const split = analyticsData?.payment_split && typeof analyticsData.payment_split === 'object'
    ? analyticsData.payment_split
    : null
  return {
    amountEur: Number(totals?.amount_eur ?? split?.amount_eur ?? analyticsData?.total_incasso ?? 0),
    cashEur: Number(totals?.cash_eur ?? split?.cash_eur ?? 0),
    cardEur: Number(totals?.card_eur ?? split?.card_eur ?? 0),
    receipts: Number(totals?.receipts ?? split?.receipts ?? 0),
    quoteEur: Number(totals?.quote_eur ?? split?.quote_eur ?? 0),
    quoteReceipts: Number(totals?.quote_receipts ?? split?.quote_receipts ?? 0),
  }
}

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

function AnalisiAgentCassaSemaphore() {
  const [syncStatus, setSyncStatus] = React.useState(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const st = await fetchPosReceiptSyncStatus()
        if (cancelled) return
        setSyncStatus(st)
        setError('')
      } catch (err) {
        if (cancelled) return
        setError(err?.message || 'Stato agent non disponibile')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    const id = window.setInterval(load, 60_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  const light = resolveAgentCassaSemaphoreLight({ syncStatus, loading, error })
  return <VneStatusSemaphore light={light} show />
}

function resolveLocalesToday(data, machines) {
  const fromApi = Array.isArray(data?.locales_today) ? data.locales_today : []
  if (fromApi.length) return fromApi
  return (Array.isArray(machines) ? machines : []).map((m) => {
    const s = m?.snapshot || {}
    return {
      model_id: m.model_id,
      label: m.model_label,
      incasso_oggi: s.incasso_oggi || 0,
      movimenti_oggi: s.movimenti_oggi || 0,
    }
  })
}

function LocaleTodayKpis({ snap, localesToday }) {
  const [localeId, setLocaleId] = React.useState(LOCALE_KPI_ALL)
  const selected =
    localeId === LOCALE_KPI_ALL
      ? null
      : localesToday.find((l) => l.model_id === localeId) || null
  const incasso = selected ? selected.incasso_oggi : snap?.incasso_oggi
  const movimenti = selected ? selected.movimenti_oggi : snap?.movimenti_oggi
  const hint = selected
    ? `Solo ${selected.label} · scontrini agent cassa`
    : 'Somma dei 5 locali · solo agent / POS (niente VNE)'

  return (
    <section className="dashboard-kpi-grid analisi-kpi-grid" style={{ marginBottom: '1rem' }}>
      <div className="dashboard-kpi dashboard-kpi--primary">
        <div className="dashboard-kpi-label-row">
          <div className="dashboard-kpi-label">Incasso oggi</div>
          <label className="dashboard-kpi-locale-label">
            <span className="sr-only">Locale incasso</span>
            <select
              className="dashboard-kpi-locale-select"
              value={localeId}
              onChange={(e) => setLocaleId(e.target.value)}
            >
              <option value={LOCALE_KPI_ALL}>Tutti i locali</option>
              {localesToday.map((l) => (
                <option key={l.model_id} value={l.model_id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="dashboard-kpi-value">{eur(incasso)}</div>
        <div className="dashboard-kpi-hint">{hint}</div>
      </div>
      <div className="dashboard-kpi">
        <div className="dashboard-kpi-label-row">
          <div className="dashboard-kpi-label">Operazioni oggi</div>
          <label className="dashboard-kpi-locale-label">
            <span className="sr-only">Locale operazioni</span>
            <select
              className="dashboard-kpi-locale-select"
              value={localeId}
              onChange={(e) => setLocaleId(e.target.value)}
              aria-label="Locale operazioni"
            >
              <option value={LOCALE_KPI_ALL}>Tutti i locali</option>
              {localesToday.map((l) => (
                <option key={`op-${l.model_id}`} value={l.model_id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="dashboard-kpi-value">{movimenti ?? 0}</div>
        <div className="dashboard-kpi-hint">
          {selected ? `Scontrini · ${selected.label}` : 'Scontrini agent · tutti i locali'}
        </div>
      </div>
      <div className="dashboard-kpi dashboard-kpi--secondary">
        <div className="dashboard-kpi-label">Locali</div>
        <div className="dashboard-kpi-value">{localesToday.length || 0}</div>
        <div className="dashboard-kpi-hint">Schede sotto</div>
      </div>
    </section>
  )
}

export function AnalisiDashboardPage() {
  const { data, loading, refreshing, error, lastSyncAt, refreshNow } = useAnalisiFetch(
    'overview:months=3',
    () => fetchAnalyticsOverview({ months: 3 }),
    [],
  )
  const snap = data?.snapshot
  const machines = Array.isArray(data?.by_machine) ? data.by_machine : []
  const localesToday = resolveLocalesToday(data, machines)

  return (
    <AnalisiPageShell
      title="Dashboard Analitica"
      vneStatus={<AnalisiAgentCassaSemaphore />}
      actions={
        <aside className="analisi-hero-tools" aria-label="Aggiorna analisi">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={refreshNow}
            disabled={refreshing || loading}
          >
            {refreshing || loading ? 'Aggiorno…' : 'Aggiorna ora'}
          </button>
        </aside>
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

      {snap ? <LocaleTodayKpis snap={snap} localesToday={localesToday} /> : null}

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
          <h2 className="analisi-panel-title">Andamento mensile (tutti i locali · agent)</h2>
          <SeriesBars rows={data.monthly.rows || []} labelKey="month_label" />
        </section>
      ) : null}
    </AnalisiPageShell>
  )
}

export function AnalisiGiornalieroPage() {
  const { modelId, setModelId, location, machineLabel } = useAnalisiMachineFilter()
  const range = React.useMemo(() => analisiPeriodRange({ days: 30 }), [])
  const { data, loading, refreshing, error, lastSyncAt, refreshNow } = useAnalisiFetch(
    `daily:days=30:${modelId}`,
    () => fetchAnalyticsDaily({ days: 30, modelId, location }),
    [modelId, location],
  )
  const { data: payData } = useAnalisiFetch(
    `pay-daily:30:${modelId}:${range.dateFrom}:${range.dateTo}`,
    () =>
      fetchPosPaymentSummary({
        modelId: modelId || undefined,
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
      }),
    [modelId, range.dateFrom, range.dateTo],
  )
  const kpis = splitFromPayOrAnalytics(payData, data)

  return (
    <AnalisiPageShell
      title={`Andamento giornaliero — ${machineLabel}`}
      vneStatus={<AnalisiAgentCassaSemaphore />}
      actions={
        <AnalisiTrendToolbar
          selectId="analisi-daily-machine"
          modelId={modelId}
          onModelChange={setModelId}
          onRefresh={refreshNow}
          refreshing={refreshing}
          loading={loading}
        />
      }
    >
      <AnalisiSyncStatus loading={loading} refreshing={refreshing} lastSyncAt={lastSyncAt} />
      {error && <div className="alert alert-danger">{error}</div>}
      <AnalisiIncassoAttrPanel
        title={`Incasso periodo · ${machineLabel}`}
        hint={`Ultimi 30 giorni (${range.dateFrom} → ${range.dateTo}) · solo scontrini fiscali EasyRetail.`}
        amountLabel="Incasso 30 giorni"
        {...kpis}
      />
      {data ? (
        <section className="card analisi-panel analisi-attr-panel">
          <AnalisiAttrTag>Attributo · € per giorno</AnalisiAttrTag>
          <h2 className="analisi-panel-title">Incasso giorno per giorno · {machineLabel}</h2>
          <p className="analisi-machine-scope">
            Barre = € contabilizzati per giornata · contanti (verde) e carta/POS (blu). I preventivi non
            sono in queste barre.
          </p>
          <SeriesBars
            splitPayments
            rows={(data.rows || []).map((r) => ({
              ...r,
              label: `${r.weekday_label?.slice(0, 3) || ''} ${r.date?.slice(5) || ''}`.trim(),
            }))}
          />
        </section>
      ) : null}
    </AnalisiPageShell>
  )
}

export function AnalisiSettimanalePage() {
  const { modelId, setModelId, location, machineLabel } = useAnalisiMachineFilter()
  const range = React.useMemo(() => analisiPeriodRange({ weeks: 12 }), [])
  const { data, loading, refreshing, error, lastSyncAt, refreshNow } = useAnalisiFetch(
    `weekly:weeks=12:${modelId}`,
    () => fetchAnalyticsWeekly({ weeks: 12, modelId, location }),
    [modelId, location],
  )
  const { data: payData } = useAnalisiFetch(
    `pay-weekly:12:${modelId}:${range.dateFrom}:${range.dateTo}`,
    () =>
      fetchPosPaymentSummary({
        modelId: modelId || undefined,
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
      }),
    [modelId, range.dateFrom, range.dateTo],
  )
  const kpis = splitFromPayOrAnalytics(payData, data)

  return (
    <AnalisiPageShell
      title={`Andamento settimanale — ${machineLabel}`}
      vneStatus={<AnalisiAgentCassaSemaphore />}
      actions={
        <AnalisiTrendToolbar
          selectId="analisi-weekly-machine"
          modelId={modelId}
          onModelChange={setModelId}
          onRefresh={refreshNow}
          refreshing={refreshing}
          loading={loading}
        />
      }
    >
      <AnalisiSyncStatus loading={loading} refreshing={refreshing} lastSyncAt={lastSyncAt} />
      {error && <div className="alert alert-danger">{error}</div>}
      <AnalisiIncassoAttrPanel
        title={`Incasso periodo · ${machineLabel}`}
        hint={`Ultime 12 settimane (${range.dateFrom} → ${range.dateTo}) · solo scontrini fiscali EasyRetail.`}
        amountLabel="Incasso 12 settimane"
        {...kpis}
      />
      {data ? (
        <section className="card analisi-panel analisi-attr-panel">
          <AnalisiAttrTag>Attributo · € per settimana</AnalisiAttrTag>
          <h2 className="analisi-panel-title">Incasso settimana per settimana · {machineLabel}</h2>
          <p className="analisi-machine-scope">
            Barre = € contabilizzati per settimana · contanti / carta-POS. Preventivi in attributo dedicato
            sopra.
          </p>
          <SeriesBars splitPayments rows={data.rows || []} labelKey="label" />
        </section>
      ) : null}
    </AnalisiPageShell>
  )
}

export function AnalisiMensilePage() {
  const { modelId, setModelId, location, machineLabel } = useAnalisiMachineFilter()
  const range = React.useMemo(() => analisiPeriodRange({ months: 6 }), [])
  const { data, loading, refreshing, error, lastSyncAt, refreshNow } = useAnalisiFetch(
    `monthly:months=6:${modelId}`,
    () => fetchAnalyticsMonthly({ months: 6, modelId, location }),
    [modelId, location],
  )
  const { data: payData } = useAnalisiFetch(
    `pay-monthly:6:${modelId}:${range.dateFrom}:${range.dateTo}`,
    () =>
      fetchPosPaymentSummary({
        modelId: modelId || undefined,
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
      }),
    [modelId, range.dateFrom, range.dateTo],
  )
  const kpis = splitFromPayOrAnalytics(payData, data)

  return (
    <AnalisiPageShell
      title={`Andamento mensile — ${machineLabel}`}
      vneStatus={<AnalisiAgentCassaSemaphore />}
      actions={
        <AnalisiTrendToolbar
          selectId="analisi-monthly-machine"
          modelId={modelId}
          onModelChange={setModelId}
          onRefresh={refreshNow}
          refreshing={refreshing}
          loading={loading}
        />
      }
    >
      <AnalisiSyncStatus loading={loading} refreshing={refreshing} lastSyncAt={lastSyncAt} />
      {error && <div className="alert alert-danger">{error}</div>}
      <AnalisiIncassoAttrPanel
        title={`Incasso periodo · ${machineLabel}`}
        hint={`Ultimi 6 mesi (${range.dateFrom} → ${range.dateTo}) · solo scontrini fiscali EasyRetail.`}
        amountLabel="Incasso 6 mesi"
        {...kpis}
      />
      {data ? (
        <section className="card analisi-panel analisi-attr-panel">
          <AnalisiAttrTag>Attributo · € per mese</AnalisiAttrTag>
          <h2 className="analisi-panel-title">Incasso mese per mese · {machineLabel}</h2>
          <p className="analisi-machine-scope">
            Barre = € contabilizzati per mese · contanti / carta-POS. Preventivi non fiscali separati sopra.
          </p>
          <SeriesBars splitPayments rows={data.rows || []} labelKey="month_label" />
        </section>
      ) : null}
    </AnalisiPageShell>
  )
}

export function AnalisiOrariaPage() {
  const { modelId, setModelId, machineLabel } = useAnalisiMachineFilter()
  const todayIso = React.useMemo(() => todayIsoLocal(), [])
  const { data, loading, refreshing, error, lastSyncAt, refreshNow } = useAnalisiFetch(
    `hourly:months=3:${modelId}`,
    () => fetchAnalyticsHourly({ months: 3, modelId }),
    [modelId],
  )
  const { data: payToday } = useAnalisiFetch(
    `pay-today:${modelId}:${todayIso}`,
    () =>
      fetchPosPaymentSummary({
        modelId: modelId || undefined,
        dateFrom: todayIso,
        dateTo: todayIso,
      }),
    [modelId, todayIso],
  )
  const machines = Array.isArray(data?.by_machine) ? data.by_machine : []
  const kpis = splitFromPayOrAnalytics(payToday, null)
  const hourRows = Array.isArray(payToday?.by_hour) ? payToday.by_hour : []
  const peakHour = hourRows.reduce(
    (best, row) => {
      const v = Number(row?.amount_eur || 0)
      if (v <= Number(best?.amount_eur || 0)) return best
      return row
    },
    null,
  )
  const peakLabel = peakHour
    ? peakHour.slot_label || `${String(peakHour.hour).padStart(2, '0')}:00`
    : '—'

  return (
    <AnalisiPageShell
      title={`Analisi oraria — ${machineLabel}`}
      vneStatus={<AnalisiAgentCassaSemaphore />}
      actions={
        <AnalisiTrendToolbar
          selectId="analisi-hourly-machine"
          modelId={modelId}
          onModelChange={setModelId}
          onRefresh={refreshNow}
          refreshing={refreshing}
          loading={loading}
        />
      }
    >
      <AnalisiSyncStatus loading={loading} refreshing={refreshing} lastSyncAt={lastSyncAt} />
      {error && <div className="alert alert-danger">{error}</div>}

      <AnalisiIncassoAttrPanel
        title={`Saldo intera giornata · ${machineLabel}`}
        hint="Totale € di oggi da scontrini EasyRetail (agent cassa). Non è il flusso visite e non è la media storica."
        amountLabel="Incasso giornata"
        {...kpis}
      />

      <section className="card analisi-panel analisi-attr-panel" style={{ marginBottom: '1rem' }}>
        <AnalisiAttrTag>Attributo · € per fascia oraria</AnalisiAttrTag>
        <h2 className="analisi-panel-title">Incasso per ora (oggi)</h2>
        <p className="analisi-machine-scope">
          Quanto hai incassato in ogni ora di oggi · contanti (verde) e carta/POS (blu). Picco €:{' '}
          <strong>{peakLabel}</strong>
          {peakHour ? ` · ${eur(peakHour.amount_eur)}` : ''}.
        </p>
        {hourRows.some((r) => Number(r.amount_eur || 0) > 0) ? (
          <SeriesBars
            splitPayments
            rows={hourRows.map((r) => ({
              ...r,
              label: r.slot_label || `${String(r.hour).padStart(2, '0')}:00`,
              incasso: Number(r.amount_eur || 0),
            }))}
          />
        ) : (
          <p className="empty-state">Nessun incasso orario per oggi su questo locale.</p>
        )}
      </section>

      {data ? (
        <section className="card analisi-panel analisi-attr-panel">
          <AnalisiAttrTag>Attributo · Fasce con maggior flusso</AnalisiAttrTag>
          <h2 className="analisi-panel-title">Orari di punta (visite / traffico)</h2>
          <p className="analisi-machine-scope">
            Qui si guarda il <strong>flusso clienti</strong> (quando passa più gente), non il saldo € della
            giornata. Periodo storico ~3 mesi · {machineLabel}.
          </p>
          <HeatmapGrid hours={data.hours} weekdays={data.weekdays} cells={data.cells} />
          <PopularTimesChart
            cells={data.cells}
            hours={data.hours}
            weekdays={data.weekdays}
            title="Fasce con maggior flusso"
          />
          <h3 className="analisi-machine-subtitle">Top fasce · traffico</h3>
          <TopSlotsColumnChart
            suggestions={data.suggestions}
            emptyText="Pochi dati di traffico nel periodo."
          />

          {machines.length > 1 ? (
            <div className="analisi-machine-grid" style={{ marginTop: '1rem' }}>
              {machines.map((m) => (
                <section key={m.model_id} className="card analisi-panel analisi-machine-card">
                  <AnalisiAttrTag>Flusso · {m.model_label}</AnalisiAttrTag>
                  <h2 className="analisi-panel-title">{m.model_label}</h2>
                  <HeatmapGrid
                    hours={m.hours || data.hours}
                    weekdays={m.weekdays || data.weekdays}
                    cells={m.cells || []}
                  />
                  <PopularTimesChart
                    cells={m.cells}
                    hours={m.hours || data.hours}
                    weekdays={m.weekdays || data.weekdays}
                    title={`Maggior flusso · ${m.model_label}`}
                  />
                  <TopSlotsColumnChart
                    suggestions={m.suggestions}
                    emptyText="Pochi scontrini per questa sede."
                  />
                </section>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
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
      vneStatus={<AnalisiAgentCassaSemaphore />}
      actions={
        <aside className="analisi-hero-tools" aria-label="Aggiorna analisi">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={refreshNow}
            disabled={refreshing || loading}
          >
            {refreshing || loading ? 'Aggiorno…' : 'Aggiorna ora'}
          </button>
        </aside>
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
