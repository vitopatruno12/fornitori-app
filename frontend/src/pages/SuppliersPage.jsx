import React, { useEffect, useMemo, useState } from 'react'
import { fetchSuppliers, createSupplier, updateSupplier, deleteSupplier, deleteAllSuppliers } from '../services/suppliersService'
import { fetchInvoices } from '../services/invoicesService'
import { fetchDeliveries } from '../services/deliveriesService'
import { fetchPriceList } from '../services/priceListService'
import { checkAiAnomalies, suggestSupplierFields } from '../services/aiService'

const SpeechRecognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)

function parseVoiceToSupplier(text) {
  const t = text.trim()
  if (!t) return {}

  let nameVal = ''
  let vat = ''
  let emailVal = ''
  let phoneVal = ''
  let cityVal = ''

  const vatM = t.match(/(?:partita\s*iva|p\.?\s*iva|piva)\s*[:\s]*(?:it\s*)?([0-9\s]{9,13})/i)
  if (vatM) vat = vatM[1].replace(/\s/g, '').slice(-11)

  const emailM = t.match(/(?:email|e-?mail)\s*[:\s]*([^\s,]+(?:\s+[^\s,]+)*)/i)
  if (emailM) {
    emailVal = emailM[1]
      .replace(/\s*(at|@)\s*/gi, '@')
      .replace(/\s*punto\s*/gi, '.')
      .replace(/\s/g, '')
      .trim()
  }
  if (!emailVal && /@/.test(t)) {
    const e = t.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)
    if (e) emailVal = e[0]
  }

  const phoneM = t.match(/(?:telefono|tel|cellulare|cell)\s*[:\s]*([0-9\s\-\.\/]{6,20})/i)
  if (phoneM) phoneVal = phoneM[1].replace(/\s/g, '').replace(/[^\d+]/g, '').slice(0, 15)

  const cityM = t.match(/(?:città|citta|city)\s*[:\s]*([a-zàèéìòù\s]{2,50})/i)
  if (cityM) cityVal = cityM[1].trim()

  const firstKeyword = t.search(/(?:partita\s*iva|p\.?\s*iva|piva|email|e-?mail|telefono|tel|cellulare|città|citta|city)\s*[:\s]/i)
  if (firstKeyword > 0) {
    nameVal = t.slice(0, firstKeyword).replace(/\s*,\s*$/, '').trim()
  } else if (!vat && !emailVal && !phoneVal && !cityVal) {
    nameVal = t
  } else {
    const idx = Math.min(
      ...[vatM?.index, emailM?.index, phoneM?.index, cityM?.index].filter((i) => i != null && i >= 0)
    )
    if (idx > 0) nameVal = t.slice(0, idx).replace(/\s*,\s*$/, '').trim()
  }

  return {
    name: nameVal,
    vat_number: vat,
    email: emailVal,
    phone: phoneVal,
    city: cityVal,
  }
}

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
  const [email, setEmail] = useState('')
  const [vatNumber, setVatNumber] = useState('')
  const [fiscalCode, setFiscalCode] = useState('')
  const [phone, setPhone] = useState('')
  const [city, setCity] = useState('')
  const [contactPerson, setContactPerson] = useState('')
  const [iban, setIban] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [merchandiseCategory, setMerchandiseCategory] = useState('')
  const [notes, setNotes] = useState('')
  const [priceListLabel, setPriceListLabel] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [isExpired, setIsExpired] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [listening, setListening] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const [voiceGuideActive, setVoiceGuideActive] = useState(false)
  const [voiceGuideStep, setVoiceGuideStep] = useState(0)
  const [voiceGuideRepeatTick, setVoiceGuideRepeatTick] = useState(0)
  const [voiceGuidePrompt, setVoiceGuidePrompt] = useState('')
  const [voiceGuideHeard, setVoiceGuideHeard] = useState('')
  const submitBtnRef = React.useRef(null)
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
  const [aiMissing, setAiMissing] = useState([])
  const [aiSupplierAnomalies, setAiSupplierAnomalies] = useState([])
  const [ibanPanelOpen, setIbanPanelOpen] = useState(false)
  const [quickEditSupplierId, setQuickEditSupplierId] = useState('')

  const filteredSuppliers = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return suppliers
    return suppliers.filter((s) => {
      const blob = [s.name, s.vat_number, s.fiscal_code, s.email, s.phone, s.city, s.iban].filter(Boolean).join(' ').toLowerCase()
      return blob.includes(q)
    })
  }, [suppliers, search])

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
      if (s.email) setEmail(String(s.email))
      if (s.phone) setPhone(String(s.phone))
      if (s.city) setCity(String(s.city))
      if (s.contact_person) setContactPerson(String(s.contact_person))
      if (s.payment_terms) setPaymentTerms(String(s.payment_terms))
      if (s.merchandise_category) setMerchandiseCategory(String(s.merchandise_category))
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
    } catch (e) {
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
        email: email.trim() || undefined,
        vat_number: vatNumber.trim() || undefined,
        fiscal_code: fiscalCode.trim() || undefined,
        phone: phone.trim() || undefined,
        city: city.trim() || undefined,
        contact_person: contactPerson.trim() || undefined,
        iban: iban.trim() || undefined,
        payment_terms: paymentTerms.trim() || undefined,
        merchandise_category: merchandiseCategory.trim() || undefined,
        notes: notes.trim() || undefined,
        price_list_label: priceListLabel.trim() || undefined,
        is_active: isActive,
        is_expired: isExpired,
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
    setEmail('')
    setVatNumber('')
    setFiscalCode('')
    setPhone('')
    setCity('')
    setContactPerson('')
    setIban('')
    setPaymentTerms('')
    setMerchandiseCategory('')
    setNotes('')
    setPriceListLabel('')
    setIsActive(true)
    setIsExpired(false)
  }

  function handleEdit(s) {
    setEditingId(s.id)
    setName(s.name || '')
    setEmail(s.email || '')
    setVatNumber(s.vat_number || '')
    setFiscalCode(s.fiscal_code || '')
    setPhone(s.phone || '')
    setCity(s.city || '')
    setContactPerson(s.contact_person || '')
    setIban(s.iban || '')
    setPaymentTerms(s.payment_terms || '')
    setMerchandiseCategory(s.merchandise_category || '')
    setNotes(s.notes || '')
    setPriceListLabel(s.price_list_label || '')
    setIsActive(s.is_active !== false)
    setIsExpired(!!s.is_expired)
    setError('')
  }

  function handleVoiceInput() {
    if (!SpeechRecognition) {
      setVoiceError('L\'assistente vocale non è supportato da questo browser (usa Chrome o Edge)')
      return
    }
    setVoiceError('')
    const recognition = new SpeechRecognition()
    recognition.lang = 'it-IT'
    recognition.continuous = false
    recognition.interimResults = false

    recognition.onstart = () => setListening(true)
    recognition.onend = () => setListening(false)
    recognition.onerror = (e) => {
      setListening(false)
      if (e.error === 'not-allowed') setVoiceError('Microfono non autorizzato')
      else setVoiceError('Errore rilevamento vocale')
    }

    recognition.onresult = (e) => {
      const transcript = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join(' ')
      const parsed = parseVoiceToSupplier(transcript)
      if (parsed.name) setName(parsed.name)
      if (parsed.vat_number) setVatNumber(parsed.vat_number)
      if (parsed.email) setEmail(parsed.email)
      if (parsed.phone) setPhone(parsed.phone)
      if (parsed.city) setCity(parsed.city)
    }

    recognition.start()
  }

  function applyGuidedVoiceValue(key, value) {
    const v = (value || '').trim()
    if (!v) return
    if (key === 'name') setName(v)
    if (key === 'vat_number') setVatNumber(v.replace(/\s/g, '').slice(-11))
    if (key === 'email') setEmail(v.replace(/\s/g, ''))
    if (key === 'phone') setPhone(v.replace(/[^\d+]/g, '').slice(0, 15))
    if (key === 'city') setCity(v)
    if (key === 'contact_person') setContactPerson(v)
    if (key === 'payment_terms') setPaymentTerms(v)
    if (key === 'notes') setNotes(v)
  }

  function stopVoiceGuide() {
    setVoiceGuideActive(false)
    setVoiceGuidePrompt('')
    setVoiceGuideStep(0)
    setListening(false)
  }

  function startVoiceGuide() {
    if (!SpeechRecognition) {
      setVoiceError('L\'assistente vocale non è supportato da questo browser (usa Chrome o Edge)')
      return
    }
    setVoiceError('')
    setVoiceGuideHeard('')
    setVoiceGuideActive(true)
    setVoiceGuideStep(0)
  }

  useEffect(() => {
    if (!voiceGuideActive) return
    const steps = [
      { key: 'name', prompt: 'Dimmi la ragione sociale del fornitore.' },
      { key: 'vat_number', prompt: 'Dimmi la partita IVA, solo numeri. Puoi dire passa.' },
      { key: 'email', prompt: 'Dimmi la email. Puoi dire passa.' },
      { key: 'phone', prompt: 'Dimmi il telefono. Puoi dire passa.' },
      { key: 'city', prompt: 'Dimmi la città. Puoi dire passa.' },
      { key: 'contact_person', prompt: 'Dimmi il referente. Puoi dire passa.' },
      { key: 'payment_terms', prompt: 'Dimmi le condizioni di pagamento. Puoi dire passa.' },
      { key: 'notes', prompt: 'Dimmi eventuali note finali. Puoi dire passa.' },
      { key: '__confirm__', prompt: 'Vuoi salvare adesso? Rispondi sì o no.' },
    ]

    if (voiceGuideStep >= steps.length) {
      setVoiceGuidePrompt('Compilazione vocale completata.')
      setVoiceGuideActive(false)
      setListening(false)
      return
    }

    const step = steps[voiceGuideStep]
    setVoiceGuidePrompt(step.prompt)

    const askAndListen = () => {
      const rec = new SpeechRecognition()
      let gotResult = false
      rec.lang = 'it-IT'
      rec.continuous = false
      rec.interimResults = false
      rec.onstart = () => setListening(true)
      rec.onend = () => {
        setListening(false)
        if (!gotResult) {
          setVoiceGuideHeard('(nessuna risposta rilevata)')
          setVoiceGuideStep((s) => s + 1)
        }
      }
      rec.onerror = () => {
        setVoiceError('Errore ascolto nella modalità guidata')
        setListening(false)
        setVoiceGuideStep((s) => s + 1)
      }
      rec.onresult = (e) => {
        gotResult = true
        const transcript = Array.from(e.results).map((r) => r[0].transcript).join(' ').trim()
        setVoiceGuideHeard(transcript)
        const repeat = /^(ripeti|ripet[iy]|di nuovo|repeat)$/i.test(transcript)
        if (repeat) {
          setVoiceGuidePrompt(`Ripeto: ${step.prompt}`)
          window.setTimeout(() => setVoiceGuideRepeatTick((n) => n + 1), 120)
          return
        }
        if (step.key === '__confirm__') {
          const yes = /^(si|sì|ok|confermo|salva|procedi)/i.test(transcript)
          if (yes) {
            if (!name.trim()) {
              setVoiceError('Manca la ragione sociale: non posso salvare automaticamente.')
            } else {
              window.setTimeout(() => submitBtnRef.current?.click(), 120)
            }
          }
          setVoiceGuideStep((s) => s + 1)
          return
        }
        const skip = /^(passa|salta|skip|nessuno|vuoto)$/i.test(transcript)
        if (!skip) applyGuidedVoiceValue(step.key, transcript)
        setVoiceGuideStep((s) => s + 1)
      }
      rec.start()
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const utter = new SpeechSynthesisUtterance(step.prompt)
      utter.lang = 'it-IT'
      utter.rate = 1
      utter.onend = () => window.setTimeout(askAndListen, 350)
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(utter)
    } else {
      window.setTimeout(askAndListen, 250)
    }
  }, [voiceGuideActive, voiceGuideStep, voiceGuideRepeatTick])

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

  async function handleAiSuggestSupplier() {
    if (!aiSupplierText.trim()) return
    try {
      setVoiceError('')
      const res = await suggestSupplierFields(aiSupplierText, {
        name,
        vat_number: vatNumber,
        email,
        phone,
        city,
        contact_person: contactPerson,
        payment_terms: paymentTerms,
        iban,
        notes,
      })
      const s = res?.suggested_fields || {}
      if (s.name) setName(String(s.name))
      if (s.vat_number) setVatNumber(String(s.vat_number))
      if (s.email) setEmail(String(s.email))
      if (s.phone) setPhone(String(s.phone))
      if (s.city) setCity(String(s.city))
      if (s.contact_person) setContactPerson(String(s.contact_person))
      if (s.payment_terms) setPaymentTerms(String(s.payment_terms))
      if (s.merchandise_category) setMerchandiseCategory(String(s.merchandise_category))
      setAiMissing(res?.missing_fields || [])
    } catch {
      setVoiceError('Assistente AI non disponibile al momento')
    }
  }

  async function handleAiCheckSupplier() {
    try {
      const res = await checkAiAnomalies('supplier', {
        name,
        vat_number: vatNumber,
        email,
        payment_terms: paymentTerms,
      })
      setAiSupplierAnomalies(res?.anomalies || [])
    } catch {
      setVoiceError('Controllo anomalie AI non disponibile')
    }
  }

  return (
    <div>
      <section className="staff-page-hero">
      <h1 className="page-header staff-page-title">Fornitori</h1>
      <p className="staff-page-lead">
        Anagrafica completa con dati commerciali, pagamenti e collegamenti. <strong>Apri IBAN</strong> mostra solo gli IBAN da copiare;
        accanto puoi scegliere un fornitore dall’elenco filtrato e aprire la modifica. Per ogni riga vedi totali fatture, saldi aperti,
        ultime consegne/fatture e listino.
      </p>
      </section>

      {error && <div className="alert alert-danger">{error}</div>}

      <section className="card" ref={supplierFormSectionRef}>
        <h2 className="page-subheader" style={{ marginTop: 0 }}>
          {editingId ? 'Modifica fornitore' : 'Nuovo fornitore'}
          {SpeechRecognition && (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleVoiceInput}
                disabled={listening || voiceGuideActive}
                style={{ marginLeft: '1rem', padding: '0.4rem 0.8rem' }}
                title="Assistente vocale: parla una volta per compilare i campi principali"
              >
                {listening ? '🎤 In ascolto...' : '🎤 Assistente vocale'}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={voiceGuideActive ? stopVoiceGuide : startVoiceGuide}
                disabled={listening && !voiceGuideActive}
                style={{ marginLeft: '0.5rem', padding: '0.4rem 0.8rem' }}
                title="Modalità guidata: ti fa domande e compila i campi"
              >
                {voiceGuideActive ? '⏹️ Ferma guida vocale' : '🗣️ Guida vocale passo-passo'}
              </button>
            </>
          )}
        </h2>
        {voiceError && <div className="alert alert-danger" style={{ marginTop: '0.5rem' }}>{voiceError}</div>}
        {voiceGuidePrompt && (
          <div className="alert alert-info" style={{ marginTop: '0.5rem' }}>
            <strong>Guida vocale:</strong> {voiceGuidePrompt}
            {voiceGuideHeard ? <div style={{ marginTop: '0.35rem', color: 'var(--text-muted)' }}>Hai detto: "{voiceGuideHeard}"</div> : null}
          </div>
        )}
        {SpeechRecognition && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
            Esempio rapido: &quot;Mario Rossi srl, partita iva 12345678901, email mario@rossi.it, telefono 3331234567, città Lecce&quot;.
            In modalità guidata puoi dire <strong>passa</strong> per saltare un campo o <strong>ripeti</strong> per riascoltare la domanda.
          </p>
        )}
        <div className="form-group" style={{ marginBottom: '0.9rem' }}>
          <label>Comando AI (compilazione rapida)</label>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input
              className="form-control"
              value={aiSupplierText}
              onChange={(e) => setAiSupplierText(e.target.value)}
              placeholder='Es. "Acqua Pura srl, Lecce, bonifico 30 giorni, partita iva 12345678901"'
              style={{ flex: '1 1 460px' }}
            />
            <button type="button" className="btn btn-primary" onClick={handleAiSuggestSupplier}>Compila con AI</button>
            <button type="button" className="btn btn-secondary" onClick={handleAiCheckSupplier}>Controlla record</button>
          </div>
          {(aiMissing.length > 0 || aiSupplierAnomalies.length > 0) && (
            <div className="alert alert-info" style={{ marginTop: '0.45rem', marginBottom: 0 }}>
              {aiMissing.length > 0 && <div><strong>Campi mancanti:</strong> {aiMissing.join(', ')}</div>}
              {aiSupplierAnomalies.length > 0 && <div><strong>Anomalie:</strong> {aiSupplierAnomalies.join(' · ')}</div>}
            </div>
          )}
        </div>
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
          <div className="form-row">
            <div className="form-group">
              <label>Email</label>
              <input type="email" className="form-control" value={email} onChange={e => setEmail(e.target.value)} placeholder="info@fornitore.it" />
            </div>
            <div className="form-group">
              <label>Telefono</label>
              <input type="tel" className="form-control" value={phone} onChange={e => setPhone(e.target.value)} placeholder="080 1234567" />
            </div>
            <div className="form-group">
              <label>Referente</label>
              <input className="form-control" value={contactPerson} onChange={e => setContactPerson(e.target.value)} placeholder="Nome referente" />
            </div>
            <div className="form-group">
              <label>Città</label>
              <input className="form-control" value={city} onChange={e => setCity(e.target.value)} placeholder="Lecce" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group" style={{ flex: '1 1 320px' }}>
              <label>IBAN</label>
              <input className="form-control" value={iban} onChange={e => setIban(e.target.value)} placeholder="IT..." />
            </div>
            <div className="form-group" style={{ flex: '1 1 220px' }}>
              <label>Categoria merceologica</label>
              <input className="form-control" value={merchandiseCategory} onChange={e => setMerchandiseCategory(e.target.value)} placeholder="Es. Ortofrutta" />
            </div>
            <div className="form-group" style={{ flex: '1 1 220px' }}>
              <label>Listino associato (etichetta)</label>
              <input className="form-control" value={priceListLabel} onChange={e => setPriceListLabel(e.target.value)} placeholder="Nome listino o riferimento" />
            </div>
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
            <button ref={submitBtnRef} type="submit" className="btn btn-primary" style={{ display: 'none' }} aria-hidden>
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

      <section className="card" ref={supplierListSectionRef}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' }}>
          <h2 className="page-subheader" style={{ marginTop: 0 }}>Elenco fornitori</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.65rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
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
              className="btn btn-primary"
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
              placeholder="Cerca nome, P.IVA, email, telefono, città…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Cerca fornitore"
            />
          </div>
        </div>
        {loading && <p className="loading">Caricamento...</p>}
        {!loading && !error && (
          <div className="table-wrap pn-table-wrap" style={{ fontSize: '0.88rem' }}>
            <table className="app-table">
              <thead>
                <tr>
                  <th>Ragione sociale</th>
                  <th>P.IVA / CF</th>
                  <th>Contatti</th>
                  <th>Referente</th>
                  <th>Pagamenti</th>
                  <th>Categoria</th>
                  <th>Note</th>
                  <th>Listino</th>
                  <th>Stato</th>
                  <th className="text-end">Tot. fatture</th>
                  <th className="text-end" title="Somma residui (totale − pagato)">Saldo aperto</th>
                  <th>Ult. consegna</th>
                  <th>Ult. fattura</th>
                  <th className="text-end">Scad. aperte</th>
                  <th>Azioni</th>
                </tr>
              </thead>
              <tbody>
                {filteredSuppliers.map(s => (
                  <tr
                    key={s.id}
                    className="pn-row-click"
                    onClick={() => openSupplierDrawer(s)}
                    title="Apri scheda fornitore"
                  >
                    <td style={{ fontWeight: 600 }}>{s.name}</td>
                    <td>
                      <div>{s.vat_number || '–'}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.85em' }}>{s.fiscal_code || ''}</div>
                    </td>
                    <td>
                      <div>{s.email || '–'}</div>
                      <div>{s.phone || '–'}</div>
                    </td>
                    <td>{s.contact_person || '–'}</td>
                    <td style={{ maxWidth: 160, whiteSpace: 'pre-wrap' }}>{s.payment_terms || '–'}</td>
                    <td>{s.merchandise_category || '–'}</td>
                    <td style={{ maxWidth: 140, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={s.notes || ''}>{s.notes || '–'}</td>
                    <td>
                      <div>{s.price_list_label || '–'}</div>
                      {s.listino_righe > 0 && (
                        <div style={{ fontSize: '0.85em', color: 'var(--text-muted)' }}>{s.listino_righe} righe</div>
                      )}
                    </td>
                    <td>
                      {s.is_active ? <span style={{ color: 'var(--success)' }}>Attivo</span> : <span style={{ color: 'var(--text-muted)' }}>Non attivo</span>}
                      {s.is_expired && <div style={{ color: 'var(--danger)', fontSize: '0.85em' }}>Scaduto</div>}
                    </td>
                    <td className="text-end amount">{formatEuro(s.totale_fatture)}</td>
                    <td className="text-end amount pn-amount-cell" style={{ color: Number(s.saldo_aperto) > 0 ? 'var(--warning)' : undefined }}>{formatEuro(s.saldo_aperto)}</td>
                    <td>{formatDateTime(s.ultima_consegna)}</td>
                    <td>{formatDateTime(s.ultima_fattura)}</td>
                    <td className="text-end">{s.scadenze_aperte ?? 0}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ padding: '0.35rem 0.65rem', fontSize: '0.85rem' }}
                          onClick={() => handleEdit(s)}
                          title="Apri il modulo in alto per modificare l’anagrafica"
                        >
                          Modifica fornitore
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem' }}
                          onClick={() => openSupplierDrawer(s)}
                          title="Scheda e documenti"
                        >
                          Scheda
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline-danger"
                          style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem' }}
                          onClick={() => handleDelete(s)}
                        >
                          Elimina
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredSuppliers.length === 0 && (
                  <tr>
                    <td colSpan={15} className="empty-state">{suppliers.length === 0 ? 'Nessun fornitore presente.' : 'Nessun risultato per la ricerca.'}</td>
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
