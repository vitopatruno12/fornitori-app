import React, { useEffect, useMemo, useRef, useState } from 'react'
import { fetchSuppliers, createSupplier, updateSupplier, deleteSupplier, deleteAllSuppliers, parseSupplierInvoiceFile } from '../services/suppliersService'
import { fetchInvoices } from '../services/invoicesService'
import { fetchDeliveries } from '../services/deliveriesService'
import { fetchPriceList } from '../services/priceListService'
import { checkAiAnomalies, suggestSupplierFields } from '../services/aiService'
import GeminiVoiceAssistant from '../components/GeminiVoiceAssistant.jsx'
import { loadPrimaNotaLocales, localeLabel } from '../constants/primaNotaLocales'
import {
  formatSupplierLocales,
  parseSupplierLocales,
  serializeSupplierLocales,
} from '../utils/supplierLocales.js'
import {
  enrichSupplierFields,
  mergeSupplierFields,
  parseSupplierVoiceLocal,
} from '../utils/supplierVoiceParse.js'
import {
  SUPPLIER_WORKBOOK_COLUMNS,
  SUPPLIER_WORKBOOK_TITLE,
  supplierWorkbookCellValue,
  supplierWorkbookTotals,
  supplierWorkbookTotalsLabel,
} from '../utils/suppliersWorkbook.js'
import SupplierMultiContactEditor from '../components/SupplierMultiContactEditor.jsx'
import {
  buildSupplierMultiContactPayload,
  emptyContactItem,
  mergeContactValue,
  parseContactListFromSupplier,
  parseMerchandiseCategoriesFromSupplier,
} from '../utils/supplierContactLists.js'

function formatEuro(n) {
  if (n == null || Number.isNaN(Number(n))) return '–'
  return `€ ${Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDateTime(value) {
  if (!value) return '–'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '–'
  return d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

async function copyToClipboard(text) {
  const t = String(text || '')
  if (!t) return
  try {
    await navigator.clipboard.writeText(t)
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = t
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    } catch {
      window.alert(`Copia manualmente:\n${t}`)
    }
  }
}

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [vatNumber, setVatNumber] = useState('')
  const [fiscalCode, setFiscalCode] = useState('')
  const [phones, setPhones] = useState([emptyContactItem()])
  const [emails, setEmails] = useState([emptyContactItem()])
  const [cities, setCities] = useState([emptyContactItem()])
  const [merchandiseCategories, setMerchandiseCategories] = useState([])
  const [contactPerson, setContactPerson] = useState('')
  const [iban, setIban] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [notes, setNotes] = useState('')
  const [priceListLabel, setPriceListLabel] = useState('')
  const [supplierLocales, setSupplierLocales] = useState([])
  const [localePick, setLocalePick] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [isExpired, setIsExpired] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [aiError, setAiError] = useState('')
  const supplierListSectionRef = React.useRef(null)
  const supplierFormSectionRef = React.useRef(null)
  const [deletingAll, setDeletingAll] = useState(false)
  const [search, setSearch] = useState('')
  const [drawerSupplier, setDrawerSupplier] = useState(null)
  const [drawerTab, setDrawerTab] = useState('doc')
  const [drawerInvoices, setDrawerInvoices] = useState([])
  const [drawerDeliveries, setDrawerDeliveries] = useState([])
  const [drawerPrices, setDrawerPrices] = useState([])
  const [drawerLoading, setDrawerLoading] = useState(false)
  const [aiSupplierText, setAiSupplierText] = useState('')
  const [aiSupplierLoading, setAiSupplierLoading] = useState(false)
  const [aiSupplierSummary, setAiSupplierSummary] = useState('')
  const [aiMissing, setAiMissing] = useState([])
  const [aiSupplierAnomalies, setAiSupplierAnomalies] = useState([])
  const [ibanPanelOpen, setIbanPanelOpen] = useState(false)
  const [invoiceUploadBusy, setInvoiceUploadBusy] = useState(false)
  const invoiceUploadRef = useRef(null)
  const [quickEditSupplierId, setQuickEditSupplierId] = useState('')
  const localeOptions = useMemo(() => loadPrimaNotaLocales(), [])

  const filteredSuppliers = useMemo(() => {
    const list = Array.isArray(suppliers) ? suppliers : []
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter((s) => {
      const blob = [
        s.name,
        s.vat_number,
        s.fiscal_code,
        s.email,
        s.phone,
        s.city,
        s.emails_json,
        s.phones_json,
        s.cities_json,
        s.merchandise_categories_json,
        s.address,
        s.country,
        s.contact_person,
        s.payment_terms,
        s.merchandise_category,
        s.notes,
        s.price_list_label,
        s.iban,
        formatSupplierLocales(s.locales, localeOptions),
      ].filter(Boolean).join(' ').toLowerCase()
      return blob.includes(q)
    })
  }, [suppliers, search, localeOptions])

  const workbookTotals = useMemo(
    () => supplierWorkbookTotals(filteredSuppliers),
    [filteredSuppliers],
  )

  function toggleSupplierLocale(id) {
    if (!id) return
    setSupplierLocales((prev) => (
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    ))
  }

  function addLocaleFromSelect() {
    if (!localePick || supplierLocales.includes(localePick)) return
    setSupplierLocales((prev) => [...prev, localePick])
    setLocalePick('')
  }

  useEffect(() => {
    if (!quickEditSupplierId) return
    const still = filteredSuppliers.some((s) => String(s.id) === String(quickEditSupplierId))
    if (!still) setQuickEditSupplierId('')
  }, [filteredSuppliers, quickEditSupplierId])

  useEffect(() => {
    loadSuppliers()
  }, [])

  useEffect(() => {
    const onApply = (ev) => {
      const s = ev?.detail || {}
      if (s.name) setName(String(s.name))
      if (s.vat_number) setVatNumber(String(s.vat_number))
      if (s.email) mergeContactValue(emails, setEmails, s.email)
      if (s.phone) mergeContactValue(phones, setPhones, s.phone)
      if (s.city) mergeContactValue(cities, setCities, s.city)
      if (s.contact_person) setContactPerson(String(s.contact_person))
      if (s.payment_terms) setPaymentTerms(String(s.payment_terms))
      if (s.merchandise_category) {
        const parts = String(s.merchandise_category)
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
        if (parts.length) setMerchandiseCategories((prev) => [...new Set([...prev, ...parts])])
      }
    }
    window.addEventListener('ai-apply-supplier', onApply)
    return () => window.removeEventListener('ai-apply-supplier', onApply)
  }, [])

  async function loadSuppliers() {
    try {
      setLoading(true)
      setError('')
      const data = await fetchSuppliers()
      setSuppliers(data)
    } catch {
      setSuppliers([])
      setError('Errore nel caricamento fornitori')
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    const isNewSupplier = editingId == null
    try {
      const payload = {
        name: name.trim(),
        vat_number: vatNumber.trim() || undefined,
        fiscal_code: fiscalCode.trim() || undefined,
        contact_person: contactPerson.trim() || undefined,
        iban: iban.trim() || undefined,
        payment_terms: paymentTerms.trim() || undefined,
        notes: notes.trim() || undefined,
        price_list_label: priceListLabel.trim() || undefined,
        locales: serializeSupplierLocales(supplierLocales),
        is_active: isActive,
        is_expired: isExpired,
        ...buildSupplierMultiContactPayload({ phones, emails, cities, merchandiseCategories }),
      }
      if (editingId) {
        await updateSupplier(editingId, payload)
        setError('')
        setEditingId(null)
      } else {
        await createSupplier(payload)
      }
      resetForm()
      await loadSuppliers()
      if (isNewSupplier) {
        window.requestAnimationFrame(() => {
          supplierListSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
      }
    } catch (e) {
      setError(editingId ? 'Errore nell\'aggiornamento fornitore' : 'Errore nel salvataggio fornitore')
    }
  }

  function resetForm() {
    setName('')
    setVatNumber('')
    setFiscalCode('')
    setPhones([emptyContactItem()])
    setEmails([emptyContactItem()])
    setCities([emptyContactItem()])
    setMerchandiseCategories([])
    setContactPerson('')
    setIban('')
    setPaymentTerms('')
    setNotes('')
    setPriceListLabel('')
    setSupplierLocales([])
    setLocalePick('')
    setIsActive(true)
    setIsExpired(false)
  }

  function handleEdit(s) {
    setEditingId(s.id)
    setName(s.name || '')
    setVatNumber(s.vat_number || '')
    setFiscalCode(s.fiscal_code || '')
    setPhones(parseContactListFromSupplier(s, 'phones_json', 'phone'))
    setEmails(parseContactListFromSupplier(s, 'emails_json', 'email'))
    setCities(parseContactListFromSupplier(s, 'cities_json', 'city'))
    setMerchandiseCategories(parseMerchandiseCategoriesFromSupplier(s))
    setContactPerson(s.contact_person || '')
    setIban(s.iban || '')
    setPaymentTerms(s.payment_terms || '')
    setNotes(s.notes || '')
    setPriceListLabel(s.price_list_label || '')
    setSupplierLocales(parseSupplierLocales(s.locales))
    setLocalePick('')
    setIsActive(s.is_active !== false)
    setIsExpired(!!s.is_expired)
    setError('')
  }

  function handleCancelEdit() {
    setEditingId(null)
    resetForm()
    setError('')
  }

  async function handleDelete(s) {
    if (!window.confirm(`Eliminare il fornitore "${s.name}"?`)) return
    try {
      await deleteSupplier(s.id)
      await loadSuppliers()
      if (editingId === s.id) handleCancelEdit()
    } catch (e) {
      setError('Errore nell\'eliminazione fornitore')
    }
  }

  async function openSupplierDrawer(s) {
    setDrawerSupplier(s)
    setDrawerTab('doc')
    setDrawerLoading(true)
    setDrawerInvoices([])
    setDrawerDeliveries([])
    setDrawerPrices([])
    try {
      const to = new Date().toISOString().slice(0, 10)
      const from = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10)
      const [inv, del, price] = await Promise.all([
        fetchInvoices({ supplier_id: s.id }),
        fetchDeliveries({ supplier_id: s.id, date_from: from, date_to: to }),
        fetchPriceList(s.id),
      ])
      setDrawerInvoices(inv || [])
      setDrawerDeliveries(del || [])
      setDrawerPrices(price || [])
    } catch {
      // noop
    } finally {
      setDrawerLoading(false)
    }
  }

  async function handleDeleteAll() {
    if (!window.confirm(
      'Eliminare TUTTI i fornitori? Verranno rimossi anche scarichi, fatture e righe del prezzario collegati. Nella Prima Nota i movimenti restano ma senza riferimento al fornitore.',
    )) return
    try {
      setDeletingAll(true)
      setError('')
      await deleteAllSuppliers()
      handleCancelEdit()
      await loadSuppliers()
    } catch (e) {
      setError('Errore durante l\'eliminazione di tutti i fornitori')
    } finally {
      setDeletingAll(false)
    }
  }

  function applyAiSupplierSuggestion(s) {
    if (!s || typeof s !== 'object') return []
    const applied = []
    if (s.name) { setName(String(s.name)); applied.push(`Ragione sociale: ${s.name}`) }
    if (s.vat_number) { setVatNumber(String(s.vat_number)); applied.push(`P.IVA: ${s.vat_number}`) }
    if (s.fiscal_code) { setFiscalCode(String(s.fiscal_code)); applied.push(`CF: ${s.fiscal_code}`) }
    if (s.email) { mergeContactValue(emails, setEmails, s.email); applied.push(`Email: ${s.email}`) }
    if (s.phone) { mergeContactValue(phones, setPhones, s.phone); applied.push(`Telefono: ${s.phone}`) }
    if (s.city) { mergeContactValue(cities, setCities, s.city); applied.push(`Città: ${s.city}`) }
    if (s.contact_person) { setContactPerson(String(s.contact_person)); applied.push(`Referente: ${s.contact_person}`) }
    if (s.iban) { setIban(String(s.iban).toUpperCase()); applied.push(`IBAN: ${s.iban}`) }
    if (s.payment_terms) { setPaymentTerms(String(s.payment_terms)); applied.push(`Pagamento: ${s.payment_terms}`) }
    if (s.merchandise_category) {
      const parts = String(s.merchandise_category)
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
      if (parts.length) {
        setMerchandiseCategories((prev) => [...new Set([...prev, ...parts])])
        applied.push(`Categorie: ${parts.join(', ')}`)
      }
    }
    if (s.price_list_label) { setPriceListLabel(String(s.price_list_label)); applied.push(`Listino: ${s.price_list_label}`) }
    if (s.notes) { setNotes(String(s.notes)); applied.push('Note aggiornate') }
    return applied
  }

  function finishSupplierAiSummary(applied, { instant = false, viaAi = false, localOnly = false } = {}) {
    if (applied.length) {
      const prefix = localOnly
        ? 'Compilato subito'
        : instant
          ? 'Compilato (istantaneo)'
          : viaAi
            ? 'Atlas AI'
            : 'Compilato'
      setAiSupplierSummary(`${prefix}: ${applied.join(' · ')}`)
    } else {
      setAiError(
        'Nessun campo estratto. Esempio: «Bar Roma, P.IVA 12345678901, email info@bar.it, tel 0801234567» oppure «fornitore Bar Peroni nome Mario Rossi».',
      )
    }
  }

  async function handleAiSuggestSupplier(textOverride) {
    const text = (textOverride != null ? textOverride : aiSupplierText).trim()
    if (!text) {
      setAiError('Parla o scrivi un comando prima di Compila')
      return
    }
    setAiSupplierLoading(true)
    setAiError('')
    setAiSupplierSummary('')

    const multiContact = buildSupplierMultiContactPayload({ phones, emails, cities, merchandiseCategories })
    const existingPayload = {
      name,
      vat_number: vatNumber,
      email: multiContact.email,
      phone: multiContact.phone,
      city: multiContact.city,
      contact_person: contactPerson,
      payment_terms: paymentTerms,
      iban,
      notes,
      fiscal_code: fiscalCode,
      merchandise_category: multiContact.merchandise_category,
      price_list_label: priceListLabel,
    }

    const local = parseSupplierVoiceLocal(text)
    const localFields = enrichSupplierFields(text, local.suggested_fields)
    if (local.completeEnough) {
      const appliedLocal = applyAiSupplierSuggestion(localFields)
      if (appliedLocal.length) {
        finishSupplierAiSummary(appliedLocal, { localOnly: true })
        setAiSupplierLoading(false)
        suggestSupplierFields(text, existingPayload)
          .then((res) => {
            const merged = mergeSupplierFields(text, localFields, res?.suggested_fields)
            const applied = applyAiSupplierSuggestion(merged)
            if (!applied.length) return
            setAiMissing(res?.missing_fields || [])
            finishSupplierAiSummary(applied, {
              instant: Boolean(res?.fast_path),
              viaAi: Boolean(res?.ai_used),
            })
          })
          .catch(() => {})
        return
      }
    }

    try {
      const res = await suggestSupplierFields(text, existingPayload)
      const merged = mergeSupplierFields(text, localFields, res?.suggested_fields)
      const applied = applyAiSupplierSuggestion(merged)
      setAiMissing(res?.missing_fields || [])
      const viaAi = Boolean(res?.ai_used)
      const instant = Boolean(res?.fast_path || (res?.local_fallback && !res?.ai_used))
      finishSupplierAiSummary(applied, { instant, viaAi })
    } catch (err) {
      const msg = String(err?.message || '')
      if (err?.name === 'AbortError') {
        const fallback = parseSupplierVoiceLocal(text)
        const applied = applyAiSupplierSuggestion(
          enrichSupplierFields(text, fallback.suggested_fields),
        )
        if (applied.length) {
          finishSupplierAiSummary(applied, { localOnly: true })
        } else {
          setAiError('Tempo scaduto. Includi ragione sociale e almeno P.IVA o email nel comando.')
        }
      } else if (msg.includes('500') || msg.includes('NameError') || msg.includes('Internal Server')) {
        setAiError('Errore server AI. Riavvia il backend FastAPI (porta 8000) e riprova.')
      } else if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        setAiError('Backend non raggiungibile. Avvia: npm run dev (FastAPI porta 8000).')
      } else {
        setAiError(
          msg.replace(/^400:\s*/, '') ||
            'Atlas AI non disponibile. Usa un comando con nome, P.IVA o email espliciti.',
        )
      }
    } finally {
      setAiSupplierLoading(false)
    }
  }

  async function handleSupplierInvoiceUpload(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setInvoiceUploadBusy(true)
    setAiError('')
    setAiSupplierSummary('')
    setAiSupplierAnomalies([])
    try {
      const res = await parseSupplierInvoiceFile(file)
      const fields = res?.suggested_fields || {}
      const applied = applyAiSupplierSuggestion(fields)
      setAiMissing(res?.missing_fields || [])
      if (Array.isArray(res?.warnings) && res.warnings.length) {
        setAiSupplierAnomalies(res.warnings)
      }
      if (applied.length) {
        const kind = res.file_type === 'xml' ? 'XML FatturaPA' : 'PDF'
        setAiSupplierSummary(`Da fattura (${kind}): ${applied.join(' · ')}`)
        setEditingId(null)
        window.requestAnimationFrame(() => {
          supplierFormSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
      } else {
        setAiError('Nessun campo fornitore estratto dal file. Verifica il formato o compila manualmente.')
      }
    } catch (err) {
      setAiError(err?.message || 'Upload fornitore non riuscito')
    } finally {
      setInvoiceUploadBusy(false)
    }
  }

  async function handleAiCheckSupplier() {
    try {
      const multiContact = buildSupplierMultiContactPayload({ phones, emails, cities, merchandiseCategories })
      const res = await checkAiAnomalies('supplier', {
        name,
        vat_number: vatNumber,
        email: multiContact.email,
        payment_terms: paymentTerms,
      })
      setAiSupplierAnomalies(res?.anomalies || [])
    } catch {
      setAiError('Controllo anomalie AI non disponibile')
    }
  }

  return (
    <div>
      <section className="staff-page-hero">
      <h1 className="page-header staff-page-title">Fornitori</h1>
      <p className="staff-page-lead">
        Anagrafica completa con dati commerciali, pagamenti e collegamenti. L&apos;elenco usa un foglio Excel con una colonna per ogni attributo;
        in fondo compaiono i totali. <strong>Apri IBAN</strong> mostra solo gli IBAN da copiare.
      </p>
      </section>

      {error && <div className="alert alert-danger">{error}</div>}

      <section className="card" ref={supplierFormSectionRef}>
        <h2 className="page-subheader" style={{ marginTop: 0 }}>
          {editingId ? 'Modifica fornitore' : 'Nuovo fornitore'}
        </h2>
        <div
          className="supplier-invoice-upload-row"
          style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}
        >
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={invoiceUploadBusy || aiSupplierLoading}
            onClick={() => invoiceUploadRef.current?.click()}
            title="Carica XML FatturaPA o PDF fattura: nome, P.IVA, IBAN, email, telefono e pagamento nel modulo sotto"
          >
            {invoiceUploadBusy ? 'Lettura…' : 'Upload fornitore'}
          </button>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Carica una fattura del fornitore (XML o PDF) per compilare l&apos;anagrafica in automatico.
          </span>
          <input
            ref={invoiceUploadRef}
            type="file"
            accept=".xml,.pdf,.p7m,application/xml,application/pdf,text/xml"
            className="pagamenti-upload-input"
            onChange={(e) => void handleSupplierInvoiceUpload(e)}
          />
        </div>
        <GeminiVoiceAssistant
          label="Fornitore a voce (Atlas AI)"
          hint='Dì chiaramente «partita IVA» + 11 cifre e «codice fiscale» + codice (16 caratteri). Es: «Bar Roma partita IVA 12345678901 codice fiscale RSSMRA80A01H501U email info@bar.it tel 0801234567». Dopo Compila il testo si cancella.'
          text={aiSupplierText}
          onTextChange={setAiSupplierText}
          onCompile={(spoken) => handleAiSuggestSupplier(spoken)}
          compiling={aiSupplierLoading}
          compileLabel={aiSupplierLoading ? 'Compilo…' : 'Compila fornitore'}
          showInterimResults={false}
          onClear={() => {
            setAiSupplierSummary('')
            setAiError('')
          }}
        />
        {aiSupplierSummary ? (
          <div className="alert alert-success" style={{ marginTop: '0.35rem', marginBottom: '0.5rem' }}>
            <strong>Atlas AI:</strong> {aiSupplierSummary}
          </div>
        ) : null}
        {aiError && <div className="alert alert-danger" style={{ marginTop: '0.5rem' }}>{aiError}</div>}
        {(aiMissing.length > 0 || aiSupplierAnomalies.length > 0) && (
          <div className="alert alert-info" style={{ marginTop: '0.45rem', marginBottom: '0.9rem' }}>
            {aiMissing.length > 0 && <div><strong>Campi mancanti:</strong> {aiMissing.join(', ')}</div>}
            {aiSupplierAnomalies.length > 0 && <div><strong>Anomalie:</strong> {aiSupplierAnomalies.join(' · ')}</div>}
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group" style={{ flex: '1 1 240px' }}>
              <label>Ragione sociale</label>
              <input className="form-control" value={name} onChange={e => setName(e.target.value)} placeholder="Ragione sociale" required />
            </div>
            <div className="form-group" style={{ flex: '0 1 160px' }}>
              <label>P. IVA</label>
              <input className="form-control" value={vatNumber} onChange={e => setVatNumber(e.target.value)} placeholder="IT12345678901" />
            </div>
            <div className="form-group" style={{ flex: '0 1 160px' }}>
              <label>Codice fiscale</label>
              <input className="form-control" value={fiscalCode} onChange={e => setFiscalCode(e.target.value)} placeholder="CF" />
            </div>
          </div>
          <SupplierMultiContactEditor
            phones={phones}
            setPhones={setPhones}
            emails={emails}
            setEmails={setEmails}
            cities={cities}
            setCities={setCities}
            merchandiseCategories={merchandiseCategories}
            setMerchandiseCategories={setMerchandiseCategories}
          />
          <div className="form-row">
            <div className="form-group" style={{ flex: '1 1 320px' }}>
              <label>IBAN</label>
              <input className="form-control" value={iban} onChange={e => setIban(e.target.value)} placeholder="IT..." />
            </div>
            <div className="form-group" style={{ flex: '1 1 220px' }}>
              <label>Referente</label>
              <input className="form-control" value={contactPerson} onChange={e => setContactPerson(e.target.value)} placeholder="Nome referente" />
            </div>
            <div className="form-group" style={{ flex: '1 1 220px' }}>
              <label>Listino associato (etichetta)</label>
              <input className="form-control" value={priceListLabel} onChange={e => setPriceListLabel(e.target.value)} placeholder="Nome listino o riferimento" />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="sup-locale-select">Locali / punti vendita</label>
            <div className="sup-locale-picker">
              <select
                id="sup-locale-select"
                className="form-control"
                value={localePick}
                onChange={(e) => setLocalePick(e.target.value)}
              >
                <option value="">Seleziona locale…</option>
                {localeOptions
                  .filter((l) => !supplierLocales.includes(l.id))
                  .map((l) => (
                    <option key={l.id} value={l.id}>{l.label}</option>
                  ))}
              </select>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!localePick}
                onClick={addLocaleFromSelect}
              >
                Aggiungi
              </button>
            </div>
            {supplierLocales.length > 0 ? (
              <div className="sup-locale-tags" aria-label="Locali selezionati">
                {supplierLocales.map((id) => (
                  <span key={id} className="sup-locale-tag">
                    {localeLabel(id, localeOptions)}
                    <button
                      type="button"
                      className="sup-locale-tag-remove"
                      onClick={() => toggleSupplierLocale(id)}
                      aria-label={`Rimuovi ${localeLabel(id, localeOptions)}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="sup-locale-hint">Nessun locale selezionato (es. Risacca, La Via Lattea, Mediazione).</p>
            )}
          </div>
          <div className="form-group">
            <label>Condizioni di pagamento</label>
            <textarea className="form-control" value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} rows={2} placeholder="Es. 30gg fine mese, RID, bonifico" />
          </div>
          <div className="form-group">
            <label>Note</label>
            <textarea className="form-control" value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Note interne" />
          </div>
          <div className="form-row" style={{ alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginRight: '1.5rem' }}>
              <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
              Attivo
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input type="checkbox" checked={isExpired} onChange={e => setIsExpired(e.target.checked)} />
              Scaduto (rapporto / documentazione)
            </label>
          </div>
          <div className="btn-group" style={{ marginTop: '0.75rem' }}>
            <button type="submit" className="btn btn-primary">
              {editingId ? 'Salva modifiche' : 'Aggiungi fornitore'}
            </button>
            {editingId && (
              <button type="button" className="btn btn-secondary" onClick={handleCancelEdit}>
                Annulla
              </button>
            )}
            <button
              type="button"
              className="btn btn-outline-danger"
              onClick={handleDeleteAll}
              disabled={deletingAll || suppliers.length === 0}
              title="Elimina tutti i fornitori e i dati collegati (scarichi, fatture, prezzario)"
            >
              {deletingAll ? 'Eliminazione…' : 'Elimina tutti i fornitori'}
            </button>
          </div>
        </form>
      </section>

      <section className="card pagamenti-workbook-card suppliers-workbook-card" ref={supplierListSectionRef}>
        <div className="pagamenti-workbook-toolbar suppliers-workbook-toolbar">
          <div className="pagamenti-workbook-toolbar-left">
            <span className="pagamenti-workbook-title">{SUPPLIER_WORKBOOK_TITLE}</span>
            <span className="pagamenti-workbook-sheet-label">
              {filteredSuppliers.length} fornitori{search.trim() ? ' (filtrati)' : ''}
            </span>
          </div>
          <div className="pagamenti-workbook-actions suppliers-workbook-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setIbanPanelOpen(true)}
              title="Mostra gli IBAN dei fornitori (rispetta il filtro di ricerca)"
            >
              Apri IBAN
            </button>
            <select
              id="sup-quick-edit"
              className="form-control"
              value={quickEditSupplierId}
              onChange={(e) => setQuickEditSupplierId(e.target.value)}
              style={{ minWidth: 200, maxWidth: 'min(320px, 50vw)' }}
              aria-label="Scegli fornitore da modificare (elenco filtrato dalla ricerca)"
            >
              <option value="">Modifica: scegli fornitore…</option>
              {filteredSuppliers.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!quickEditSupplierId}
              title="Apre il modulo Nuovo/Modifica fornitore in alto con i dati selezionati"
              onClick={() => {
                const s = filteredSuppliers.find((x) => String(x.id) === String(quickEditSupplierId))
                if (!s) return
                handleEdit(s)
                window.requestAnimationFrame(() => {
                  supplierFormSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                })
              }}
            >
              Modifica fornitore
            </button>
            <input
              type="search"
              className="sup-search"
              placeholder="Cerca nome, P.IVA, email, categoria…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Cerca fornitore"
            />
          </div>
        </div>
        {loading && <p className="loading pagamenti-loading">Caricamento anagrafica…</p>}
        {!loading && !error && (
          <div className="pagamenti-grid-wrap excel-wrap suppliers-grid-wrap">
            <table className="app-table excel-table pagamenti-grid suppliers-grid">
              <colgroup>
                {SUPPLIER_WORKBOOK_COLUMNS.map((col) => (
                  <col key={col.id} style={{ minWidth: col.width }} />
                ))}
                <col style={{ minWidth: 168 }} />
              </colgroup>
              <thead>
                <tr>
                  {SUPPLIER_WORKBOOK_COLUMNS.map((col) => (
                    <th
                      key={col.id}
                      className={[
                        col.numeric ? 'text-end' : '',
                        col.sticky === 'left' ? 'suppliers-col-sticky-left' : '',
                      ].filter(Boolean).join(' ')}
                    >
                      {col.label}
                    </th>
                  ))}
                  <th className="sup-actions-col">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {filteredSuppliers.map((s, rowIndex) => (
                  <tr
                    key={s.id}
                    className="suppliers-grid-row pn-row-click"
                    onClick={() => openSupplierDrawer(s)}
                    title="Apri scheda fornitore"
                  >
                    {SUPPLIER_WORKBOOK_COLUMNS.map((col) => {
                      const value = supplierWorkbookCellValue(s, col, { rowIndex, localeOptions })
                      const statusActive = col.id === 'is_active' && s.is_active
                      const statusExpired = col.id === 'is_expired' && s.is_expired
                      const saldoWarn = col.id === 'saldo_aperto' && Number(s.saldo_aperto) > 0
                      return (
                        <td
                          key={col.id}
                          className={col.sticky === 'left' ? 'suppliers-col-sticky-left' : ''}
                        >
                          <input
                            className={[
                              'excel-cell',
                              'pagamenti-cell-readonly',
                              col.numeric ? 'excel-cell-num' : '',
                              col.emphasis ? 'suppliers-cell-emphasis' : '',
                              col.mono ? 'suppliers-cell-mono' : '',
                              statusActive ? 'suppliers-cell-yes' : '',
                              statusExpired ? 'suppliers-cell-alert' : '',
                              saldoWarn ? 'suppliers-cell-warning' : '',
                            ].filter(Boolean).join(' ')}
                            value={value}
                            readOnly
                            tabIndex={-1}
                            aria-label={`${col.label} ${s.name}`}
                          />
                        </td>
                      )
                    })}
                    <td className="sup-actions-col" onClick={(e) => e.stopPropagation()}>
                      <div className="sup-actions-btns">
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => handleEdit(s)}
                          title="Modifica anagrafica"
                        >
                          Modifica
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => openSupplierDrawer(s)}
                          title="Scheda e documenti"
                        >
                          Scheda
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline-danger btn-sm"
                          onClick={() => handleDelete(s)}
                          title="Elimina fornitore"
                        >
                          Elimina
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredSuppliers.length === 0 ? (
                  <tr>
                    <td colSpan={SUPPLIER_WORKBOOK_COLUMNS.length + 1} className="empty-state">
                      {suppliers.length === 0 ? 'Nessun fornitore presente.' : 'Nessun risultato per la ricerca.'}
                    </td>
                  </tr>
                ) : (
                  <tr className="suppliers-row-totals">
                    {SUPPLIER_WORKBOOK_COLUMNS.map((col) => (
                      <td
                        key={`tot-${col.id}`}
                        className={col.sticky === 'left' ? 'suppliers-col-sticky-left' : ''}
                      >
                        <input
                          className={[
                            'excel-cell',
                            'pagamenti-cell-readonly',
                            col.numeric ? 'excel-cell-num' : '',
                            'suppliers-cell-total',
                          ].filter(Boolean).join(' ')}
                          value={supplierWorkbookTotalsLabel(col.id, workbookTotals)}
                          readOnly
                          tabIndex={-1}
                          aria-label={`Totale ${col.label}`}
                        />
                      </td>
                    ))}
                    <td className="sup-actions-col" />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {ibanPanelOpen && (
        <>
          <div className="ui-drawer-backdrop" onClick={() => setIbanPanelOpen(false)} aria-hidden />
          <aside className="ui-drawer" role="dialog" aria-label="IBAN fornitori" style={{ width: 'min(520px, 100vw)' }}>
            <div className="ui-drawer-header">
              <div>
                <h2 className="ui-drawer-title">IBAN fornitori</h2>
                <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                  Elenco in base ai filtri attuali ({filteredSuppliers.length} fornitori). Usa Copia per incollare in bonifici o gestionali.
                </div>
              </div>
              <button type="button" className="ui-drawer-close" onClick={() => setIbanPanelOpen(false)} aria-label="Chiudi">
                ×
              </button>
            </div>
            <div className="ui-drawer-body" style={{ paddingTop: 0 }}>
              <div className="table-wrap">
                <table className="app-table app-table--compact">
                  <thead>
                    <tr>
                      <th>Ragione sociale</th>
                      <th>IBAN</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSuppliers.map((s) => (
                      <tr key={s.id}>
                        <td style={{ fontWeight: 600 }}>{s.name}</td>
                        <td style={{ wordBreak: 'break-all', fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: '0.82rem' }}>
                          {s.iban?.trim() ? s.iban.trim() : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {s.iban?.trim() ? (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => copyToClipboard(s.iban.trim())}
                            >
                              Copia
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                    {filteredSuppliers.length === 0 && (
                      <tr>
                        <td colSpan={3} className="empty-state">
                          Nessun fornitore nell’elenco filtrato.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </aside>
        </>
      )}

      {drawerSupplier && (
        <>
          <div className="ui-drawer-backdrop" onClick={() => setDrawerSupplier(null)} aria-hidden />
          <aside className="ui-drawer" role="dialog" aria-label="Scheda fornitore" style={{ width: 'min(480px, 100vw)' }}>
            <div className="ui-drawer-header">
              <div>
                <h2 className="ui-drawer-title">{drawerSupplier.name}</h2>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>P.IVA {drawerSupplier.vat_number || '–'} · {drawerSupplier.city || '–'}</div>
                {drawerSupplier.iban?.trim() ? (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.86rem' }}>
                    <strong>IBAN:</strong>{' '}
                    <code style={{ wordBreak: 'break-all', fontSize: '0.82rem' }}>{drawerSupplier.iban.trim()}</code>{' '}
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => copyToClipboard(drawerSupplier.iban.trim())}>
                      Copia
                    </button>
                  </div>
                ) : null}
              </div>
              <button type="button" className="ui-drawer-close" onClick={() => setDrawerSupplier(null)} aria-label="Chiudi">×</button>
            </div>
            <div className="ui-drawer-body">
              <div className="ui-tabs">
                <button type="button" className={`ui-tab ${drawerTab === 'doc' ? 'active' : ''}`} onClick={() => setDrawerTab('doc')}>Documenti</button>
                <button type="button" className={`ui-tab ${drawerTab === 'price' ? 'active' : ''}`} onClick={() => setDrawerTab('price')}>Listino</button>
              </div>
              {drawerLoading && <p className="loading">Caricamento…</p>}
              {!drawerLoading && drawerTab === 'doc' && (
                <>
                  <p style={{ marginTop: 0, fontSize: '0.9rem' }}><strong>Saldo aperto:</strong> {formatEuro(drawerSupplier.saldo_aperto)}</p>
                  <h3 className="page-subheader" style={{ fontSize: '0.95rem' }}>Fatture recenti</h3>
                  <div className="table-wrap">
                    <table className="app-table app-table--compact">
                      <thead>
                        <tr><th>N.</th><th>Data</th><th className="text-end">Tot.</th><th>Stato</th></tr>
                      </thead>
                      <tbody>
                        {drawerInvoices.slice(0, 12).map((inv) => (
                          <tr key={inv.id}>
                            <td>{inv.invoice_number}</td>
                            <td>{formatDateTime(inv.invoice_date)}</td>
                            <td className="text-end amount">{formatEuro(inv.total)}</td>
                            <td>{inv.payment_status === 'paid' ? 'Pagata' : inv.payment_status === 'partial' ? 'Parz.' : 'Da pagare'}</td>
                          </tr>
                        ))}
                        {drawerInvoices.length === 0 && (
                          <tr><td colSpan={4} className="empty-state">Nessuna fattura.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <h3 className="page-subheader" style={{ fontSize: '0.95rem', marginTop: '1rem' }}>Consegne recenti</h3>
                  <div className="table-wrap">
                    <table className="app-table app-table--compact">
                      <thead>
                        <tr><th>Data</th><th>Merce</th><th className="text-end">Tot.</th></tr>
                      </thead>
                      <tbody>
                        {drawerDeliveries.slice(0, 12).map((d) => (
                          <tr key={d.id}>
                            <td>{formatDateTime(d.delivery_date)}</td>
                            <td>{d.product_description || '–'}</td>
                            <td className="text-end amount">{formatEuro(d.total)}</td>
                          </tr>
                        ))}
                        {drawerDeliveries.length === 0 && (
                          <tr><td colSpan={3} className="empty-state">Nessuna consegna nel periodo.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {!drawerLoading && drawerTab === 'price' && (
                <div className="table-wrap">
                  <table className="app-table app-table--compact">
                    <thead>
                      <tr><th>Merce</th><th className="text-end">Prezzo €</th></tr>
                    </thead>
                    <tbody>
                      {drawerPrices.map((p) => (
                        <tr key={p.id}>
                          <td>{p.product_description}</td>
                          <td className="text-end amount">{Number(p.unit_price).toFixed(2)}</td>
                        </tr>
                      ))}
                      {drawerPrices.length === 0 && (
                        <tr><td colSpan={2} className="empty-state">Nessuna voce listino.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              <div style={{ marginTop: '1rem' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    handleEdit(drawerSupplier)
                    setDrawerSupplier(null)
                  }}
                >
                  Modifica fornitore
                </button>
              </div>
            </div>
          </aside>
        </>
      )}
    </div>
  )
}
