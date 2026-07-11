import React from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useLocation } from 'react-router-dom'

type NavDropdownItem = {
  to: string
  label: string
}

type Props = {
  label: string
  to: string
  items: NavDropdownItem[]
  onNavigate?: () => void
}

function useIsMobileNav() {
  const [isMobile, setIsMobile] = React.useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1199px)').matches,
  )

  React.useEffect(() => {
    const mq = window.matchMedia('(max-width: 1199px)')
    const onChange = () => setIsMobile(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return isMobile
}

function useNavDropdownMenuPosition(open: boolean, rootRef: React.RefObject<HTMLDivElement | null>) {
  const [style, setStyle] = React.useState<React.CSSProperties>({})

  React.useLayoutEffect(() => {
    if (!open) return
    const root = rootRef.current
    if (!root) return

    function updatePosition() {
      const node = rootRef.current
      if (!node) return
      const rect = node.getBoundingClientRect()
      const top = rect.bottom + 4
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - 180))
      setStyle({
        top: `${top}px`,
        left: `${left}px`,
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, rootRef])

  return style
}

export default function AppNavDropdown({ label, to, items, onNavigate }: Props) {
  const location = useLocation()
  const [open, setOpen] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const isMobileNav = useIsMobileNav()
  const menuStyle = useNavDropdownMenuPosition(open && !isMobileNav, rootRef)
  const isGroupActive =
    location.pathname === to || items.some((item) => location.pathname === item.to)

  React.useEffect(() => {
    function onDocClick(event: MouseEvent) {
      const target = event.target as Node
      if (rootRef.current?.contains(target)) return
      const menu = document.getElementById(`app-nav-dropdown-menu-${label.replace(/\s+/g, '-')}`)
      if (menu?.contains(target)) return
      setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open, label])

  React.useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  const menuId = `app-nav-dropdown-menu-${label.replace(/\s+/g, '-')}`

  const menu = open ? (
    <div
      id={menuId}
      className="app-nav-dropdown-menu"
      role="menu"
      style={isMobileNav ? undefined : menuStyle}
    >
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          role="menuitem"
          className={({ isActive }) => (isActive ? 'active' : '')}
          onClick={() => {
            setOpen(false)
            onNavigate?.()
          }}
        >
          {item.label}
        </NavLink>
      ))}
    </div>
  ) : null

  return (
    <div
      className={`app-nav-dropdown${open ? ' is-open' : ''}${isGroupActive ? ' is-active' : ''}`}
      ref={rootRef}
    >
      <div className="app-nav-dropdown-trigger">
        <NavLink
          to={to}
          className={({ isActive }) => `app-nav-dropdown-label${isActive ? ' active' : ''}`}
          onClick={onNavigate}
        >
          {label}
        </NavLink>
        <button
          type="button"
          className="app-nav-dropdown-caret"
          aria-expanded={open}
          aria-haspopup="menu"
          aria-controls={menuId}
          aria-label={`Apri menu ${label}`}
          onClick={() => setOpen((value) => !value)}
        >
          <span aria-hidden>▾</span>
        </button>
      </div>
      {menu && (isMobileNav ? menu : createPortal(menu, document.body))}
    </div>
  )
}
