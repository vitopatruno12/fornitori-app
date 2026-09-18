import React from 'react'
import { formatStaffLocaleOptionLabel } from '../utils/staffLocaleCompanyLabels.js'

/**
 * Selettore locale Personale nel banner del gestionale (Report, Stipendi).
 * Mostra società · sede (es. Mediazione · Mani in Pasta Via Zanardelli 19).
 */
export default function StaffGestionaleLocaleSelect({
  localeNames = [],
  value = '',
  onChange,
  loading = false,
  disabled = false,
  className = '',
  label = 'Società / locale',
}) {
  return (
    <label className={`staff-gestionale-locale-select ${className}`.trim()}>
      <span className="staff-gestionale-locale-select-label">{label}</span>
      <select
        className="form-control staff-gestionale-locale-select-field"
        value={value}
        disabled={disabled || loading}
        onChange={(e) => onChange?.(e.target.value)}
        aria-label="Seleziona società o locale personale"
      >
        <option value="">{loading ? 'Caricamento locali…' : 'Seleziona società / locale'}</option>
        {localeNames.map((name) => (
          <option key={name} value={name}>
            {formatStaffLocaleOptionLabel(name)}
          </option>
        ))}
      </select>
    </label>
  )
}
