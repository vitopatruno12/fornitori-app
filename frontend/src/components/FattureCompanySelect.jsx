import React from 'react'
import { companyLabel } from '../utils/fattureCompany.js'

/**
 * Selettore società nel banner verde Amministrazione → Fatture ricevute.
 */
export default function FattureCompanySelect({
  companies = [],
  value = '',
  onChange,
  loading = false,
  disabled = false,
  className = '',
}) {
  return (
    <label className={`staff-gestionale-locale-select fatture-company-select ${className}`.trim()}>
      <span className="staff-gestionale-locale-select-label">Società</span>
      <select
        className="form-control staff-gestionale-locale-select-field"
        value={value}
        disabled={disabled || loading}
        onChange={(e) => onChange?.(e.target.value)}
        aria-label="Seleziona la società destinatario"
      >
        <option value="">{loading ? 'Caricamento…' : 'Seleziona società'}</option>
        {companies.map((row) => (
          <option key={row.id} value={row.id}>
            {row.label || companyLabel(row.id)}
          </option>
        ))}
      </select>
    </label>
  )
}
