import React, { useEffect, useMemo, useRef, useState } from 'react'
import { fetchSuppliers } from '../services/suppliersService'
import { fetchEntries, createEntry, updateEntry, deleteEntry, deleteEntriesForDay, deleteEntriesForRange, fetchDailySummary, getExportUrl, fetchPrimaNotaLinkOptions } from '../services/cashService'
import { fetchAccounts, fetchPaymentMethods, fetchCategories } from '../services/referenceService'
import { fetchCustomers } from '../services/customersService'
import { checkAiAnomalies, suggestPrimaNota } from '../services/aiService'

export default function PrimaNotaPage() {
  const formatLocalIsoDate = (d) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  const todayIso = formatLocalIsoDate(new Date())
  const currentYearMonth = todayIso.slice(0, 7)
  const currentMonthFrom = `${currentYearMonth}-01`
  const monthStart = new Date(`${currentYearMonth}-01T00:00:00`)
  const currentMonthTo = formatLocalIsoDate(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0))

  const [suppliers, setSuppliers] = useState([])
  const [entries, setEntries] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [selectedDate, setSelectedDate] = useState(() => todayIso)
  const [exportDateFrom, setExportDateFrom] = useState('')
  const [exportDateTo, setExportDateTo] = useState('')
  const [resetRangeFrom, setResetRangeFrom] = useState(currentMonthFrom)
  const [resetRangeTo, setResetRangeTo] = useState(currentMonthTo)
  const [openingCashInput, setOpeningCashInput] = useState('')

  const [formType, setFormType] = useState('entrata')
  const [formAmount, setFormAmount] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formNote, setFormNote] = useState('')
  const [formConto, setFormConto] = useState('')
  const [formNonFiscale, setFormNonFiscale] = useState(false)
  const [formRifDocumento, setFormRifDocumento] = useState('')
  const [formSupplierId, setFormSupplierId] = useState('')
  const [formInvoiceId, setFormInvoiceId] = useState('')
  const [formDeliveryId, setFormDeliveryId] = useState('')
  const [formCustomerId, setFormCustomerId] = useState('')
  const [formAccountId, setFormAccountId] = useState('')
  const [formPaymentMethodId, setFormPaymentMethodId] = useState('')
  const [formCategoryId, setFormCategoryId] = useState('')
  const [accounts, setAccounts] = useState([])
  const [paymentMethods, setPaymentMethods] = useState([])
  const [categories, setCategories] = useState([])
  const [customers, setCustomers] = useState([])
  const [linkOptions, setLinkOptions] = useState({ invoices: [], deliveries: [] })
  const [formEntryDate, setFormEntryDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [deletingDay, setDeletingDay] = useState(false)
  const [resettingCumulative, setResettingCumulative] = useState(false)
  const [deletingRange, setDeletingRange] = useState(false)
  const [highlightEntryId, setHighlightEntryId] = useState(null)
  const [focusEntryMessage, setFocusEntryMessage] = useState('')
  const highlightScrollDoneRef = useRef(null)
  const formAnchorRef = useRef(null)
  const [drawerEntry, setDrawerEntry] = useState(null)
  const [movementSearch, setMovementSearch] = useState('')
  const [movementKind, setMovementKind] = useState('all')
  const [aiPrimaNotaText, setAiPrimaNotaText] = useState('')
  const [aiPrimaNotaAnomalies, setAiPrimaNotaAnomalies] = useState([])
  const [dashboardFilterActive, setDashboardFilterActive] = useState(false)
  const dashboardPreFiltersRef = useRef(null)

  useEffect(() => {
    loadSuppliers()
    loadPrimaNotaReference()
  }, [])

  useEffect(() => {
    const onApply = (ev) => {
      const s = ev?.detail || {}
      if (s.description) setFormDescription(String(s.description))
      if (s.amount != null) setFormAmount(String(s.amount))
      if (s.type === 'entrata' || s.type === 'uscita') setFormType(s.type)
      if (s.payment_method_hint) {
        const hit = paymentMethods.find((p) => (p.name || '').toLowerCase().includes(String(s.payment_method_hint).toLowerCase()))
        if (hit) setFormPaymentMethodId(String(hit.id))
      }
      if (s.category_hint) {
        const hit = categories.find((c) => (c.name || '').toLowerCase().includes(String(s.category_hint).toLowerCase()))
        if (hit) setFormCategoryId(String(hit.id))
      }
      if (s.account_hint) {
        const hit = accounts.find((a) => (a.name || '').toLowerCase().includes(String(s.account_hint).toLowerCase()))
        if (hit) setFormAccountId(String(hit.id))
      }
    }
    window.addEventListener('ai-apply-prima-nota', onApply)
    return () => window.removeEventListener('ai-apply-prima-nota', onApply)
  }, [paymentMethods, categories, accounts])

  useEffect(() => {
    const onAiFilter = (ev) => {
      const d = ev?.detail || {}
      if (d?.movementKind && ['all', 'entrata', 'uscita', 'nf'].includes(String(d.movementKind))) {
        setMovementKind(String(d.movementKind))
        setSuccess('Filtro AI applicato')
      }
      if (typeof d?.search === 'string') {
        setMovementSearch(d.search)
        setSuccess('Filtro AI applicato')
      }
    }
    const onAiReset = () => {
      setMovementKind('all')
      setMovementSearch('')
      setDashboardFilterActive(false)
      setSuccess('Filtri resettati da AI')
    }
    window.addEventListener('ai-prima-nota-filter', onAiFilter)
    window.addEventListener('ai-reset-filters', onAiReset)
    return () => {
      window.removeEventListener('ai-prima-nota-filter', onAiFilter)
      window.removeEventListener('ai-reset-filters', onAiReset)
    }
  }, [])

  async function loadPrimaNotaReference() {
    try {
      const [acc, pm, cat, cust, links] = await Promise.all([
        fetchAccounts(),
        fetchPaymentMethods(),
        fetchCategories(),
        fetchCustomers(),
        fetchPrimaNotaLinkOptions(),
      ])
      setAccounts(acc)
      setPaymentMethods(pm)
      setCategories(cat)
      setCustomers(cust)
      setLinkOptions(links || { invoices: [], deliveries: [] })
    } catch {
      // non bloccare Prima Nota
    }
  }

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('primaNotaFocus')
      if (!raw) return
      const data = JSON.parse(raw)
      sessionStorage.removeItem('primaNotaFocus')
      if (data.date) {
        setSelectedDate(data.date)
        setFormEntryDate(data.date)
      }
      if (data.supplierId) setFormSupplierId(String(data.supplierId))
      if (data.invoiceId) setFormInvoiceId(String(data.invoiceId))
      setFormType('uscita')
      if (data.description) setFormDescription(String(data.description))
      if (data.invoiceNumber) {
        const rif = String(data.invoiceNumber).trim()
        if (rif) setFormRifDocumento(`Fattura n. ${rif}`)
      }
      if (data.cashEntryId != null && data.cashEntryId !== '') {
        setHighlightEntryId(Number(data.cashEntryId))
        setFocusEntryMessage('')
        highlightScrollDoneRef.current = null
      }
    } catch {
      sessionStorage.removeItem('primaNotaFocus')
    }
  }, [])

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('primaNotaDashboardFilter')
      if (!raw) return
      const data = JSON.parse(raw)
      dashboardPreFiltersRef.current = {
        selectedDate,
        movementKind,
        movementSearch,
      }
      sessionStorage.removeItem('primaNotaDashboardFilter')
      let applied = false
      if (data?.monthKey && /^\d{4}-\d{2}$/.test(data.monthKey)) {
        setSelectedDate(`${data.monthKey}-01`)
        applied = true
      }
      if (data?.movementKind && ['all', 'entrata', 'uscita', 'nf'].includes(String(data.movementKind))) {
        setMovementKind(String(data.movementKind))
        applied = true
      }
      if (data?.search) {
        setMovementSearch(String(data.search))
        applied = true
      }
      setDashboardFilterActive(applied)
      setSuccess('Filtro dashboard applicato')
    } catch {
      sessionStorage.removeItem('primaNotaDashboardFilter')
    }
  }, [])

  function resetDashboardFilters() {
    if (!dashboardFilterActive) return
    const prev = dashboardPreFiltersRef.current
    if (prev) {
      setSelectedDate(prev.selectedDate || todayIso)
      setMovementKind(prev.movementKind || 'all')
      setMovementSearch(prev.movementSearch || '')
    } else {
      setMovementKind('all')
      setMovementSearch('')
    }
    setDashboardFilterActive(false)
    setSuccess('Filtri dashboard rimossi')
  }

  useEffect(() => {
    if (highlightEntryId == null) return
    const t = window.setTimeout(() => {
      setHighlightEntryId(null)
      highlightScrollDoneRef.current = null
      setFocusEntryMessage('')
    }, 12000)
    return () => window.clearTimeout(t)
  }, [highlightEntryId])

  useEffect(() => {
    if (loading || highlightEntryId == null) return
    const id = Number(highlightEntryId)
    if (Number.isNaN(id)) {
      setHighlightEntryId(null)
      return
    }
    const found = entries.some(e => Number(e.id) === id)
    if (!found) {
      setFocusEntryMessage(`Movimento cassa #${id} non presente nella data selezionata. Cambia la data in alto se il movimento è registrato in un altro giorno.`)
      return
    }
    setFocusEntryMessage('')
    if (highlightScrollDoneRef.current === id) return
    highlightScrollDoneRef.current = id
    window.setTimeout(() => {
      const el = document.getElementById(`cash-entry-row-${id}`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 200)
  }, [loading, entries, highlightEntryId])

  useEffect(() => {
    loadEntries()
    loadSummary()
  }, [selectedDate])

  async function loadSuppliers() {
    try {
      const data = await fetchSuppliers()
      setSuppliers(data)
    } catch {
      // noop
    }
  }

  async function loadEntries() {
    try {
      setLoading(true)
      setError('')
      const data = await fetchEntries({
        date_from: selectedDate,
        date_to: selectedDate,
      })
      setEntries(data)
    } catch (e) {
      setError('Errore nel caricamento dei movimenti')
    } finally {
      setLoading(false)
    }
  }

  async function loadSummary() {
    try {
      const data = await fetchDailySummary(selectedDate)
      setSummary(data)
    } catch {
      setSummary(null)
    }
  }

  async function refreshRiepilogo() {
    setError('')
    await loadEntries()
    await loadSummary()
    setSuccess('Riepilogo aggiornato')
  }

  async function handleAiSuggestPrimaNota() {
    if (!aiPrimaNotaText.trim()) return
    try {
      const res = await suggestPrimaNota(aiPrimaNotaText, { selectedDate })
      const s = res?.suggested_fields || {}
      if (s.description) setFormDescription(String(s.description))
      if (s.amount != null) setFormAmount(String(s.amount))
      if (s.type === 'entrata' || s.type === 'uscita') setFormType(s.type)
      if (s.payment_method_hint) {
        const hit = paymentMethods.find((p) => (p.name || '').toLowerCase().includes(String(s.payment_method_hint).toLowerCase()))
        if (hit) setFormPaymentMethodId(String(hit.id))
      }
      if (s.category_hint) {
        const hit = categories.find((c) => (c.name || '').toLowerCase().includes(String(s.category_hint).toLowerCase()))
        if (hit) setFormCategoryId(String(hit.id))
      }
      if (s.account_hint) {
        const hit = accounts.find((a) => (a.name || '').toLowerCase().includes(String(s.account_hint).toLowerCase()))
        if (hit) setFormAccountId(String(hit.id))
      }
      setSuccess('Bozza Prima Nota compilata con AI: verifica e salva')
    } catch {
      setError('Assistente AI non disponibile')
    }
  }

  async function handleAiCheckPrimaNota() {
    try {
      const res = await checkAiAnomalies('prima-nota', {
        description: formDescription,
        amount: Number(formAmount || 0),
        category_id: formCategoryId || null,
        payment_method_id: formPaymentMethodId || null,
      })
      setAiPrimaNotaAnomalies(res?.anomalies || [])
    } catch {
      setError('Controllo anomalie AI non disponibile')
    }
  }

  function handleAzzeraCassaIniziale() {
    setOpeningCashInput('')
    setSuccess('Cassa iniziale ripristinata (automatica)')
  }

  async function handleEliminaGiornata() {
    if (!window.confirm(`Eliminare tutti i movimenti del ${formatDate(selectedDate)}? Il riepilogo tornerà a zero.`)) return
    try {
      setDeletingDay(true)
      setError('')
      await deleteEntriesForDay(selectedDate)
      handleCancelEdit()
      setOpeningCashInput('')
      await loadEntries()
      await loadSummary()
      setSuccess('Movimenti del giorno eliminati')
    } catch {
      setError('Errore nell\'eliminazione dei movimenti del giorno')
    } finally {
      setDeletingDay(false)
    }
  }

  async function handleAzzeraSaldoCumulativo() {
    if (!summary) return
    const saldo = Number(summary.saldo_cumulativo || 0)
    if (!Number.isFinite(saldo) || Math.abs(saldo) < 0.005) {
      setSuccess('Saldo cumulativo gia a zero')
      return
    }
    const isPositive = saldo > 0
    const amount = Math.abs(saldo)
    const actionLabel = isPositive ? 'uscita' : 'entrata'
    if (!window.confirm(
      `Vuoi azzerare il saldo cumulativo del ${formatDate(selectedDate)}?\nVerrà registrata una ${actionLabel} di € ${formatAmount(amount)}.`
    )) return

    try {
      setResettingCumulative(true)
      setError('')
      await createEntry({
        entry_date: `${selectedDate}T23:59:00`,
        type: isPositive ? 'uscita' : 'entrata',
        amount,
        description: 'Azzera saldo cumulativo fine giornata',
        note: 'Movimento automatico di assestamento',
        conto: null,
        riferimento_documento: null,
        supplier_id: null,
        invoice_id: null,
        delivery_id: null,
        customer_id: null,
        account_id: null,
        payment_method_id: null,
        category_id: null,
      })
      await loadEntries()
      await loadSummary()
      setSuccess('Saldo cumulativo azzerato')
    } catch {
      setError('Errore nell\'azzeramento del saldo cumulativo')
    } finally {
      setResettingCumulative(false)
    }
  }

  async function handleEliminaIntervallo() {
    if (!resetRangeFrom || !resetRangeTo) {
      setError('Seleziona data inizio e data fine dell\'intervallo')
      return
    }
    if (resetRangeFrom > resetRangeTo) {
      setError('La data inizio non puo essere successiva alla data fine')
      return
    }
    if (!window.confirm(`Eliminare tutti i movimenti dal ${formatDate(resetRangeFrom)} al ${formatDate(resetRangeTo)}?`)) return
    try {
      setDeletingRange(true)
      setError('')
      await deleteEntriesForRange(resetRangeFrom, resetRangeTo)
      handleCancelEdit()
      setOpeningCashInput('')
      await loadEntries()
      await loadSummary()
      setSuccess('Movimenti dell\'intervallo eliminati')
    } catch {
      setError('Errore nell\'eliminazione dei movimenti dell\'intervallo')
    } finally {
      setDeletingRange(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!formAmount || Number(formAmount) <= 0) {
      setError('Inserisci un importo valido')
      return
    }

    try {
      setSaving(true)
      const entryDate = formEntryDate || selectedDate
      const payload = {
        entry_date: entryDate.includes('T') ? entryDate : `${entryDate}T12:00:00`,
        type: formType,
        amount: Number(formAmount),
        description: formDescription.trim() || null,
        note: formNote.trim() || null,
        conto: formNonFiscale ? 'NON_FISCALE' : (formConto.trim() || null),
        riferimento_documento: formRifDocumento.trim() || null,
        supplier_id: formSupplierId ? Number(formSupplierId) : null,
        invoice_id: formInvoiceId ? Number(formInvoiceId) : null,
        delivery_id: formDeliveryId ? Number(formDeliveryId) : null,
        customer_id: formCustomerId ? Number(formCustomerId) : null,
        account_id: formAccountId ? Number(formAccountId) : null,
        payment_method_id: formPaymentMethodId ? Number(formPaymentMethodId) : null,
        category_id: formCategoryId ? Number(formCategoryId) : null,
      }

      if (editingId) {
        await updateEntry(editingId, payload)
        setSuccess('Movimento aggiornato')
      } else {
        await createEntry(payload)
        setSuccess('Movimento registrato')
      }

      setFormAmount('')
      setFormDescription('')
      setFormNote('')
      setFormConto('')
      setFormNonFiscale(false)
      setFormRifDocumento('')
      setFormSupplierId('')
      setFormInvoiceId('')
      setFormDeliveryId('')
      setFormCustomerId('')
      setFormAccountId('')
      setFormPaymentMethodId('')
      setFormCategoryId('')
      setFormEntryDate('')
      setFormType('entrata')
      setEditingId(null)
      await loadEntries()
      await loadSummary()
    } catch (err) {
      setError(editingId ? 'Errore nella modifica del movimento' : 'Errore nel salvataggio del movimento')
    } finally {
      setSaving(false)
    }
  }

  function handleEdit(entry) {
    setDrawerEntry(null)
    setEditingId(entry.id)
    setFormType(entry.type || 'entrata')
    setFormAmount(String(entry.amount ?? ''))
    setFormDescription(entry.description || '')
    setFormNote(entry.note || '')
    setFormConto(entry.conto || '')
    setFormNonFiscale(entry.conto === 'NON_FISCALE')
    setFormRifDocumento(entry.riferimento_documento || '')
    setFormSupplierId(entry.supplier_id ? String(entry.supplier_id) : '')
    setFormInvoiceId(entry.invoice_id ? String(entry.invoice_id) : '')
    setFormDeliveryId(entry.delivery_id ? String(entry.delivery_id) : '')
    setFormCustomerId(entry.customer_id ? String(entry.customer_id) : '')
    setFormAccountId(entry.account_id ? String(entry.account_id) : '')
    setFormPaymentMethodId(entry.payment_method_id ? String(entry.payment_method_id) : '')
    setFormCategoryId(entry.category_id ? String(entry.category_id) : '')
    setFormEntryDate(entry.entry_date ? entry.entry_date.slice(0, 10) : selectedDate)
    setError('')
    setSuccess('')
  }

  function handleCancelEdit() {
    setEditingId(null)
    setFormType('entrata')
    setFormAmount('')
    setFormDescription('')
    setFormNote('')
    setFormConto('')
    setFormNonFiscale(false)
    setFormRifDocumento('')
    setFormSupplierId('')
    setFormInvoiceId('')
    setFormDeliveryId('')
    setFormCustomerId('')
    setFormAccountId('')
    setFormPaymentMethodId('')
    setFormCategoryId('')
    setFormEntryDate('')
    setError('')
  }

  async function handleDelete(entry) {
    if (!window.confirm('Eliminare questo movimento?')) return
    try {
      await deleteEntry(entry.id)
      setDrawerEntry((prev) => (prev && prev.id === entry.id ? null : prev))
      if (editingId === entry.id) handleCancelEdit()
      setSuccess('Movimento eliminato')
      await loadEntries()
      await loadSummary()
    } catch {
      setError('Errore nell\'eliminazione del movimento')
    }
  }

  function handleDownloadReport(e) {
    e.preventDefault()
    const url = getExportUrl(exportDateFrom || undefined, exportDateTo || undefined)
    window.open(url, '_blank')
  }

  function formatDate(value) {
    if (!value) return ''
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return String(value)
    return d.toLocaleDateString('it-IT')
  }

  function formatTime(value) {
    if (!value) return ''
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  }

  function formatAmount(value) {
    if (value == null) return ''
    return Number(value).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  function isNonFiscale(entry) {
    return entry?.conto === 'NON_FISCALE'
  }

  const rowsWithLedger = React.useMemo(() => {
    if (!entries || entries.length === 0) return { rows: [], cassaIniziale: 0, cassaFinale: 0 }

    const firstFiscale = entries.find(e => e.conto !== 'NON_FISCALE')
    const defaultOpening = firstFiscale
      ? Number(firstFiscale.saldo_progressivo) - (firstFiscale.type === 'entrata' ? Number(firstFiscale.amount) : -Number(firstFiscale.amount))
      : Number(entries[0].saldo_progressivo || 0)
    const cassaIniziale = openingCashInput === '' ? defaultOpening : Number(openingCashInput || 0)

    let running = cassaIniziale
    const rows = entries.map((entry) => {
      const isNonFiscal = entry.conto === 'NON_FISCALE'
      const entrata = !isNonFiscal && entry.type === 'entrata' ? Number(entry.amount) : 0
      const uscita = !isNonFiscal && entry.type === 'uscita' ? Number(entry.amount) : 0
      const nonFiscale = isNonFiscal ? (entry.type === 'entrata' ? Number(entry.amount) : -Number(entry.amount)) : 0
      const totaleMovimento = entrata - uscita
      const incasso = totaleMovimento + nonFiscale
      const affectsSaldo = !isNonFiscal
      if (affectsSaldo) running += totaleMovimento
      return {
        ...entry,
        entrata,
        uscita,
        nonFiscale,
        totaleMovimento,
        affectsSaldo,
        incasso,
        cassaMattina: cassaIniziale,
        cassaSera: running,
      }
    })

    return { rows, cassaIniziale, cassaFinale: running }
  }, [entries, openingCashInput])

  const filteredMovementRows = useMemo(() => {
    const q = movementSearch.trim().toLowerCase()
    return rowsWithLedger.rows.filter((entry) => {
      if (movementKind === 'entrata' && (entry.conto === 'NON_FISCALE' || entry.type !== 'entrata')) return false
      if (movementKind === 'uscita' && (entry.conto === 'NON_FISCALE' || entry.type !== 'uscita')) return false
      if (movementKind === 'nf' && entry.conto !== 'NON_FISCALE') return false
      if (!q) return true
      const blob = [entry.description, entry.note, entry.riferimento_documento].filter(Boolean).join(' ').toLowerCase()
      return blob.includes(q)
    })
  }, [rowsWithLedger.rows, movementSearch, movementKind])

  function supplierName(id) {
    if (!id) return null
    const s = suppliers.find((x) => Number(x.id) === Number(id))
    return s ? s.name : `#${id}`
  }

  function customerName(id) {
    if (!id) return null
    const c = customers.find((x) => Number(x.id) === Number(id))
    return c ? c.name : `#${id}`
  }

  function accountLabel(id) {
    if (!id) return null
    const a = accounts.find((x) => Number(x.id) === Number(id))
    return a ? `${a.code ? `${a.code} — ` : ''}${a.name}` : `#${id}`
  }

  function paymentLabel(id) {
    if (!id) return null
    const p = paymentMethods.find((x) => Number(x.id) === Number(id))
    return p ? p.name : `#${id}`
  }

  function categoryLabel(id) {
    if (!id) return null
    const c = categories.find((x) => Number(x.id) === Number(id))
    return c ? `${c.name} (${c.flow})` : `#${id}`
  }

  function linkedInvoiceLabel(id) {
    if (id == null || id === '') return null
    const inv = (linkOptions.invoices || []).find((x) => Number(x.id) === Number(id))
    if (inv) {
      return `n. ${inv.invoice_number} — ${inv.supplier_name} · € ${formatAmount(inv.total)}`
    }
    return `Collegamento #${id} (non tra le ultime fatture in elenco)`
  }

  function linkedDeliveryLabel(id) {
    if (id == null || id === '') return null
    const d = (linkOptions.deliveries || []).find((x) => Number(x.id) === Number(id))
    if (d) {
      const dateStr = d.delivery_date ? formatDate(d.delivery_date) : ''
      const desc = (d.product_description || 'Consegna').slice(0, 56)
      return `${desc} — ${d.supplier_name}${dateStr ? ` · ${dateStr}` : ''}`
    }
    return `Collegamento #${id} (non tra le ultime consegne in elenco)`
  }

  function scrollToNewMovement() {
    setDrawerEntry(null)
    window.setTimeout(() => {
      formAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      document.getElementById('prima-nota-amount')?.focus()
    }, 100)
  }

  const nonFiscaleGiorno = React.useMemo(() => {
    return entries.reduce((acc, e) => {
      if (e.conto !== 'NON_FISCALE') return acc
      const delta = e.type === 'entrata' ? Number(e.amount || 0) : -Number(e.amount || 0)
      return acc + delta
    }, 0)
  }, [entries])

  const cassaFinaleRiepilogo = Number(nonFiscaleGiorno || 0) + Number(summary?.saldo_giornaliero || 0)

  return (
    <div>
      <h1 className="page-header">Prima Nota di Cassa</h1>

      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="ui-toolbar-one card" style={{ padding: '0.85rem 1rem', marginBottom: '1rem' }}>
        <div className="form-group">
          <label>Data giornata</label>
          <input
            type="date"
            className="form-control"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            style={{ maxWidth: 160 }}
          />
        </div>
        <div className="form-group" style={{ flex: '1 1 200px', minWidth: 160 }}>
          <label>Cerca movimento</label>
          <input
            type="search"
            className="form-control"
            value={movementSearch}
            onChange={e => setMovementSearch(e.target.value)}
            placeholder="Descrizione, note, riferimento…"
            aria-label="Filtra movimenti"
          />
        </div>
        <div className="form-group">
          <label>Tipo</label>
          <select className="form-control" value={movementKind} onChange={e => setMovementKind(e.target.value)} style={{ minWidth: 130 }}>
            <option value="all">Tutti</option>
            <option value="entrata">Solo entrate</option>
            <option value="uscita">Solo uscite</option>
            <option value="nf">Non fiscali</option>
          </select>
        </div>
        <div className="form-group">
          <button type="button" className="btn btn-secondary" onClick={refreshRiepilogo}>
            Aggiorna
          </button>
        </div>
        <div className="form-group" style={{ flex: '1 1 320px' }}>
          <label>Comando AI movimento</label>
          <div style={{ display: 'flex', gap: '0.45rem' }}>
            <input
              className="form-control"
              value={aiPrimaNotaText}
              onChange={e => setAiPrimaNotaText(e.target.value)}
              placeholder='Es. "pagato fattura bevande aprile 450 euro con bonifico"'
            />
            <button type="button" className="btn btn-primary" onClick={handleAiSuggestPrimaNota}>Compila</button>
            <button type="button" className="btn btn-secondary" onClick={handleAiCheckPrimaNota}>Controlla</button>
          </div>
          {aiPrimaNotaAnomalies.length > 0 && (
            <div className="alert alert-info" style={{ marginTop: '0.45rem', marginBottom: 0 }}>
              <strong>Anomalie:</strong> {aiPrimaNotaAnomalies.join(' · ')}
            </div>
          )}
        </div>
        {dashboardFilterActive && (
          <div className="ui-filter-pill">
            <span>Dashboard · {selectedDate.slice(0, 7)} · {movementKind}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={resetDashboardFilters}>Reset</button>
          </div>
        )}
      </div>

      <section className="card" ref={formAnchorRef} id="prima-nota-form">
        <h2 className="page-subheader" style={{ marginTop: 0 }}>{editingId ? 'Modifica movimento' : 'Nuovo movimento'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label>Data operazione</label>
              <input
                type="date"
                className="form-control"
                value={formEntryDate || selectedDate}
                onChange={e => setFormEntryDate(e.target.value)}
                style={{ maxWidth: 160 }}
              />
            </div>
            <div className="form-group">
              <label>Movimento cassa</label>
              <div className="btn-group" style={{ marginTop: 0 }}>
                <button
                  type="button"
                  className={formType === 'entrata' ? 'btn btn-primary' : 'btn btn-secondary'}
                  onClick={() => setFormType('entrata')}
                >
                  Cassa entrata
                </button>
                <button
                  type="button"
                  className={formType === 'uscita' ? 'btn btn-primary' : 'btn btn-secondary'}
                  onClick={() => setFormType('uscita')}
                >
                  Cassa uscita
                </button>
              </div>
            </div>
            <div className="form-group" style={{ flex: '1 1 220px', minWidth: 200 }}>
              <label>Voce fiscale</label>
              <div className="btn-group" style={{ marginTop: 0 }}>
                <button
                  type="button"
                  className={!formNonFiscale ? 'btn btn-primary' : 'btn btn-secondary'}
                  onClick={() => setFormNonFiscale(false)}
                  title="Movimento fiscale: entra nei conteggi di cassa e nel riepilogo giornaliero."
                >
                  Fiscale
                </button>
                <button
                  type="button"
                  className={formNonFiscale ? 'btn btn-outline-danger' : 'btn btn-secondary'}
                  onClick={() => setFormNonFiscale(true)}
                  title="Movimento NON fiscale: viene salvato ma non entra nei conteggi di cassa/riepilogo."
                >
                  Non fiscale
                </button>
              </div>
            </div>
            <div className="form-group">
              <label>Importo {formType === 'entrata' ? 'entrata' : 'uscita'} (€)</label>
              <input
                id="prima-nota-amount"
                type="number"
                step="0.01"
                min="0.01"
                className="form-control"
                value={formAmount}
                onChange={e => setFormAmount(e.target.value)}
                style={{ maxWidth: 140 }}
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group" style={{ flex: '1 1 300px' }}>
              <label>Descrizione operazione</label>
              <input className="form-control" value={formDescription} onChange={e => setFormDescription(e.target.value)} placeholder="Perché hai pagato o ricevuto questa somma" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group" style={{ flex: '1 1 220px' }}>
              <label>Riferimento documento fiscale</label>
              <input className="form-control" value={formRifDocumento} onChange={e => setFormRifDocumento(e.target.value)} placeholder="Es. Fattura n. 123" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Fornitore (opzionale)</label>
              <select className="form-control" value={formSupplierId} onChange={e => setFormSupplierId(e.target.value)} style={{ minWidth: 200 }}>
                <option value="">–</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ flex: '1 1 200px' }}>
              <label>Conto testuale (opzionale)</label>
              <input className="form-control" value={formConto} onChange={e => setFormConto(e.target.value)} placeholder="Es. Cassa, Banca… (alternativa al conto anagrafico sotto)" disabled={formNonFiscale} />
            </div>
          </div>

          <details className="prima-nota-links" style={{ marginBottom: '1rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.75rem 1rem', background: 'var(--bg-card)' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--text-heading)' }}>
              Collegamenti contabili (fattura, consegna, cliente, conto, pagamento, categoria)
            </summary>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '0.75rem 0' }}>
              Collega il movimento a documenti e soggetti: così la Prima Nota non resta isolata da fatture fornitori, consegne, clienti e piano dei conti. Gli allegati sono gestiti dalla tabella <code>attachments</code> (API <code>GET /attachments</code>).
            </p>
            <div className="form-row">
              <div className="form-group" style={{ flex: '1 1 260px' }}>
                <label>Fattura fornitore</label>
                <select className="form-control" value={formInvoiceId} onChange={e => setFormInvoiceId(e.target.value)}>
                  <option value="">–</option>
                  {(linkOptions.invoices || []).map(inv => (
                    <option key={inv.id} value={inv.id}>
                      {inv.invoice_number} — {inv.supplier_name} (€ {formatAmount(inv.total)})
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ flex: '1 1 260px' }}>
                <label>Consegna (riga merce)</label>
                <select className="form-control" value={formDeliveryId} onChange={e => setFormDeliveryId(e.target.value)}>
                  <option value="">–</option>
                  {(linkOptions.deliveries || []).map(d => (
                    <option key={d.id} value={d.id}>
                      {(d.product_description || 'Merce').slice(0, 40)} — {d.supplier_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group" style={{ flex: '1 1 200px' }}>
                <label>Cliente</label>
                <select className="form-control" value={formCustomerId} onChange={e => setFormCustomerId(e.target.value)}>
                  <option value="">–</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ flex: '1 1 200px' }}>
                <label>Conto (piano conti)</label>
                <select className="form-control" value={formAccountId} onChange={e => setFormAccountId(e.target.value)}>
                  <option value="">–</option>
                  {accounts.map(a => (
                    <option key={a.id} value={a.id}>{a.code ? `${a.code} — ` : ''}{a.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group" style={{ flex: '1 1 200px' }}>
                <label>Metodo di pagamento</label>
                <select className="form-control" value={formPaymentMethodId} onChange={e => setFormPaymentMethodId(e.target.value)}>
                  <option value="">–</option>
                  {paymentMethods.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ flex: '1 1 200px' }}>
                <label>Categoria</label>
                <select className="form-control" value={formCategoryId} onChange={e => setFormCategoryId(e.target.value)}>
                  <option value="">–</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.flow})</option>
                  ))}
                </select>
              </div>
            </div>
          </details>

          <div className="form-group">
            <label>Note (per commercialista)</label>
            <textarea className="form-control" value={formNote} onChange={e => setFormNote(e.target.value)} rows={2} placeholder="Note da allegare al report per il commercialista" />
          </div>
          <div className="btn-group">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Salvataggio...' : editingId ? 'Salva modifiche' : 'Registra movimento'}
            </button>
            {editingId && (
              <button type="button" className="btn btn-secondary" onClick={handleCancelEdit}>
                Annulla
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="card">
        <h2 className="page-subheader" style={{ marginTop: 0 }}>Movimenti del {formatDate(selectedDate)}</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: '-0.35rem', marginBottom: '0.75rem' }}>
          Clicca una riga per il dettaglio. I filtri sono nella barra in alto.
        </p>
        {focusEntryMessage && (
          <div className="alert alert-danger" style={{ marginBottom: '0.75rem' }}>{focusEntryMessage}</div>
        )}
        {loading && <p className="loading">Caricamento...</p>}
        {!loading && !error && (
          <div className="table-wrap pn-table-wrap">
            <table className="app-table app-table--compact">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>N.</th>
                  <th>Operazioni</th>
                  <th className="text-end">Cassa entrata</th>
                  <th className="text-end">Cassa uscita</th>
                  <th className="text-end">Non fiscale</th>
                  <th className="text-end">Totale</th>
                  <th className="text-end">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {filteredMovementRows.map((entry, idx) => (
                  <tr
                    key={entry.id}
                    id={`cash-entry-row-${entry.id}`}
                    className="pn-row-click"
                    onClick={() => setDrawerEntry(entry)}
                    style={
                      highlightEntryId != null && Number(entry.id) === Number(highlightEntryId)
                        ? { background: 'rgba(250, 204, 21, 0.22)', boxShadow: 'inset 0 0 0 2px #d97706' }
                        : undefined
                    }
                  >
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(entry.entry_date)}</td>
                    <td>{idx + 1}</td>
                    <td style={{ maxWidth: 260 }}>
                      {entry.description || '–'}
                      {entry.riferimento_documento ? <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{entry.riferimento_documento}</div> : null}
                    </td>
                    <td className="text-end amount">{entry.entrata > 0 ? `€ ${formatAmount(entry.entrata)}` : '—'}</td>
                    <td className="text-end amount">{entry.uscita > 0 ? `€ ${formatAmount(entry.uscita)}` : '—'}</td>
                    <td className="text-end amount">{entry.nonFiscale !== 0 ? `€ ${formatAmount(entry.nonFiscale)}` : '—'}</td>
                    <td
                      className="text-end pn-amount-cell"
                      style={{
                        color: isNonFiscale(entry) ? 'var(--text-muted)' : entry.type === 'entrata' ? 'var(--success)' : 'var(--danger)',
                      }}
                    >
                      € {formatAmount(entry.incasso)}
                    </td>
                    <td className="text-end" style={{ whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ marginRight: '0.25rem', padding: '0.35rem 0.6rem', fontSize: '0.85rem' }}
                        onClick={(e) => { e.stopPropagation(); handleEdit(entry) }}
                      >
                        Modifica
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline-danger"
                        style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem' }}
                        onClick={(e) => { e.stopPropagation(); handleDelete(entry) }}
                      >
                        Elimina
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredMovementRows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="empty-state">
                      {rowsWithLedger.rows.length === 0 ? 'Nessun movimento in questa data.' : 'Nessun movimento corrisponde ai filtri.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {!loading && !error && rowsWithLedger.rows.length > 0 && (
          <details style={{ marginTop: '1rem' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--text-heading)' }}>Vista foglio (stile Excel)</summary>
            <div className="table-wrap excel-wrap" style={{ marginTop: '0.75rem' }}>
              <table className="app-table excel-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Descrizione</th>
                    <th>Entrata</th>
                    <th>Uscita</th>
                    <th>Totale</th>
                    <th>Non fiscale</th>
                    <th>Saldo attuale cassa</th>
                    <th>Cassa finale</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsWithLedger.rows.map((entry) => (
                    <tr
                      key={`excel-${entry.id}`}
                      id={`cash-entry-excel-row-${entry.id}`}
                      style={
                        highlightEntryId != null && Number(entry.id) === Number(highlightEntryId)
                          ? { background: 'rgba(250, 204, 21, 0.22)' }
                          : undefined
                      }
                    >
                      <td><input className="excel-cell" value={`${formatDate(entry.entry_date)} ${formatTime(entry.entry_date)}`} readOnly /></td>
                      <td><input className="excel-cell" value={`${entry.description || ''}${isNonFiscale(entry) ? ' [Non fiscale]' : ''}`} readOnly /></td>
                      <td><input className="excel-cell excel-cell-num" value={formatAmount(entry.entrata)} readOnly /></td>
                      <td><input className="excel-cell excel-cell-num" value={formatAmount(entry.uscita)} readOnly /></td>
                      <td><input className="excel-cell excel-cell-num" value={formatAmount(entry.totaleMovimento)} readOnly /></td>
                      <td><input className="excel-cell excel-cell-num" value={formatAmount(entry.nonFiscale)} readOnly /></td>
                      <td><input className="excel-cell excel-cell-num" value={formatAmount(entry.cassaMattina)} readOnly /></td>
                      <td><input className="excel-cell excel-cell-num" value={formatAmount(entry.cassaSera)} readOnly /></td>
                      <td><input className="excel-cell" value={entry.note || ''} readOnly /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </section>

      <section className="card">
        <h2 className="page-subheader" style={{ marginTop: 0 }}>Riepilogo giornaliero</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '0.75rem' }}>
          Giorno <strong>{formatDate(selectedDate)}</strong>. I totali entrate/uscite si aggiornano dai movimenti. Puoi modificare la <strong>cassa iniziale</strong> per adattare lo schema; per correggere i totali modifica o elimina i movimenti nella tabella sotto.
        </p>
        <div className="form-row">
          <div className="form-group">
            <label>Saldo attuale cassa/rimanente</label>
            <input
              type="number"
              step="0.01"
              className="form-control"
              value={openingCashInput}
              onChange={e => setOpeningCashInput(e.target.value)}
              placeholder="auto"
              style={{ maxWidth: 180 }}
            />
          </div>
        </div>
        <div className="btn-group" style={{ marginBottom: '0.75rem' }}>
          <button type="button" className="btn btn-secondary" onClick={handleAzzeraCassaIniziale}>
            Azzera cassa iniziale
          </button>
          <button
            type="button"
            className="btn btn-outline-danger"
            onClick={handleEliminaGiornata}
            disabled={deletingDay || entries.length === 0}
            title="Elimina tutti i movimenti della data selezionata nel calendario. Aggiorna saldo giornaliero e saldo cumulativo (senza i movimenti di quel giorno)."
          >
            {deletingDay ? 'Eliminazione...' : 'Elimina tutti i movimenti del giorno'}
          </button>
          <button
            type="button"
            className="btn btn-outline-danger"
            onClick={handleAzzeraSaldoCumulativo}
            disabled={resettingCumulative || !summary}
            title="Registra un movimento di assestamento per portare il saldo cumulativo di fine giornata a zero."
          >
            {resettingCumulative ? 'Azzeramento...' : 'Azzera saldo cumulativo di fine giornata'}
          </button>
        </div>
        <div className="form-row" style={{ alignItems: 'end', marginBottom: '0.75rem' }}>
          <div className="form-group">
            <label>Reset movimenti intervallo - data inizio</label>
            <input
              type="date"
              className="form-control"
              value={resetRangeFrom}
              onChange={e => setResetRangeFrom(e.target.value)}
              style={{ maxWidth: 180 }}
            />
          </div>
          <div className="form-group">
            <label>Data fine</label>
            <input
              type="date"
              className="form-control"
              value={resetRangeTo}
              onChange={e => setResetRangeTo(e.target.value)}
              style={{ maxWidth: 180 }}
            />
          </div>
          <div className="form-group">
            <button
              type="button"
              className="btn btn-outline-danger"
              onClick={handleEliminaIntervallo}
              disabled={deletingRange}
              title="Elimina riepilogo giornaliero periodo"
            >
              {deletingRange ? 'Eliminazione intervallo...' : 'Elimina riepilogo giornaliero periodo'}
            </button>
          </div>
        </div>

        {summary && (
          <div className="table-wrap" style={{ marginTop: '1rem' }}>
            <table className="app-table">
              <tbody>
                <tr>
                  <td><strong>Totale entrate</strong></td>
                  <td className="text-end amount" style={{ color: 'var(--success)' }}>€ {formatAmount(summary.totale_entrate)}</td>
                </tr>
                <tr>
                  <td><strong>Totale uscite</strong></td>
                  <td className="text-end amount" style={{ color: 'var(--danger)' }}>€ {formatAmount(summary.totale_uscite)}</td>
                </tr>
                <tr>
                  <td><strong>Totale non fiscale (giorno)</strong></td>
                  <td className="text-end amount" style={{ color: 'var(--text-muted)' }}>€ {formatAmount(nonFiscaleGiorno)}</td>
                </tr>
                <tr>
                  <td><strong>Saldo giornaliero</strong></td>
                  <td className="text-end amount">€ {formatAmount(summary.saldo_giornaliero)}</td>
                </tr>
                <tr>
                  <td>
                    <strong>Saldo cumulativo a fine giornata</strong>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 400, marginTop: '0.3rem', maxWidth: 360 }}>
                      È la cassa calcolata su <strong>tutti</strong> i movimenti fino a questa data (anche dei giorni precedenti). Usa i pulsanti sopra per eliminare solo i movimenti della <strong>data selezionata</strong>: se gran parte del saldo viene dai giorni passati, questo totale non si azzera finché non modifichi o elimini anche quelle registrazioni.
                    </div>
                  </td>
                  <td className="text-end amount" style={{ fontWeight: 700 }}>€ {formatAmount(summary.saldo_cumulativo)}</td>
                </tr>
                <tr>
                  <td><strong>Saldo attuale cassa</strong></td>
                  <td className="text-end amount">€ {formatAmount(rowsWithLedger.cassaIniziale)}</td>
                </tr>
                <tr>
                  <td><strong>Cassa finale (schema)</strong></td>
                  <td className="text-end amount" style={{ fontWeight: 700 }}>€ {formatAmount(cassaFinaleRiepilogo)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="page-subheader" style={{ marginTop: 0 }}>Scarica report entrate/uscite</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.95rem' }}>
          Esporta un file CSV con tutti i movimenti nel periodo indicato, da inviare al commercialista.
        </p>
        <form onSubmit={handleDownloadReport} className="filter-bar">
          <div className="form-group">
            <label>Data da</label>
            <input type="date" className="form-control" value={exportDateFrom} onChange={e => setExportDateFrom(e.target.value)} style={{ minWidth: 140 }} />
          </div>
          <div className="form-group">
            <label>Data a</label>
            <input type="date" className="form-control" value={exportDateTo} onChange={e => setExportDateTo(e.target.value)} style={{ minWidth: 140 }} />
          </div>
          <button type="submit" className="btn btn-primary">
            Scarica report CSV
          </button>
        </form>
      </section>

      <button type="button" className="ui-fab" onClick={scrollToNewMovement} title="Vai al form nuovo movimento">
        + Nuovo movimento
      </button>

      {drawerEntry && (
        <>
          <div className="ui-drawer-backdrop" onClick={() => setDrawerEntry(null)} aria-hidden />
          <aside className="ui-drawer" role="dialog" aria-label="Dettaglio movimento" style={{ width: 'min(440px, 100vw)' }}>
            <div className="ui-drawer-header">
              <div>
                <h2 className="ui-drawer-title">Movimento cassa</h2>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  {formatDate(drawerEntry.entry_date)} {formatTime(drawerEntry.entry_date)}
                </div>
              </div>
              <button type="button" className="ui-drawer-close" onClick={() => setDrawerEntry(null)} aria-label="Chiudi">×</button>
            </div>
            <div className="ui-drawer-body">
              <p style={{ marginTop: 0 }}>
                {isNonFiscale(drawerEntry) ? (
                  <span className="badge-pn badge-pn--nf">Non fiscale</span>
                ) : drawerEntry.type === 'entrata' ? (
                  <span className="badge-pn badge-pn--in">Entrata</span>
                ) : (
                  <span className="badge-pn badge-pn--out">Uscita</span>
                )}
              </p>
              <p className="pn-amount-cell" style={{ fontSize: '1.35rem', margin: '0.5rem 0 1rem', color: isNonFiscale(drawerEntry) ? 'var(--text-muted)' : drawerEntry.type === 'entrata' ? 'var(--success)' : 'var(--danger)' }}>
                € {formatAmount(drawerEntry.amount)}
              </p>
              <dl style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '0.35rem 0.75rem', fontSize: '0.9rem' }}>
                <dt style={{ color: 'var(--text-muted)' }}>Descrizione</dt>
                <dd style={{ margin: 0 }}>{drawerEntry.description || '–'}</dd>
                <dt style={{ color: 'var(--text-muted)' }}>Note</dt>
                <dd style={{ margin: 0 }}>{drawerEntry.note || '–'}</dd>
                <dt style={{ color: 'var(--text-muted)' }}>Rif. documento</dt>
                <dd style={{ margin: 0 }}>{drawerEntry.riferimento_documento || '–'}</dd>
                <dt style={{ color: 'var(--text-muted)' }}>Conto testuale</dt>
                <dd style={{ margin: 0 }}>{drawerEntry.conto || '–'}</dd>
                <dt style={{ color: 'var(--text-muted)' }}>Fornitore</dt>
                <dd style={{ margin: 0 }}>{supplierName(drawerEntry.supplier_id) || '–'}</dd>
                <dt style={{ color: 'var(--text-muted)' }}>Cliente</dt>
                <dd style={{ margin: 0 }}>{customerName(drawerEntry.customer_id) || '–'}</dd>
                <dt style={{ color: 'var(--text-muted)' }}>Fattura fornitore</dt>
                <dd style={{ margin: 0 }}>{drawerEntry.invoice_id != null ? linkedInvoiceLabel(drawerEntry.invoice_id) : '–'}</dd>
                <dt style={{ color: 'var(--text-muted)' }}>Consegna</dt>
                <dd style={{ margin: 0 }}>{drawerEntry.delivery_id != null ? linkedDeliveryLabel(drawerEntry.delivery_id) : '–'}</dd>
                <dt style={{ color: 'var(--text-muted)' }}>Conto</dt>
                <dd style={{ margin: 0 }}>{accountLabel(drawerEntry.account_id) || '–'}</dd>
                <dt style={{ color: 'var(--text-muted)' }}>Pagamento</dt>
                <dd style={{ margin: 0 }}>{paymentLabel(drawerEntry.payment_method_id) || '–'}</dd>
                <dt style={{ color: 'var(--text-muted)' }}>Categoria</dt>
                <dd style={{ margin: 0 }}>{categoryLabel(drawerEntry.category_id) || '–'}</dd>
                <dt style={{ color: 'var(--text-muted)' }}>Cassa sera</dt>
                <dd style={{ margin: 0, fontWeight: 600 }}>€ {formatAmount(drawerEntry.cassaSera)}</dd>
              </dl>
              <div className="btn-group" style={{ marginTop: '1.25rem' }}>
                <button type="button" className="btn btn-primary" onClick={() => handleEdit(drawerEntry)}>Modifica</button>
                <button type="button" className="btn btn-outline-danger" onClick={() => handleDelete(drawerEntry)}>Elimina</button>
              </div>
            </div>
          </aside>
        </>
      )}
    </div>
  )
}
