import React from 'react'
import { createPortal } from 'react-dom'
import { type OperatorAuthMode, validateOperatorAuthMode } from '../utils/atlasAuth'
import { setOperatorStationLock } from '../utils/operatorMode.ts'
import OfflineBanner from './OfflineBanner.jsx'
import PwaInstallPrompt from './PwaInstallPrompt.jsx'
import AtlasUpdateButton from './AtlasUpdateButton.jsx'

const SESSION_KEY_BY_MODE: Record<OperatorAuthMode, string> = {
  operator: 'atlasAuthOperator',
  carrier: 'atlasAuthCarrier',
}

export type OperatorNavItem = {
  id: string
  label: string
  active: boolean
  onClick: () => void
  items?: {
    id: string
    label: string
    active: boolean
    onClick: () => void
  }[]
}

function computeDropdownMenuStyle(anchor: HTMLElement, menuEl: HTMLElement | null): React.CSSProperties {
  const rect = anchor.getBoundingClientRect()
  const gap = 6
  const viewportPad = 10
  const minWidth = Math.max(rect.width, 176)
  const menuHeight = menuEl?.offsetHeight ?? 220
  const maxLeft = window.innerWidth - viewportPad - minWidth

  let top = rect.bottom + gap
  let left = Math.min(Math.max(rect.left, viewportPad), Math.max(viewportPad, maxLeft))

  if (top + menuHeight > window.innerHeight - viewportPad) {
    top = Math.max(viewportPad, rect.top - gap - menuHeight)
  }

  return {
    position: 'fixed',
    top,
    left,
    minWidth,
    zIndex: 1000,
  }
}

function OperatorSatelliteNavDropdown({
  item,
}: {
  item: OperatorNavItem & { items: NonNullable<OperatorNavItem['items']> }
}) {
  const [open, setOpen] = React.useState(false)
  const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties>({})
  const rootRef = React.useRef<HTMLDivElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)
  const groupActive = item.active || item.items.some((sub) => sub.active)

  const updateMenuPosition = React.useCallback(() => {
    if (!rootRef.current) return
    setMenuStyle(computeDropdownMenuStyle(rootRef.current, menuRef.current))
  }, [])

  React.useLayoutEffect(() => {
    if (!open) return
    updateMenuPosition()
    const raf = window.requestAnimationFrame(updateMenuPosition)
    return () => window.cancelAnimationFrame(raf)
  }, [open, updateMenuPosition, item.items.length])

  React.useEffect(() => {
    if (!open) return

    function onDocClick(event: MouseEvent) {
      const target = event.target as Node
      if (rootRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }

    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    window.addEventListener('mousedown', onDocClick)
    window.addEventListener('keydown', onEscape)
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    return () => {
      window.removeEventListener('mousedown', onDocClick)
      window.removeEventListener('keydown', onEscape)
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
    }
  }, [open, updateMenuPosition])

  const menu =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={menuRef}
            className="operator-satellite-nav-dropdown-menu is-portal"
            style={menuStyle}
            role="menu"
          >
            {item.items.map((sub) => (
              <button
                key={sub.id}
                type="button"
                role="menuitem"
                className={`operator-satellite-nav-dropdown-item${sub.active ? ' is-active' : ''}`}
                onClick={() => {
                  setOpen(false)
                  sub.onClick()
                }}
              >
                {sub.label}
              </button>
            ))}
          </div>,
          document.body,
        )
      : null

  return (
    <div
      className={`operator-satellite-nav-dropdown${open ? ' is-open' : ''}${groupActive ? ' is-active' : ''}`}
      ref={rootRef}
    >
      <button
        type="button"
        className={`operator-satellite-nav-btn operator-satellite-nav-btn-main${item.active ? ' is-active' : ''}`}
        aria-current={item.active ? 'page' : undefined}
        onClick={() => {
          setOpen(false)
          item.onClick()
        }}
      >
        {item.label}
      </button>
      <button
        type="button"
        className="operator-satellite-nav-btn operator-satellite-nav-btn-caret"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Apri menu ${item.label}`}
        onClick={() => setOpen((value) => !value)}
      >
        ▾
      </button>
      {menu}
    </div>
  )
}

type OperatorSatelliteShellProps = {
  documentTitle: string
  /** Testo sotto il logo / sopra il form; se vuoto non viene mostrato. */
  loginHint?: string
  headerTitle: string
  headerSubtitle?: string
  nav?: OperatorNavItem[]
  stationOnly?: boolean
  /** Credenziali: postazione operativa oppure postazione trasportatore. */
  authMode?: OperatorAuthMode
  children: React.ReactNode
}

export default function OperatorSatelliteShell({
  documentTitle,
  loginHint = '',
  headerTitle,
  headerSubtitle = 'Collegato al gestionale ATLAS — salvataggio sullo stesso database',
  nav,
  stationOnly = false,
  authMode = 'operator',
  children,
}: OperatorSatelliteShellProps) {
  const sessionKey = SESSION_KEY_BY_MODE[authMode]
  const [isAuthenticated, setIsAuthenticated] = React.useState(() => {
    try {
      return sessionStorage.getItem(sessionKey) === '1'
    } catch {
      return false
    }
  })
  const [loginUsername, setLoginUsername] = React.useState('')
  const [loginPassword, setLoginPassword] = React.useState('')
  const [loginError, setLoginError] = React.useState('')
  const [showPassword, setShowPassword] = React.useState(false)
  const [isLoggingIn, setIsLoggingIn] = React.useState(false)
  const [compactHeaderActions, setCompactHeaderActions] = React.useState(false)

  React.useEffect(() => {
    const mq = window.matchMedia('(max-width: 1100px)')
    const apply = () => setCompactHeaderActions(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  React.useEffect(() => {
    document.title = documentTitle
  }, [documentTitle])

  React.useEffect(() => {
    try {
      sessionStorage.setItem(sessionKey, isAuthenticated ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [isAuthenticated, sessionKey])

  function handleLoginSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (isLoggingIn) return
    const u = loginUsername.trim()
    const p = loginPassword.trim()
    if (!u || !p) {
      setLoginError('Inserisci username e password')
      return
    }
    if (!validateOperatorAuthMode(authMode, u, p)) {
      setLoginError('Username o password non corretti')
      return
    }
    setLoginError('')
    setIsLoggingIn(true)
    window.setTimeout(() => {
      setIsAuthenticated(true)
      setLoginPassword('')
      setIsLoggingIn(false)
      if (stationOnly) setOperatorStationLock(true)
    }, 260)
  }

  function handleLogout() {
    setIsAuthenticated(false)
    setLoginPassword('')
    if (stationOnly) setOperatorStationLock(false)
  }

  if (!isAuthenticated) {
    return (
      <div className={`atlas-login-page operator-order-login${isLoggingIn ? ' is-entering' : ''}`}>
        <div className="atlas-login-overlay" />
        <div className="atlas-login-shell">
          <img src="/atlas-login-bg.png" alt="ATLAS" className="atlas-login-hero" />
          {loginHint.trim() ? <p className="operator-order-login-hint">{loginHint}</p> : null}
          <form className="atlas-login-form" onSubmit={handleLoginSubmit}>
            <input
              type="text"
              className="form-control atlas-login-input"
              value={loginUsername}
              onChange={(e) => setLoginUsername(e.target.value)}
              placeholder="Username"
              autoComplete="username"
            />
            <div className="atlas-password-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                className="form-control atlas-login-input atlas-password-input"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Password"
                autoComplete="current-password"
              />
              <button
                type="button"
                className="atlas-password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Nascondi password' : 'Mostra password'}
              >
                {showPassword ? 'Nascondi' : 'Mostra'}
              </button>
            </div>
            {loginError ? <p className="atlas-login-error">{loginError}</p> : null}
            <button type="submit" className="btn btn-primary atlas-login-submit" disabled={isLoggingIn}>
              {isLoggingIn ? 'Accesso...' : 'Accedi'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="app-wrap operator-order-wrap">
      <OfflineBanner />
      <PwaInstallPrompt />
      <div className="operator-station-band">
        <div className="operator-station-band-inner">
          <header className="operator-order-header" aria-label="Intestazione operatore">
            <img src="/atlas-logo.svg" alt="ATLAS" className="operator-order-logo" />
            <div className="operator-order-header-text">
              <strong>{headerTitle}</strong>
              {headerSubtitle ? <span>{headerSubtitle}</span> : null}
            </div>
            <div className="operator-order-header-actions">
              <AtlasUpdateButton iconOnly={compactHeaderActions} />
              <button type="button" className="btn btn-secondary btn-sm operator-order-logout" onClick={handleLogout}>
                Esci
              </button>
            </div>
          </header>
          {nav && nav.length > 0 ? (
            <nav className="operator-satellite-nav" aria-label="Sezioni operatore">
              {nav.map((item) =>
                item.items && item.items.length > 0 ? (
                  <OperatorSatelliteNavDropdown key={item.id} item={{ ...item, items: item.items }} />
                ) : (
                  <button
                    key={item.id}
                    type="button"
                    className={`operator-satellite-nav-btn${item.active ? ' is-active' : ''}`}
                    onClick={item.onClick}
                    aria-current={item.active ? 'page' : undefined}
                  >
                    {item.label}
                  </button>
                ),
              )}
            </nav>
          ) : null}
        </div>
      </div>
      <main className="app-main operator-order-main">{children}</main>
    </div>
  )
}
