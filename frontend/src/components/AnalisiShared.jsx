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

export function AnalisiPageShell({ title, lead, children, actions = null }) {
  return (
    <div className="analisi-page">
      <header className="analisi-header staff-page-hero">
        <div className="analisi-header-row">
          <div>
            <p className="analisi-kicker">Analisi</p>
            <h1 className="page-header staff-page-title" style={{ marginBottom: '0.25rem' }}>
              {title}
            </h1>
            {lead ? <p className="dashboard-subtitle staff-page-lead">{lead}</p> : null}
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
        label={loading ? 'Caricamento dati VNE' : 'Aggiornamento dati'}
      />
    )
  }

  if (!when) return null
  return <p className="analisi-sync-meta">Aggiornato: {when}</p>
}

/** Classifica semaforo VNE: green / yellow / red. */
export function resolveVneSemaphoreLight(messages = [], { emptyFail = false, hasOffline = false } = {}) {
  const items = (Array.isArray(messages) ? messages : [messages])
    .map((w) => String(w || '').trim())
    .filter(Boolean)
  const blob = items.join('\n').toLowerCase()
  const hardError =
    emptyFail ||
    /403|forbidden|accesso negato|credenzial|csrf|http error|errore query|non validi|sessione/.test(blob)
  const delayed =
    /timeout|rallent|ritardo|non accessibile|lenta|504|troppo lenta|offline|connessione/.test(blob) ||
    hasOffline ||
    (items.length > 0 && !hardError)

  if (hardError) return 'red'
  if (delayed) return 'yellow'
  return 'green'
}

/** Semaforo stato VNE: verde ok, giallo ritardo, rosso errore. */
export function VneStatusSemaphore({ light = 'green', show = true }) {
  if (!show) return null
  const labels = {
    green: 'Operativo',
    yellow: 'Rallentamento o in ritardo',
    red: 'Errore',
  }
  const active = light === 'yellow' || light === 'red' ? light : 'green'

  return (
    <div
      className={`analisi-vne-semaphore analisi-vne-semaphore--${active}`}
      role="status"
      aria-label={`Stato VNE: ${labels[active]}`}
    >
      <div className="analisi-vne-semaphore-housing" aria-hidden>
        <span className={`analisi-vne-light analisi-vne-light--red${active === 'red' ? ' is-on' : ''}`} />
        <span className={`analisi-vne-light analisi-vne-light--yellow${active === 'yellow' ? ' is-on' : ''}`} />
        <span className={`analisi-vne-light analisi-vne-light--green${active === 'green' ? ' is-on' : ''}`} />
      </div>
      <div className="analisi-vne-semaphore-copy">
        <strong className="analisi-vne-semaphore-title">Stato collegamento VNE</strong>
        <ul className="analisi-vne-semaphore-legend">
          <li className={active === 'green' ? 'is-active' : ''}>
            <span className="analisi-vne-legend-dot analisi-vne-legend-dot--green" />
            Verde — operativo
          </li>
          <li className={active === 'yellow' ? 'is-active' : ''}>
            <span className="analisi-vne-legend-dot analisi-vne-legend-dot--yellow" />
            Giallo — rallentamento o in ritardo
          </li>
          <li className={active === 'red' ? 'is-active' : ''}>
            <span className="analisi-vne-legend-dot analisi-vne-legend-dot--red" />
            Rosso — errore
          </li>
        </ul>
      </div>
    </div>
  )
}

export function SeriesBars({ rows, valueKey = 'incasso', labelKey = 'label' }) {
  if (!rows?.length) return <p className="empty-state">Nessun dato disponibile nel periodo.</p>
  const max = Math.max(1, ...rows.map((r) => Number(r[valueKey] || 0)))
  return (
    <div className="analisi-bars">
      {rows.map((r, idx) => {
        const v = Number(r[valueKey] || 0)
        const label = r[labelKey] || r.month_label || r.date || r.week_start || `#${idx + 1}`
        return (
          <div key={label + idx} className="analisi-bar-row">
            <div className="analisi-bar-label" title={label}>
              {label}
            </div>
            <div className="analisi-bar-track">
              <div className="analisi-bar-fill" style={{ width: `${(v / max) * 100}%` }} />
            </div>
            <div className="analisi-bar-value">{eur(v)}</div>
          </div>
        )
      })}
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
