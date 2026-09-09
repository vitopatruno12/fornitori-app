import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Azioni compatte per griglie fatture: un'azione primaria + menu «Opzioni».
 * Il pannello è in portal su document.body per non essere tagliato dall'overflow della tabella.
 */
export default function FattureActionsMenu({ primary = null, items = [], label = 'Opzioni' }) {
  const [open, setOpen] = useState(false)
  const [panelStyle, setPanelStyle] = useState({})
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)
  const menuId = useId()

  const menuItems = (Array.isArray(items) ? items : []).filter(Boolean)

  useLayoutEffect(() => {
    if (!open) return undefined

    function updatePosition() {
      const trigger = triggerRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const panel = panelRef.current
      const panelHeight = panel?.offsetHeight || Math.min(280, menuItems.length * 40 + 16)
      const panelWidth = panel?.offsetWidth || 168
      const gap = 4
      const spaceBelow = window.innerHeight - rect.bottom - 8
      const openUp = spaceBelow < panelHeight && rect.top > spaceBelow
      const top = openUp
        ? Math.max(8, rect.top - panelHeight - gap)
        : Math.min(window.innerHeight - panelHeight - 8, rect.bottom + gap)
      const left = Math.max(8, Math.min(rect.right - panelWidth, window.innerWidth - panelWidth - 8))
      setPanelStyle({
        position: 'fixed',
        top: `${top}px`,
        left: `${left}px`,
        zIndex: 1200,
      })
    }

    updatePosition()
    // Re-measure after paint when panel has real height
    const raf = requestAnimationFrame(updatePosition)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, menuItems.length])

  useEffect(() => {
    if (!open) return undefined
    function onDoc(ev) {
      const target = ev.target
      if (rootRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKey(ev) {
      if (ev.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const panel =
    open && menuItems.length > 0 ? (
      <div
        id={menuId}
        ref={panelRef}
        className="fatture-actions-menu-panel fatture-actions-menu-panel--portal"
        role="menu"
        style={panelStyle}
      >
        {menuItems.map((item) => {
          if (item.href) {
            return (
              <a
                key={item.key || item.label}
                role="menuitem"
                className="fatture-actions-menu-item"
                href={item.href}
                target={item.target || '_blank'}
                rel={item.rel || 'noreferrer'}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </a>
            )
          }
          return (
            <button
              key={item.key || item.label}
              type="button"
              role="menuitem"
              className={['fatture-actions-menu-item', item.danger ? 'is-danger' : '']
                .filter(Boolean)
                .join(' ')}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.onClick?.()
              }}
            >
              {item.label}
            </button>
          )
        })}
      </div>
    ) : null

  return (
    <div
      className="fatture-actions-menu"
      ref={rootRef}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {primary}
      {menuItems.length > 0 ? (
        <div className="fatture-actions-menu-wrap">
          <button
            ref={triggerRef}
            type="button"
            className="btn btn-secondary btn-sm fatture-actions-menu-trigger"
            aria-expanded={open}
            aria-haspopup="menu"
            aria-controls={menuId}
            onClick={() => setOpen((v) => !v)}
          >
            {label}
            <span className="fatture-actions-menu-caret" aria-hidden>
              ▾
            </span>
          </button>
          {panel && typeof document !== 'undefined' ? createPortal(panel, document.body) : null}
        </div>
      ) : null}
    </div>
  )
}
