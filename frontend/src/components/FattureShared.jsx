import React from 'react'
import { Link, Navigate, NavLink } from 'react-router-dom'

export const FATTURE_NAV_ITEMS = [
  { to: '/fatture', label: 'Dashboard', end: true },
  { to: '/fatture/ricevute', label: 'Fatture ricevute' },
  { to: '/fatture/da-registrare', label: 'Da registrare' },
  { to: '/fatture/registrate', label: 'Registrate' },
  { to: '/fatture/scadenziario', label: 'Scadenziario' },
  { to: '/fatture/sincronizzazione', label: 'Sincronizzazione' },
  { to: '/fatture/conservazione', label: 'Conservazione' },
  { to: '/fatture/importa-xml', label: 'Importa XML' },
  { to: '/fatture/log', label: 'Log sync' },
  { to: '/fatture/impostazioni', label: 'Impostazioni fatture' },
  { to: '/pagamenti', label: 'Pagamenti' },
]

/** Base path fatture: `/fatture` nel gestionale, oppure `/operatore-consegne/fatture` in postazione carrier. */
export const FattureNavBaseContext = React.createContext('/fatture')

export function FattureNavBaseProvider({ base = '/fatture', children }) {
  const normalized = String(base || '/fatture').replace(/\/+$/, '') || '/fatture'
  return <FattureNavBaseContext.Provider value={normalized}>{children}</FattureNavBaseContext.Provider>
}

/** Risolve un path assoluto `/fatture/...` rispetto alla base corrente. */
export function useFattureTo(to) {
  const base = React.useContext(FattureNavBaseContext)
  const raw = String(to || '').trim()
  if (!raw || raw === '/pagamenti' || raw.startsWith('/pagamenti?')) return raw || base
  if (raw === '/fatture' || raw === '/fatture/') return base
  if (raw.startsWith('/fatture/')) return `${base}/${raw.slice('/fatture/'.length)}`
  if (raw.startsWith('/')) return raw
  return `${base}/${raw.replace(/^\//, '')}`
}

export function FattureLink({ to, ...props }) {
  const resolved = useFattureTo(to)
  return <Link to={resolved} {...props} />
}

export function FattureNavigate({ to, ...props }) {
  const resolved = useFattureTo(to)
  return <Navigate to={resolved} {...props} />
}

export function eur(n) {
  if (n == null || n === '') return '—'
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(n))
}

export function formatDate(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('it-IT')
}

export function PaymentBadge({ status, ignored }) {
  const base = {
    padding: '0.15rem 0.5rem',
    borderRadius: 999,
    fontSize: '0.78rem',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  }
  if (ignored) {
    return <span style={{ ...base, background: '#e5e7eb', color: '#4b5563' }}>Ignorata</span>
  }
  if (status === 'paid') {
    return (
      <span style={{ ...base, background: 'var(--success-bg, #d1fae5)', color: 'var(--success, #059669)' }}>
        Pagata
      </span>
    )
  }
  if (status === 'partial') {
    return <span style={{ ...base, background: '#fef3c7', color: '#b45309' }}>Parziale</span>
  }
  return (
    <span style={{ ...base, background: 'var(--danger-bg, #fee2e2)', color: 'var(--danger, #dc2626)' }}>
      Non pagata
    </span>
  )
}

export function FattureSubnav() {
  const base = React.useContext(FattureNavBaseContext)
  const embedded = base !== '/fatture'
  const items = FATTURE_NAV_ITEMS.filter((item) => !(embedded && item.to === '/pagamenti')).map((item) => {
    if (item.to === '/pagamenti') return item
    if (item.to === '/fatture') return { ...item, to: base }
    return { ...item, to: `${base}/${item.to.slice('/fatture/'.length)}` }
  })

  return (
    <nav className="fatture-subnav" aria-label="Sezioni Amministrazione">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={Boolean(item.end)}
          className={({ isActive }) => `fatture-subnav-link${isActive ? ' is-active' : ''}`}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}

export function FatturePageShell({ title, lead, children, actions = null }) {
  return (
    <div className="fatture-page">
      <header className="fatture-header staff-page-hero">
        <div className="fatture-header-row">
          <div>
            <p className="fatture-kicker">Amministrazione · Fatture Fornitori</p>
            <h1 className="page-header staff-page-title" style={{ marginBottom: '0.25rem' }}>
              {title}
            </h1>
            {lead ? <p className="dashboard-subtitle staff-page-lead">{lead}</p> : null}
          </div>
          {actions}
        </div>
      </header>
      <FattureSubnav />
      {children}
    </div>
  )
}

export function FattureStubCard({ title, points = [] }) {
  return (
    <section className="card fatture-panel">
      <h2 className="fatture-panel-title">{title}</h2>
      <p className="fatture-note">Funzione in evoluzione (fase 1). Ecco cosa arriverà:</p>
      <ul className="fatture-suggestions">
        {points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </section>
  )
}

export function SeriesBars({ rows, valueKey = 'totale', labelKey = 'month_label' }) {
  if (!rows?.length) return <p className="empty-state">Nessun dato nel periodo.</p>
  const max = Math.max(1, ...rows.map((r) => Number(r[valueKey] || 0)))
  return (
    <div className="analisi-bars">
      {rows.map((r, idx) => {
        const v = Number(r[valueKey] || 0)
        const label = r[labelKey] || r.month_key || `#${idx + 1}`
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
