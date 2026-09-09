import React, { useEffect, useId, useRef, useState } from 'react'

/**
 * Azioni compatte per griglie fatture: un'azione primaria + menu «Opzioni».
 */
export default function FattureActionsMenu({ primary = null, items = [], label = 'Opzioni' }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return undefined
    function onDoc(ev) {
      if (!rootRef.current?.contains(ev.target)) setOpen(false)
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

  const menuItems = (Array.isArray(items) ? items : []).filter(Boolean)

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
          {open ? (
            <div id={menuId} className="fatture-actions-menu-panel" role="menu">
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
                    className={[
                      'fatture-actions-menu-item',
                      item.danger ? 'is-danger' : '',
                    ]
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
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
