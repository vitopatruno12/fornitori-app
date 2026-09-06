import React from 'react'
import { NavLink } from 'react-router-dom'

export const ANALISI_NAV_ITEMS = [
  { to: '/analisi', label: 'Dashboard Analitica', end: true },
  { to: '/analisi/giornaliero', label: 'Giornaliero' },
  { to: '/analisi/settimanale', label: 'Settimanale' },
  { to: '/analisi/mensile', label: 'Mensile' },
  { to: '/analisi/oraria', label: 'Analisi oraria' },
  { to: '/analisi/pianificazione', label: 'Pianificazione personale' },
]

export function eur(n) {
  if (n == null || n === '') return '—'
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(n))
}

export function AnalisiSubnav() {
  return (
    <nav className="analisi-subnav" aria-label="Sezioni Analisi">
      {ANALISI_NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={Boolean(item.end)}
          className={({ isActive }) => `analisi-subnav-link${isActive ? ' is-active' : ''}`}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}

export function AnalisiPageShell({ title, lead, children, actions = null, vneStatus = null }) {
  return (
    <div className="analisi-page">
      <header className="analisi-header staff-page-hero">
        <div className="analisi-header-row">
          <div className="analisi-header-main">
            <div>
              <p className="analisi-kicker">Analisi</p>
              <h1 className="page-header staff-page-title" style={{ marginBottom: '0.25rem' }}>
                {title}
              </h1>
              {lead ? <p className="dashboard-subtitle staff-page-lead">{lead}</p> : null}
            </div>
            {vneStatus ? <div className="analisi-hero-vne-status">{vneStatus}</div> : null}
          </div>
          {actions}
        </div>
      </header>
      <AnalisiSubnav />
      {children}
    </div>
  )
}

/** Barra di caricamento classica con percentuale. */
export function AnalisiLoadingBar({
  active = false,
  variant = 'primary',
  label = 'Caricamento',
}) {
  const [percent, setPercent] = React.useState(0)

  React.useEffect(() => {
    if (!active) {
      setPercent(0)
      return undefined
    }
    setPercent(6)
    const started = Date.now()
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - started
      // sale verso ~92% in modo asintotico mentre aspetta VNE
      const next = Math.min(92, Math.round(6 + (1 - Math.exp(-elapsed / 4500)) * 86))
      setPercent(next)
    }, 120)
    return () => window.clearInterval(timer)
  }, [active])

  if (!active) return null

  return (
    <div
      className={`analisi-progress-card analisi-progress-card--${variant}`}
      role="progressbar"
      aria-busy="true"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={label}
    >
      <div className="analisi-progress-head">
        <span className="analisi-progress-title">{label}</span>
        <strong className="analisi-progress-percent">{percent}%</strong>
      </div>
      <div className="analisi-progress-track">
        <div className="analisi-progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

/** Stato sync: barra percentuale se in corso, altrimenti orario ultimo aggiornamento. */
export function AnalisiSyncStatus({ loading, refreshing, lastSyncAt }) {
  const busy = Boolean(loading || refreshing)
  const when = (() => {
    if (!lastSyncAt) return ''
    const d = new Date(lastSyncAt)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleString('it-IT')
  })()

  if (busy) {
    return (
      <AnalisiLoadingBar
        active
        variant={loading ? 'primary' : 'subtle'}
        label={loading ? 'Caricamento dati agent cassa' : 'Aggiornamento dati'}
      />
    )
  }

  if (!when) return null
  return <p className="analisi-sync-meta">Aggiornato: {when}</p>
}

/** Classifica semaforo VNE (pagina VNE / stato singolo modello): green / yellow / red. */
export function resolveVneSemaphoreLight(
  messages = [],
  { emptyFail = false, hasOffline = false, pending = false } = {},
) {
  const items = (Array.isArray(messages) ? messages : [messages])
    .map((w) => String(w || '').trim())
    .filter(Boolean)
  const blob = items.join('\n').toLowerCase()
  const offlineSignal =
    hasOffline ||
    /\boffline\b|non accessibile|impossibile accedere|imposible acceder|spenta|non risponde|macchina non/.test(
      blob,
    )
  const hardError =
    emptyFail ||
    offlineSignal ||
    /403|forbidden|accesso negato|credenzial|csrf|http error|errore query|non validi|sessione/.test(blob)
  // Giallo solo per ritardo/verifica in corso — offline e macchina spenta vanno a rosso.
  const delayed =
    pending || /timeout|rallent|ritardo|lenta|504|troppo lenta|esaurito/.test(blob)

  if (hardError) return 'red'
  if (delayed) return 'yellow'
  return 'green'
}

const UNREACHABLE_WARN_RE =
  /non accessibile|impossibile accedere|imposible acceder|\boffline\b|non risponde|url non configurati|non trovata|403|forbidden|credenzial|accesso negato|sessione|http error/i
const DELAY_WARN_RE = /timeout|504|esaurito|rallent|lenta|troppo lenta|ritardo/i

function _num(v) {
  return Number(v || 0) || 0
}

function _machineLabelFromWarning(warning) {
  const text = String(warning || '').trim()
  const m =
    text.match(/^(?:Operazioni|Chiusure)\s+(.+?):\s*/i) ||
    text.match(/^(.+?):\s*(?:saltata|macchina)/i)
  return m ? m[1].trim() : ''
}

function _analisiMachineHasData(machine) {
  if (!machine || typeof machine !== 'object') return false
  const snap = machine.snapshot || {}
  if (_num(snap.incasso_oggi) > 0 || _num(snap.movimenti_oggi) > 0) return true
  if (Array.isArray(snap.machines) && snap.machines.length > 0) return true
  const weeklyRows = machine.weekly?.rows
  if (Array.isArray(weeklyRows) && weeklyRows.some((r) => _num(r.incasso) > 0 || _num(r.movimenti) > 0)) {
    return true
  }
  return false
}

/** True se almeno una macchina ha contribuito dati analitici. */
export function analisiHasAnyMachineData(data) {
  if (!data || typeof data !== 'object') return false
  if (_num(data.total_incasso) > 0 || _num(data.total_movimenti) > 0) return true
  const snap = data.snapshot
  if (snap && (_num(snap.incasso_oggi) > 0 || _num(snap.movimenti_oggi) > 0)) return true
  if (Array.isArray(snap?.machines) && snap.machines.length > 0) return true
  const rowSets = [data.rows, data.monthly?.rows, data.weekly?.rows].filter(Array.isArray)
  for (const rows of rowSets) {
    if (rows.some((r) => _num(r.incasso) > 0 || _num(r.amount) > 0 || _num(r.movimenti) > 0)) return true
  }
  if (
    Array.isArray(data.cells) &&
    data.cells.some((c) => _num(c.amount) > 0 || _num(c.count) > 0 || _num(c.intensity) > 0)
  ) {
    return true
  }
  if (Array.isArray(data.by_machine) && data.by_machine.some(_analisiMachineHasData)) return true
  if (Array.isArray(data.days) && data.days.length > 0) return true
  return false
}

/**
 * Semaforo dashboard analitica (giornaliero/settimanale/mensile/overview):
 * - giallo in caricamento
 * - verde se almeno una macchina risponde / ha dati
 * - rosso solo se tutte le macchine sono irraggiungibili (o errore totale senza dati)
 */
export function resolveAnalisiVneSemaphoreLight({
  data = null,
  loading = false,
  refreshing = false,
  error = '',
  expectedMachines = 3,
} = {}) {
  // Giallo solo in caricamento iniziale (non a ogni refresh in background).
  if (loading || (refreshing && !data)) return 'yellow'
  if (error && !data) return 'red'
  if (!data) return 'yellow'

  if (analisiHasAnyMachineData(data)) return 'green'

  const warnings = Array.isArray(data.warnings) ? data.warnings : []
  const warningBlob = warnings.join('\n').toLowerCase()
  // Errore globale (credenziali/sessione) senza dati → rosso
  if (
    warnings.length > 0 &&
    /credenzial|accesso negato|403|forbidden|csrf|sessione|non validi/.test(warningBlob) &&
    !/operazioni |chiusure /i.test(warningBlob)
  ) {
    return 'red'
  }

  const unreachableLabels = new Set()
  let hasDelay = false
  for (const w of warnings) {
    const text = String(w || '')
    if (DELAY_WARN_RE.test(text)) hasDelay = true
    if (!UNREACHABLE_WARN_RE.test(text)) continue
    const label = _machineLabelFromWarning(text)
    if (label) unreachableLabels.add(label)
    else unreachableLabels.add(text)
  }

  const machines = Array.isArray(data.by_machine) ? data.by_machine : []
  if (machines.length > 0) {
    const allUnreachable = machines.every((m) => {
      const label = String(m.model_label || '')
      return [...unreachableLabels].some((u) => u === label || label.includes(u) || u.includes(label))
    })
    if (allUnreachable && unreachableLabels.size > 0) return 'red'
    // Alcune offline ma non tutte → collegamento ok su almeno una
    if (unreachableLabels.size > 0 && unreachableLabels.size < machines.length) return 'green'
    if (hasDelay) return 'yellow'
    return 'green'
  }

  const need = Math.max(1, Number(expectedMachines) || 3)
  if (unreachableLabels.size >= need) return 'red'
  // Una o due macchine irraggiungibili senza dati aggregati: non rosso se non sono tutte
  if (unreachableLabels.size > 0 && unreachableLabels.size < need) return 'green'
  if (hasDelay) return 'yellow'
  return 'green'
}

/** Semaforo agent PC cassa: verde operativo, giallo comunicazione, rosso fermo. */
export function resolveAgentCassaSemaphoreLight({
  syncStatus = null,
  loading = false,
  error = '',
} = {}) {
  if (loading && !syncStatus) return 'yellow'
  if (error && !syncStatus) return 'yellow'
  const light = String(syncStatus?.agent_light || '').toLowerCase()
  if (light === 'green' || light === 'yellow' || light === 'red') return light
  // Senza stato agent: in attesa di comunicazione
  return 'yellow'
}

/** Semaforo stato agent cassa (non più collegamento VNE). */
export function VneStatusSemaphore({ light = 'green', show = true }) {
  if (!show) return null
  const labels = {
    green: 'Operativo — agent cassa attivo',
    yellow: 'In attesa / problemi di comunicazione cassa ↔ ATLAS',
    red: 'Fermo — agent non contatta ATLAS',
  }
  const active = light === 'yellow' || light === 'red' ? light : 'green'

  return (
    <div
      className={`analisi-vne-semaphore analisi-vne-semaphore--${active}`}
      role="status"
      aria-label={`Stato agent cassa: ${labels[active]}`}
    >
      <div className="analisi-vne-semaphore-housing" aria-hidden>
        <span className={`analisi-vne-light analisi-vne-light--red${active === 'red' ? ' is-on' : ''}`} />
        <span className={`analisi-vne-light analisi-vne-light--yellow${active === 'yellow' ? ' is-on' : ''}`} />
        <span className={`analisi-vne-light analisi-vne-light--green${active === 'green' ? ' is-on' : ''}`} />
      </div>
      <div className="analisi-vne-semaphore-copy">
        <strong className="analisi-vne-semaphore-title">Stato agent cassa</strong>
        <ul className="analisi-vne-semaphore-legend">
          <li className={active === 'green' ? 'is-active' : ''}>
            <span className="analisi-vne-legend-dot analisi-vne-legend-dot--green" />
            Verde — operativo (agent al lavoro)
          </li>
          <li className={active === 'yellow' ? 'is-active' : ''}>
            <span className="analisi-vne-legend-dot analisi-vne-legend-dot--yellow" />
            Giallo — in attesa / problemi comunicazione cassa ↔ ATLAS
          </li>
          <li className={active === 'red' ? 'is-active' : ''}>
            <span className="analisi-vne-legend-dot analisi-vne-legend-dot--red" />
            Rosso — fermo (PC cassa spento o agent fermo)
          </li>
        </ul>
      </div>
    </div>
  )
}

export function SeriesBars({ rows, valueKey = 'incasso', labelKey = 'label', splitPayments = false }) {
  if (!rows?.length) return <p className="empty-state">Nessun dato disponibile nel periodo.</p>
  const useSplit =
    splitPayments &&
    rows.some((r) => Number(r.cash_eur || 0) > 0 || Number(r.card_eur || 0) > 0)
  const max = Math.max(
    1,
    ...rows.map((r) =>
      useSplit
        ? Number(r.cash_eur || 0) + Number(r.card_eur || 0) || Number(r[valueKey] || 0)
        : Number(r[valueKey] || 0),
    ),
  )
  return (
    <div className="analisi-bars">
      {useSplit ? (
        <div className="analisi-payment-legend" role="note">
          <span className="analisi-payment-legend-item">
            <span className="analisi-payment-swatch analisi-payment-swatch--cash" /> Contanti
          </span>
          <span className="analisi-payment-legend-item">
            <span className="analisi-payment-swatch analisi-payment-swatch--card" /> Carta/POS
          </span>
        </div>
      ) : null}
      {rows.map((r, idx) => {
        const cash = Number(r.cash_eur || 0)
        const card = Number(r.card_eur || 0)
        const v = useSplit ? cash + card || Number(r[valueKey] || 0) : Number(r[valueKey] || 0)
        const label = r[labelKey] || r.month_label || r.date || r.week_start || `#${idx + 1}`
        const cashPct = useSplit && v > 0 ? (cash / max) * 100 : 0
        const cardPct = useSplit && v > 0 ? (card / max) * 100 : 0
        return (
          <div key={label + idx} className="analisi-bar-row">
            <div className="analisi-bar-label" title={label}>
              {label}
            </div>
            <div className="analisi-bar-track">
              {useSplit ? (
                <div className="analisi-bar-stack">
                  <div className="analisi-bar-fill analisi-bar-fill--cash" style={{ width: `${cashPct}%` }} />
                  <div className="analisi-bar-fill analisi-bar-fill--card" style={{ width: `${cardPct}%` }} />
                </div>
              ) : (
                <div className="analisi-bar-fill" style={{ width: `${(v / max) * 100}%` }} />
              )}
            </div>
            <div className="analisi-bar-value" title={useSplit ? `Contanti ${eur(cash)} · Carta ${eur(card)}` : undefined}>
              {eur(v)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function PaymentSplitSummary({ split }) {
  if (!split) return null
  const cash = Number(split.cash_eur || 0)
  const card = Number(split.card_eur || 0)
  if (cash <= 0 && card <= 0) return null
  return (
    <p className="analisi-machine-scope" role="status">
      Contanti <strong>{eur(cash)}</strong>
      {' · '}
      Carta/POS <strong>{eur(card)}</strong>
      {Number(split.receipts || 0) > 0 ? ` · ${split.receipts} scontrini` : ''}
    </p>
  )
}

function _slotOpsTone(ops) {
  const n = Number(ops || 0)
  if (n >= 3) return 'alto'
  if (n >= 2) return 'medio'
  return 'basso'
}

/** Grafico a barre verticali per Top fasce (media € + operatori). */
export function TopSlotsColumnChart({ suggestions = [], emptyText = 'Pochi dati operazioni nel periodo.' }) {
  const rows = (Array.isArray(suggestions) ? suggestions : [])
    .map((s, idx) => {
      const amount = Number(s?.avg_amount || 0)
      const ops = Number(s?.operatori_consigliati || 0)
      const day = String(s?.weekday_label || '').slice(0, 3)
      const slot = String(s?.slot_label || '').replace(/\s+/g, '')
      const label = [day, slot].filter(Boolean).join(' ') || `#${idx + 1}`
      return {
        key: `${s?.weekday_label || ''}-${s?.slot_label || ''}-${idx}`,
        label,
        amount,
        ops,
        tone: _slotOpsTone(ops),
        title: s?.message
          ? `${s.message} · media ${eur(amount)}`
          : `${label}: ${eur(amount)} · ${ops} op.`,
      }
    })
    .filter((r) => r.amount > 0 || r.ops > 0)
    .slice(0, 12)

  if (!rows.length) return <p className="empty-state">{emptyText}</p>

  const max = Math.max(1, ...rows.map((r) => r.amount))

  return (
    <div className="analisi-top-slots">
      <div className="analisi-top-slots-chart" role="img" aria-label="Top fasce: barre verticali per media incasso">
        {rows.map((r) => {
          const heightPct = Math.max(6, Math.round((r.amount / max) * 100))
          return (
            <div key={r.key} className="analisi-top-slots-col" title={r.title}>
              <div className="analisi-top-slots-value">{eur(r.amount)}</div>
              <div className="analisi-top-slots-track">
                <div
                  className={`analisi-top-slots-bar tone-${r.tone}`}
                  style={{ height: `${heightPct}%` }}
                >
                  <span className="analisi-top-slots-ops">{r.ops || '—'}</span>
                </div>
              </div>
              <div className="analisi-top-slots-label">{r.label}</div>
            </div>
          )
        })}
      </div>
      <div className="analisi-top-slots-legend" aria-hidden>
        <span>Altezza = media €</span>
        <span className="analisi-top-slots-legend-item">
          <i className="tone-basso" />1 op.
        </span>
        <span className="analisi-top-slots-legend-item">
          <i className="tone-medio" />2 op.
        </span>
        <span className="analisi-top-slots-legend-item">
          <i className="tone-alto" />3+ op.
        </span>
      </div>
    </div>
  )
}

const MACHINE_CHART_COLORS = ['#2563eb', '#0891b2', '#d97706', '#7c3aed', '#059669']

function _machineChartRows(machines = []) {
  return (Array.isArray(machines) ? machines : []).map((m, idx) => {
    const s = m?.snapshot || {}
    return {
      id: m?.model_id || `m-${idx}`,
      label: m?.model_label || `Macchina ${idx + 1}`,
      short: String(m?.model_label || `M${idx + 1}`)
        .replace(/^Le\s+/i, '')
        .replace(/^La\s+/i, '')
        .slice(0, 14),
      incasso: Number(s.incasso_oggi || 0) || 0,
      operazioni: Number(s.movimenti_oggi || 0) || 0,
      piccoOp: Number(s.picco_previsto?.operatori_consigliati || 0) || 0,
      piccoSlot: s.picco_previsto?.slot_label || '',
      color: MACHINE_CHART_COLORS[idx % MACHINE_CHART_COLORS.length],
    }
  })
}

function _donutSlices(rows, valueKey) {
  const total = rows.reduce((acc, r) => acc + Math.max(0, Number(r[valueKey] || 0)), 0)
  if (total <= 0) return { total: 0, slices: [] }
  let angle = -90
  const slices = rows
    .filter((r) => Number(r[valueKey] || 0) > 0)
    .map((r) => {
      const value = Number(r[valueKey] || 0)
      const sweep = (value / total) * 360
      const start = angle
      angle += sweep
      return { ...r, value, pct: (value / total) * 100, start, sweep }
    })
  return { total, slices }
}

function _polar(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
}

function _donutPath(cx, cy, rOuter, rInner, startDeg, sweepDeg) {
  if (sweepDeg <= 0) return ''
  const sweep = Math.min(359.999, sweepDeg)
  const large = sweep > 180 ? 1 : 0
  const [x1, y1] = _polar(cx, cy, rOuter, startDeg)
  const [x2, y2] = _polar(cx, cy, rOuter, startDeg + sweep)
  const [x3, y3] = _polar(cx, cy, rInner, startDeg + sweep)
  const [x4, y4] = _polar(cx, cy, rInner, startDeg)
  return [
    `M ${x1} ${y1}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${x4} ${y4}`,
    'Z',
  ].join(' ')
}

function CompareColumnBars({ rows, valueKey, formatValue, emptyText = 'Nessun dato' }) {
  const max = Math.max(1, ...rows.map((r) => Number(r[valueKey] || 0)))
  const hasData = rows.some((r) => Number(r[valueKey] || 0) > 0)
  if (!hasData) return <p className="empty-state">{emptyText}</p>
  return (
    <div className="analisi-compare-cols" role="img">
      {rows.map((r) => {
        const v = Number(r[valueKey] || 0)
        const h = Math.max(v > 0 ? 8 : 0, Math.round((v / max) * 100))
        return (
          <div key={r.id} className="analisi-compare-col" title={`${r.label}: ${formatValue(v, r)}`}>
            <div className="analisi-compare-col-value">{formatValue(v, r)}</div>
            <div className="analisi-compare-col-track">
              <div className="analisi-compare-col-bar" style={{ height: `${h}%`, background: r.color }} />
            </div>
            <div className="analisi-compare-col-label">{r.short}</div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Confronto macchine: torta solo per quota incasso (€ = stesso tipo),
 * barre verticali per operazioni e picco operatori (conteggi).
 */
export function MachineCompareCharts({ machines = [] }) {
  const rows = _machineChartRows(machines)
  if (!rows.length) return null

  const { total, slices } = _donutSlices(rows, 'incasso')
  const cx = 60
  const cy = 60
  const rOuter = 52
  const rInner = 30

  return (
    <section className="card analisi-panel analisi-compare-panel">
      <h2 className="analisi-panel-title">Confronto macchine — oggi</h2>
      <p className="analisi-machine-scope">
        Torta = quota incasso da scontrini agent. Barre = operazioni (scontrini) e picco operatori.
      </p>
      <div className="analisi-compare-grid">
        <div className="analisi-compare-card">
          <h3 className="analisi-machine-subtitle" style={{ marginTop: 0 }}>
            Quota incasso
          </h3>
          {total <= 0 ? (
            <p className="empty-state">Nessuna chiusura di giornata oggi.</p>
          ) : (
            <div className="analisi-donut-wrap">
              <svg className="analisi-donut" viewBox="0 0 120 120" aria-hidden>
                {slices.map((s) => (
                  <path
                    key={s.id}
                    d={_donutPath(cx, cy, rOuter, rInner, s.start, s.sweep)}
                    fill={s.color}
                  />
                ))}
                <text x="60" y="56" textAnchor="middle" className="analisi-donut-total-label">
                  Totale
                </text>
                <text x="60" y="72" textAnchor="middle" className="analisi-donut-total-value">
                  {eur(total)}
                </text>
              </svg>
              <ul className="analisi-donut-legend">
                {slices.map((s) => (
                  <li key={s.id}>
                    <span className="analisi-donut-swatch" style={{ background: s.color }} />
                    <span>
                      {s.label} · {eur(s.value)} ({Math.round(s.pct)}%)
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="analisi-compare-card">
          <h3 className="analisi-machine-subtitle" style={{ marginTop: 0 }}>
            Operazioni oggi
          </h3>
          <CompareColumnBars
            rows={rows}
            valueKey="operazioni"
            formatValue={(v) => String(v)}
            emptyText="Nessuna operazione oggi."
          />
        </div>

        <div className="analisi-compare-card">
          <h3 className="analisi-machine-subtitle" style={{ marginTop: 0 }}>
            Picco operatori consigliati
          </h3>
          <CompareColumnBars
            rows={rows}
            valueKey="piccoOp"
            formatValue={(v, r) => (r.piccoSlot ? `${v} · ${r.piccoSlot}` : String(v))}
            emptyText="Nessun picco disponibile."
          />
          <div className="analisi-top-slots-legend" aria-hidden>
            <span>Altezza = operatori consigliati al picco</span>
          </div>
        </div>
      </div>
    </section>
  )
}

const WEEKDAY_SHORT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']

/**
 * Grafico stile Google "Orari di punta".
 * - Giorno = oggi: visite reali ora per ora dagli scontrini agent (tempo reale)
 * - Altri giorni: media storica per quel weekday (~3 mesi)
 */
export function PopularTimesChart({
  cells = [],
  hours = [],
  weekdays = [],
  title = 'Orari di punta',
  todayHourly = null,
}) {
  const todayWd = new Date().getDay()
  // JS: 0=Dom … converti a Lun=0
  const todayIdx = todayWd === 0 ? 6 : todayWd - 1
  const nowHour = new Date().getHours()
  const [weekday, setWeekday] = React.useState(todayIdx)

  const hourList = hours.length ? hours : Array.from({ length: 15 }, (_, i) => i + 8)
  const dayLabels = weekdays.length
    ? weekdays
    : ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica']

  const byKey = React.useMemo(() => {
    const map = new Map()
    for (const c of cells || []) map.set(`${c.weekday}-${c.hour}`, c)
    return map
  }, [cells])

  const todayByHour = React.useMemo(() => {
    const map = new Map()
    for (const row of Array.isArray(todayHourly) ? todayHourly : []) {
      map.set(Number(row.hour), Number(row.visits || 0) || 0)
    }
    return map
  }, [todayHourly])

  const isTodayView = weekday === todayIdx
  const useLiveToday = isTodayView && todayByHour.size > 0

  const dayCells = hourList.map((h) => byKey.get(`${weekday}-${h}`) || null)

  function visitValue(c, h) {
    if (useLiveToday) {
      return todayByHour.get(h) || 0
    }
    if (!c) return 0
    const avg = Number(c.avg_visits)
    if (Number.isFinite(avg) && avg > 0) return avg
    const mov = Number(c.movimenti || 0)
    const days = Math.max(1, Number(c.sample_days || 1))
    return mov / days
  }

  const maxVisits = Math.max(1, ...hourList.map((h, idx) => visitValue(dayCells[idx], h)))
  const hasData = hourList.some((h, idx) => visitValue(dayCells[idx], h) > 0)

  const peakHour = hourList.reduce(
    (best, h, idx) => {
      const v = visitValue(dayCells[idx], h)
      if (v > best.v) return { v, hour: h, cell: dayCells[idx] }
      return best
    },
    { v: 0, hour: null, cell: null },
  )

  return (
    <div className="analisi-popular">
      <div className="analisi-popular-head">
        <h3 className="analisi-machine-subtitle" style={{ margin: 0 }}>
          {title}
        </h3>
        <label className="analisi-popular-day">
          <span className="analisi-popular-day-label">Giorno</span>
          <select
            value={weekday}
            onChange={(e) => setWeekday(Number(e.target.value))}
            aria-label="Giorno della settimana"
          >
            {dayLabels.map((label, idx) => (
              <option key={label} value={idx}>
                {WEEKDAY_SHORT[idx] || label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="analisi-machine-scope" style={{ marginBottom: '0.45rem' }}>
        {useLiveToday
          ? 'Visite di oggi · scontrini agent in tempo reale (ora per ora)'
          : 'Media storica per questo giorno della settimana (~3 mesi)'}
        {peakHour.hour != null && peakHour.v > 0
          ? ` · picco alle ${String(peakHour.hour).padStart(2, '0')}:00`
          : ''}
      </p>
      {!hasData ? (
        <p className="empty-state">
          {useLiveToday ? 'Ancora nessun scontrino oggi in queste fasce.' : 'Pochi dati visite per questo giorno.'}
        </p>
      ) : (
        <div className="analisi-popular-chart" role="img" aria-label={`Orari di punta ${dayLabels[weekday]}`}>
          {hourList.map((h, idx) => {
            const c = dayCells[idx]
            const v = visitValue(c, h)
            const heightPct = Math.max(v > 0 ? 6 : 0, Math.round((v / maxVisits) * 100))
            const isLive = weekday === todayIdx && h === nowHour
            const isPeak = peakHour.hour === h && peakHour.v > 0
            const showTick = h % 3 === 0 || h === hourList[0] || h === hourList[hourList.length - 1]
            const tipUnit = useLiveToday ? 'visite oggi' : 'visite medie/ora'
            return (
              <div
                key={h}
                className={`analisi-popular-col${isLive ? ' is-live' : ''}${isPeak ? ' is-peak' : ''}`}
                title={
                  c || useLiveToday
                    ? `${dayLabels[weekday]} ${String(h).padStart(2, '0')}:00 · ${useLiveToday ? v : `~${v.toFixed(1)}`} ${tipUnit}`
                    : `${String(h).padStart(2, '0')}:00`
                }
              >
                {isLive ? (
                  <span className="analisi-popular-live">LIVE</span>
                ) : (
                  <span className="analisi-popular-live-spacer" />
                )}
                <div className="analisi-popular-track">
                  <div className="analisi-popular-bar" style={{ height: `${heightPct}%` }} />
                </div>
                <div className={`analisi-popular-hour${showTick ? ' is-visible' : ''}`}>
                  {showTick ? h : ''}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <div className="analisi-popular-legend" aria-hidden>
        <span>
          <i className="analisi-popular-swatch" /> {useLiveToday ? 'Visite oggi' : 'Affluenza tipica'}
        </span>
        <span>
          <i className="analisi-popular-swatch is-live" /> Ora attuale
        </span>
      </div>
    </div>
  )
}

export function HeatmapGrid({ hours = [], weekdays = [], cells = [] }) {
  const byKey = React.useMemo(() => {
    const map = new Map()
    for (const c of cells) map.set(`${c.weekday}-${c.hour}`, c)
    return map
  }, [cells])

  if (!hours.length || !weekdays.length) {
    return <p className="empty-state">Nessuna heatmap disponibile.</p>
  }

  return (
    <div className="analisi-heatmap-wrap">
      <table className="analisi-heatmap">
        <thead>
          <tr>
            <th scope="col">Giorno</th>
            {hours.map((h) => (
              <th key={h} scope="col">
                {String(h).padStart(2, '0')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weekdays.map((label, wd) => (
            <tr key={label}>
              <th scope="row">{label.slice(0, 3)}</th>
              {hours.map((h) => {
                const cell = byKey.get(`${wd}-${h}`)
                const level = cell?.level || 'nullo'
                const ops = cell?.operatori_consigliati || 0
                const title = cell
                  ? `${label} ${cell.slot_label}: ${eur(cell.avg_amount)} · ${ops} op.`
                  : `${label} ${h}:00`
                return (
                  <td key={h} className={`analisi-heat-cell level-${level}`} title={title}>
                    {ops > 0 && level !== 'nullo' ? ops : ''}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="analisi-heat-legend" aria-hidden>
        <span className="level-basso">basso</span>
        <span className="level-medio">medio</span>
        <span className="level-alto">alto</span>
      </div>
    </div>
  )
}
