import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { fetchSuppliers } from '../services/suppliersService'
import { fetchInvoices, fetchInvoice, fetchInvoiceByNumber, createInvoice, updateInvoice, deleteInvoice, getInvoicesExportUrl, getInvoicePdfUrl, markInvoicePaid, setInvoiceIgnored } from '../services/invoicesService'
import { fetchCashEntry } from '../services/cashService'
import { checkAiAnomalies, suggestInvoiceFields } from '../services/aiService'
import { FattureLink, FattureNavBaseContext, FatturePageShell, formatDate } from '../components/FattureShared.jsx'
import FattureScopeTools from '../components/FattureScopeTools.jsx'
import VneWorkbookGrid from '../components/VneWorkbookGrid.jsx'
import { filterInvoicesBySupplierAndDate } from '../components/FattureSupplierDateFilters.jsx'
import FattureActionsMenu from '../components/FattureActionsMenu.jsx'
import { AnalisiLoadingBar } from '../components/AnalisiShared.jsx'
import { useFattureCompany } from '../hooks/useFattureCompany.js'
import { activitiesForCompany, isGestionaleFattureContext } from '../utils/fattureCompany.js'
import { invoiceNumbersMatch } from '../utils/pagamentiWorkbook.js'

/** Registro Prima Nota corretto per la fattura (società / attività / testo righe). */
function resolvePrimaNotaActivityFromInvoice(inv) {
  const direct = String(inv?.activity || '').trim().toLowerCase()
  if (direct && direct !== 'mediazione') return direct

  const company = String(inv?.company || '').trim().toLowerCase()
  const fromCompany = activitiesForCompany(company)
  if (fromCompany.length) return fromCompany[0]

  const blob = [
    inv?.note,
    inv?.supplier_name,
    ...(Array.isArray(inv?.rows)
      ? inv.rows.map((r) => r?.description || r?.product_description || r?.name || r?.denominazione || '')
      : []),
  ]
    .join(' ')
    .toLowerCase()
  if (/via\s*lattea|mucche\s*volanti/.test(blob)) return 'via_lattea'
  if (/risacca|bar\s*momento/.test(blob)) return 'risacca'
  if (/zanardelli/.test(blob)) return 'via_zanardelli'
  if (/\babba\b|mani\s*in\s*pasta/.test(blob)) return 'via_abba'
  if (/gazza\s*ladra|\bpg\b/.test(blob)) return 'pg'
  return ''
}

function formatAmount(value) {
  if (value == null || value === '') return '–'
  return Number(value).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function findInvoiceByNumber(list, qNum) {
  const needle = String(qNum || '').trim()
  if (!needle || !Array.isArray(list)) return null
  const low = needle.toLowerCase()
  const exact = list.find((inv) => String(inv?.invoice_number || '').trim().toLowerCase() === low)
  if (exact) return exact
  return list.find((inv) => invoiceNumbersMatch(inv?.invoice_number, needle)) || null
}

const REGISTRATE_COLUMNS = [
  { id: 'invoice_number', label: 'N. doc.', width: 9, fluid: true },
  { id: 'invoice_date', label: 'Data doc.', width: 9, fluid: true },
  { id: 'due_date', label: 'Scadenza', width: 9, fluid: true },
  { id: 'supplier_name', label: 'Fornitore', width: 20, fluid: true },
  { id: 'imponibile', label: 'Imponibile', width: 10, fluid: true, numeric: true },
  { id: 'vat_amount', label: 'IVA', width: 8, fluid: true, numeric: true },
  { id: 'total', label: 'Totale', width: 10, fluid: true, numeric: true, emphasis: true },
  { id: 'payment_status', label: 'Stato', width: 9, fluid: true },
  { id: 'amount_paid', label: 'Pagato', width: 8, fluid: true, numeric: true },
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
  const [searchParams, setSearchParams] = useSearchParams()
  const focusHandledRef = useRef('')
  const urlFilterAppliedRef = useRef('')
  const [focusInvoiceId, setFocusInvoiceId] = useState('')
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
  const [monthFilter, setMonthFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
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

  const urlFocusId = String(searchParams.get('id') || '').trim()
  const activeFocusId = String(focusInvoiceId || urlFocusId || '').trim()

  const filteredInvoices = useMemo(() => {
    let rows = invoices
    if (monthFilter) {
      rows = rows.filter((inv) => (inv.invoice_date ? String(inv.invoice_date).slice(0, 7) : '') === monthFilter)
    }
    rows = filterInvoicesBySupplierAndDate(rows, {
      dateFrom,
      dateTo,
    })
    if (!activeFocusId) return rows
    const focused = invoices.find((inv) => String(inv.id) === activeFocusId)
    if (!focused || rows.some((inv) => String(inv.id) === activeFocusId)) return rows
    const origIdx = invoices.findIndex((inv) => String(inv.id) === activeFocusId)
    const insertAt = rows.findIndex((inv) => invoices.findIndex((x) => String(x.id) === String(inv.id)) > origIdx)
    if (insertAt < 0) return [...rows, focused]
    return [...rows.slice(0, insertAt), focused, ...rows.slice(insertAt)]
  }, [invoices, monthFilter, dateFrom, dateTo, activeFocusId])

  // Da movimenti banca: vai all’elenco storico (non restare sui box Nuova fattura) e tieni la riga evidenziata.
  const scrolledFocusRef = useRef('')
  useEffect(() => {
    if (loading) {
      if (activeFocusId) scrolledFocusRef.current = ''
      return
    }
    if (!activeFocusId) return
    if (!filteredInvoices.some((inv) => String(inv.id) === activeFocusId)) return
    if (scrolledFocusRef.current === activeFocusId) return
    scrolledFocusRef.current = activeFocusId

    let cancelled = false
    let attempts = 0
    const maxAttempts = 8

    const scrollToFocusedInvoice = () => {
      if (cancelled) return
      const listEl = document.getElementById('fatture-storico-elenco')
      const rowEl = document.getElementById(`invoice-row-${activeFocusId}`)
      if (!rowEl) {
        attempts += 1
        if (attempts < maxAttempts) window.setTimeout(scrollToFocusedInvoice, 120)
        return
      }
      // Prima porta in vista la sezione elenco (sotto i box di inserimento), poi la riga.
      listEl?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      window.setTimeout(() => {
        if (cancelled) return
        rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 220)
    }

    const t = window.setTimeout(scrollToFocusedInvoice, 80)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [loading, activeFocusId, filteredInvoices])

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
    const qId = String(searchParams.get('id') || '').trim()
    const qNum = String(searchParams.get('n') || '').trim()
    const qCompany = String(searchParams.get('company') || '').trim()
    const qSupplier = String(searchParams.get('supplier_id') || '').trim()
    const qSupplierName = String(searchParams.get('supplier') || '').trim()

    // Deep-link solo filtro fornitore (es. Da registrare → Apri storico della riga)
    if (!qId && !qNum) {
      if (!qCompany && !qSupplier && !qSupplierName) return

      const filterKey = `c:${qCompany}|s:${qSupplier}|n:${qSupplierName}`
      if (urlFilterAppliedRef.current === filterKey) return

      if (qCompany && gestionaleMode) {
        changeScopeMode('company')
        if (companyId !== qCompany) setCompanyId(qCompany)
      }
      if (qSupplier) {
        if (supplierId !== qSupplier) setSupplierId(qSupplier)
      } else if (qSupplierName) {
        setPendingSupplierLabel(qSupplierName)
      }

      // Rimuovi company/supplier dall'URL: altrimenti restano "appiccicati" e bloccano il cambio società.
      urlFilterAppliedRef.current = filterKey
      const cleaned = new URLSearchParams(searchParams)
      cleaned.delete('company')
      cleaned.delete('supplier_id')
      cleaned.delete('supplier')
      setSearchParams(cleaned, { replace: true })
      return
    }

    const targetKey = qId ? `id:${qId}` : `n:${qNum}`
    if (focusHandledRef.current === targetKey) return

    // Apply scope/filters so the target invoice can appear in the list.
    if (qCompany && gestionaleMode) {
      changeScopeMode('company')
      if (companyId !== qCompany) setCompanyId(qCompany)
    }
    if (supplierId) {
      setSupplierId('')
      return
    }
    if (monthFilter) setMonthFilter('')
    if (dueFilter) setDueFilter('')
    if (dateFrom) setDateFrom('')
    if (dateTo) setDateTo('')

    if (loading) return

    setError('')
    let match = null
    if (qId) match = invoices.find((inv) => String(inv.id) === qId) || null
    if (!match && qNum) match = findInvoiceByNumber(invoices, qNum)

    const finishFocus = (inv) => {
      if (!inv?.id) return
      focusHandledRef.current = `id:${inv.id}`
      setFocusInvoiceId(String(inv.id))
      scrolledFocusRef.current = '' // forza nuovo scroll verso l’elenco
      setError('')
      // Solo evidenzia + scroll: il dettaglio si apre al click sulla riga.
      setSuccess(`Documento ${inv.invoice_number || inv.id} evidenziato nell’elenco sotto`)
      // Keep id in URL for share/reload, drop helper params once applied.
      const next = new URLSearchParams()
      next.set('id', String(inv.id))
      setSearchParams(next, { replace: true })
    }

    if (match) {
      finishFocus(match)
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        if (qId && /^\d+$/.test(qId)) {
          try {
            const full = await fetchInvoice(qId)
            if (cancelled) return
            if (full?.id) {
              setInvoices((prev) => (prev.some((x) => String(x.id) === String(full.id)) ? prev : [full, ...prev]))
              finishFocus(full)
              return
            }
          } catch {
            if (cancelled) return
          }
        }

        const lookupNum = qNum || qId
        if (lookupNum) {
          try {
            const hit = await fetchInvoiceByNumber(lookupNum)
            if (cancelled) return
            if (hit?.id) {
              if (hit.ignored) setShowIgnored(true)
              if (hit.company && gestionaleMode && String(companyId || '') !== String(hit.company)) {
                changeScopeMode('company')
                setCompanyId(String(hit.company))
              }
              setInvoices((prev) => (prev.some((x) => String(x.id) === String(hit.id)) ? prev : [hit, ...prev]))
              finishFocus(hit)
              return
            }
          } catch {
            if (cancelled) return
          }
        }

        if (cancelled) return
        focusHandledRef.current = targetKey
        setError(
          lookupNum
            ? `N. ${lookupNum} non è nello storico Atlas (nel bonifico può essere un riferimento banca, non il numero fattura).`
            : `Documento id ${qId} non trovato nello storico fatture`,
        )
      } catch (e) {
        if (!cancelled) {
          focusHandledRef.current = targetKey
          setError(e?.message || (qId ? `Documento id ${qId} non trovato` : `Documento n. ${qNum} non trovato nello storico fatture`))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    searchParams,
    invoices,
    loading,
    gestionaleMode,
    companyId,
    supplierId,
    monthFilter,
    dueFilter,
    setCompanyId,
    setSearchParams,
  ])

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
      const focusing = String(searchParams.get('id') || searchParams.get('n') || focusInvoiceId || '').trim()
      if (!focusing) setError('')
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
      const list = Array.isArray(data) ? data : []
      // Non perdere la fattura appena aperta da movimenti se il reload lista la esclude
      const keepId = String(focusInvoiceId || searchParams.get('id') || '').trim()
      if (keepId && !list.some((inv) => String(inv.id) === keepId)) {
        setInvoices((prev) => {
          const kept = prev.find((inv) => String(inv.id) === keepId)
          return kept ? [kept, ...list] : list
        })
      } else {
        setInvoices(list)
      }
    } catch (e) {
      setError('Errore nel caricamento delle fatture')
    } finally {
      setLoading(false)
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
    window.setTimeout(() => {
      document.getElementById('fatture-form-inserimento')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
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
    let activityFromCash = ''
    if (inv.cash_entry_id) {
      try {
        const entry = await fetchCashEntry(inv.cash_entry_id)
        if (entry?.entry_date) {
          dateStr = entry.entry_date.slice(0, 10)
        }
        if (entry?.activity) activityFromCash = String(entry.activity).trim().toLowerCase()
      } catch {
        // movimento non trovato: resta la data documento
      }
    }
    const activity =
      activityFromCash ||
      resolvePrimaNotaActivityFromInvoice(inv) ||
      (scopeMode === 'locale' ? String(localeId || '').trim().toLowerCase() : '') ||
      (scopeMode === 'company' ? activitiesForCompany(companyId)[0] || '' : '')
    sessionStorage.setItem('primaNotaFocus', JSON.stringify({
      date: dateStr,
      activity: activity || null,
      company: inv.company || companyId || null,
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
      title="Storico fatture"
      lead="Archivio completo delle fatture: filtra per società o locale dal banner, poi scadenza e stato."
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
          Scegli <strong>Società</strong> o <strong>Locale</strong> nel banner verde per vedere lo storico
          fatture.
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

      <section className="card" id="fatture-form-inserimento">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <h2 className="page-subheader" style={{ marginTop: 0, marginBottom: 0 }}>
            {editingId ? 'Modifica fattura' : 'Nuova fattura'}
          </h2>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {activeFocusId && !editingId ? (
              <>
                <a className="btn btn-secondary btn-sm" href="#fatture-storico-elenco">
                  Vai all&apos;elenco evidenziato
                </a>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setFocusInvoiceId('')
                    scrolledFocusRef.current = ''
                    focusHandledRef.current = ''
                    setSuccess('')
                    const next = new URLSearchParams(searchParams)
                    next.delete('id')
                    next.delete('n')
                    setSearchParams(next, { replace: true })
                  }}
                  title="Togli evidenziazione e mostra di nuovo il form di inserimento"
                >
                  Mostra inserimento
                </button>
              </>
            ) : null}
            <FattureLink className="btn btn-secondary btn-sm" to="/fatture/ricevute">
              ← Torna all&apos;elenco
            </FattureLink>
          </div>
        </div>
        {activeFocusId && !editingId ? (
          <p className="fatture-note" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
            Arrivo da movimenti banca: il documento è evidenziato nello{' '}
            <a href="#fatture-storico-elenco">Storico fatture</a> sotto.
          </p>
        ) : null}
        <div
          className="form-group"
          style={{
            marginBottom: '0.9rem',
            marginTop: '0.9rem',
            display: activeFocusId && !editingId ? 'none' : undefined,
          }}
        >
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
        <form
          onSubmit={handleCreateInvoice}
          style={activeFocusId && !editingId ? { display: 'none' } : undefined}
        >
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
            <FattureLink className="btn btn-secondary" to="/fatture/ricevute">
              ← Torna all&apos;elenco
            </FattureLink>
          </div>
        </form>
      </section>

      <section className="card" id="fatture-storico-elenco">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: '0.75rem',
            flexWrap: 'wrap',
            alignItems: 'center',
            marginBottom: '0.35rem',
          }}
        >
          <h2 className="page-subheader" style={{ marginTop: 0, marginBottom: 0 }}>
            Storico fatture
          </h2>
          {activeFocusId ? (
            <span className="fatture-focus-banner" role="status">
              Documento evidenziato nell&apos;elenco
            </span>
          ) : null}
        </div>
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
            <label>Data da</label>
            <input
              type="date"
              className="form-control"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value)
                if (e.target.value) setMonthFilter('')
              }}
            />
          </div>
          <div className="form-group">
            <label>Data a</label>
            <input
              type="date"
              className="form-control"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value)
                if (e.target.value) setMonthFilter('')
              }}
            />
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
            onClick={() => {
              setSupplierId('')
              setDueFilter('')
              setMonthFilter('')
              setDateFrom('')
              setDateTo('')
              setShowIgnored(false)
            }}
          >
            Reset filtri
          </button>
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

        {loading && invoices.length === 0 ? (
          <AnalisiLoadingBar active label="Caricamento fatture" variant="subtle" />
        ) : null}

        {(!loading || invoices.length > 0) && !error && (
          <VneWorkbookGrid
            title="Storico fatture"
            sheetLabel={`${filteredInvoices.length} documenti`}
            loading={loading && invoices.length > 0}
            loadingLabel="Aggiornamento elenco"
            exportSubtitle={
              [
                supplierId ? suppliers.find((s) => String(s.id) === String(supplierId))?.name : null,
                dateFrom || dateTo ? `${dateFrom || '…'} → ${dateTo || '…'}` : null,
                monthFilter ? `Mese ${monthFilter}` : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'Elenco completo'
            }
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
            getRowId={(inv) => `invoice-row-${inv.id}`}
            getRowClassName={(inv) =>
              activeFocusId && String(inv.id) === String(activeFocusId) ? 'workbook-row-focus-purple' : ''
            }
            actionsHeader="Azioni"
            actionsColWidth="16.5rem"
            renderActions={(inv) => (
              <FattureActionsMenu
                primary={
                  <div className="fatture-row-actions-primary">
                    {inv.file_path ? (
                      <a
                        href={getInvoicePdfUrl(inv.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-primary btn-sm"
                        title="Apri / stampa PDF"
                      >
                        PDF
                      </a>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => handleMarkPaid(inv)}
                        disabled={inv.payment_status === 'paid'}
                        title="Segna come pagata"
                      >
                        Pagata
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => openPrimaNota(inv)}
                      title="Apri Prima Nota sul registro della fattura"
                    >
                      Prima Nota
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleEdit(inv)}
                      title="Modifica fattura"
                    >
                      Modifica
                    </button>
                  </div>
                }
                items={[
                  inv.file_path
                    ? {
                        key: 'pagata',
                        label: 'Segna pagata',
                        disabled: inv.payment_status === 'paid',
                        onClick: () => handleMarkPaid(inv),
                      }
                    : null,
                  {
                    key: 'ignore',
                    label: inv.ignored ? 'Ripristina' : 'Ignora',
                    onClick: () => handleToggleIgnore(inv),
                  },
                  {
                    key: 'delete',
                    label: 'Elimina',
                    danger: true,
                    onClick: () => handleDelete(inv),
                  },
                ]}
              />
            )}
          />
        )}
      </section>
    </FatturePageShell>
  )
}
