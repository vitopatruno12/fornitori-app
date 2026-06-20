import React, { useEffect, useMemo, useRef, useState } from 'react'
import { fetchSuppliers } from '../services/suppliersService'
import { fetchEntries, createEntry, updateEntry, deleteEntry, deleteEntriesForDay, deleteEntriesForRange, fetchDailySummary, getExportUrl, fetchPrimaNotaLinkOptions, fetchPrimaNotaLocalePacks, fetchPrimaNotaLocalePack, upsertPrimaNotaLocalePack, deletePrimaNotaLocalePack } from '../services/cashService'
import { fetchStaffLocalePack, fetchStaffLocalePacks } from '../services/staffService'
import { fetchAccounts, fetchPaymentMethods, fetchCategories } from '../services/referenceService'
import { fetchCustomers } from '../services/customersService'
import OperatorLinkCard from '../components/OperatorLinkCard.jsx'
import PrimaNotaLocalePicker from '../components/PrimaNotaLocalePicker'
import StaffSectionBackupBar from '../components/StaffSectionBackupBar.jsx'
import {
  formatPrimaNotaBackupLabel,
  getLatestPrimaNotaBackup,
  movementBackupKey,
  savePrimaNotaBackup,
} from '../utils/primaNotaLocalBackup.js'
import { downloadPrimaNotaMovementsPdf, generatePrimaNotaMovementsPdf } from '../utils/primaNotaMovementsPdf.js'
import { getOperatorPrimaNotaPublicUrl, getOperatorStationPublicUrl } from '../utils/operatorMode.ts'
import {
  generateLocaleAccessCode,
  isValidLocaleAccessCode,
  normalizeLocaleAccessCode,
} from '../utils/staffLocaleAccessCode.js'
import {
  getStaffLocaleLinkForActivity,
  resolveStaffLocaleName,
  staffLocaleHint,
  staffLocaleRequiresCode,
} from '../utils/primaNotaStaffLocaleLink.js'
import {
  clearStoredPrimaNotaAccessCode,
  listStoredPrimaNotaAccessSlugs,
  readStoredPrimaNotaAccessCode,
  saveStoredPrimaNotaAccessCode,
} from '../utils/primaNotaLocaleAccess.js'
import {
  DEFAULT_PRIMA_NOTA_ACTIVITY,
  loadPrimaNotaLocales,
  localeLabel,
  normalizePrimaNotaActivity,
  removeCustomLocaleById,
} from '../constants/primaNotaLocales'

const CONTO_NON_FISCALE = 'NON_FISCALE'
const CONTO_POS = 'POS'

export default function PrimaNotaPage({ operatorMode = false }) {
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

  const [locales, setLocales] = useState(() => loadPrimaNotaLocales())
  const [activeActivity, setActiveActivity] = useState(() => {
    try {
      const saved = sessionStorage.getItem('primaNotaActivity')
      const list = loadPrimaNotaLocales()
      if (saved) return normalizePrimaNotaActivity(saved, list)
    } catch {
      // ignore
    }
    return DEFAULT_PRIMA_NOTA_ACTIVITY
  })
  const activeActivityLabel = localeLabel(activeActivity, locales)

  const [suppliers, setSuppliers] = useState([])
  const [entries, setEntries] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [selectedDate, setSelectedDate] = useState(() => todayIso)
  const [movementPeriodFrom, setMovementPeriodFrom] = useState(() => todayIso)
  const [movementPeriodTo, setMovementPeriodTo] = useState(() => todayIso)
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
  const [formFlowTag, setFormFlowTag] = useState('fiscale') // fiscale | non_fiscale | pos
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
  const [deletingRange, setDeletingRange] = useState(false)
  const [highlightEntryId, setHighlightEntryId] = useState(null)
  const [focusEntryMessage, setFocusEntryMessage] = useState('')
  const highlightScrollDoneRef = useRef(null)
  const formAnchorRef = useRef(null)
  const [drawerEntry, setDrawerEntry] = useState(null)
  const [movementSearch, setMovementSearch] = useState('')
  const [movementKind, setMovementKind] = useState('all')
  const [dashboardFilterActive, setDashboardFilterActive] = useState(false)
  const dashboardPreFiltersRef = useRef(null)
  const [backupMeta, setBackupMeta] = useState(() => getLatestPrimaNotaBackup()?.savedAt ?? null)
  const [backupBusy, setBackupBusy] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [localeAccessCode, setLocaleAccessCode] = useState('')
  const [staffLocaleSummaries, setStaffLocaleSummaries] = useState([])
  const [protectedLocaleSummaries, setProtectedLocaleSummaries] = useState([])
  const [unlockedSlugs, setUnlockedSlugs] = useState(() => new Set(listStoredPrimaNotaAccessSlugs()))
  const [unlockBusy, setUnlockBusy] = useState(false)
  const [saveCodeBusy, setSaveCodeBusy] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const protectedSlugs = useMemo(() => {
    const slugs = new Set()
    for (const loc of locales) {
      if (staffLocaleRequiresCode(loc.id, staffLocaleSummaries)) {
        slugs.add(loc.id)
      }
    }
    for (const row of protectedLocaleSummaries) {
      if (row?.requires_access_code && row?.activity_slug) {
        slugs.add(row.activity_slug)
      }
    }
    return [...slugs]
  }, [locales, staffLocaleSummaries, protectedLocaleSummaries])

  const activeStaffLocaleHint = staffLocaleHint(activeActivity, staffLocaleSummaries)
  const activeUsesStaffCode = Boolean(getStaffLocaleLinkForActivity(activeActivity))

  function activeLocaleNeedsCode() {
    return protectedSlugs.includes(activeActivity)
  }

  function hasActiveLocaleAccess() {
    if (!activeLocaleNeedsCode()) return true
    return isValidLocaleAccessCode(resolveActiveAccessCode())
  }

  function resolveActiveAccessCode() {
    const stored = readStoredPrimaNotaAccessCode(activeActivity)
    const typed = normalizeLocaleAccessCode(localeAccessCode)
    if (isValidLocaleAccessCode(typed)) return typed
    if (isValidLocaleAccessCode(stored)) return stored
    return undefined
  }

  async function refreshStaffLocaleSummaries() {
    try {
      const rows = await fetchStaffLocalePacks()
      setStaffLocaleSummaries(Array.isArray(rows) ? rows : [])
    } catch {
      setStaffLocaleSummaries([])
    }
  }

  async function refreshProtectedLocaleSummaries() {
    try {
      const rows = await fetchPrimaNotaLocalePacks()
      setProtectedLocaleSummaries(Array.isArray(rows) ? rows : [])
    } catch {
      setProtectedLocaleSummaries([])
    }
  }

  async function verifyLocaleAccess(activityId, code) {
    const slug = String(activityId || '').trim()
    if (!slug) return { ok: false, needsCode: true }
    const normalized = normalizeLocaleAccessCode(code)
    if (!isValidLocaleAccessCode(normalized)) return { ok: false, needsCode: true }
    const stored = readStoredPrimaNotaAccessCode(slug)
    if (stored && stored === normalized) return { ok: true }

    if (staffLocaleRequiresCode(slug, staffLocaleSummaries)) {
      const staffName = resolveStaffLocaleName(slug, staffLocaleSummaries)
      if (!staffName) return { ok: false, wrongCode: true }
      try {
        await fetchStaffLocalePack(staffName, normalized)
        saveStoredPrimaNotaAccessCode(slug, normalized)
        setUnlockedSlugs((prev) => new Set([...prev, slug]))
        return { ok: true }
      } catch {
        return { ok: false, wrongCode: true }
      }
    }

    const primaNotaProtected = protectedLocaleSummaries.some(
      (row) => row?.activity_slug === slug && row?.requires_access_code,
    )
    if (!primaNotaProtected) return { ok: true }
    try {
      await fetchPrimaNotaLocalePack(slug, normalized)
      saveStoredPrimaNotaAccessCode(slug, normalized)
      setUnlockedSlugs((prev) => new Set([...prev, slug]))
      return { ok: true }
    } catch {
      return { ok: false, wrongCode: true }
    }
  }

  async function handleVerifyAndSelectLocale(activityId, code) {
    setUnlockBusy(true)
    setError('')
    try {
      const access = await verifyLocaleAccess(activityId, code)
      if (!access.ok) {
        if (!access.needsCode) {
          setError('Codice errato: non puoi aprire questo locale.')
        }
        return false
      }
      selectActivity(activityId)
      setLocaleAccessCode(normalizeLocaleAccessCode(code))
      setSuccess(`Locale «${localeLabel(activityId, locales)}» aperto.`)
      return true
    } finally {
      setUnlockBusy(false)
    }
  }

  async function handleDeleteCustomLocale(loc) {
    if (!loc?.id || loc.builtin) return false
    const label = loc.label || loc.id
    let code = ''
    if (protectedSlugs.includes(loc.id)) {
      if (activeActivity === loc.id) {
        code = normalizeLocaleAccessCode(localeAccessCode)
      }
      if (!isValidLocaleAccessCode(code)) {
        code = readStoredPrimaNotaAccessCode(loc.id)
      }
      if (!isValidLocaleAccessCode(code)) {
        setError(`Per eliminare «${label}» inserisci prima il codice a 6 cifre (seleziona il locale e salva/usa il codice).`)
        return false
      }
    }
    if (
      !window.confirm(
        `Eliminare il locale personalizzato «${label}»?\n\nSparisce dall’elenco su questo browser. I movimenti cassa già salvati sul server non vengono cancellati.`,
      )
    ) {
      return false
    }
    setDeleteBusy(true)
    setError('')
    try {
      try {
        await deletePrimaNotaLocalePack(loc.id, code || undefined)
      } catch {
        // nessun pack sul server
      }
      clearStoredPrimaNotaAccessCode(loc.id)
      const next = removeCustomLocaleById(loc.id)
      setLocales(next)
      setUnlockedSlugs((prev) => {
        const s = new Set(prev)
        s.delete(loc.id)
        return s
      })
      await refreshProtectedLocaleSummaries()
      if (activeActivity === loc.id) {
        selectActivity(DEFAULT_PRIMA_NOTA_ACTIVITY)
      }
      setSuccess(`Locale «${label}» eliminato.`)
      return true
    } catch (e) {
      setError(e?.message || 'Impossibile eliminare il locale.')
      return false
    } finally {
      setDeleteBusy(false)
    }
  }

  async function handleSaveLocaleAccessCode() {
    const code = normalizeLocaleAccessCode(localeAccessCode)
    if (!isValidLocaleAccessCode(code)) {
      setError('Inserisci o genera un codice a 6 cifre prima di salvarlo.')
      return
    }
    setSaveCodeBusy(true)
    setError('')
    try {
      const saved = await upsertPrimaNotaLocalePack(activeActivity, activeActivityLabel, code)
      saveStoredPrimaNotaAccessCode(activeActivity, code)
      setUnlockedSlugs((prev) => new Set([...prev, activeActivity]))
      await refreshProtectedLocaleSummaries()
      const staffNote = activeUsesStaffCode && activeStaffLocaleHint
        ? ` Se in Personale «${activeStaffLocaleHint}» c’è un codice, quello ha priorità all’apertura.`
        : ''
      setSuccess(
        `Codice salvato per «${activeActivityLabel}»: ${saved?.access_code || code}. Condividilo con chi apre questo locale.${staffNote}`,
      )
    } catch (e) {
      setError(e?.message || 'Impossibile salvare il codice locale.')
    } finally {
      setSaveCodeBusy(false)
    }
  }

  useEffect(() => {
    loadSuppliers()
    loadPrimaNotaReference()
    void refreshStaffLocaleSummaries()
    void refreshProtectedLocaleSummaries()
  }, [])

  useEffect(() => {
    const stored = readStoredPrimaNotaAccessCode(activeActivity)
    setLocaleAccessCode(stored || '')
  }, [activeActivity])

  useEffect(() => {
    const onDataSynced = () => {
      void loadEntries()
      void loadSummary()
    }
    window.addEventListener('atlas-refresh-data', onDataSynced)
    return () => window.removeEventListener('atlas-refresh-data', onDataSynced)
  })

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
      if (d?.movementKind && ['all', 'entrata', 'uscita', 'fiscale', 'nf', 'pos'].includes(String(d.movementKind))) {
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
        setMovementPeriodFrom(data.date)
        setMovementPeriodTo(data.date)
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
        movementPeriodFrom,
        movementPeriodTo,
      }
      sessionStorage.removeItem('primaNotaDashboardFilter')
      let applied = false
      if (data?.monthKey && /^\d{4}-\d{2}$/.test(data.monthKey)) {
        const firstDay = `${data.monthKey}-01`
        const ms = new Date(`${data.monthKey}-01T12:00:00`)
        const lastDay = formatLocalIsoDate(new Date(ms.getFullYear(), ms.getMonth() + 1, 0))
        setSelectedDate(firstDay)
        setMovementPeriodFrom(firstDay)
        setMovementPeriodTo(lastDay)
        applied = true
      }
      if (data?.movementKind && ['all', 'entrata', 'uscita', 'fiscale', 'nf', 'pos'].includes(String(data.movementKind))) {
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
      if (prev.movementPeriodFrom) setMovementPeriodFrom(prev.movementPeriodFrom)
      if (prev.movementPeriodTo) setMovementPeriodTo(prev.movementPeriodTo)
    } else {
      setMovementKind('all')
      setMovementSearch('')
    }
    setDashboardFilterActive(false)
    setSuccess('Filtri dashboard rimossi')
  }

  function applyMovementPeriodPreset(which) {
    const now = new Date()
    const today = formatLocalIsoDate(now)
    if (which === 'today') {
      setMovementPeriodFrom(today)
      setMovementPeriodTo(today)
    } else if (which === 'month') {
      setMovementPeriodFrom(currentMonthFrom)
      setMovementPeriodTo(currentMonthTo)
    } else if (which === 'week') {
      const d = new Date(now)
      d.setDate(d.getDate() - 6)
      setMovementPeriodFrom(formatLocalIsoDate(d))
      setMovementPeriodTo(today)
    }
  }

  function alignMovementPeriodToSelectedDay() {
    setMovementPeriodFrom(selectedDate)
    setMovementPeriodTo(selectedDate)
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
      setFocusEntryMessage(`Movimento cassa #${id} non è nell’elenco del periodo impostato (dal ${formatDate(movementPeriodFrom)} al ${formatDate(movementPeriodTo)}). Allarga il periodo nella barra in alto o vai al giorno giusto.`)
      return
    }
    setFocusEntryMessage('')
    if (highlightScrollDoneRef.current === id) return
    highlightScrollDoneRef.current = id
    window.setTimeout(() => {
      const el = document.getElementById(`cash-entry-row-${id}`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 200)
  }, [loading, entries, highlightEntryId, movementPeriodFrom, movementPeriodTo])


  useEffect(() => {
    loadSummary()
  }, [selectedDate, activeActivity, unlockedSlugs, localeAccessCode])

  useEffect(() => {
    let cancelled = false
    async function ensureSelectedDayEntries() {
      const from = movementPeriodFrom
      const to = movementPeriodTo
      if (from && to && from <= selectedDate && selectedDate <= to) return
      try {
        const dayEntries = await fetchEntries({
          date_from: selectedDate,
          date_to: selectedDate,
          activity: activeActivity,
          access_code: resolveActiveAccessCode(),
        })
        if (cancelled || !Array.isArray(dayEntries)) return
        setEntries((prev) => {
          const byId = new Map((prev || []).map((e) => [e.id, e]))
          for (const e of dayEntries) byId.set(e.id, e)
          return Array.from(byId.values()).sort((a, b) => {
            const da = String(a.entry_date || '')
            const db = String(b.entry_date || '')
            return da.localeCompare(db) || Number(a.id) - Number(b.id)
          })
        })
      } catch {
        // ignore: il riepilogo usa comunque i totali dal server
      }
    }
    ensureSelectedDayEntries()
    return () => {
      cancelled = true
    }
  }, [selectedDate, activeActivity, movementPeriodFrom, movementPeriodTo])

  useEffect(() => {
    loadEntries()
  }, [movementPeriodFrom, movementPeriodTo, activeActivity, unlockedSlugs, localeAccessCode])

  function selectActivity(activityId) {
    if (activityId === activeActivity) return
    setActiveActivity(activityId)
    try {
      sessionStorage.setItem('primaNotaActivity', activityId)
    } catch {
      // ignore
    }
    handleCancelEdit()
    setDrawerEntry(null)
    setHighlightEntryId(null)
    setOpeningCashInput('')
  }

  async function loadSuppliers() {
    try {
      const data = await fetchSuppliers()
      setSuppliers(Array.isArray(data) ? data : [])
    } catch {
      // noop
    }
  }

  async function loadEntries() {
    if (!hasActiveLocaleAccess()) {
      setEntries([])
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      setError('')
      let from = movementPeriodFrom
      let to = movementPeriodTo
      if (from && to && from > to) {
        const swap = from
        from = to
        to = swap
      }
      const data = await fetchEntries({
        date_from: from || undefined,
        date_to: to || undefined,
        activity: activeActivity,
        access_code: resolveActiveAccessCode(),
      })
      setEntries(data)
    } catch (e) {
      setError(e?.message?.includes('Codice') ? 'Codice locale non valido o mancante.' : 'Errore nel caricamento dei movimenti')
    } finally {
      setLoading(false)
    }
  }

  async function loadSummary() {
    if (!hasActiveLocaleAccess()) {
      setSummary(null)
      return
    }
    try {
      const data = await fetchDailySummary(selectedDate, activeActivity, resolveActiveAccessCode())
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

  function handleAzzeraCassaIniziale() {
    setOpeningCashInput('')
    setSuccess('Cassa iniziale ripristinata (automatica)')
  }

  async function handleEliminaGiornata() {
    if (!window.confirm(`Eliminare tutti i movimenti di ${activeActivityLabel} del ${formatDate(selectedDate)}? Il riepilogo tornerà a zero.`)) return
    try {
      setDeletingDay(true)
      setError('')
      await deleteEntriesForDay(selectedDate, activeActivity, resolveActiveAccessCode())
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

  async function handleEliminaIntervallo() {
    if (!resetRangeFrom || !resetRangeTo) {
      setError('Seleziona data inizio e data fine dell\'intervallo')
      return
    }
    if (resetRangeFrom > resetRangeTo) {
      setError('La data inizio non puo essere successiva alla data fine')
      return
    }
    if (!window.confirm(`Eliminare tutti i movimenti di ${activeActivityLabel} dal ${formatDate(resetRangeFrom)} al ${formatDate(resetRangeTo)}?`)) return
    try {
      setDeletingRange(true)
      setError('')
      await deleteEntriesForRange(resetRangeFrom, resetRangeTo, activeActivity, resolveActiveAccessCode())
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

    const descTrimmed = formDescription.trim()
    if (!descTrimmed) {
      setError('La descrizione operazione è obbligatoria')
      document.getElementById('prima-nota-description')?.focus()
      return
    }

    try {
      setSaving(true)
      const entryDate = formEntryDate || selectedDate
      const payload = {
        entry_date: entryDate.includes('T') ? entryDate : `${entryDate}T12:00:00`,
        type: formType,
        amount: Number(formAmount),
        description: descTrimmed,
        note: formNote.trim() || null,
        conto:
          formFlowTag === 'non_fiscale'
            ? CONTO_NON_FISCALE
            : formFlowTag === 'pos'
              ? CONTO_POS
              : (formConto.trim() || null),
        riferimento_documento: formRifDocumento.trim() || null,
        supplier_id: formSupplierId ? Number(formSupplierId) : null,
        invoice_id: formInvoiceId ? Number(formInvoiceId) : null,
        delivery_id: formDeliveryId ? Number(formDeliveryId) : null,
        customer_id: formCustomerId ? Number(formCustomerId) : null,
        account_id: formAccountId ? Number(formAccountId) : null,
        payment_method_id: formPaymentMethodId ? Number(formPaymentMethodId) : null,
        category_id: formCategoryId ? Number(formCategoryId) : null,
        activity: activeActivity,
      }

      if (editingId) {
        await updateEntry(editingId, payload, resolveActiveAccessCode())
        setSuccess('Movimento aggiornato')
      } else {
        await createEntry(payload, resolveActiveAccessCode())
        setSuccess('Movimento registrato')
      }

      setFormAmount('')
      setFormDescription('')
      setFormNote('')
      setFormConto('')
      setFormFlowTag('fiscale')
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
    setFormFlowTag(entry.conto === CONTO_NON_FISCALE ? 'non_fiscale' : entry.conto === CONTO_POS ? 'pos' : 'fiscale')
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
    setFormFlowTag('fiscale')
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
      await deleteEntry(entry.id, resolveActiveAccessCode())
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
    const url = getExportUrl(exportDateFrom || undefined, exportDateTo || undefined, activeActivity, resolveActiveAccessCode())
    window.open(url, '_blank')
  }

  function normalizedMovementPeriod() {
    let from = movementPeriodFrom
    let to = movementPeriodTo
    if (from && to && from > to) {
      const swap = from
      from = to
      to = swap
    }
    return { from, to }
  }

  function bumpBackupMeta() {
    setBackupMeta(getLatestPrimaNotaBackup()?.savedAt ?? null)
  }

  function serializeEntryForBackup(entry) {
    return {
      entry_date: entry.entry_date,
      type: entry.type,
      amount: Number(entry.amount),
      description: entry.description || '',
      note: entry.note || null,
      conto: entry.conto || null,
      riferimento_documento: entry.riferimento_documento || null,
      supplier_id: entry.supplier_id ?? null,
      invoice_id: entry.invoice_id ?? null,
      delivery_id: entry.delivery_id ?? null,
      customer_id: entry.customer_id ?? null,
      account_id: entry.account_id ?? null,
      payment_method_id: entry.payment_method_id ?? null,
      category_id: entry.category_id ?? null,
      activity: entry.activity || activeActivity,
    }
  }

  async function handleBackupMovements() {
    setBackupBusy(true)
    setError('')
    try {
      const { from, to } = normalizedMovementPeriod()
      let list = Array.isArray(entries) ? entries : []
      if (!list.length) {
        list = await fetchEntries({
          date_from: from || undefined,
          date_to: to || undefined,
          activity: activeActivity,
          access_code: resolveActiveAccessCode(),
        })
        list = Array.isArray(list) ? list : []
      }
      if (!list.length) {
        setError(
          `Nessun movimento nel periodo ${from ? formatDate(from) : '—'} → ${to ? formatDate(to) : '—'}. Carica l'elenco prima del backup.`,
        )
        return
      }
      savePrimaNotaBackup({
        activity: activeActivity,
        activityLabel: activeActivityLabel,
        periodFrom: from || null,
        periodTo: to || null,
        openingCashInput,
        entries: list.map(serializeEntryForBackup),
      })
      bumpBackupMeta()
      setSuccess(
        `Backup movimenti creato (${list.length} voci, ${activeActivityLabel}, solo su questo browser).`,
      )
    } catch (err) {
      setError(err?.message || 'Backup movimenti non riuscito')
    } finally {
      setBackupBusy(false)
    }
  }

  async function handleRestoreMovementsBackup() {
    const latest = getLatestPrimaNotaBackup()
    const rows = latest?.payload?.entries
    if (!rows?.length) {
      setError('Nessun backup movimenti da ripristinare.')
      return
    }
    const when = formatPrimaNotaBackupLabel(latest.savedAt) || 'backup'
    const from = latest.payload.periodFrom || movementPeriodFrom
    const to = latest.payload.periodTo || movementPeriodTo
    const label = latest.payload.activityLabel || activeActivityLabel
    if (
      !window.confirm(
        `Ripristinare ${rows.length} movimenti dal backup del ${when}?\n\nLocale backup: ${label}\nPeriodo: ${formatDate(from)} → ${formatDate(to)}.\nVengono ricreati solo i movimenti mancanti (duplicati saltati).`,
      )
    ) {
      return
    }
    setBackupBusy(true)
    setError('')
    try {
      const activity = latest.payload.activity || activeActivity
      const existing = await fetchEntries({
        date_from: from || undefined,
        date_to: to || undefined,
        activity,
        access_code: resolveActiveAccessCode(),
      })
      const existingList = Array.isArray(existing) ? existing : []
      const existingKeys = new Set(existingList.map((e) => movementBackupKey(e)))
      let created = 0
      let skipped = 0
      for (const row of rows) {
        const key = movementBackupKey(row)
        if (existingKeys.has(key)) {
          skipped += 1
          continue
        }
        const entryDate = String(row.entry_date || '').slice(0, 10)
        if (!entryDate) {
          skipped += 1
          continue
        }
        await createEntry({
          entry_date: row.entry_date?.includes('T') ? row.entry_date : `${entryDate}T12:00:00`,
          type: row.type,
          amount: Number(row.amount),
          description: String(row.description || '').trim() || 'Movimento ripristinato',
          note: row.note,
          conto: row.conto,
          riferimento_documento: row.riferimento_documento,
          supplier_id: row.supplier_id,
          invoice_id: row.invoice_id,
          delivery_id: row.delivery_id,
          customer_id: row.customer_id,
          account_id: row.account_id,
          payment_method_id: row.payment_method_id,
          category_id: row.category_id,
          activity,
        }, resolveActiveAccessCode())
        created += 1
        existingKeys.add(key)
      }
      if (latest.payload.openingCashInput != null && latest.payload.openingCashInput !== '') {
        setOpeningCashInput(String(latest.payload.openingCashInput))
      }
      await loadEntries()
      await loadSummary()
      bumpBackupMeta()
      setSuccess(
        created > 0
          ? `Ripristinati ${created} movimenti${skipped ? ` (${skipped} già presenti)` : ''}.`
          : `Nessun nuovo movimento: tutti già presenti (${skipped} saltati).`,
      )
    } catch (err) {
      setError(err?.message || 'Ripristino backup movimenti non riuscito')
      await loadEntries()
      await loadSummary()
    } finally {
      setBackupBusy(false)
    }
  }

  function handlePrintMovementsPdf() {
    if (!filteredMovementRows.length) {
      setError('Nessun movimento da stampare nel periodo/filtri correnti.')
      return
    }
    setPdfBusy(true)
    setError('')
    try {
      const blob = generatePrimaNotaMovementsPdf({
        activityLabel: activeActivityLabel,
        periodLabel: movementsSectionHeading.replace(/^Movimenti /, ''),
        rows: filteredMovementRows,
        totals: movementPeriodTotals,
      })
      const { from, to } = normalizedMovementPeriod()
      const safeLocale = String(activeActivity || 'locale').replace(/[^\w.-]+/g, '_')
      const range = from && to ? `${from}_${to}` : selectedDate
      downloadPrimaNotaMovementsPdf(blob, `prima-nota-movimenti-${safeLocale}-${range}.pdf`)
      setSuccess('PDF movimenti generato')
    } catch (err) {
      setError(err?.message || 'Errore nella generazione del PDF')
    } finally {
      setPdfBusy(false)
    }
  }

  function formatDate(value) {
    if (!value) return ''
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return String(value)
    return d.toLocaleDateString('it-IT')
  }

  const movementsSectionHeading = useMemo(() => {
    let from = movementPeriodFrom
    let to = movementPeriodTo
    if (from && to && from > to) {
      const s = from
      from = to
      to = s
    }
    if (!from && !to) return `Movimenti del ${formatDate(selectedDate)}`
    if (from === to) return `Movimenti del ${formatDate(from)}`
    return `Movimenti dal ${formatDate(from)} al ${formatDate(to)}`
  }, [movementPeriodFrom, movementPeriodTo, selectedDate])

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

  function formatAmountClean(value) {
    const n = Number(value || 0)
    if (!Number.isFinite(n) || Math.abs(n) < 0.005) return ''
    return formatAmount(n)
  }

  function isNonFiscale(entry) {
    return entry?.conto === CONTO_NON_FISCALE
  }

  function isPos(entry) {
    return entry?.conto === CONTO_POS
  }

  function isExtraCassa(entry) {
    return isPos(entry)
  }

  function buildLedgerFields(entry) {
    const amount = Number(entry.amount || 0)
    const nonFiscaleTag = entry.conto === CONTO_NON_FISCALE
    const posTag = entry.conto === CONTO_POS
    const isEntrata = entry.type === 'entrata'
    const entrata = !posTag && isEntrata ? amount : 0
    const uscita = !posTag && entry.type === 'uscita' ? amount : 0
    const nonFiscale = nonFiscaleTag ? (isEntrata ? amount : -amount) : 0
    const pos = posTag ? (isEntrata ? amount : -amount) : 0
    const totaleMovimento = !nonFiscaleTag && !posTag ? entrata - uscita : 0
    const affectsSaldo = !posTag
    const cashDelta = affectsSaldo ? entrata - uscita : 0
    const incasso = totaleMovimento + nonFiscale + pos
    return {
      entrata,
      uscita,
      nonFiscale,
      pos,
      totaleMovimento,
      affectsSaldo,
      cashDelta,
      incasso,
    }
  }

  function mapEntriesWithLedger(entryList, openingDefault) {
    const cassaIniziale = openingCashInput === '' ? openingDefault : Number(openingCashInput || 0)
    let running = cassaIniziale
    const rows = entryList.map((entry) => {
      const ledger = buildLedgerFields(entry)
      if (ledger.affectsSaldo) running += ledger.cashDelta
      return {
        ...entry,
        ...ledger,
        cassaMattina: cassaIniziale,
        cassaSera: running,
      }
    })
    return { rows, cassaIniziale, cassaFinale: running }
  }

  const rowsWithLedger = React.useMemo(() => {
    if (!entries || entries.length === 0) return { rows: [], cassaIniziale: 0, cassaFinale: 0 }

    const firstCash = entries.find((e) => !isExtraCassa(e))
    const defaultOpening = firstCash
      ? Number(firstCash.saldo_progressivo) - (firstCash.type === 'entrata' ? Number(firstCash.amount) : -Number(firstCash.amount))
      : Number(entries[0].saldo_progressivo || 0)
    return mapEntriesWithLedger(entries, defaultOpening)
  }, [entries, openingCashInput])

  const entriesForSelectedDay = useMemo(() => {
    if (!entries?.length) return []
    const day = selectedDate
    return entries.filter((e) => (e.entry_date ? String(e.entry_date).slice(0, 10) : '') === day)
  }, [entries, selectedDate])

  const rowsWithLedgerSelectedDay = React.useMemo(() => {
    if (!entriesForSelectedDay || entriesForSelectedDay.length === 0) {
      return { rows: [], cassaIniziale: 0, cassaFinale: 0 }
    }

    const firstCash = entriesForSelectedDay.find((e) => !isExtraCassa(e))
    const defaultOpening = firstCash
      ? Number(firstCash.saldo_progressivo) - (firstCash.type === 'entrata' ? Number(firstCash.amount) : -Number(firstCash.amount))
      : Number(entriesForSelectedDay[0].saldo_progressivo || 0)
    return mapEntriesWithLedger(entriesForSelectedDay, defaultOpening)
  }, [entriesForSelectedDay, openingCashInput])

  const filteredMovementRows = useMemo(() => {
    const q = movementSearch.trim().toLowerCase()
    return rowsWithLedger.rows.filter((entry) => {
      if (movementKind === 'entrata' && (isExtraCassa(entry) || entry.type !== 'entrata')) return false
      if (movementKind === 'uscita' && (isExtraCassa(entry) || entry.type !== 'uscita')) return false
      if (movementKind === 'fiscale' && (isNonFiscale(entry) || isPos(entry))) return false
      if (movementKind === 'nf' && !isNonFiscale(entry)) return false
      if (movementKind === 'pos' && !isPos(entry)) return false
      if (!q) return true
      const blob = [entry.description, entry.note, entry.riferimento_documento].filter(Boolean).join(' ').toLowerCase()
      return blob.includes(q)
    })
  }, [rowsWithLedger.rows, movementSearch, movementKind])

  function sumMovementRows(rows) {
    return (rows || []).reduce(
      (acc, entry) => ({
        entrata: acc.entrata + Number(entry.entrata || 0),
        uscita: acc.uscita + Number(entry.uscita || 0),
        fiscale: acc.fiscale + (entry.affectsSaldo ? Number(entry.totaleMovimento || 0) : 0),
        nonFiscale: acc.nonFiscale + Number(entry.nonFiscale || 0),
        pos: acc.pos + Number(entry.pos || 0),
        incasso: acc.incasso + Number(entry.incasso || 0),
        count: acc.count + 1,
      }),
      { entrata: 0, uscita: 0, fiscale: 0, nonFiscale: 0, pos: 0, incasso: 0, count: 0 },
    )
  }

  const movementPeriodTotals = useMemo(
    () => sumMovementRows(filteredMovementRows),
    [filteredMovementRows],
  )

  const movementPeriodTotalsAll = useMemo(
    () => sumMovementRows(rowsWithLedger.rows),
    [rowsWithLedger.rows],
  )

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

  const cassaContantiGiornoComputed = React.useMemo(() => {
    return entriesForSelectedDay.reduce((acc, e) => {
      if (e.conto === CONTO_POS) return acc
      const delta = e.type === 'entrata' ? Number(e.amount || 0) : -Number(e.amount || 0)
      return acc + delta
    }, 0)
  }, [entriesForSelectedDay])

  const entrateCassaGiornoComputed = React.useMemo(() => {
    return entriesForSelectedDay.reduce((acc, e) => {
      if (e.conto === CONTO_POS || e.type !== 'entrata') return acc
      return acc + Number(e.amount || 0)
    }, 0)
  }, [entriesForSelectedDay])

  const usciteCassaGiornoComputed = React.useMemo(() => {
    return entriesForSelectedDay.reduce((acc, e) => {
      if (e.conto === CONTO_POS || e.type !== 'uscita') return acc
      return acc + Number(e.amount || 0)
    }, 0)
  }, [entriesForSelectedDay])

  const nonFiscaleGiornoComputed = React.useMemo(() => {
    return entriesForSelectedDay.reduce((acc, e) => {
      if (e.conto !== CONTO_NON_FISCALE) return acc
      const delta = e.type === 'entrata' ? Number(e.amount || 0) : -Number(e.amount || 0)
      return acc + delta
    }, 0)
  }, [entriesForSelectedDay])

  const posGiornoComputed = React.useMemo(() => {
    return entriesForSelectedDay.reduce((acc, e) => {
      if (e.conto !== CONTO_POS) return acc
      const delta = e.type === 'entrata' ? Number(e.amount || 0) : -Number(e.amount || 0)
      return acc + delta
    }, 0)
  }, [entriesForSelectedDay])

  const fiscaleGiornoComputed = React.useMemo(() => {
    return entriesForSelectedDay.reduce((acc, e) => {
      if (e.conto === CONTO_NON_FISCALE || e.conto === CONTO_POS) return acc
      const delta = e.type === 'entrata' ? Number(e.amount || 0) : -Number(e.amount || 0)
      return acc + delta
    }, 0)
  }, [entriesForSelectedDay])

  const nonFiscaleGiorno = summary?.totale_non_fiscale != null ? Number(summary.totale_non_fiscale) : nonFiscaleGiornoComputed
  const posGiorno = summary?.totale_pos != null ? Number(summary.totale_pos) : posGiornoComputed
  const fiscaleGiorno = summary?.totale_fiscale != null ? Number(summary.totale_fiscale) : fiscaleGiornoComputed
  const totaleVenditaGiorno = summary?.totale_vendita != null
    ? Number(summary.totale_vendita)
    : Number(fiscaleGiorno || 0) + Number(nonFiscaleGiorno || 0) + Number(posGiorno || 0)
  const cassaFinaleRiepilogo = Number(totaleVenditaGiorno || 0)
  const needsLocaleUnlock = activeLocaleNeedsCode() && !hasActiveLocaleAccess()

  const totaleEntrateGiorno = summary?.totale_entrate != null ? Number(summary.totale_entrate) : entrateCassaGiornoComputed
  const totaleUsciteGiorno = summary?.totale_uscite != null ? Number(summary.totale_uscite) : usciteCassaGiornoComputed
  const saldoGiornalieroFiscale = summary?.saldo_giornaliero != null ? Number(summary.saldo_giornaliero) : cassaContantiGiornoComputed

  return (
    <div>
      <section className="staff-page-hero">
        <h1 className="page-header staff-page-title">{operatorMode ? 'Prima Nota' : 'Prima Nota di Cassa'}</h1>
        <p className="staff-page-lead">
          {operatorMode ? (
            <>
              Registra entrate e uscite per il locale scelto in <strong>Locali prima nota</strong>. Stessi dati e salvataggio del
              gestionale ATLAS.
            </>
          ) : (
            <>
              Registro separato per locale: <strong>{activeActivityLabel}</strong>.
              Riepilogo sulla giornata selezionata; l’elenco movimenti può essere filtrato per intervallo di date insieme alla ricerca testuale.
            </>
          )}
        </p>
      </section>

      {!operatorMode && (
        <OperatorLinkCard
          title="Link operatore"
          description="Condividi con le postazioni di lavoro: il link unificato include Panoramica, Personale, Ordini e Prima Nota; oppure solo la cassa con il link dedicato."
          links={[
            { label: 'Postazione operativa (Panoramica + Personale + Ordini + Prima Nota)', url: getOperatorStationPublicUrl() },
            { label: 'Solo Prima Nota', url: getOperatorPrimaNotaPublicUrl() },
          ]}
        />
      )}

      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <PrimaNotaLocalePicker
        locales={locales}
        activeActivity={activeActivity}
        onSelect={selectActivity}
        onLocalesChange={setLocales}
        onNotify={(msg) => setSuccess(msg)}
        operatorMode={operatorMode}
        localeAccessCode={localeAccessCode}
        onLocaleAccessCodeChange={setLocaleAccessCode}
        onVerifyAndSelectLocale={handleVerifyAndSelectLocale}
        onSaveLocaleAccessCode={handleSaveLocaleAccessCode}
        onDeleteCustomLocale={handleDeleteCustomLocale}
        protectedSlugs={protectedSlugs}
        staffLocaleHintFor={(id) => staffLocaleHint(id, staffLocaleSummaries)}
        activeUsesStaffCode={activeUsesStaffCode}
        activeStaffLocaleHint={activeStaffLocaleHint}
        unlockBusy={unlockBusy}
        saveCodeBusy={saveCodeBusy}
        deleteBusy={deleteBusy}
        autoPromptLocaleId={needsLocaleUnlock ? activeActivity : ''}
      />

      {needsLocaleUnlock ? (
        <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
          Il registro di <strong>{activeActivityLabel}</strong> è protetto: seleziona il locale e inserisci il codice a 6
          cifre per continuare.
        </div>
      ) : null}

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
        <div className="form-group" style={{ minWidth: 220 }}>
          <label>Periodo elenco movimenti</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
            <input
              type="date"
              className="form-control"
              value={movementPeriodFrom}
              onChange={e => setMovementPeriodFrom(e.target.value)}
              aria-label="Data inizio periodo movimenti"
              style={{ maxWidth: 150 }}
            />
            <span style={{ color: 'var(--text-muted)' }}>–</span>
            <input
              type="date"
              className="form-control"
              value={movementPeriodTo}
              onChange={e => setMovementPeriodTo(e.target.value)}
              aria-label="Data fine periodo movimenti"
              style={{ maxWidth: 150 }}
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => applyMovementPeriodPreset('today')} title="Solo oggi">
              Oggi
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => applyMovementPeriodPreset('week')} title="Ultimi 7 giorni">
              7 gg
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => applyMovementPeriodPreset('month')} title="Mese corrente">
              Mese
            </button>
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={alignMovementPeriodToSelectedDay} title="Imposta periodo = giornata riepilogo">
              = giornata
            </button>
          </div>
        </div>
        <div className="form-group" style={{ flex: '1 1 200px', minWidth: 160 }}>
          <label>Cerca movimento</label>
          <input
            type="search"
            className="form-control"
            value={movementSearch}
            onChange={e => setMovementSearch(e.target.value)}
            placeholder="Descrizione, note, riferimento (nell’elenco del periodo)"
            aria-label="Filtra movimenti"
          />
        </div>
        <div className="form-group">
          <label>Tipo</label>
          <select className="form-control" value={movementKind} onChange={e => setMovementKind(e.target.value)} style={{ minWidth: 130 }}>
            <option value="all">Tutti</option>
            <option value="fiscale">Fiscale</option>
            <option value="entrata">Solo entrate</option>
            <option value="uscita">Solo uscite</option>
            <option value="nf">Non fiscale</option>
            <option value="pos">POS</option>
          </select>
        </div>
        <div className="form-group">
          <button type="button" className="btn btn-secondary" onClick={refreshRiepilogo}>
            Aggiorna
          </button>
        </div>
        {!operatorMode && dashboardFilterActive && (
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
              <label>Tipologia voce</label>
              <div className="btn-group" style={{ marginTop: 0 }}>
                <button
                  type="button"
                  className={formFlowTag === 'fiscale' ? 'btn btn-primary' : 'btn btn-secondary'}
                  onClick={() => setFormFlowTag('fiscale')}
                  title="Movimento fiscale: entra nei conteggi di cassa e nel riepilogo giornaliero."
                >
                  Fiscale
                </button>
                <button
                  type="button"
                  className={formFlowTag === 'non_fiscale' ? 'btn btn-outline-danger' : 'btn btn-secondary'}
                  onClick={() => setFormFlowTag('non_fiscale')}
                  title="Movimento NON fiscale: compare in cassa entrata/uscita e nel riepilogo vendite (escluso dal totale fiscale)."
                >
                  Non fiscale
                </button>
                <button
                  type="button"
                  className={formFlowTag === 'pos' ? 'btn btn-vino' : 'btn btn-secondary'}
                  onClick={() => setFormFlowTag('pos')}
                  title="Flusso POS/Bancomat: registrato nelle vendite ma escluso dalla cassa fisica."
                >
                  POS
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
              <label htmlFor="prima-nota-description">Descrizione operazione (obbligatorio)</label>
              <input
                id="prima-nota-description"
                className="form-control"
                value={formDescription}
                onChange={e => setFormDescription(e.target.value)}
                placeholder="Perché hai pagato o ricevuto questa somma"
                required
                aria-required="true"
                autoComplete="off"
              />
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
              <input
                className="form-control"
                value={formConto}
                onChange={e => setFormConto(e.target.value)}
                placeholder="Es. Cassa, Banca… (alternativa al conto anagrafico sotto)"
                disabled={formFlowTag !== 'fiscale'}
              />
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
        <h2 className="page-subheader" style={{ marginTop: 0 }}>{movementsSectionHeading}</h2>
        <StaffSectionBackupBar
          sectionTitle="movimenti"
          lastSavedAt={backupMeta}
          formatBackupLabel={formatPrimaNotaBackupLabel}
          onBackup={handleBackupMovements}
          onRestore={handleRestoreMovementsBackup}
          disabled={loading || saving || backupBusy || pdfBusy || deletingDay || deletingRange}
          busy={backupBusy}
        />
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
            marginBottom: '0.75rem',
          }}
        >
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: 0, flex: '1 1 200px' }}>
            Clicca una riga per il dettaglio. Periodo e ricerca testuale sono nella barra in alto.
          </p>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={loading || pdfBusy || filteredMovementRows.length === 0}
            onClick={handlePrintMovementsPdf}
            title="Scarica PDF dell'elenco movimenti visibile (periodo e filtri correnti)"
          >
            {pdfBusy ? 'Generazione…' : 'Stampa PDF'}
          </button>
        </div>
        {focusEntryMessage && (
          <div className="alert alert-danger" style={{ marginBottom: '0.75rem' }}>{focusEntryMessage}</div>
        )}
        {loading && <p className="loading">Caricamento...</p>}
        {!loading && !error && filteredMovementRows.length > 0 && (
          <div className="pn-movement-totals" aria-label="Totali movimenti nel periodo">
            <span className="pn-movement-totals-label">
              Totali periodo ({movementPeriodTotals.count} movimenti)
            </span>
            <span className="pn-movement-totals-item">
              Fiscale: <strong>€ {formatAmount(movementPeriodTotals.fiscale)}</strong>
            </span>
            <span className="pn-movement-totals-item pn-movement-totals-item--nf">
              Non fiscale: <strong>€ {formatAmount(movementPeriodTotals.nonFiscale)}</strong>
            </span>
            <span className="pn-movement-totals-item">
              POS: <strong>€ {formatAmount(movementPeriodTotals.pos)}</strong>
            </span>
            <span className="pn-movement-totals-item">
              Incasso: <strong>€ {formatAmount(movementPeriodTotals.incasso)}</strong>
            </span>
          </div>
        )}
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
                  <th className="text-end">Fiscale</th>
                  <th className="text-end">Non fiscale</th>
                  <th className="text-end">POS</th>
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
                    <td className="text-end amount">{entry.affectsSaldo ? `€ ${formatAmount(entry.totaleMovimento)}` : '—'}</td>
                    <td className="text-end amount">{entry.nonFiscale !== 0 ? `€ ${formatAmount(entry.nonFiscale)}` : '—'}</td>
                    <td className="text-end amount">{entry.pos !== 0 ? `€ ${formatAmount(entry.pos)}` : '—'}</td>
                    <td
                      className="text-end pn-amount-cell"
                      style={{
                        color: isPos(entry) ? 'var(--text-muted)' : entry.type === 'entrata' ? 'var(--success)' : 'var(--danger)',
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
                    <td colSpan={10} className="empty-state">
                      {rowsWithLedger.rows.length === 0 ? 'Nessun movimento nel periodo selezionato.' : 'Nessun movimento corrisponde ai filtri.'}
                    </td>
                  </tr>
                )}
              </tbody>
              {filteredMovementRows.length > 0 && (
                <tfoot>
                  <tr className="pn-table-totals-row">
                    <td colSpan={3}>
                      <strong>Totali periodo</strong>
                      <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: '0.35rem' }}>
                        ({movementPeriodTotals.count} mov.)
                      </span>
                    </td>
                    <td className="text-end amount">€ {formatAmount(movementPeriodTotals.entrata)}</td>
                    <td className="text-end amount">€ {formatAmount(movementPeriodTotals.uscita)}</td>
                    <td className="text-end amount">€ {formatAmount(movementPeriodTotals.fiscale)}</td>
                    <td className="text-end amount pn-table-totals-nf">€ {formatAmount(movementPeriodTotals.nonFiscale)}</td>
                    <td className="text-end amount">€ {formatAmount(movementPeriodTotals.pos)}</td>
                    <td className="text-end amount pn-amount-cell">€ {formatAmount(movementPeriodTotals.incasso)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
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
                    <th>Fiscale</th>
                    <th>POS</th>
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
                      <td><input className="excel-cell" value={`${entry.description || ''}${isNonFiscale(entry) ? ' [Non fiscale]' : isPos(entry) ? ' [POS]' : ''}`} readOnly /></td>
                      <td><input className="excel-cell excel-cell-num" value={formatAmount(entry.entrata)} readOnly /></td>
                      <td><input className="excel-cell excel-cell-num" value={formatAmount(entry.uscita)} readOnly /></td>
                      <td><input className="excel-cell excel-cell-num" value={formatAmount(entry.totaleMovimento)} readOnly /></td>
                      <td><input className="excel-cell excel-cell-num" value={formatAmountClean(entry.nonFiscale) || formatAmount(entry.nonFiscale)} readOnly /></td>
                      <td><input className="excel-cell excel-cell-num" value={formatAmountClean(entry.affectsSaldo ? entry.totaleMovimento : 0)} readOnly /></td>
                      <td><input className="excel-cell excel-cell-num" value={formatAmountClean(entry.pos)} readOnly /></td>
                      <td><input className="excel-cell excel-cell-num" value={formatAmount(entry.cassaMattina)} readOnly /></td>
                      <td><input className="excel-cell excel-cell-num" value={formatAmount(entry.cassaSera)} readOnly /></td>
                      <td><input className="excel-cell" value={entry.note || ''} readOnly /></td>
                    </tr>
                  ))}
                  <tr className="pn-table-totals-row">
                    <td colSpan={2}><strong>Totali periodo</strong></td>
                    <td><input className="excel-cell excel-cell-num" value={formatAmount(movementPeriodTotalsAll.entrata)} readOnly /></td>
                    <td><input className="excel-cell excel-cell-num" value={formatAmount(movementPeriodTotalsAll.uscita)} readOnly /></td>
                    <td><input className="excel-cell excel-cell-num" value={formatAmount(movementPeriodTotalsAll.fiscale)} readOnly /></td>
                    <td><input className="excel-cell excel-cell-num pn-table-totals-nf" value={formatAmount(movementPeriodTotalsAll.nonFiscale)} readOnly /></td>
                    <td><input className="excel-cell excel-cell-num" value={formatAmount(movementPeriodTotalsAll.fiscale)} readOnly /></td>
                    <td><input className="excel-cell excel-cell-num" value={formatAmount(movementPeriodTotalsAll.pos)} readOnly /></td>
                    <td colSpan={3} />
                  </tr>
                </tbody>
              </table>
            </div>
          </details>
        )}
      </section>

      <section className="card">
        <h2 className="page-subheader" style={{ marginTop: 0 }}>Riepilogo giornaliero</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '0.75rem' }}>
          Riferito al giorno <strong>{formatDate(selectedDate)}</strong>. I totali «(giorno)» includono fiscale, non fiscale e POS calcolati dal server per quel giorno. Il saldo cassa usa movimenti fiscali e non fiscali (escluso POS).
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
          {!operatorMode && (
          <button
            type="button"
            className="btn btn-outline-danger"
            onClick={handleEliminaGiornata}
            disabled={deletingDay}
            title="Elimina tutti i movimenti della data selezionata nel calendario. Aggiorna il saldo giornaliero."
          >
            {deletingDay ? 'Eliminazione...' : 'Elimina tutti i movimenti del giorno'}
          </button>
          )}
        </div>
        {!operatorMode && (
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
        )}

        <div className="prima-nota-riepilogo-vendite" style={{ marginTop: '1rem' }}>
          <h3 className="prima-nota-riepilogo-vendite-title">Vendite del giorno — {activeActivityLabel}</h3>
          <p className="prima-nota-riepilogo-vendite-hint">
            Fiscale, non fiscale e POS per il <strong>{formatDate(selectedDate)}</strong>. Il non fiscale entra in cassa entrata/uscita e nel totale vendita.
          </p>
          <div className="table-wrap">
            <table className="app-table prima-nota-riepilogo-vendite-table">
              <tbody>
                <tr>
                  <td><strong>Totale fiscale</strong></td>
                  <td className="text-end amount">€ {formatAmount(fiscaleGiorno)}</td>
                </tr>
                <tr className="prima-nota-riepilogo-row-nf">
                  <td>
                    <strong>Totale non fiscale</strong>
                    <span className="badge-pn badge-pn--nf" style={{ marginLeft: '0.45rem' }}>Non fiscale</span>
                  </td>
                  <td className="text-end amount prima-nota-riepilogo-nf-value">€ {formatAmount(nonFiscaleGiorno)}</td>
                </tr>
                <tr>
                  <td><strong>Totale POS</strong></td>
                  <td className="text-end amount">€ {formatAmount(posGiorno)}</td>
                </tr>
                <tr className="prima-nota-riepilogo-row-totale">
                  <td><strong>Totale vendita (Fiscale + Non fiscale + POS)</strong></td>
                  <td className="text-end amount">€ {formatAmount(totaleVenditaGiorno)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="table-wrap" style={{ marginTop: '1rem' }}>
          <table className="app-table">
            <tbody>
              <tr>
                <td><strong>Totale entrate cassa</strong></td>
                <td className="text-end amount" style={{ color: 'var(--success)' }}>€ {formatAmount(totaleEntrateGiorno)}</td>
              </tr>
              <tr>
                <td><strong>Totale uscite cassa</strong></td>
                <td className="text-end amount" style={{ color: 'var(--danger)' }}>€ {formatAmount(totaleUsciteGiorno)}</td>
              </tr>
              <tr>
                <td><strong>Saldo giornaliero cassa</strong></td>
                <td className="text-end amount">€ {formatAmount(saldoGiornalieroFiscale)}</td>
              </tr>
              <tr>
                <td><strong>Saldo attuale cassa</strong></td>
                <td className="text-end amount">€ {formatAmount(rowsWithLedgerSelectedDay.cassaIniziale)}</td>
              </tr>
              <tr>
                <td><strong>Cassa finale (schema vendite)</strong></td>
                <td className="text-end amount" style={{ fontWeight: 700 }}>€ {formatAmount(cassaFinaleRiepilogo)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {!summary && (
          <p className="prima-nota-riepilogo-warn" role="status">
            Riepilogo cassa dal server non disponibile: i totali vendite sopra usano i movimenti caricati per il giorno selezionato.
          </p>
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
                ) : isPos(drawerEntry) ? (
                  <span className="badge-pn badge-pn--nf">POS</span>
                ) : drawerEntry.type === 'entrata' ? (
                  <span className="badge-pn badge-pn--in">Entrata</span>
                ) : (
                  <span className="badge-pn badge-pn--out">Uscita</span>
                )}
              </p>
              <p className="pn-amount-cell" style={{ fontSize: '1.35rem', margin: '0.5rem 0 1rem', color: isPos(drawerEntry) ? 'var(--text-muted)' : drawerEntry.type === 'entrata' ? 'var(--success)' : 'var(--danger)' }}>
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
