import React from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'

export const AMMINISTRAZIONE_NAV_ITEMS = [
  { to: '/amministrazione', label: 'Dashboard', end: true },
  { to: '/amministrazione/mastrini', label: 'Mastrini contabili' },
  { to: '/banca', label: 'Banca' },
  { to: '/fatture', label: 'Fatture Fornitori' },
  { to: '/prima-nota', label: 'Prima Nota' },
  { to: '/amministrazione/impostazioni', label: 'Impostazioni' },
]

export const BANCA_NAV_ITEMS = [
  { to: '/banca', label: 'Dashboard', end: true },
  { to: '/banca/conti', label: 'Conti correnti' },
  { to: '/banca/movimenti', label: 'Movimenti' },
  { to: '/banca/riconciliazione', label: 'Riconciliazione' },
]

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

export function ConnectionBadge({ status }) {
  const base = {
    padding: '0.15rem 0.5rem',
    borderRadius: 999,
    fontSize: '0.78rem',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  }
  if (status === 'connected') {
    return <span style={{ ...base, background: '#d1fae5', color: '#059669' }}>Collegato</span>
  }
  if (status === 'pending') {
    return <span style={{ ...base, background: '#fef3c7', color: '#b45309' }}>In corso</span>
  }
  if (status === 'error') {
    return <span style={{ ...base, background: '#fee2e2', color: '#dc2626' }}>Errore</span>
  }
  return <span style={{ ...base, background: '#e5e7eb', color: '#4b5563' }}>Disconnesso</span>
}

export function ReconBadge({ status }) {
  const base = {
    padding: '0.15rem 0.5rem',
    borderRadius: 999,
    fontSize: '0.78rem',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  }
  if (status === 'matched') {
    return <span style={{ ...base, background: '#d1fae5', color: '#059669' }}>Riconciliato</span>
  }
  if (status === 'difference') {
    return <span style={{ ...base, background: '#fef3c7', color: '#b45309' }}>Differenza</span>
  }
  return <span style={{ ...base, background: '#fee2e2', color: '#dc2626' }}>Da riconciliare</span>
}

export function AmministrazioneSubnav() {
  const location = useLocation()
  const path = location.pathname || ''

  return (
    <nav className="fatture-subnav" aria-label="Sezioni Amministrazione">
      {AMMINISTRAZIONE_NAV_ITEMS.map((item) => {
        let active = false
        if (item.to === '/amministrazione' && item.end) active = path === '/amministrazione'
        else if (item.to === '/amministrazione/mastrini') active = path === '/amministrazione/mastrini'
        else if (item.to === '/amministrazione/impostazioni') active = path === '/amministrazione/impostazioni'
        else if (item.to === '/banca') active = path === '/banca' || path.startsWith('/banca/')
        else if (item.to === '/fatture') active = path.startsWith('/fatture') || path === '/pagamenti'
        else if (item.to === '/prima-nota') active = path.startsWith('/prima-nota')
        else active = path === item.to || path.startsWith(`${item.to}/`)
        return (
          <NavLink key={item.to} to={item.to} end={Boolean(item.end)} className={`fatture-subnav-link${active ? ' is-active' : ''}`}>
            {item.label}
          </NavLink>
        )
      })}
    </nav>
  )
}

export function BancaSubnav() {
  return (
    <nav className="fatture-subnav" aria-label="Sezioni Banca">
      {BANCA_NAV_ITEMS.map((item) => (
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

export function AmministrazionePageShell({ title, lead, children, actions = null }) {
  return (
    <div className="fatture-page banca-page">
      <header className="fatture-header staff-page-hero">
        <div className="fatture-header-row">
          <div>
            <p className="fatture-kicker">Amministrazione</p>
            <h1 className="page-header staff-page-title" style={{ marginBottom: '0.25rem' }}>
              {title}
            </h1>
            {lead ? <p className="dashboard-subtitle staff-page-lead">{lead}</p> : null}
          </div>
          {actions}
        </div>
      </header>
      <AmministrazioneSubnav />
      {children}
    </div>
  )
}

export function BancaPageShell({ title, lead, children, actions = null }) {
  return (
    <div className="fatture-page banca-page">
      <header className="fatture-header staff-page-hero">
        <div className="fatture-header-row">
          <div>
            <p className="fatture-kicker">
              <Link to="/amministrazione" style={{ color: 'inherit', textDecoration: 'none' }}>
                Amministrazione
              </Link>
              {' · Banca'}
            </p>
            <h1 className="page-header staff-page-title" style={{ marginBottom: '0.25rem' }}>
              {title}
            </h1>
            {lead ? <p className="dashboard-subtitle staff-page-lead">{lead}</p> : null}
          </div>
          {actions}
        </div>
      </header>
      <BancaSubnav />
      {children}
    </div>
  )
}
