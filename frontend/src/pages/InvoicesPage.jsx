import React, { useEffect, useMemo, useState } from 'react'
import { fetchSuppliers } from '../services/suppliersService'
import { fetchInvoices, fetchInvoice, createInvoice, updateInvoice, deleteInvoice, getInvoicesExportUrl, getInvoicePdfUrl, markInvoicePaid, setInvoiceIgnored } from '../services/invoicesService'
import { fetchCashEntry } from '../services/cashService'
import { checkAiAnomalies, suggestInvoiceFields } from '../services/aiService'
import { FattureNavBaseContext, FatturePageShell, PaymentBadge, formatDate } from '../components/FattureShared.jsx'
import FattureScopeTools from '../components/FattureScopeTools.jsx'
import WorkbookGrid from '../components/WorkbookGrid.jsx'
import { AnalisiLoadingBar } from '../components/AnalisiShared.jsx'
import { useFattureCompany } from '../hooks/useFattureCompany.js'
import { isGestionaleFattureContext } from '../utils/fattureCompany.js'

function formatAmount(value) {
  if (value == null || value === '') return '–'
  return Number(value).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const REGISTRATE_COLUMNS = [
  { id: 'invoice_number', label: 'N. doc.', width: 110, sticky: 'left' },
  { id: 'invoice_date', label: 'Data doc.', width: 100 },
  { id: 'due_date', label: 'Scadenza', width: 100 },
  { id: 'supplier_name', label: 'Fornitore', width: 200 },
  { id: 'imponibile', label: 'Imponibile', width: 110, numeric: true },
  { id: 'vat_amount', label: 'IVA', width: 90, numeric: true },
  { id: 'total', label: 'Totale', width: 110, numeric: true, emphasis: true },
  { id: 'payment_status', label: 'Stato', width: 100 },
  { id: 'amount_paid', label: 'Pagato', width: 100, numeric: true },
]

function paymentStatusText(status, ignored) {
  if (ignored) return 'Ignorata'
  if (status === 'paid') return 'Pagata'
  if (status === 'partial') return 'Parziale'
  return 'Da pagare'
}

export default function InvoicesPage() {
  const fattureBase = React.useContext(FattureNavBaseContext)
  const gestionaleMode = isGestionaleFattureContext(fattureBase)
  const { companies, companyId, setCompanyId, loadingCompanies } = useFattureCompany(gestionaleMode)
  const [scopeMode, setScopeMode] = useState(() => {
    try {
      return sessionStorage.getItem('atlasFattureScopeMode:v1') || 'company'
    } catch {
      return 'company'
    }
  })
  const [localeId, setLocaleId] = useState(() => {
    try {
      return sessionStorage.getItem('atlasFattureLocale:v1') || ''
    } catch {
      return ''
    }
  })
  const [suppliers, setSuppliers] = useState([])
  const [invoices, setInvoices] = useState([])
  const [supplierId, setSupplierId] = useState('')
  const [dueFilter, setDueFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  function changeScopeMode(next) {
    setScopeMode(next)
    try {
      sessionStorage.setItem('atlasFattureScopeMode:v1', next)
    } catch {
      /* ignore */
    }
  }

  function changeLocaleId(next) {
    setLocaleId(next)
    try {
      sessionStorage.setItem('atlasFattureLocale:v1', next)
    } catch {
      /* ignore */
    }
  }

  const scopeReady = gestionaleMode
    ? scopeMode === 'company'
      ? Boolean(companyId)
      : Boolean(localeId)
    : true

  const [formSupplierId, setFormSupplierId] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [imponibile, setImponibile] = useState('')
  const [vatPercent, setVatPercent] = useState('23')
  const [amountPaid, setAmountPaid] = useState('0')
  const [cashEntryId, setCashEntryId] = useState('')
  const [note, setNote] = useState('')
  const [file, setFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [detailInv, setDetailInv] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [monthFilter, setMonthFilter] = useState('')
  const [showIgnored, setShowIgnored] = useState(false)
  const [pendingSupplierLabel, setPendingSupplierLabel] = useState('')
  const [dashboardFilterActive, setDashboardFilterActive] = useState(false)
  const [dashboardAppliedMonth, setDashboardAppliedMonth] = useState(false)
  const [dashboardAppliedSupplier, setDashboardAppliedSupplier] = useState(false)
  const [dashboardSupplierHit, setDashboardSupplierHit] = useState('')
  const [preDashboardFilters, setPreDashboardFilters] = useState(null)
  const [aiInvoiceText, setAiInvoiceText] = useState('')
  const [aiInvoiceWarnings, setAiInvoiceWarnings] = useState([])
  const [aiInvoiceAnomalies, setAiInvoiceAnomalies] = useState([])

  const availableMonths = useMemo(() => {
    const uniq = new Set()
    for (const inv of invoices) {
      const key = inv.invoice_date ? String(inv.invoice_date).slice(0, 7) : ''
      if (key) uniq.add(key)
    }
    return Array.from(uniq).sort().reverse()
  }, [invoices])

  const filteredInvoices = useMemo(() => {
    if (!monthFilter) return invoices
    return invoices.filter((inv) => (inv.invoice_date ? String(inv.invoice_date).slice(0, 7) : '') === monthFilter)
  }, [invoices, monthFilter])

  const kpi = useMemo(() => {
    let residuoTot = 0
    let scadute = 0
    let scaduteEuro = 0
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    for (const inv of filteredInvoices) {
      const res = Number(inv.total) - Number(inv.amount_paid || 0)
      if (inv.payment_status !== 'paid' && res > 0.009) residuoTot += res
      if (inv.payment_status !== 'paid' && inv.due_date) {
        const d = new Date(inv.due_date)
        d.setHours(0, 0, 0, 0)
        if (d < today && res > 0.009) {
          scadute += 1
          scaduteEuro += res
        }
      }
    }
    return { residuoTot, scadute, scaduteEuro, count: filteredInvoices.length }
  }, [filteredInvoices])

  useEffect(() => {
    loadSuppliers()
  }, [])

  useEffect(() => {
    const onApply = (ev) => {
      const s = ev?.detail || {}
      if (s.imponibile_hint != null) setImponibile(String(s.imponibile_hint))
      if (s.invoice_date_hint) setInvoiceDate(String(s.invoice_date_hint))
      if (s.due_date_hint) setDueDate(String(s.due_date_hint))
      if (s.category_hint) setNote((prev) => prev || `Categoria suggerita AI: ${s.category_hint}`)
    }
    window.addEventListener('ai-apply-invoice', onApply)
    return () => window.removeEventListener('ai-apply-invoice', onApply)
  }, [])

  useEffect(() => {
    const onAiFilter = (ev) => {
      const d = ev?.detail || {}
      if (typeof d.dueFilter === 'string') setDueFilter(d.dueFilter)
      if (typeof d.showIgnored === 'boolean') setShowIgnored(d.showIgnored)
      if (d.dueFilter || d.showIgnored) {
        setSuccess(typeof d.message === 'string' ? d.message : 'Filtro AI applicato')
      }
    }
    const onAiReset = () => {
      setSupplierId('')
      setDueFilter('')
      setMonthFilter('')
      setShowIgnored(false)
      setDashboardFilterActive(false)
      setDashboardAppliedMonth(false)
      setDashboardAppliedSupplier(false)
      setDashboardSupplierHit('')
      setSuccess('Filtri resettati da AI')
    }
    window.addEventListener('ai-invoices-filter', onAiFilter)
    window.addEventListener('ai-reset-filters', onAiReset)
    return () => {
      window.removeEventListener('ai-invoices-filter', onAiFilter)
      window.removeEventListener('ai-reset-filters', onAiReset)
    }
  }, [])

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('dashboardInvoicesFilter')
      if (!raw) return
      const f = JSON.parse(raw)
      setPreDashboardFilters({ monthFilter, supplierId })
      if (f?.monthKey) setMonthFilter(String(f.monthKey))
      if (f?.supplierLabel) setPendingSupplierLabel(String(f.supplierLabel))
      setDashboardAppliedMonth(Boolean(f?.monthKey))
      setDashboardAppliedSupplier(Boolean(f?.supplierLabel))
      setDashboardFilterActive(Boolean(f?.monthKey || f?.supplierLabel))
      sessionStorage.removeItem('dashboardInvoicesFilter')
      setSuccess('Filtro dashboard applicato')
    } catch {
      sessionStorage.removeItem('dashboardInvoicesFilter')
    }
  }, [])

  useEffect(() => {
    loadInvoices()
  }, [supplierId, dueFilter, showIgnored, gestionaleMode, scopeMode, companyId, localeId, scopeReady])

  useEffect(() => {
    if (!pendingSupplierLabel || suppliers.length === 0 || supplierId) return
    const q = pendingSupplierLabel.trim().toLowerCase()
    const hit = suppliers.find((s) => (s.name || '').trim().toLowerCase() === q)
      || suppliers.find((s) => (s.name || '').trim().toLowerCase().includes(q))
    if (hit) {
      setSupplierId(String(hit.id))
      setDashboardSupplierHit(hit.name || '')
    } else {
      setDashboardAppliedSupplier(false)
      setDashboardSupplierHit('')
    }
    setPendingSupplierLabel('')
  }, [pendingSupplierLabel, suppliers, supplierId])

  function resetDashboardFilters() {
    if (!dashboardFilterActive) return
    if (preDashboardFilters) {
      setMonthFilter(preDashboardFilters.monthFilter || '')
      setSupplierId(preDashboardFilters.supplierId || '')
    } else {
      if (dashboardAppliedMonth) setMonthFilter('')
      if (dashboardAppliedSupplier) setSupplierId('')
    }
    setDashboardFilterActive(false)
    setDashboardAppliedMonth(false)
    setDashboardAppliedSupplier(false)
    setDashboardSupplierHit('')
    setSuccess('Filtri dashboard rimossi')
  }

  async function loadSuppliers() {
    try {
      const data = await fetchSuppliers()
      setSuppliers(Array.isArray(data) ? data : [])
    } catch {
      // noop
    }
  }

  async function loadInvoices() {
    try {
      if (gestionaleMode && !scopeReady) {
        setInvoices([])
        setLoading(false)
        return
      }
      setLoading(true)
      setError('')
      const params = {
        supplier_id: supplierId || undefined,
        due_filter: dueFilter || undefined,
        include_ignored: showIgnored || undefined,
      }
      if (gestionaleMode) {
        if (scopeMode === 'company' && companyId) params.company = companyId
        if (scopeMode === 'locale' && localeId) params.activity = localeId
      }
      const data = await fetchInvoices(params)
      setInvoices(data)
    } catch (e) {
      setError('Errore nel caricamento delle fatture')
    } finally {
      setLoading(false)
    }
  }

  async function openInvoiceDetail(inv) {
    setDetailInv({ ...inv, rows: inv.rows || [] })
    setDetailLoading(true)
    try {
      const full = await fetchInvoice(inv.id)
      setDetailInv({
        ...inv,
        ...full,
        supplier_name: full.supplier_name || inv.supplier_name,
        payment_status: full.payment_status || inv.payment_status,
        rows: Array.isArray(full.rows) ? full.rows : [],
      })
    } catch (e) {
      setError(e?.message || 'Errore caricamento dettaglio fattura')
    } finally {
      setDetailLoading(false)
    }
  }

  function handleFilterSubmit(e) {
    e.preventDefault()
    loadInvoices()
  }

  function appendInvoiceFormData(formData) {
    formData.append('due_date', dueDate ? `${dueDate}T00:00:00` : '')
    formData.append('amount_paid', amountPaid === '' ? '0' : String(amountPaid))
    if (cashEntryId.trim()) formData.append('cash_entry_id', cashEntryId.trim())
    else formData.append('cash_entry_id', '')
  }

  async function handleCreateInvoice(e) {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!formSupplierId) {
      setError('Seleziona un fornitore')
      return
    }
    if (!invoiceNumber.trim()) {
      setError('Inserisci il numero documento')
      return
    }
    if (!invoiceDate) {
      setError('Inserisci la data documento')
      return
    }
    if (!imponibile) {
      setError('Inserisci l\'imponibile')
      return
    }

    try {
      setSaving(true)
      const formData = new FormData()
      formData.append('supplier_id', formSupplierId)
      formData.append('invoice_number', invoiceNumber)
      formData.append('invoice_date', `${invoiceDate}T00:00:00`)
      formData.append('imponibile', imponibile)
      formData.append('vat_percent', vatPercent || '23')
      if (note) formData.append('note', note)
      appendInvoiceFormData(formData)
      if (file) formData.append('file', file)

      if (editingId) {
        await updateInvoice(editingId, formData)
        setSuccess('Fattura aggiornata correttamente')
        setEditingId(null)
      } else {
        await createInvoice(formData)
        setSuccess('Fattura salvata correttamente')
      }
      resetForm()
      await loadInvoices()
    } catch (err) {
      setError(editingId ? 'Errore nell\'aggiornamento fattura' : 'Errore nel salvataggio fattura')
    } finally {
      setSaving(false)
    }
  }

  function resetForm() {
    setFormSupplierId('')
    setInvoiceNumber('')
    setInvoiceDate('')
    setDueDate('')
    setImponibile('')
    setVatPercent('23')
    setAmountPaid('0')
    setCashEntryId('')
    setNote('')
    setFile(null)
  }

  function handleEdit(inv) {
    setEditingId(inv.id)
    setFormSupplierId(String(inv.supplier_id))
    setInvoiceNumber(inv.invoice_number || '')
    setInvoiceDate(inv.invoice_date ? inv.invoice_date.slice(0, 10) : '')
    setDueDate(inv.due_date ? inv.due_date.slice(0, 10) : '')
    setImponibile(String(inv.imponibile ?? ''))
    setVatPercent(String(inv.vat_percent ?? '23'))
    setAmountPaid(inv.amount_paid != null ? String(inv.amount_paid) : '0')
    setCashEntryId(inv.cash_entry_id != null ? String(inv.cash_entry_id) : '')
    setNote(inv.note || '')
    setFile(null)
    setError('')
  }

  function handleCancelEdit() {
    setEditingId(null)
    resetForm()
    setError('')
  }

  async function handleDelete(inv) {
    if (!window.confirm(`Eliminare la fattura n. ${inv.invoice_number}?`)) return
    try {
      await deleteInvoice(inv.id)
      await loadInvoices()
      if (editingId === inv.id) handleCancelEdit()
    } catch (err) {
      setError('Errore nell\'eliminazione fattura')
    }
  }

  async function handleMarkPaid(inv) {
    try {
      await markInvoicePaid(inv.id)
      setSuccess(`Fattura ${inv.invoice_number} segnata come pagata`)
      await loadInvoices()
    } catch {
      setError('Errore nel saldo fattura')
    }
  }

  async function handleToggleIgnore(inv) {
    try {
      await setInvoiceIgnored(inv.id, !inv.ignored)
      setSuccess(inv.ignored ? 'Fattura ripristinata nello scadenziario' : 'Fattura ignorata nello scadenziario')
      await loadInvoices()
    } catch {
      setError('Errore aggiornamento scadenziario')
    }
  }

  async function handleAiSuggestInvoice() {
    if (!aiInvoiceText.trim()) return
    try {
      const res = await suggestInvoiceFields(aiInvoiceText, {
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        due_date: dueDate,
      })
      const s = res?.suggested_fields || {}
      if (s.imponibile_hint != null && !imponibile) setImponibile(String(s.imponibile_hint))
      if (s.invoice_date_hint && !invoiceDate) setInvoiceDate(String(s.invoice_date_hint))
      if (s.due_date_hint && !dueDate) setDueDate(String(s.due_date_hint))
      if (s.category_hint && !note) setNote(`Categoria suggerita AI: ${s.category_hint}`)
      setAiInvoiceWarnings(res?.warnings || [])
      setSuccess('Bozza fattura suggerita con AI')
    } catch {
      setError('Assistente AI non disponibile')
    }
  }

  async function handleAiCheckInvoice() {
    try {
      const vatAmount = (Number(imponibile || 0) * Number(vatPercent || 0)) / 100
      const total = Number(imponibile || 0) + vatAmount
      const res = await checkAiAnomalies('invoice', {
        imponibile: Number(imponibile || 0),
        vat_amount: vatAmount,
        total,
        due_date: dueDate || null,
      })
      setAiInvoiceAnomalies(res?.anomalies || [])
    } catch {
      setError('Controllo anomalie non disponibile')
    }
  }

  async function openPrimaNota(inv) {
    let dateStr = inv.invoice_date ? inv.invoice_date.slice(0, 10) : ''
    if (inv.cash_entry_id) {
      try {
        const entry = await fetchCashEntry(inv.cash_entry_id)
        if (entry?.entry_date) {
          dateStr = entry.entry_date.slice(0, 10)
        }
      } catch {
        // movimento non trovato: resta la data documento
      }
    }
    sessionStorage.setItem('primaNotaFocus', JSON.stringify({
      date: dateStr,
      supplierId: inv.supplier_id,
      cashEntryId: inv.cash_entry_id || null,
      invoiceId: inv.id || null,
      invoiceNumber: inv.invoice_number || '',
      supplierName: inv.supplier_name || '',
      description: `Pagamento fattura ${inv.invoice_number || ''}${inv.supplier_name ? ` · ${inv.supplier_name}` : ''}`.trim(),
    }))
    window.dispatchEvent(new Event('open-prima-nota'))
  }

  return (
    <FatturePageShell
      title="Registrate"
      lead="Elenco fatture in archivio Atlas: filtra per società o locale dal banner, poi scadenza e stato."
      actions={
        gestionaleMode ? (
          <FattureScopeTools
            mode={scopeMode}
            onModeChange={changeScopeMode}
            companies={[...companies, { id: 'non_classificata', label: 'Non classificate' }]}
            companyId={companyId}
            onCompanyChange={setCompanyId}
            localeId={localeId}
            onLocaleChange={changeLocaleId}
            loading={loadingCompanies}
          />
        ) : null
      }
    >
      {gestionaleMode && !scopeReady ? (
        <div className="alert alert-info">
          Scegli <strong>Società</strong> o <strong>Locale</strong> nel banner verde per vedere le fatture
          registrate.
        </div>
      ) : null}
      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="ui-kpi-row">
        <div className="ui-kpi-card">
          <div className="ui-kpi-card-label">Documenti in elenco</div>
          <div className="ui-kpi-card-value">{kpi.count}</div>
        </div>
        <div className="ui-kpi-card">
          <div className="ui-kpi-card-label">Residuo da pagare</div>
          <div className="ui-kpi-card-value" style={{ color: 'var(--warning)' }}>€ {formatAmount(kpi.residuoTot)}</div>
        </div>
        <div className="ui-kpi-card">
          <div className="ui-kpi-card-label">Fatture scadute</div>
          <div className="ui-kpi-card-value" style={{ color: kpi.scadute ? 'var(--danger)' : undefined }}>{kpi.scadute}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>€ {formatAmount(kpi.scaduteEuro)}</div>
        </div>
      </div>

      <section className="card">
        <h2 className="page-subheader" style={{ marginTop: 0 }}>{editingId ? 'Modifica fattura' : 'Nuova fattura'}</h2>
        <div className="form-group" style={{ marginBottom: '0.9rem' }}>
          <label>Comando AI fattura</label>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input
              className="form-control"
              value={aiInvoiceText}
              onChange={(e) => setAiInvoiceText(e.target.value)}
              placeholder='Es. "Fattura bevande del 5/4/2026 totale 320 euro bonifico"'
              style={{ flex: '1 1 420px' }}
            />
            <button type="button" className="btn btn-primary" onClick={handleAiSuggestInvoice}>Suggerisci</button>
            <button type="button" className="btn btn-secondary" onClick={handleAiCheckInvoice}>Controlla anomalie</button>
          </div>
          {(aiInvoiceWarnings.length > 0 || aiInvoiceAnomalies.length > 0) && (
            <div className="alert alert-info" style={{ marginTop: '0.55rem', marginBottom: 0 }}>
              {aiInvoiceWarnings.length > 0 && <div><strong>Avvisi AI:</strong> {aiInvoiceWarnings.join(' · ')}</div>}
              {aiInvoiceAnomalies.length > 0 && <div><strong>Anomalie:</strong> {aiInvoiceAnomalies.join(' · ')}</div>}
            </div>
          )}
        </div>
        <form onSubmit={handleCreateInvoice}>
          <div className="form-row">
            <div className="form-group">
              <label>Fornitore</label>
              <select className="form-control" value={formSupplierId} onChange={e => setFormSupplierId(e.target.value)}>
                <option value="">Seleziona...</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Numero documento</label>
              <input className="form-control" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="N. fattura / nota" />
            </div>
            <div className="form-group">
              <label>Data documento</label>
              <input type="date" className="form-control" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Data scadenza</label>
              <input type="date" className="form-control" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Imponibile (€)</label>
              <input type="number" step="0.01" className="form-control" value={imponibile} onChange={e => setImponibile(e.target.value)} />
            </div>
            <div className="form-group">
              <label>IVA %</label>
              <input type="number" step="0.1" className="form-control" value={vatPercent} onChange={e => setVatPercent(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Importo già pagato (€)</label>
              <input type="number" step="0.01" className="form-control" value={amountPaid} onChange={e => setAmountPaid(e.target.value)} placeholder="0 = da pagare tutto" />
            </div>
            <div className="form-group">
              <label>ID movimento Prima Nota (opzionale)</label>
              <input className="form-control" value={cashEntryId} onChange={e => setCashEntryId(e.target.value)} placeholder="Collega a riga cassa" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group" style={{ flex: '1 1 280px' }}>
              <label>File PDF / allegato</label>
              <input type="file" accept=".pdf,image/*" className="form-control" onChange={e => setFile(e.target.files?.[0] || null)} />
            </div>
          </div>
          <div className="form-group">
            <label>Note</label>
            <textarea className="form-control" value={note} onChange={e => setNote(e.target.value)} rows={2} />
          </div>
          <div className="btn-group">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Salvataggio...' : editingId ? 'Salva modifiche' : 'Salva fattura'}
            </button>
            {editingId && (
              <button type="button" className="btn btn-secondary" onClick={handleCancelEdit}>Annulla</button>
            )}
          </div>
        </form>
      </section>

      <section className="card">
        <h2 className="page-subheader" style={{ marginTop: 0 }}>Storico fatture</h2>
        <form onSubmit={handleFilterSubmit} className="ui-toolbar-one">
          <div className="form-group">
            <label>Fornitore</label>
            <select className="form-control" value={supplierId} onChange={e => setSupplierId(e.target.value)} style={{ minWidth: 180 }}>
              <option value="">Tutti</option>
              {suppliers.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Scadenze</label>
            <select className="form-control" value={dueFilter} onChange={e => setDueFilter(e.target.value)} style={{ minWidth: 200 }}>
              <option value="">Tutte</option>
              <option value="overdue">Scadute (non saldate)</option>
              <option value="due_soon">In scadenza (7 giorni)</option>
            </select>
          </div>
          <div className="form-group">
            <label>Mese documento</label>
            <select className="form-control" value={monthFilter} onChange={e => setMonthFilter(e.target.value)} style={{ minWidth: 150 }}>
              <option value="">Tutti</option>
              {availableMonths.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Ignorate</label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.45rem' }}>
              <input type="checkbox" checked={showIgnored} onChange={e => setShowIgnored(e.target.checked)} />
              Mostra ignorate
            </label>
          </div>
          <button type="submit" className="btn btn-primary">Aggiorna</button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => window.open(getInvoicesExportUrl(supplierId || undefined), '_blank')}
          >
            CSV
          </button>
          {dashboardFilterActive && (
            <div className="ui-filter-pill">
              <span>
                Dashboard
                {dashboardAppliedMonth ? ` · ${monthFilter || 'mese'}` : ''}
                {dashboardAppliedSupplier && dashboardSupplierHit ? ` · ${dashboardSupplierHit}` : ''}
              </span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={resetDashboardFilters}>Reset</button>
            </div>
          )}
        </form>

        {loading && <AnalisiLoadingBar active label="Caricamento fatture" variant="subtle" />}

        {!loading && !error && (
          <WorkbookGrid
            title="Storico fatture"
            sheetLabel={`${filteredInvoices.length} documenti`}
            hideToolbar
            gridClassName="fatture-excel-grid"
            columns={REGISTRATE_COLUMNS}
            rows={filteredInvoices}
            rowKey={(row) => row.id}
            cellValue={(row, col) => {
              if (col.id === 'invoice_date' || col.id === 'due_date') return formatDate(row[col.id])
              if (col.id === 'supplier_name') return row.supplier_name || row.supplier_id || '—'
              if (col.id === 'imponibile' || col.id === 'vat_amount' || col.id === 'total' || col.id === 'amount_paid') {
                return formatAmount(row[col.id])
              }
              if (col.id === 'payment_status') return paymentStatusText(row.payment_status, row.ignored)
              return row[col.id] || '—'
            }}
            totals={
              filteredInvoices.length
                ? {
                    count: filteredInvoices.length,
                    imponibile: filteredInvoices.reduce((a, r) => a + (Number(r.imponibile) || 0), 0),
                    vat_amount: filteredInvoices.reduce((a, r) => a + (Number(r.vat_amount) || 0), 0),
                    total: filteredInvoices.reduce((a, r) => a + (Number(r.total) || 0), 0),
                    amount_paid: filteredInvoices.reduce((a, r) => a + (Number(r.amount_paid) || 0), 0),
                  }
                : null
            }
            totalsLabel={(colId, totals) => {
              if (colId === 'invoice_number') return 'Totali'
              if (colId === 'supplier_name') return `${totals.count} doc.`
              if (colId === 'imponibile') return formatAmount(totals.imponibile)
              if (colId === 'vat_amount') return formatAmount(totals.vat_amount)
              if (colId === 'total') return formatAmount(totals.total)
              if (colId === 'amount_paid') return formatAmount(totals.amount_paid)
              return ''
            }}
            emptyMessage={
              invoices.length === 0 ? 'Nessuna fattura registrata.' : 'Nessuna fattura per i filtri selezionati.'
            }
            onRowClick={(inv) => openInvoiceDetail(inv)}
            actionsHeader="Azioni"
            renderActions={(inv) => (
              <div className="fatture-excel-actions" onClick={(e) => e.stopPropagation()}>
                {inv.file_path ? (
                  <a
                    href={getInvoicePdfUrl(inv.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-primary btn-sm"
                    title="Apri PDF"
                  >
                    PDF
                  </a>
                ) : null}
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => openPrimaNota(inv)}>
                  Cassa
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => handleMarkPaid(inv)}
                  disabled={inv.payment_status === 'paid'}
                >
                  Pagata
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleToggleIgnore(inv)}>
                  {inv.ignored ? 'Ripristina' : 'Ignora'}
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleEdit(inv)}>
                  Modifica
                </button>
                <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => handleDelete(inv)}>
                  Elimina
                </button>
              </div>
            )}
          />
        )}
      </section>

      {detailInv && (
        <>
          <div className="ui-drawer-backdrop" onClick={() => setDetailInv(null)} aria-hidden />
          <aside className="ui-drawer" role="dialog" aria-label="Dettaglio fattura">
            <div className="ui-drawer-header">
              <div>
                <h2 className="ui-drawer-title">Fattura {detailInv.invoice_number}</h2>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{detailInv.supplier_name}</div>
              </div>
              <button type="button" className="ui-drawer-close" onClick={() => setDetailInv(null)} aria-label="Chiudi">×</button>
            </div>
            <div className="ui-drawer-body">
              {detailLoading ? <AnalisiLoadingBar active label="Caricamento dettaglio" variant="subtle" /> : null}
              <p style={{ marginTop: 0 }}><PaymentBadge status={detailInv.payment_status} ignored={detailInv.ignored} /></p>
              <p><strong>Data documento:</strong> {formatDate(detailInv.invoice_date)}</p>
              <p><strong>Scadenza:</strong> {formatDate(detailInv.due_date)}</p>
              <p><strong>Imponibile:</strong> € {formatAmount(detailInv.imponibile)}</p>
              <p><strong>IVA:</strong> € {formatAmount(detailInv.vat_amount)} ({detailInv.vat_percent}%)</p>
              <p><strong>Totale:</strong> € {formatAmount(detailInv.total)}</p>
              <p><strong>Già pagato:</strong> € {formatAmount(detailInv.amount_paid)}</p>
              <p><strong>Residuo:</strong> € {formatAmount(Number(detailInv.total) - Number(detailInv.amount_paid || 0))}</p>
              {detailInv.note && <p><strong>Note:</strong> {detailInv.note}</p>}

              <hr style={{ margin: '1rem 0', border: 0, borderTop: '1px solid var(--border, #ddd)' }} />
              <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>Righe</h3>
              <div className="table-wrap">
                <table className="app-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Descrizione</th>
                      <th className="text-end">Q.tà</th>
                      <th className="text-end">Imponibile</th>
                      <th className="text-end">IVA %</th>
                      <th className="text-end">Totale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detailInv.rows || []).map((ln) => (
                      <tr key={ln.line_no}>
                        <td>{ln.line_no}</td>
                        <td>{ln.description || '—'}</td>
                        <td className="text-end">{ln.quantity != null ? Number(ln.quantity).toLocaleString('it-IT') : '—'}</td>
                        <td className="text-end">€ {formatAmount(ln.imponibile)}</td>
                        <td className="text-end">{ln.vat_percent != null ? `${ln.vat_percent}%` : '—'}</td>
                        <td className="text-end">€ {formatAmount(ln.total_line)}</td>
                      </tr>
                    ))}
                    {!detailLoading && !(detailInv.rows || []).length ? (
                      <tr>
                        <td colSpan={6} className="empty-state">Nessuna riga</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className="btn-group" style={{ marginTop: '1rem' }}>
                <button type="button" className="btn btn-primary" onClick={() => { handleEdit(detailInv); setDetailInv(null) }}>Modifica</button>
                <button type="button" className="btn btn-secondary" onClick={() => openPrimaNota(detailInv)}>Apri Prima Nota</button>
                <button type="button" className="btn btn-secondary" onClick={() => handleToggleIgnore(detailInv)}>
                  {detailInv.ignored ? 'Ripristina' : 'Ignora'}
                </button>
              </div>
            </div>
          </aside>
        </>
      )}
    </FatturePageShell>
  )
}
