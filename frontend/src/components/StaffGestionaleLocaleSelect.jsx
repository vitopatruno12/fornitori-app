import React from 'react'

/**
 * Selettore locale Personale nel banner del gestionale (Report, Stipendi).
 */
export default function StaffGestionaleLocaleSelect({
  localeNames = [],
  value = '',
  onChange,
  loading = false,
  disabled = false,
  className = '',
}) {
  return (
    <label className={`staff-gestionale-locale-select ${className}`.trim()}>
      <span className="staff-gestionale-locale-select-label">Locale personale</span>
      <select
        className="form-control staff-gestionale-locale-select-field"
        value={value}
        disabled={disabled || loading}
        onChange={(e) => onChange?.(e.target.value)}
        aria-label="Seleziona il locale personale"
      >
        <option value="">{loading ? 'Caricamento locali…' : 'Seleziona locale'}</option>
        {localeNames.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  )
}
