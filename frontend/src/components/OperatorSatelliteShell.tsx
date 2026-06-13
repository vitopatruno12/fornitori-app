import React from 'react'
import { validateAtlasLogin } from '../utils/atlasAuth'
import OfflineBanner from './OfflineBanner.jsx'
import PwaInstallPrompt from './PwaInstallPrompt.jsx'

export type OperatorNavItem = {
  id: string
  label: string
  active: boolean
  onClick: () => void
}

type OperatorSatelliteShellProps = {
  documentTitle: string
  loginHint: string
  headerTitle: string
  headerSubtitle?: string
  nav?: OperatorNavItem[]
  children: React.ReactNode
}

export default function OperatorSatelliteShell({
  documentTitle,
  loginHint,
  headerTitle,
  headerSubtitle = 'Collegato al gestionale ATLAS — salvataggio sullo stesso database',
  nav,
  children,
}: OperatorSatelliteShellProps) {
  const [isAuthenticated, setIsAuthenticated] = React.useState(() => {
    try {
      return sessionStorage.getItem('atlasAuth') === '1'
    } catch {
      return false
    }
  })
  const [loginUsername, setLoginUsername] = React.useState('')
  const [loginPassword, setLoginPassword] = React.useState('')
  const [loginError, setLoginError] = React.useState('')
  const [showPassword, setShowPassword] = React.useState(false)
  const [isLoggingIn, setIsLoggingIn] = React.useState(false)

  React.useEffect(() => {
    document.title = documentTitle
  }, [documentTitle])

  React.useEffect(() => {
    try {
      sessionStorage.setItem('atlasAuth', isAuthenticated ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [isAuthenticated])

  function handleLoginSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (isLoggingIn) return
    const u = loginUsername.trim()
    const p = loginPassword.trim()
    if (!u || !p) {
      setLoginError('Inserisci username e password')
      return
    }
    if (!validateAtlasLogin(u, p)) {
      setLoginError('Username o password non corretti')
      return
    }
    setLoginError('')
    setIsLoggingIn(true)
    window.setTimeout(() => {
      setIsAuthenticated(true)
      setLoginPassword('')
      setIsLoggingIn(false)
    }, 260)
  }

  function handleLogout() {
    setIsAuthenticated(false)
    setLoginPassword('')
  }

  if (!isAuthenticated) {
    return (
      <div className={`atlas-login-page operator-order-login${isLoggingIn ? ' is-entering' : ''}`}>
        <div className="atlas-login-overlay" />
        <div className="atlas-login-shell">
          <img src="/atlas-login-bg.png" alt="ATLAS" className="atlas-login-hero" />
          <p className="operator-order-login-hint">{loginHint}</p>
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
      <header className="operator-order-header" aria-label="Intestazione operatore">
        <img src="/atlas-logo.svg" alt="ATLAS" className="operator-order-logo" />
        <div className="operator-order-header-text">
          <strong>{headerTitle}</strong>
          <span>{headerSubtitle}</span>
        </div>
        <button type="button" className="btn btn-secondary btn-sm operator-order-logout" onClick={handleLogout}>
          Esci
        </button>
      </header>
      {nav && nav.length > 0 ? (
        <nav className="operator-satellite-nav" aria-label="Sezioni operatore">
          {nav.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`operator-satellite-nav-btn${item.active ? ' is-active' : ''}`}
              onClick={item.onClick}
              aria-current={item.active ? 'page' : undefined}
            >
              {item.label}
            </button>
          ))}
        </nav>
      ) : null}
      <main className="app-main operator-order-main">{children}</main>
    </div>
  )
}
