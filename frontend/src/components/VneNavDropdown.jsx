import React from 'react'

export default function VneNavDropdown({ label, open, active, onToggle, children }) {
  return (
    <div className={`vne-nav-dropdown${open ? ' is-open' : ''}${active ? ' is-active' : ''}`}>
      <button
        type="button"
        className={`vne-nav-dropdown-trigger${active ? ' is-active' : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={onToggle}
      >
        <span>{label}</span>
        <span className="vne-nav-dropdown-caret" aria-hidden>▾</span>
      </button>
      {open ? <div className="vne-nav-dropdown-panel">{children}</div> : null}
    </div>
  )
}
