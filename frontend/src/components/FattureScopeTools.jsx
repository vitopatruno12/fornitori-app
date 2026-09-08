import React from 'react'
import FattureCompanySelect from './FattureCompanySelect.jsx'
import { ACTIVITY_LABELS } from '../utils/fattureCompany.js'

const LOCALE_OPTIONS = Object.entries(ACTIVITY_LABELS).map(([id, label]) => ({ id, label }))

/**
 * Banner verde fatture: scegli se filtrare per Società o per Locale.
 */
export default function FattureScopeTools({
  mode = 'company',
  onModeChange,
  companies = [],
  companyId = '',
  onCompanyChange,
  localeId = '',
  onLocaleChange,
  loading = false,
  className = '',
  ariaLabel = 'Filtro società o locale',
}) {
  return (
    <aside className={`mastrini-hero-tools fatture-hero-tools ${className}`.trim()} aria-label={ariaLabel}>
      <div className="mastrini-hero-tools-btns fatture-scope-mode-btns">
        <button
          type="button"
          className={mode === 'company' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
          onClick={() => onModeChange?.('company')}
        >
          Società
        </button>
        <button
          type="button"
          className={mode === 'locale' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
          onClick={() => onModeChange?.('locale')}
        >
          Locale
        </button>
      </div>
      {mode === 'company' ? (
        <FattureCompanySelect
          className="mastrini-hero-tools-company"
          companies={companies}
          value={companyId}
          onChange={onCompanyChange}
          loading={loading}
        />
      ) : (
        <label className="staff-gestionale-locale-select fatture-company-select mastrini-hero-tools-company">
          <span className="staff-gestionale-locale-select-label">Locale</span>
          <select
            className="form-control staff-gestionale-locale-select-field"
            value={localeId}
            disabled={loading}
            onChange={(e) => onLocaleChange?.(e.target.value)}
            aria-label="Seleziona il locale"
          >
            <option value="">{loading ? 'Caricamento…' : 'Seleziona locale'}</option>
            {LOCALE_OPTIONS.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </aside>
  )
}

export function localeLabel(localeId) {
  return ACTIVITY_LABELS[localeId] || localeId || '—'
}

export { LOCALE_OPTIONS }
