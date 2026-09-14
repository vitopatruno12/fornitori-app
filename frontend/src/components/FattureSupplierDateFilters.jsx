import React, { useMemo } from 'react'

/** Normalizza data fattura a YYYY-MM-DD. */
export function invoiceDateKey(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  return raw.slice(0, 10)
}

/**
 * Filtra fatture per fornitore (id o nome) e intervallo date documento.
 * @param {Array} rows
 * @param {{ supplierId?: string, supplierName?: string, dateFrom?: string, dateTo?: string }} filters
 */
export function filterInvoicesBySupplierAndDate(rows, filters = {}) {
  const list = Array.isArray(rows) ? rows : []
  const supplierId = String(filters.supplierId || '').trim()
  const supplierName = String(filters.supplierName || '').trim().toLowerCase()
  const dateFrom = invoiceDateKey(filters.dateFrom)
  const dateTo = invoiceDateKey(filters.dateTo)

  return list.filter((row) => {
    if (supplierId) {
      if (String(row?.supplier_id ?? '') !== supplierId) return false
    } else if (supplierName) {
      const name = String(row?.supplier_name || '').trim().toLowerCase()
      if (name !== supplierName) return false
    }
    const d = invoiceDateKey(row?.invoice_date)
    if (dateFrom && (!d || d < dateFrom)) return false
    if (dateTo && (!d || d > dateTo)) return false
    return true
  })
}

/** Opzioni fornitore da elenco fatture (id+name o solo name). */
export function supplierOptionsFromInvoices(rows) {
  const map = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = row?.supplier_id != null && row.supplier_id !== '' ? String(row.supplier_id) : ''
    const name = String(row?.supplier_name || '').trim() || 'Senza fornitore'
    const key = id || `name:${name.toLowerCase()}`
    if (!map.has(key)) {
      map.set(key, { key, supplier_id: id, supplier_name: name })
    }
  }
  return Array.from(map.values()).sort((a, b) => a.supplier_name.localeCompare(b.supplier_name, 'it'))
}

/**
 * Barra filtri Fornitore + Da/A data.
 * mode:
 * - 'id' → value = supplier_id (string)
 * - 'name' → value = supplier_name (string)
 */
export default function FattureSupplierDateFilters({
  supplierMode = 'id',
  supplierOptions = [],
  supplierValue = '',
  onSupplierChange,
  dateFrom = '',
  dateTo = '',
  onDateFromChange,
  onDateToChange,
  onReset,
  children = null,
}) {
  const options = useMemo(() => {
    const list = Array.isArray(supplierOptions) ? supplierOptions : []
    return list.map((opt) => {
      if (typeof opt === 'string') {
        return { value: opt, label: opt }
      }
      if (supplierMode === 'name') {
        return {
          value: opt.supplier_name || opt.name || opt.value || '',
          label: opt.supplier_name || opt.name || opt.label || '—',
        }
      }
      return {
        value: String(opt.supplier_id ?? opt.id ?? opt.value ?? ''),
        label: opt.supplier_name || opt.name || opt.label || '—',
      }
    }).filter((o) => o.value !== '')
  }, [supplierOptions, supplierMode])

  return (
    <div className="ui-toolbar-one" style={{ marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.65rem' }}>
      <div className="form-group">
        <label>Fornitore</label>
        <select
          className="form-control"
          value={supplierValue}
          onChange={(e) => onSupplierChange?.(e.target.value)}
          style={{ minWidth: 200 }}
        >
          <option value="">Tutti</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label>Data da</label>
        <input
          type="date"
          className="form-control"
          value={dateFrom || ''}
          onChange={(e) => onDateFromChange?.(e.target.value)}
        />
      </div>
      <div className="form-group">
        <label>Data a</label>
        <input
          type="date"
          className="form-control"
          value={dateTo || ''}
          onChange={(e) => onDateToChange?.(e.target.value)}
        />
      </div>
      {typeof onReset === 'function' ? (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onReset} style={{ alignSelf: 'flex-end' }}>
          Reset filtri
        </button>
      ) : null}
      {children}
    </div>
  )
}
