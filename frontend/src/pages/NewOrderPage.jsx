import React, { useEffect, useMemo, useRef, useState } from 'react'
import { fetchSuppliers } from '../services/suppliersService'
import { fetchPriceList } from '../services/priceListService'
import { checkAiAnomalies, suggestOrderLines, suggestOrderFull } from '../services/aiService'

const SpeechRecognition =
  typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)
import {
  createSupplierOrder,
  deleteSupplierOrder,
  deleteAllSupplierOrders,
  fetchSupplierOrder,
  fetchSupplierOrders,
  supplierOrderPdfUrl,
  updateSupplierOrder,
} from '../services/supplierOrdersService'
import { getOperatorOrderPublicUrl } from '../utils/operatorMode.ts'

const emptyRow = () => ({ product_description: '', pieces: '', weight_kg: '', note: '' })
const TEMPLATE_LS = 'fornitori_app_order_row_template_v1'

function normalizeWhatsAppNumber(raw) {
  if (!raw) return null
  let d = String(raw).replace(/\D/g, '')
  if (!d) return null
  if (d.startsWith('00')) d = d.slice(2)
  if (d.length === 10 && d.startsWith('3')) d = `39${d}`
  if (d.length === 11 && d.startsWith('39')) return d
  if (d.length === 10 && d.startsWith('0')) d = `39${d.slice(1)}`
  return d.length >= 8 ? d : null
}

function formatDateIt(iso) {
  if (!iso) return ''
  const [y, m, day] = String(iso).slice(0, 10).split('-')
  if (!y || !m || !day) return iso
  return `${day}/${m}/${y}`
}

function todayIso() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const ITALIAN_MONTHS = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6,
  luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
}

const ITALIAN_DAYS = {
  lunedi: 1, lunedì: 1, martedi: 2, martedì: 2, mercoledi: 3, mercoledì: 3,
  giovedi: 4, giovedì: 4, venerdi: 5, venerdì: 5, sabato: 6, domenica: 0,
}

/** Parse natural language date (oggi, domani, lunedì, "12 marzo", "12/03/2026") into yyyy-mm-dd. */
function parseSpokenDateToIso(text) {
  const t = (text || '').toLowerCase().trim()
  if (!t) return ''
  const today = new Date()
  if (t === 'oggi' || /^stesso giorno/.test(t)) return todayIso()
  if (t === 'domani') {
    const d = new Date(today.getTime() + 86400000)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  if (t === 'dopodomani') {
    const d = new Date(today.getTime() + 2 * 86400000)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  for (const [name, dow] of Object.entries(ITALIAN_DAYS)) {
    if (t.includes(name)) {
      const cur = today.getDay()
      let delta = (dow - cur + 7) % 7
      if (delta === 0) delta = 7
      const d = new Date(today.getTime() + delta * 86400000)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
  }
  let m = t.match(/(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+(\d{2,4}))?/)
  if (m) {
    const dd = Number(m[1])
    const mm = ITALIAN_MONTHS[m[2]]
    let yy = m[3] ? Number(m[3]) : today.getFullYear()
    if (yy < 100) yy += 2000
    if (dd >= 1 && dd <= 31 && mm) {
      return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
    }
  }
  m = t.match(/(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?/)
  if (m) {
    const dd = Number(m[1])
    const mm = Number(m[2])
    let yy = m[3] ? Number(m[3]) : today.getFullYear()
    if (yy < 100) yy += 2000
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
    }
  }
  return ''
}

function statusLabel(s) {
  if (s === 'sent') return 'Inviato'
  return 'In sospeso'
}

function truncate(str, n) {
  if (!str) return '—'
  const t = String(str)
  return t.length <= n ? t : `${t.slice(0, n)}…`
}

/** Numero ordine mostrato al fornitore (per fornitore; diverso dall'id interno). */
function orderDisplayNum(o) {
  if (!o || typeof o !== 'object') return ''
  const n = o.sequence_number
  if (n != null && n !== '' && Number.isFinite(Number(n))) return String(n)
  return String(o.id ?? '')
}

function monthRangeFromYm(ym) {
  if (!ym || String(ym).length < 7) return { from: undefined, to: undefined }
  const [ys, ms] = String(ym).split('-')
  const y = Number(ys)
  const m = Number(ms)
  if (!y || !m) return { from: undefined, to: undefined }
  const from = `${y}-${String(m).padStart(2, '0')}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { from, to }
}

function listPriceForDescription(priceList, description) {
  const d = (description || '').trim()
  if (!d) return null
  const key = d.toLowerCase()
  const row = priceList.find((x) => (x.product_description || '').trim().toLowerCase() === key)
  return row != null ? Number(row.unit_price) : null
}

/** Mostra il prezzo listino in formato leggibile (solo suggerimento, stesso dato del prezzario). */
function formatListinoCell(priceList, description) {
  const d = (description || '').trim()
  if (!d) {
    return { text: '—', title: 'Scrivi il prodotto: qui compare il prezzo unitario dal prezzario se c’è una voce uguale.' }
  }
  const p = listPriceForDescription(priceList, d)
  if (p == null || Number.isNaN(p)) {
    return {
      text: '—',
      title:
        'Nessuna voce nel prezzario con questa descrizione. In Nuova consegna → Prezzario aggiungi la merce e il prezzo, oppure usa la stessa scritta del listino (anche maiuscole diverse).',
    }
  }
  const formatted = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(p)
  return {
    text: formatted,
    title: `Prezzo unitario dal prezzario fornitore (${formatted} / cad.). Riferimento per confronto in consegna; non sostituisce il contratto reale.`,
  }
}

function escapeHtml(s) {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Testo messaggio WhatsApp da un ordine già salvato (con righe). */
function buildWhatsAppTextFromOrder(order) {
  const supplierName = order.supplier_name || ''
  const lines = [
    'Buongiorno,',
    '',
    `Ordine merce — ${supplierName || 'Fornitore'} (riferimento n. #${orderDisplayNum(order)}):`,
    `Data ordine: ${formatDateIt(order.order_date)}`,
    `IVA indicativa: ${order.vat_percent ?? '—'}%`,
    `Stato: ${statusLabel(order.status)}`,
  ]
  if (order.expected_delivery_date) {
    lines.push(`Consegna richiesta entro: ${formatDateIt(order.expected_delivery_date)}`)
  }
  const ordDest = (order.delivery_location || '').trim()
  if (ordDest) lines.push(`Destinazione scarico / spedizione: ${ordDest}`)
  lines.push('')
  const items = order.items || []
  items.forEach((it) => {
    const bits = [it.product_description || '']
    if (it.pieces != null && !Number.isNaN(Number(it.pieces))) bits.push(`${it.pieces} pz`)
    if (it.weight_kg != null && !Number.isNaN(Number(it.weight_kg))) bits.push(`${it.weight_kg} kg`)
    if (it.note) bits.push(`(${it.note})`)
    lines.push(`• ${bits.filter(Boolean).join(' — ')}`)
  })
  const on = (order.note || '').trim()
  if (on) lines.push('', `Note ordine: ${on}`)
  lines.push('', 'Grazie.')
  return lines.join('\n')
}

export default function NewOrderPage({ onNavigate, operatorMode = false }) {
  const [suppliers, setSuppliers] = useState([])
  const [supplierId, setSupplierId] = useState('')
  const [orderDate, setOrderDate] = useState(todayIso)
  const [vatPercent, setVatPercent] = useState('23')
  const [orderStatus, setOrderStatus] = useState('pending')
  const [orderSignedBy, setOrderSignedBy] = useState('')
  const [unloadingSignedBy, setUnloadingSignedBy] = useState('')
  const [orderNote, setOrderNote] = useState('')
  const [orderNoteInternal, setOrderNoteInternal] = useState('')
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('')
  const [deliveryLocation, setDeliveryLocation] = useState('')
  const [rows, setRows] = useState([emptyRow()])
  const [loadingSuppliers, setLoadingSuppliers] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [successDetail, setSuccessDetail] = useState(null)
  const [recentOrders, setRecentOrders] = useState([])
  const [editingOrderId, setEditingOrderId] = useState(null)
  const [editingOrderSeq, setEditingOrderSeq] = useState(null)
  const [historyMonth, setHistoryMonth] = useState('')
  const [historyStatus, setHistoryStatus] = useState('')
  const [priceList, setPriceList] = useState([])
  const [priceListLoading, setPriceListLoading] = useState(false)
  const [aiOrderText, setAiOrderText] = useState('')
  const [aiOrderLoading, setAiOrderLoading] = useState(false)
  const [anomalyReport, setAnomalyReport] = useState(null)
  const [copyFromOrderId, setCopyFromOrderId] = useState('')
  const [deletingAllOrders, setDeletingAllOrders] = useState(false)
  const [voiceListening, setVoiceListening] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const [aiSummary, setAiSummary] = useState('')
  const [voiceGuideActive, setVoiceGuideActive] = useState(false)
  const [voiceGuideStep, setVoiceGuideStep] = useState(0)
  const [voiceGuidePrompt, setVoiceGuidePrompt] = useState('')
  const [voiceGuideHeard, setVoiceGuideHeard] = useState('')
  const [voiceGuideProducts, setVoiceGuideProducts] = useState([])
  const [voiceGuideInfoOpen, setVoiceGuideInfoOpen] = useState(false)
  const [operatorLinkCopied, setOperatorLinkCopied] = useState(false)
  const recognitionRef = useRef(null)

  const operatorOrderUrl = useMemo(() => getOperatorOrderPublicUrl(), [])

  const supplierLabel = useMemo(() => {
    const s = suppliers.find((x) => String(x.id) === String(supplierId))
    return s ? s.name : ''
  }, [suppliers, supplierId])

  const selectedSupplier = useMemo(
    () => suppliers.find((x) => String(x.id) === String(supplierId)) || null,
    [suppliers, supplierId],
  )

  const supplierById = useMemo(() => {
    const m = {}
    suppliers.forEach((s) => {
      m[s.id] = s
    })
    return m
  }, [suppliers])

  const filledRows = useMemo(
    () => rows.filter((r) => (r.product_description || '').trim()),
    [rows],
  )

  const stats = useMemo(() => {
    let totalPieces = 0
    let withPieces = 0
    let totalKg = 0
    let linesWithKg = 0
    filledRows.forEach((r) => {
      const p = r.pieces === '' || r.pieces == null ? null : Number(r.pieces)
      if (p != null && !Number.isNaN(p) && p > 0) {
        totalPieces += p
        withPieces += 1
      }
      const w = r.weight_kg === '' || r.weight_kg == null ? null : Number(r.weight_kg)
      if (w != null && !Number.isNaN(w) && w > 0) {
        totalKg += w
        linesWithKg += 1
      }
    })
    return { lineCount: filledRows.length, totalPieces, linesWithPieces: withPieces, totalKg, linesWithKg }
  }, [filledRows])

  const dupDescriptions = useMemo(() => {
    const counts = new Map()
    filledRows.forEach((r) => {
      const k = (r.product_description || '').trim().toLowerCase()
      if (!k) return
      counts.set(k, (counts.get(k) || 0) + 1)
    })
    return new Set([...counts.entries()].filter(([, c]) => c > 1).map(([k]) => k))
  }, [filledRows])

  const smartWarnings = useMemo(() => {
    const w = []
    if (supplierId && !normalizeWhatsAppNumber(selectedSupplier?.phone)) {
      w.push('Cellulare fornitore assente o non valido: WhatsApp userà composizione manuale.')
    }
    if (supplierId && !(selectedSupplier?.email || '').trim()) {
      w.push('Email fornitore assente: il pulsante email potrebbe non essere utile.')
    }
    if (expectedDeliveryDate && orderDate && expectedDeliveryDate < orderDate) {
      w.push('La consegna prevista è precedente alla data ordine.')
    }
    filledRows.forEach((r) => {
      const desc = (r.product_description || '').trim()
      if (!desc) return
      const p = r.pieces === '' || r.pieces == null ? null : Number(r.pieces)
      if (p === 0) w.push(`Quantità zero per «${truncate(desc, 40)}».`)
      const wk = r.weight_kg === '' || r.weight_kg == null ? null : Number(r.weight_kg)
      if (wk === 0) w.push(`Peso 0 kg per «${truncate(desc, 40)}».`)
    })
    dupDescriptions.forEach((k) => {
      w.push(`Descrizione duplicata nell’ordine: «${k}».`)
    })
    return w
  }, [supplierId, selectedSupplier, expectedDeliveryDate, orderDate, filledRows, dupDescriptions])

  useEffect(() => {
    loadSuppliers()
  }, [])

  useEffect(() => {
    const fn = (e) => {
      const lines = e.detail?.suggested_lines || e.detail?.lines
      if (!Array.isArray(lines) || !lines.length) return
      setRows(
        lines.map((l) => ({
          product_description: l.product_description || '',
          pieces: l.pieces != null ? String(l.pieces) : '',
          weight_kg: l.weight_kg != null && l.weight_kg !== '' ? String(l.weight_kg) : '',
          note: l.note || '',
        })),
      )
    }
    window.addEventListener('ai-apply-order', fn)
    return () => window.removeEventListener('ai-apply-order', fn)
  }, [])

  useEffect(() => {
    if (!voiceGuideInfoOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') setVoiceGuideInfoOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [voiceGuideInfoOpen])

  useEffect(() => {
    if (!supplierId) {
      setPriceList([])
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        setPriceListLoading(true)
        const data = await fetchPriceList(supplierId)
        if (!cancelled) setPriceList(Array.isArray(data) ? data : [])
      } catch {
        if (!cancelled) setPriceList([])
      } finally {
        if (!cancelled) setPriceListLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [supplierId])

  async function refreshRecentOrders() {
    if (!supplierId) {
      setRecentOrders([])
      return
    }
    const { from, to } = monthRangeFromYm(historyMonth)
    try {
      const data = await fetchSupplierOrders({
        supplierId,
        dateFrom: from,
        dateTo: to,
        status: historyStatus === 'pending' || historyStatus === 'sent' ? historyStatus : undefined,
        limit: 80,
      })
      setRecentOrders(Array.isArray(data) ? data : [])
    } catch {
      setRecentOrders([])
    }
  }

  useEffect(() => {
    refreshRecentOrders()
  }, [supplierId, historyMonth, historyStatus])

  useEffect(() => {
    setCopyFromOrderId('')
  }, [supplierId])

  async function runAnomalyCheck(payload) {
    try {
      const r = await checkAiAnomalies('supplier-order', {
        supplier_id: payload.supplier_id,
        order_date: payload.order_date,
        expected_delivery_date: payload.expected_delivery_date,
        items: payload.items,
      })
      setAnomalyReport(r)
      return r
    } catch {
      setAnomalyReport(null)
      return null
    }
  }

  useEffect(() => {
    if (!supplierId || Number.isNaN(Number(supplierId))) {
      setAnomalyReport(null)
      return
    }
    const payload = buildPayload()
    if (payload.items.length === 0) {
      setAnomalyReport(null)
      return
    }
    const t = window.setTimeout(() => {
      runAnomalyCheck(payload)
    }, 400)
    return () => window.clearTimeout(t)
  }, [supplierId, orderDate, expectedDeliveryDate, orderNote, orderNoteInternal, vatPercent, orderStatus, rows])

  async function loadSuppliers() {
    try {
      setLoadingSuppliers(true)
      const data = await fetchSuppliers()
      setSuppliers(data)
    } catch {
      setError('Errore nel caricamento fornitori')
    } finally {
      setLoadingSuppliers(false)
    }
  }

  function resetFormNew() {
    setEditingOrderId(null)
    setEditingOrderSeq(null)
    setOrderDate(todayIso())
    setVatPercent('23')
    setOrderStatus('pending')
    setOrderSignedBy('')
    setUnloadingSignedBy('')
    setOrderNote('')
    setOrderNoteInternal('')
    setExpectedDeliveryDate('')
    setDeliveryLocation('')
    setRows([emptyRow()])
    setSuccessDetail(null)
    setAnomalyReport(null)
  }

  function resetVoiceFields() {
    if (voiceGuideActive) stopVoiceGuide()
    setSupplierId('')
    setOrderDate(todayIso())
    setVatPercent('23')
    setExpectedDeliveryDate('')
    setDeliveryLocation('')
    setOrderSignedBy('')
    setUnloadingSignedBy('')
    setOrderNote('')
    setRows([emptyRow()])
    setAiOrderText('')
    setAiSummary('')
    setVoiceGuideProducts([])
    setVoiceGuideHeard('')
    setVoiceGuidePrompt('')
    setVoiceError('')
    setError('')
    setSuccess('Campi compilati a voce/AI azzerati. Puoi riprovare.')
  }

  function updateRow(index, field, value) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)))
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()])
  }

  function removeRow(index) {
    if (rows.length <= 1) return
    setRows((prev) => prev.filter((_, i) => i !== index))
  }

  function buildPayload() {
    const items = rows
      .map((r) => {
        const wkRaw = r.weight_kg === '' || r.weight_kg == null ? null : Number(r.weight_kg)
        const weight_kg = wkRaw != null && !Number.isNaN(wkRaw) ? wkRaw : null
        return {
          product_description: (r.product_description || '').trim(),
          pieces: r.pieces === '' || r.pieces == null ? null : Number(r.pieces),
          weight_kg,
          note: (r.note || '').trim() || null,
        }
      })
      .filter((r) => r.product_description)

    return {
      supplier_id: Number(supplierId),
      order_date: orderDate,
      vat_percent: Number(vatPercent) || 23,
      note: orderNote.trim() || null,
      note_internal: orderNoteInternal.trim() || null,
      order_signed_by: orderSignedBy.trim() || null,
      unloading_signed_by: unloadingSignedBy.trim() || null,
      delivery_location: deliveryLocation.trim() || null,
      expected_delivery_date: expectedDeliveryDate || null,
      status: orderStatus,
      items,
    }
  }

  function buildWhatsAppMessage() {
    const payload = buildPayload()
    const lines = [
      'Buongiorno,',
      '',
      `Ordine merce — ${supplierLabel || 'Fornitore'}:`,
      `Data ordine: ${formatDateIt(orderDate)}`,
      `IVA indicativa: ${vatPercent}%`,
      `Stato: ${statusLabel(orderStatus)}`,
    ]
    if (expectedDeliveryDate) {
      lines.push(`Consegna richiesta entro: ${formatDateIt(expectedDeliveryDate)}`)
    }
    const dlMsg = deliveryLocation.trim()
    if (dlMsg) lines.push(`Destinazione scarico / spedizione: ${dlMsg}`)
    lines.push('')
    payload.items.forEach((it) => {
      const bits = [it.product_description]
      if (it.pieces != null && !Number.isNaN(it.pieces)) bits.push(`${it.pieces} pz`)
      if (it.weight_kg != null && !Number.isNaN(it.weight_kg)) bits.push(`${it.weight_kg} kg`)
      if (it.note) bits.push(`(${it.note})`)
      lines.push(`• ${bits.join(' — ')}`)
    })
    const on = orderNote.trim()
    if (on) lines.push('', `Note ordine: ${on}`)
    lines.push('', 'Grazie.')
    return lines.join('\n')
  }

  function saveTemplate() {
    try {
      const snap = rows.map((r) => ({
        product_description: r.product_description || '',
        pieces: r.pieces || '',
        weight_kg: r.weight_kg || '',
        note: r.note || '',
      }))
      localStorage.setItem(TEMPLATE_LS, JSON.stringify(snap))
      setSuccess('Modello righe salvato in questo browser')
    } catch {
      setError('Impossibile salvare il modello')
    }
  }

  function loadTemplate() {
    try {
      const raw = localStorage.getItem(TEMPLATE_LS)
      if (!raw) {
        setError('Nessun modello salvato')
        return
      }
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed) || !parsed.length) {
        setError('Modello non valido')
        return
      }
      setRows(
        parsed.map((r) => ({
          product_description: r.product_description || '',
          pieces: r.pieces != null ? String(r.pieces) : '',
          weight_kg: r.weight_kg != null && r.weight_kg !== '' ? String(r.weight_kg) : '',
          note: r.note || '',
        })),
      )
      setSuccess('Modello righe caricato')
    } catch {
      setError('Lettura modello non riuscita')
    }
  }

  /**
   * Copia un ordine salvato nel modulo come nuovo ordine (bozza): data odierna, stato in sospeso, non sovrascrive l’ordine originale.
   */
  async function handleLoadOrderAsNew(orderId) {
    if (!orderId) {
      setError('Seleziona un ordine dallo storico')
      return
    }
    setError('')
    setSuccess('')
    setSuccessDetail(null)
    try {
      const o = await fetchSupplierOrder(orderId)
      setEditingOrderId(null)
      setSupplierId(String(o.supplier_id))
      setOrderDate(todayIso())
      setVatPercent(String(o.vat_percent ?? '23'))
      setOrderStatus('pending')
      setOrderSignedBy(o.order_signed_by || '')
      setUnloadingSignedBy(o.unloading_signed_by || '')
      setOrderNote(o.note || '')
      setOrderNoteInternal(o.note_internal || '')
      setExpectedDeliveryDate(o.expected_delivery_date ? String(o.expected_delivery_date).slice(0, 10) : '')
      setDeliveryLocation(o.delivery_location ? String(o.delivery_location) : '')
      const list = (o.items || []).length
        ? o.items.map((it) => ({
            product_description: it.product_description || '',
            pieces: it.pieces != null ? String(it.pieces) : '',
            weight_kg: it.weight_kg != null && it.weight_kg !== '' ? String(it.weight_kg) : '',
            note: it.note || '',
          }))
        : [emptyRow()]
      setRows(list)
      setAnomalyReport(null)
      setSuccess(
        `Ordine n. ${orderDisplayNum(o)} ripreso come nuovo (data ${formatDateIt(todayIso())}, in sospeso). Modifica le righe e salva per creare un ordine distinto.`,
      )
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      setError('Impossibile caricare l’ordine')
    }
  }

  async function duplicateLastOrder() {
    if (!recentOrders.length) {
      setError('Nessun ordine nello storico filtrato da duplicare')
      return
    }
    await handleLoadOrderAsNew(recentOrders[0].id)
  }

  function handleLoadSelectedOrderAsNew() {
    if (!copyFromOrderId) {
      setError('Scegli un ordine dal menu a tendina')
      return
    }
    handleLoadOrderAsNew(Number(copyFromOrderId))
  }

  async function handleAiSuggestFull(textOverride) {
    const t = (textOverride != null ? textOverride : aiOrderText).trim()
    if (!t) {
      setError('Scrivi o detta un testo prima di compilare con AI')
      return
    }
    try {
      setAiOrderLoading(true)
      setError('')
      setVoiceError('')
      setAiSummary('')
      const supplierNames = suppliers.map((s) => s.name).filter(Boolean)
      const r = await suggestOrderFull(t, supplierNames)
      const f = r?.suggested_fields || {}
      const lines = r?.suggested_lines || []
      const applied = []

      if (f.supplier_name) {
        const matched = suppliers.find(
          (s) => (s.name || '').toLowerCase() === String(f.supplier_name).toLowerCase(),
        )
        if (matched) {
          setSupplierId(String(matched.id))
          applied.push(`Fornitore: ${matched.name}`)
        }
      }
      if (f.order_date) {
        setOrderDate(String(f.order_date).slice(0, 10))
        applied.push(`Data ordine: ${formatDateIt(f.order_date)}`)
      }
      if (f.expected_delivery_date) {
        setExpectedDeliveryDate(String(f.expected_delivery_date).slice(0, 10))
        applied.push(`Consegna prevista: ${formatDateIt(f.expected_delivery_date)}`)
      }
      if (f.delivery_location) {
        setDeliveryLocation(String(f.delivery_location))
        applied.push(`Destinazione: ${f.delivery_location}`)
      }
      if (f.order_signed_by) {
        setOrderSignedBy(String(f.order_signed_by))
        applied.push(`Firma ordine: ${f.order_signed_by}`)
      }
      if (f.unloading_signed_by) {
        setUnloadingSignedBy(String(f.unloading_signed_by))
        applied.push(`Firma scarico: ${f.unloading_signed_by}`)
      }
      if (f.vat_percent != null) {
        setVatPercent(String(f.vat_percent))
        applied.push(`IVA: ${f.vat_percent}%`)
      }
      if (f.note) {
        setOrderNote(String(f.note))
        applied.push('Note al fornitore aggiornate')
      }
      if (lines.length) {
        setRows(
          lines.map((l) => ({
            product_description: l.product_description || '',
            pieces: l.pieces != null ? String(l.pieces) : '',
            weight_kg: l.weight_kg != null && l.weight_kg !== '' ? String(l.weight_kg) : '',
            note: l.note || '',
          })),
        )
        applied.push(`${lines.length} riga/e prodotto`)
      }

      const warnings = (r?.warnings || []).join(' · ')
      if (applied.length) {
        setSuccess(`AI ha compilato: ${applied.join(', ')}. Controlla e salva.`)
        setAiSummary(applied.join(' • '))
      } else {
        setError("AI non e' riuscita a estrarre dati dal testo")
      }
      if (warnings) setVoiceError(warnings)
    } catch {
      setError('Servizio AI non disponibile')
    } finally {
      setAiOrderLoading(false)
    }
  }

  function handleVoiceCapture() {
    if (!SpeechRecognition) {
      setVoiceError("L'assistente vocale non e' supportato (usa Chrome o Edge)")
      return
    }
    setVoiceError('')
    const rec = new SpeechRecognition()
    rec.lang = 'it-IT'
    rec.continuous = false
    rec.interimResults = false
    rec.onstart = () => setVoiceListening(true)
    rec.onend = () => setVoiceListening(false)
    rec.onerror = (e) => {
      setVoiceListening(false)
      if (e?.error === 'not-allowed') setVoiceError('Microfono non autorizzato')
      else setVoiceError('Errore rilevamento vocale')
    }
    rec.onresult = (e) => {
      const transcript = Array.from(e.results).map((r) => r[0].transcript).join(' ').trim()
      const next = aiOrderText ? `${aiOrderText.replace(/\s+$/, '')}\n${transcript}` : transcript
      setAiOrderText(next)
      window.setTimeout(() => handleAiSuggestFull(next), 250)
    }
    recognitionRef.current = rec
    try {
      rec.start()
    } catch {
      setVoiceListening(false)
    }
  }

  function stopVoiceGuide() {
    setVoiceGuideActive(false)
    setVoiceGuidePrompt('')
    setVoiceGuideStep(0)
    setVoiceGuideHeard('')
    setVoiceListening(false)
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel()
      } catch {
        /* noop */
      }
    }
  }

  function startVoiceGuide() {
    if (!SpeechRecognition) {
      setVoiceError("L'assistente vocale non e' supportato (usa Chrome o Edge)")
      return
    }
    setVoiceError('')
    setVoiceGuideHeard('')
    setVoiceGuideProducts([])
    setVoiceGuideActive(true)
    setVoiceGuideStep(0)
  }

  useEffect(() => {
    if (!voiceGuideActive) return
    const supplierPrompt = supplierId
      ? `Fornitore attuale: ${supplierLabel}. Se va bene non dire nulla. Per cambiarlo dimmi il nuovo nome.`
      : "Dimmi il nome del fornitore."
    const steps = [
      { key: 'supplier', prompt: supplierPrompt },
      { key: 'order_date', prompt: "Quando e' la data dell'ordine? Puoi dire oggi, oppure una data come 12 marzo." },
      { key: 'expected_delivery_date', prompt: "Quando e' prevista la consegna? Dimmi una data oppure passa." },
      { key: 'delivery_location', prompt: 'Dimmi la destinazione di scarico o spedizione.' },
      { key: 'order_signed_by', prompt: "Chi sta facendo l'ordine? Dimmi nome e cognome." },
      { key: 'note', prompt: 'Vuoi aggiungere note al fornitore? Dimmi le note se vuoi.' },
      { key: 'products_intro', prompt: 'Adesso passiamo ai prodotti.' },
      { key: 'product_loop', prompt: "Dimmi un prodotto con quantita' (es. \"10 kg arance\" o \"5 pasta\"). Dopo ogni prodotto di' \"andiamo avanti\". Quando hai finito tutti i prodotti, di' \"fine\"." },
      { key: '__confirm__', prompt: "Vuoi salvare l'ordine? Rispondi si' o no." },
    ]
    if (voiceGuideStep >= steps.length) {
      setVoiceGuidePrompt('Compilazione vocale completata.')
      setVoiceGuideActive(false)
      setVoiceListening(false)
      return undefined
    }
    const step = steps[voiceGuideStep]
    setVoiceGuidePrompt(step.prompt)

    const TERMINATOR_RX = /\b(andiamo\s+avanti|vai\s+avanti|prossim[oa]|continu[ai]|sono\s+pronto|pronto\s+ad?\s+andare|avanti)\b/i
    const SKIP_RX = /^(passa|salta|skip|nessuno|vuoto|nulla)\b/i
    const REPEAT_RX = /^(ripeti|ripet[iy]|di nuovo|repeat)\b/i
    const FINE_RX = /\b(fine|finito|finisci|basta|stop)\b/i
    const YES_RX = /\b(si|sì|ok|conferma|salva|procedi|va bene)\b/i
    const NO_RX = /\b(no|annulla|non salvare|cancella)\b/i

    let cancelled = false
    let recognition = null
    let buffer = ''
    let inactivityTimer = null
    let advancing = false

    const speak = (text, cb) => {
      if (cancelled) return
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
          const u = new SpeechSynthesisUtterance(text)
          u.lang = 'it-IT'
          u.rate = 1
          if (cb) u.onend = () => window.setTimeout(cb, 200)
          window.speechSynthesis.cancel()
          window.speechSynthesis.speak(u)
          return
        } catch {
          /* fallthrough */
        }
      }
      if (cb) window.setTimeout(cb, 200)
    }

    const armInactivityTimer = () => {
      if (inactivityTimer) window.clearTimeout(inactivityTimer)
      inactivityTimer = window.setTimeout(() => {
        if (cancelled || advancing) return
        speak('Sei pronto ad andare avanti?')
        armInactivityTimer()
      }, 30000)
    }

    const advance = () => {
      if (advancing || cancelled) return
      advancing = true
      cancelled = true
      if (inactivityTimer) window.clearTimeout(inactivityTimer)
      try { recognition && recognition.stop() } catch { /* noop */ }
      window.setTimeout(() => setVoiceGuideStep((s) => s + 1), 50)
    }

    const applyAndAdvance = (rawText) => {
      const text = (rawText || '').trim()
      const isSkip = SKIP_RX.test(text)
      const valueText = isSkip ? '' : text
      if (step.key === 'supplier') {
        if (valueText) {
          const norm = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').trim()
          const tnorm = norm(valueText)
          const found = suppliers.find((s) => norm(s.name) === tnorm)
            || suppliers.find((s) => tnorm && norm(s.name).includes(tnorm))
            || suppliers.find((s) => tnorm && tnorm.includes(norm(s.name)))
          if (found) setSupplierId(String(found.id))
          else if (!supplierId) setVoiceError(`Fornitore "${valueText}" non trovato. Selezionalo manualmente.`)
        }
      } else if (step.key === 'order_date') {
        if (valueText) {
          const iso = parseSpokenDateToIso(valueText)
          if (iso) setOrderDate(iso)
          else setOrderDate(todayIso())
        } else if (!orderDate) {
          setOrderDate(todayIso())
        }
      } else if (step.key === 'expected_delivery_date') {
        if (valueText) {
          const iso = parseSpokenDateToIso(valueText)
          if (iso) setExpectedDeliveryDate(iso)
        }
      } else if (step.key === 'delivery_location') {
        if (valueText) setDeliveryLocation(valueText)
      } else if (step.key === 'order_signed_by') {
        if (valueText) setOrderSignedBy(valueText)
      } else if (step.key === 'note') {
        if (valueText) setOrderNote(valueText)
      } else if (step.key === '__confirm__') {
        const yes = YES_RX.test(text)
        const no = NO_RX.test(text)
        if (yes && !no) {
          window.setTimeout(() => {
            if (!supplierId) {
              setVoiceError('Manca il fornitore: non posso salvare automaticamente.')
              return
            }
            if (!orderSignedBy.trim()) {
              setVoiceError("Manca la firma di chi fa l'ordine: non posso salvare automaticamente.")
              return
            }
            handleSave(null, {})
          }, 200)
        }
      }
      advance()
    }

    const finalizeProductLoop = () => {
      setVoiceGuideProducts((prev) => {
        if (prev.length) {
          suggestOrderLines(prev.join('\n'))
            .then((rr) => {
              const lines = rr?.suggested_lines || []
              if (lines.length) {
                setRows(
                  lines.map((l) => ({
                    product_description: l.product_description || '',
                    pieces: l.pieces != null ? String(l.pieces) : '',
                    weight_kg: l.weight_kg != null && l.weight_kg !== '' ? String(l.weight_kg) : '',
                    note: l.note || '',
                  })),
                )
              }
            })
            .catch(() => undefined)
        }
        return prev
      })
      advance()
    }

    const startRecognition = () => {
      if (cancelled) return
      if (!SpeechRecognition) {
        setVoiceError('Riconoscimento vocale non disponibile')
        advance()
        return
      }
      try {
        recognition = new SpeechRecognition()
        recognition.lang = 'it-IT'
        recognition.continuous = true
        recognition.interimResults = false
      } catch {
        setVoiceError('Riconoscimento vocale non disponibile')
        advance()
        return
      }
      recognition.onstart = () => {
        setVoiceListening(true)
        armInactivityTimer()
      }
      recognition.onend = () => {
        setVoiceListening(false)
        if (cancelled) return
        window.setTimeout(() => {
          if (!cancelled) startRecognition()
        }, 250)
      }
      recognition.onerror = () => {
        // Lasciamo che onend riavvii
      }
      recognition.onresult = (e) => {
        armInactivityTimer()
        const startIdx = typeof e.resultIndex === 'number' ? e.resultIndex : 0
        for (let i = startIdx; i < e.results.length; i++) {
          const r = e.results[i]
          if (!r || !r.isFinal) continue
          const phrase = String(r[0]?.transcript || '').trim()
          if (!phrase) continue
          setVoiceGuideHeard(phrase)

          if (REPEAT_RX.test(phrase)) {
            speak(step.prompt)
            continue
          }

          if (step.key === '__confirm__') {
            applyAndAdvance(phrase)
            return
          }

          if (step.key === 'product_loop' && FINE_RX.test(phrase) && !TERMINATOR_RX.test(phrase)) {
            const cleanedFine = phrase.replace(FINE_RX, '').trim()
            if (cleanedFine) {
              setVoiceGuideProducts((prev) => [...prev, cleanedFine])
            } else if (buffer.trim()) {
              const t = buffer.trim()
              setVoiceGuideProducts((prev) => [...prev, t])
              buffer = ''
            }
            try { recognition.stop() } catch { /* noop */ }
            cancelled = true
            if (inactivityTimer) window.clearTimeout(inactivityTimer)
            window.setTimeout(finalizeProductLoop, 80)
            return
          }

          if (TERMINATOR_RX.test(phrase)) {
            const cleaned = phrase.replace(TERMINATOR_RX, '').trim()
            if (cleaned) buffer = (buffer + ' ' + cleaned).trim()
            if (step.key === 'product_loop') {
              const t = buffer.trim()
              if (t) {
                setVoiceGuideProducts((prev) => [...prev, t])
                buffer = ''
              }
              continue
            }
            applyAndAdvance(buffer)
            return
          }

          if (SKIP_RX.test(phrase)) {
            if (step.key === 'product_loop') {
              continue
            }
            applyAndAdvance('')
            return
          }

          buffer = (buffer + ' ' + phrase).trim()
        }
      }
      try {
        recognition.start()
      } catch {
        setVoiceListening(false)
      }
    }

    speak(step.prompt, startRecognition)

    return () => {
      cancelled = true
      advancing = true
      if (inactivityTimer) window.clearTimeout(inactivityTimer)
      try { recognition && recognition.stop() } catch { /* noop */ }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try { window.speechSynthesis.cancel() } catch { /* noop */ }
      }
      setVoiceListening(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceGuideActive, voiceGuideStep])

  async function handleSave(e, opts = {}) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault()
    setError('')
    setSuccess('')
    setSuccessDetail(null)
    if (!supplierId) {
      setError('Seleziona un fornitore')
      return
    }
    if (opts.requireDelivery && !deliveryLocation.trim()) {
      setError('Inserisci la destinazione scarico / spedizione per salvare con destinazione')
      return
    }
    if (!orderSignedBy.trim()) {
      setError("Inserisci la firma: chi fa l'ordine")
      return
    }
    const payload = buildPayload()
    if (payload.items.length === 0) {
      setError('Aggiungi almeno un prodotto con descrizione')
      return
    }
    const check = await runAnomalyCheck(payload)
    if (check?.has_anomalies && check?.severity === 'medium') {
      const ok = window.confirm(
        `Attenzione: ${(check.anomalies || []).join(' · ')}\n\nSalvare comunque?`,
      )
      if (!ok) return
    }
    try {
      setSaving(true)
      let saved
      if (editingOrderId != null) {
        saved = await updateSupplierOrder(editingOrderId, payload)
        const dn = orderDisplayNum(saved)
        setSuccess(`Ordine n. ${dn} aggiornato`)
      } else {
        saved = await createSupplierOrder(payload)
        const dn = orderDisplayNum(saved)
        setSuccess(`Ordine salvato (n. ${dn})`)
      }
      setSuccessDetail({
        id: saved?.id,
        sequence_number: saved?.sequence_number ?? saved?.id,
        date: saved?.order_date,
        supplier: saved?.supplier_name || supplierLabel,
        merchandise: saved?.merchandise_summary,
        status: saved?.status || orderStatus,
      })
      setEditingOrderId(null)
      setEditingOrderSeq(null)
      setOrderDate(todayIso())
      setVatPercent('23')
      setOrderStatus('pending')
      setOrderSignedBy('')
      setUnloadingSignedBy('')
      setOrderNote('')
      setOrderNoteInternal('')
      setExpectedDeliveryDate('')
      setRows([emptyRow()])
      setAnomalyReport(null)
      await refreshRecentOrders()
    } catch {
      setError('Operazione non riuscita. Verifica server e migrazioni database (ordini).')
    } finally {
      setSaving(false)
    }
  }

  function handleWhatsApp() {
    setError('')
    setSuccess('')
    setSuccessDetail(null)
    if (!supplierId) {
      setError('Seleziona un fornitore')
      return
    }
    const payload = buildPayload()
    if (payload.items.length === 0) {
      setError('Aggiungi almeno un prodotto con descrizione')
      return
    }
    const encoded = encodeURIComponent(buildWhatsAppMessage())
    const waNum = normalizeWhatsAppNumber(selectedSupplier?.phone)
    const url = waNum ? `https://wa.me/${waNum}?text=${encoded}` : `https://wa.me/?text=${encoded}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  function handleEmail() {
    setError('')
    const em = (selectedSupplier?.email || '').trim()
    if (!em) {
      setError('Email fornitore mancante in anagrafica')
      return
    }
    const payload = buildPayload()
    if (payload.items.length === 0) {
      setError('Aggiungi almeno un prodotto con descrizione')
      return
    }
    const sub = encodeURIComponent(`Ordine merce — ${supplierLabel || 'Fornitore'} — ${formatDateIt(orderDate)}`)
    const body = encodeURIComponent(buildWhatsAppMessage())
    window.location.href = `mailto:${em}?subject=${sub}&body=${body}`
  }

  function handleOpenPdf(id) {
    if (!id) return
    window.open(supplierOrderPdfUrl(id), '_blank', 'noopener,noreferrer')
  }

  function whatsappUrlForSupplierChat(sid) {
    const sup = supplierById[sid]
    const waNum = normalizeWhatsAppNumber(sup?.phone)
    if (!waNum) return null
    const name = (sup?.name || '').trim()
    const text = encodeURIComponent(
      name ? `Buongiorno, le scrivo da ${name} per un ordine merce.` : 'Buongiorno, le scrivo per un ordine merce.',
    )
    return `https://wa.me/${waNum}?text=${text}`
  }

  async function handleWhatsAppSavedOrder(order) {
    setError('')
    let full = order
    if (!order.items || order.items.length === 0) {
      try {
        full = await fetchSupplierOrder(order.id)
      } catch {
        setError('Impossibile caricare l’ordine per WhatsApp')
        return
      }
    }
    const sup = supplierById[full.supplier_id]
    const waNum = normalizeWhatsAppNumber(sup?.phone)
    const encoded = encodeURIComponent(buildWhatsAppTextFromOrder(full))
    const url = waNum ? `https://wa.me/${waNum}?text=${encoded}` : `https://wa.me/?text=${encoded}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  async function handleWhatsAppAfterSave(orderId) {
    if (!orderId) return
    setError('')
    try {
      const full = await fetchSupplierOrder(orderId)
      await handleWhatsAppSavedOrder(full)
    } catch {
      setError('Impossibile aprire WhatsApp per questo ordine')
    }
  }

  function handlePrintHistoryPdf() {
    if (!recentOrders.length) return
    setError('')
    const title = escapeHtml(`Storico ordini — ${supplierLabel || 'Fornitore'}`)
    const sub = []
    if (historyMonth) sub.push(`Mese filtro: ${historyMonth}`)
    if (historyStatus === 'pending') sub.push('Stato: in sospeso')
    if (historyStatus === 'sent') sub.push('Stato: inviato')
    const subLine = escapeHtml(sub.join(' · '))
    const rowsHtml = recentOrders
      .map((o) => {
        const pdfHref = supplierOrderPdfUrl(o.id)
        return `<tr>
          <td>${escapeHtml(formatDateIt(o.order_date))}</td>
          <td>${escapeHtml(o.expected_delivery_date ? formatDateIt(o.expected_delivery_date) : '—')}</td>
          <td>#${orderDisplayNum(o)}</td>
          <td>${escapeHtml(truncate(o.merchandise_summary, 80))}</td>
          <td>${escapeHtml(statusLabel(o.status))}</td>
          <td><a href="${escapeHtml(pdfHref)}">PDF ordine</a></td>
        </tr>`
      })
      .join('')
    // Blob URL + finestra senza noopener: document.write su about:blank e spesso window.open(...,noopener) lasciano pagina bianca.
    const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${title}</title>
  <style>
    body { font-family: Segoe UI, system-ui, sans-serif; color: #111; padding: 1rem; margin: 0; }
    h1 { font-size: 1.1rem; margin: 0 0 0.25rem 0; }
    .sub { color: #555; font-size: 0.85rem; margin-bottom: 0.75rem; }
    table { border-collapse: collapse; width: 100%; font-size: 0.8rem; }
    th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #f0f4f8; }
    @media print {
      body { padding: 0.5rem; }
      a { color: #000; text-decoration: underline; }
    }
  </style>
</head>
<body onload="setTimeout(function(){ try { window.focus(); window.print(); } catch (e) {} }, 300)">
  <h1>${title}</h1>
  ${subLine ? `<p class="sub">${subLine}</p>` : ''}
  <p class="sub">Per il dettaglio completo (note, righe, note interne) apri il link PDF di ogni ordine.</p>
  <table>
    <thead>
      <tr>
        <th>Data ordine</th>
        <th>Consegna prev.</th>
        <th>N.</th>
        <th>Merce</th>
        <th>Stato</th>
        <th>PDF</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body>
</html>`
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const blobUrl = URL.createObjectURL(blob)
    const w = window.open(blobUrl, '_blank')
    if (!w) {
      URL.revokeObjectURL(blobUrl)
      setError('Abilita i popup per stampare o salvare il PDF dell’elenco')
      return
    }
    const revokeLater = window.setTimeout(() => {
      try {
        URL.revokeObjectURL(blobUrl)
      } catch {
        // ignore
      }
    }, 120000)
    const onDone = () => window.clearTimeout(revokeLater)
    w.addEventListener(
      'afterprint',
      () => {
        onDone()
        try {
          URL.revokeObjectURL(blobUrl)
        } catch {
          // ignore
        }
      },
      { once: true },
    )
  }

  function handleRegisterDelivery() {
    if (operatorMode) return
    setError('')
    if (!supplierId) {
      setError('Seleziona un fornitore')
      return
    }
    const payload = buildPayload()
    if (payload.items.length === 0) {
      setError('Aggiungi almeno una riga merce')
      return
    }
    try {
      sessionStorage.setItem(
        'deliveryPrefillFromOrder',
        JSON.stringify({
          supplier_id: Number(supplierId),
          delivery_location: deliveryLocation.trim() || null,
          items: payload.items.map((it) => ({
            product_description: it.product_description,
            weight_kg: it.weight_kg != null && it.weight_kg !== '' ? String(it.weight_kg) : '',
            pieces: it.pieces != null ? String(it.pieces) : '',
            unit_price: '',
            note: it.note || '',
            anomaly_note: '',
          })),
          note_hint: orderNote.trim() || null,
          order_signed_by: orderSignedBy.trim() || null,
          unloading_signed_by: unloadingSignedBy.trim() || null,
        }),
      )
    } catch {
      setError('Impossibile preparare la consegna')
      return
    }
    if (onNavigate) onNavigate('new-delivery')
    else window.dispatchEvent(new CustomEvent('navigate-app', { detail: { page: 'new-delivery' } }))
  }

  async function handleEditOrder(order) {
    setError('')
    setSuccess('')
    setSuccessDetail(null)
    try {
      const o = await fetchSupplierOrder(order.id)
      setEditingOrderId(o.id)
      setEditingOrderSeq(orderDisplayNum(o))
      setSupplierId(String(o.supplier_id))
      setOrderDate(String(o.order_date).slice(0, 10))
      setVatPercent(String(o.vat_percent ?? '23'))
      setOrderStatus(o.status === 'sent' ? 'sent' : 'pending')
      setOrderSignedBy(o.order_signed_by || '')
      setUnloadingSignedBy(o.unloading_signed_by || '')
      setOrderNote(o.note || '')
      setOrderNoteInternal(o.note_internal || '')
      setExpectedDeliveryDate(o.expected_delivery_date ? String(o.expected_delivery_date).slice(0, 10) : '')
      setDeliveryLocation(o.delivery_location ? String(o.delivery_location) : '')
      const list = (o.items || []).length
        ? o.items.map((it) => ({
            product_description: it.product_description || '',
            pieces: it.pieces != null ? String(it.pieces) : '',
            weight_kg: it.weight_kg != null && it.weight_kg !== '' ? String(it.weight_kg) : '',
            note: it.note || '',
          }))
        : [emptyRow()]
      setRows(list)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      setError('Impossibile caricare l’ordine')
    }
  }

  async function handleDeleteOrder(order) {
    if (!window.confirm(`Eliminare l’ordine del ${formatDateIt(order.order_date)}?`)) return
    setError('')
    try {
      await deleteSupplierOrder(order.id)
      if (editingOrderId === order.id) resetFormNew()
      setSuccess('Ordine eliminato')
      await refreshRecentOrders()
    } catch {
      setError('Eliminazione non riuscita')
    }
  }

  async function handleDeleteAllOrders() {
    if (!supplierId) {
      setError('Seleziona prima un fornitore')
      return
    }
    const label = supplierLabel || 'fornitore selezionato'
    const ok = window.confirm(
      `ATTENZIONE: stai per eliminare TUTTO lo storico ordini di "${label}".\n\nVuoi davvero procedere?`
    )
    if (!ok) return
    const ok2 = window.confirm(
      `Confermi definitivamente l’eliminazione di tutti gli ordini di "${label}"? Operazione irreversibile.`
    )
    if (!ok2) return
    setError('')
    setSuccess('')
    setDeletingAllOrders(true)
    try {
      await deleteAllSupplierOrders({ supplierId })
      resetFormNew()
      setSuccess(`Storico ordini di "${label}" eliminato`)
      await refreshRecentOrders()
    } catch (e) {
      setError(e?.message || 'Eliminazione storico non riuscita')
    } finally {
      setDeletingAllOrders(false)
    }
  }

  const waPreview = buildWhatsAppMessage()

  async function copyOperatorLink() {
    const url = operatorOrderUrl
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      const el = document.createElement('textarea')
      el.value = url
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setOperatorLinkCopied(true)
    window.setTimeout(() => setOperatorLinkCopied(false), 2500)
  }

  return (
    <div>
      <section className="staff-page-hero">
      <h1 className="page-header staff-page-title">Nuovo ordine</h1>
      <p className="staff-page-lead">
        {operatorMode ? (
          <>
            Inserisci ordini verso i fornitori: stessi dati e salvataggio del gestionale ATLAS. Dopo il salvataggio puoi
            inviare <strong>PDF</strong>, <strong>email</strong> o <strong>WhatsApp</strong> al fornitore.
          </>
        ) : (
          <>
            Ordine verso un fornitore con più righe merce, note al fornitore e note interne, consegna prevista e controlli
            rapidi. Puoi <strong>caricare un ordine già fatto</strong> (menu &quot;Carica ordine vecchio&quot; o pulsante nello
            storico) per riprenderlo come <strong>bozza nuova</strong>, modificarlo e salvare; da storico,{' '}
            <strong>Modifica</strong> aggiorna invece quell’ordine. Dopo il salvataggio: PDF, email, WhatsApp o Nuova consegna
            precompilata. Puoi indicare la <strong>destinazione scarico / spedizione</strong> anche nell&apos;ordine; lo stesso testo viene proposto in{' '}
            <strong>Nuova consegna</strong> quando usi &quot;Registra consegna (precompila)&quot;.
          </>
        )}
      </p>
      </section>

      {!operatorMode && (
        <section className="card operator-link-card" style={{ marginBottom: '1rem' }}>
          <h2 className="page-subheader" style={{ marginTop: 0, fontSize: '1.05rem' }}>
            Link operatore (solo nuovo ordine)
          </h2>
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Condividi questo indirizzo con chi deve <strong>solo compilare ordini</strong>: vede la stessa pagina Nuovo ordine,
            senza menu Home, consegne, fatture ecc. Gli ordini salvati compaiono nel gestionale completo.
          </p>
          <div className="operator-link-row">
            <input
              type="text"
              className="form-control"
              readOnly
              value={operatorOrderUrl}
              aria-label="Link pagina operatore"
              onFocus={(e) => e.target.select()}
            />
            <button type="button" className="btn btn-primary" onClick={() => copyOperatorLink()}>
              {operatorLinkCopied ? 'Copiato' : 'Copia link'}
            </button>
            <a
              href={operatorOrderUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
            >
              Apri
            </a>
          </div>
        </section>
      )}

      {loadingSuppliers && <p className="loading">Caricamento fornitori...</p>}
      {error && <div className="alert alert-danger">{error}</div>}
      {success && (
        <div className="alert alert-success">
          <div>{success}</div>
          {successDetail && (
            <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.2rem', fontSize: '0.9rem' }}>
              <li>
                <strong>Data:</strong> {formatDateIt(successDetail.date)}
              </li>
              <li>
                <strong>Fornitore:</strong> {successDetail.supplier || '—'}
              </li>
              <li>
                <strong>Descrizione merce:</strong> {successDetail.merchandise || '—'}
              </li>
              <li>
                <strong>Stato:</strong> {statusLabel(successDetail.status)}
              </li>
              {successDetail.id != null && (
                <li>
                  <strong>N. ordine:</strong> #{successDetail.sequence_number ?? successDetail.id}{' '}
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ marginLeft: '0.35rem' }}
                    onClick={() => handleOpenPdf(successDetail.id)}
                  >
                    Scarica PDF
                  </button>
                  <button
                    type="button"
                    className="btn btn-whatsapp btn-sm"
                    style={{ marginLeft: '0.35rem' }}
                    onClick={() => handleWhatsAppAfterSave(successDetail.id)}
                  >
                    Invia su WhatsApp
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {(smartWarnings.length > 0 || (anomalyReport?.has_anomalies && (anomalyReport?.anomalies || []).length)) && (
        <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
          <strong>Avvisi</strong>
          <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.2rem' }}>
            {smartWarnings.map((w, i) => (
              <li key={`w-${i}`}>{w}</li>
            ))}
            {(anomalyReport?.anomalies || []).map((a, i) => (
              <li key={`a-${i}`}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      <section className="card" style={{ marginBottom: '1rem' }}>
        <div className="form-row" style={{ alignItems: 'flex-end' }}>
          <div className="form-group">
            <strong>Righe compilate</strong>
            <div style={{ fontSize: '1.1rem' }}>{stats.lineCount}</div>
          </div>
          <div className="form-group">
            <strong>Pezzi totali (somma righe)</strong>
            <div style={{ fontSize: '1.1rem' }}>{stats.totalPieces || '—'}</div>
          </div>
          <div className="form-group">
            <strong>Righe con quantità</strong>
            <div style={{ fontSize: '1.1rem' }}>
              {stats.linesWithPieces}/{stats.lineCount || 0}
            </div>
          </div>
          <div className="form-group">
            <strong>Kg totali (somma righe)</strong>
            <div style={{ fontSize: '1.1rem' }}>
              {stats.totalKg > 0 ? `${stats.totalKg.toFixed(3).replace(/\.?0+$/, '')} kg` : '—'}
            </div>
          </div>
          <div className="form-group">
            <strong>Righe con peso</strong>
            <div style={{ fontSize: '1.1rem' }}>
              {stats.linesWithKg}/{stats.lineCount || 0}
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        {editingOrderId != null && (
          <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
            Stai modificando l’ordine <strong>n. {editingOrderSeq ?? editingOrderId}</strong>.
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ marginLeft: '0.75rem' }}
              onClick={resetFormNew}
            >
              Annulla modifica
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ marginLeft: '0.5rem' }}
              onClick={() => handleOpenPdf(editingOrderId)}
            >
              PDF ordine
            </button>
          </div>
        )}
        <form onSubmit={handleSave}>
          <div className="form-row">
            <div className="form-group">
              <label>Fornitore</label>
              <select
                className="form-control"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                disabled={loadingSuppliers}
              >
                <option value="">Seleziona...</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Data ordine</label>
              <input type="date" className="form-control" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Consegna prevista</label>
              <input
                type="date"
                className="form-control"
                value={expectedDeliveryDate}
                onChange={(e) => setExpectedDeliveryDate(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>IVA %</label>
              <input
                type="number"
                step="0.1"
                min="0"
                className="form-control"
                value={vatPercent}
                onChange={(e) => setVatPercent(e.target.value)}
                style={{ maxWidth: 120 }}
              />
            </div>
            <div className="form-group">
              <label>Stato ordine</label>
              <select className="form-control" value={orderStatus} onChange={(e) => setOrderStatus(e.target.value)} style={{ maxWidth: 200 }}>
                <option value="pending">In sospeso</option>
                <option value="sent">Inviato</option>
              </select>
            </div>
          </div>

          <h3 className="page-subheader" style={{ marginTop: '1rem' }}>
            Compila ordine a voce
          </h3>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '0.75rem',
              marginBottom: '0.75rem',
            }}
          >
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: 0, flex: '1 1 260px', maxWidth: '100%' }}>
              Detta in linguaggio naturale o usa la guida vocale: l&apos;assistente compila in automatico{' '}
              <strong>fornitore, date, destinazione, firma e prodotti</strong>. Per le istruzioni dettagliate della guida vocale usa il pulsante a destra.
            </p>
            <button
              type="button"
              className="btn btn-outline-secondary"
              style={{ flexShrink: 0 }}
              onClick={() => setVoiceGuideInfoOpen(true)}
            >
              Info guida
            </button>
          </div>
          {voiceError && <div className="alert alert-warning" style={{ marginBottom: '0.5rem' }}>{voiceError}</div>}
          {voiceGuidePrompt && (
            <div className="alert alert-info" style={{ marginBottom: '0.5rem' }}>
              <strong>Guida vocale:</strong> {voiceGuidePrompt}
              {voiceGuideHeard ? (
                <div style={{ marginTop: '0.35rem', color: 'var(--text-muted)' }}>Hai detto: &quot;{voiceGuideHeard}&quot;</div>
              ) : null}
              {voiceGuideProducts.length > 0 ? (
                <div style={{ marginTop: '0.35rem', color: 'var(--text-muted)' }}>
                  Prodotti raccolti: {voiceGuideProducts.join(' • ')}
                </div>
              ) : null}
            </div>
          )}
          {aiSummary && !voiceGuidePrompt && (
            <div className="alert alert-success" style={{ marginBottom: '0.5rem' }}>
              <strong>Compilato:</strong> {aiSummary}
            </div>
          )}
          <div className="btn-group" style={{ marginBottom: '1rem', flexWrap: 'wrap', gap: '0.4rem' }}>
            {SpeechRecognition && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleVoiceCapture}
                  disabled={voiceListening || voiceGuideActive}
                  title="Detta liberamente: il sistema estrae automaticamente i campi"
                >
                  {voiceListening ? '🎤 In ascolto...' : '🎤 Detta'}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={voiceGuideActive ? stopVoiceGuide : startVoiceGuide}
                  disabled={voiceListening && !voiceGuideActive}
                  title="Guida vocale: l'assistente ti chiede un dato alla volta"
                >
                  {voiceGuideActive ? '⏹️ Ferma guida' : '🗣️ Guida vocale passo-passo'}
                </button>
              </>
            )}
            <button
              type="button"
              className="btn btn-outline-danger"
              onClick={resetVoiceFields}
              title="Cancella tutti i campi compilati a voce per ricominciare"
            >
              🔁 Reset campi
            </button>
          </div>

          <h3 className="page-subheader" style={{ marginTop: '0.5rem' }}>
            Prodotti da ordinare
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '-0.35rem', marginBottom: '0.5rem' }}>
            Nella colonna <strong>Listino</strong> compare il <strong>prezzo unitario (€/u)</strong> preso dal{' '}
            <strong>prezzario del fornitore</strong> (stessa descrizione prodotto che in Nuova consegna → Prezzario). È un
            promemoria in compilazione, non un prezzo vincolante sull’ordine.
          </p>
          {priceListLoading && supplierId && (
            <p className="loading" style={{ fontSize: '0.85rem' }}>
              Caricamento listino fornitore…
            </p>
          )}
          <div className="table-wrap" style={{ marginBottom: '1rem' }}>
            <table className="app-table">
              <thead>
                <tr>
                  <th>Prodotto</th>
                  <th
                    style={{ minWidth: 100 }}
                    title="Prezzo unitario dal prezzario fornitore quando la descrizione coincide (anche senza distinzione maiuscole/minuscole)."
                  >
                    Listino (€/u)
                  </th>
                  <th style={{ minWidth: 90 }}>Pezzi</th>
                  <th style={{ minWidth: 100 }}>Kg</th>
                  <th style={{ minWidth: 200 }}>Note</th>
                  <th style={{ minWidth: 200 }}>Azioni</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const desc = (row.product_description || '').trim()
                  const listino = formatListinoCell(priceList, row.product_description)
                  const isDup = desc && dupDescriptions.has(desc.toLowerCase())
                  return (
                    <tr key={index} className={isDup ? 'table-warning' : undefined} style={isDup ? { background: 'rgba(255, 193, 7, 0.12)' } : undefined}>
                      <td>
                        <input
                          id={`order-line-prod-${index}`}
                          className="form-control"
                          value={row.product_description}
                          onChange={(e) => updateRow(index, 'product_description', e.target.value)}
                          placeholder="es. carciofi, arance"
                        />
                      </td>
                      <td
                        className="text-end amount"
                        style={{ fontSize: '0.9rem', color: 'var(--text-muted)', cursor: 'help' }}
                        title={listino.title}
                      >
                        {listino.text}
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          className="form-control"
                          value={row.pieces}
                          onChange={(e) => updateRow(index, 'pieces', e.target.value)}
                          placeholder="opz."
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          className="form-control"
                          value={row.weight_kg}
                          onChange={(e) => updateRow(index, 'weight_kg', e.target.value)}
                          placeholder="opz."
                          title="Peso in chilogrammi (es. 2,5 per ortofrutta sfusa)"
                        />
                      </td>
                      <td>
                        <input
                          className="form-control"
                          value={row.note}
                          onChange={(e) => updateRow(index, 'note', e.target.value)}
                          placeholder="opzionale"
                        />
                      </td>
                      <td>
                        <div className="btn-group" style={{ marginTop: 0 }}>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem' }}
                            onClick={() => document.getElementById(`order-line-prod-${index}`)?.focus()}
                            title="Passa alla modifica di questa riga"
                          >
                            Modifica
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline-danger"
                            onClick={() => removeRow(index)}
                            disabled={rows.length <= 1}
                            style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem' }}
                          >
                            Rimuovi
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <button type="button" className="btn btn-secondary" onClick={addRow} style={{ marginBottom: '1rem' }}>
            + Aggiungi riga
          </button>

          <div className="form-row" style={{ alignItems: 'stretch', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div className="form-group" style={{ flex: '1 1 320px', minWidth: 280, marginBottom: 0 }}>
              <label>Note al fornitore (incluse in WhatsApp / email / PDF)</label>
              <textarea className="form-control" value={orderNote} onChange={(e) => setOrderNote(e.target.value)} rows={2} />
            </div>
            <div className="form-group" style={{ flex: '1 1 320px', minWidth: 280, marginBottom: 0 }}>
              <label>Destinazione scarico / spedizione</label>
              <input
                type="text"
                className="form-control"
                value={deliveryLocation}
                onChange={(e) => setDeliveryLocation(e.target.value)}
                placeholder="es. sede, magazzino, indirizzo di scarico"
                maxLength={128}
                autoComplete="off"
              />
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.35rem', marginBottom: 0 }}>
                Opzionale con <strong>Salva ordine</strong>; obbligatoria con <strong>Salva ordine con destinazione</strong>.
                Compare nel PDF e nel messaggio WhatsApp / email.
              </p>
            </div>
          </div>
          <div className="form-group">
            <label>Note interne (solo archivio / PDF, non inviate al fornitore)</label>
            <textarea
              className="form-control"
              value={orderNoteInternal}
              onChange={(e) => setOrderNoteInternal(e.target.value)}
              rows={2}
            />
          </div>

          {supplierId && recentOrders.length > 0 && (
            <div
              className="form-row"
              style={{
                alignItems: 'flex-end',
                marginBottom: '1rem',
                flexWrap: 'wrap',
                gap: '0.5rem',
                padding: '0.75rem',
                background: 'var(--surface-2, rgba(0,0,0,0.04))',
                borderRadius: 8,
                border: '1px solid var(--border-subtle, rgba(0,0,0,0.08))',
              }}
            >
              <div className="form-group" style={{ minWidth: 260, flex: '1 1 260px', marginBottom: 0 }}>
                <label>Carica ordine vecchio (come nuovo)</label>
                <select
                  className="form-control"
                  value={copyFromOrderId}
                  onChange={(e) => setCopyFromOrderId(e.target.value)}
                  aria-label="Seleziona ordine da riprendere come nuovo"
                >
                  <option value="">Scegli data e ordine…</option>
                  {recentOrders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {formatDateIt(o.order_date)} — n. {orderDisplayNum(o)} — {truncate(o.merchandise_summary, 42)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleLoadSelectedOrderAsNew}
                  title="Copia righe e note nell’ordine in compilazione (data odierna). Non modifica l’ordine archiviato."
                >
                  Carica in nuovo ordine
                </button>
              </div>
            </div>
          )}

          <details className="card" style={{ marginBottom: '1rem', padding: '0.75rem' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Anteprima messaggio WhatsApp / email</summary>
            <pre
              style={{
                marginTop: '0.75rem',
                whiteSpace: 'pre-wrap',
                fontSize: '0.88rem',
                maxHeight: 220,
                overflow: 'auto',
                background: 'var(--surface-2, #f5f5f5)',
                padding: '0.6rem',
                borderRadius: 6,
              }}
            >
              {waPreview}
            </pre>
          </details>

          <div className="form-row" style={{ alignItems: 'flex-end', marginBottom: '0.75rem' }}>
            <div className="form-group" style={{ minWidth: 260, marginBottom: 0 }}>
              <label>Firma (chi fa l'ordine) *</label>
              <input
                className="form-control"
                value={orderSignedBy}
                onChange={(e) => setOrderSignedBy(e.target.value)}
                placeholder="Nome e cognome"
              />
            </div>
          </div>
          <div className="btn-group" style={{ flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Salvataggio...' : editingOrderId != null ? 'Aggiorna ordine' : 'Salva ordine'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={() => handleSave(null, { requireDelivery: true })}
              title="Richiede il campo destinazione compilato sopra"
            >
              {saving ? 'Salvataggio...' : editingOrderId != null ? 'Aggiorna con destinazione' : 'Salva ordine con destinazione'}
            </button>
            <button type="button" className="btn btn-whatsapp" onClick={handleWhatsApp} disabled={!supplierId}>
              Invia ordine via WhatsApp
            </button>
            <button type="button" className="btn btn-secondary" onClick={handleEmail} disabled={!supplierId}>
              Email al fornitore
            </button>
            {!operatorMode && (
              <button type="button" className="btn btn-secondary" onClick={() => handleRegisterDelivery()} disabled={!supplierId}>
                Registra consegna (precompila)
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={saveTemplate}>
              Salva modello righe
            </button>
            <button type="button" className="btn btn-secondary" onClick={loadTemplate}>
              Carica modello righe
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={duplicateLastOrder}
              disabled={!supplierId || !recentOrders.length}
              title="Riprende il primo ordine dell’elenco filtrato sotto (come «Carica ordine vecchio»)"
            >
              Duplica ultimo in elenco
            </button>
          </div>
          {!selectedSupplier?.phone && supplierId && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.75rem', marginBottom: 0 }}>
              Aggiungi il cellulare al fornitore in <strong>Fornitori</strong> per aprire WhatsApp direttamente sul suo numero.
            </p>
          )}
        </form>
      </section>

      {supplierId && (
        <section className="card">
          <h2 className="page-subheader" style={{ marginTop: 0 }}>
            Storico ordini (stesso fornitore)
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: '-0.35rem', marginBottom: '0.75rem' }}>
            Dal nome fornitore puoi aprire una <strong>chat WhatsApp</strong>; da Azioni invii il <strong>testo dell’ordine</strong> salvato o apri il{' '}
            <strong>PDF</strong>. <strong>Nuovo da questo</strong> copia l’ordine nel modulo come bozza nuova;{' '}
            <strong>Modifica</strong> cambia l’ordine salvato. Destinazione: campo nell&apos;ordine sopra o in{' '}
            <strong>Nuova consegna</strong>.{' '}
            &quot;Stampa elenco&quot; per PDF dello storico filtrato.
          </p>
          <div className="form-row" style={{ marginBottom: '1rem', alignItems: 'flex-end' }}>
            <div className="form-group">
              <label>Filtra per mese (data ordine)</label>
              <input type="month" className="form-control" value={historyMonth} onChange={(e) => setHistoryMonth(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Stato</label>
              <select className="form-control" value={historyStatus} onChange={(e) => setHistoryStatus(e.target.value)} style={{ maxWidth: 200 }}>
                <option value="">Tutti</option>
                <option value="pending">In sospeso</option>
                <option value="sent">Inviato</option>
              </select>
            </div>
            <div className="form-group">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setHistoryMonth(''); setHistoryStatus('') }}>
                Reset filtri
              </button>
            </div>
            <div className="form-group">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={!recentOrders.length}
                onClick={handlePrintHistoryPdf}
                title="Apre una finestra di stampa: scegli Salva come PDF"
              >
                Stampa / PDF elenco
              </button>
            </div>
            {!operatorMode && (
              <div className="form-group">
                <button
                  type="button"
                  className="btn btn-outline-danger btn-sm"
                  disabled={deletingAllOrders || !supplierId}
                  onClick={handleDeleteAllOrders}
                  title="Elimina tutti gli ordini del fornitore selezionato"
                >
                  {deletingAllOrders ? 'Eliminazione...' : 'Elimina tutto lo storico (fornitore)'}
                </button>
              </div>
            )}
          </div>
          {recentOrders.length === 0 ? (
            <p className="empty-state">Nessun ordine con i filtri attuali.</p>
          ) : (
            <div className="table-wrap">
              <table className="app-table app-table--compact">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th className="text-end" style={{ whiteSpace: 'nowrap' }}>N.</th>
                    <th>Consegna prev.</th>
                    <th>Firma ordine</th>
                    <th>Fornitore / WhatsApp</th>
                    <th>Descrizione merce</th>
                    <th>Stato</th>
                    <th className="text-end">Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map((o) => {
                    const supplierChatUrl = whatsappUrlForSupplierChat(o.supplier_id)
                    return (
                      <tr key={o.id}>
                        <td>{formatDateIt(o.order_date)}</td>
                        <td className="text-end" style={{ fontWeight: 600 }}>{orderDisplayNum(o)}</td>
                        <td>{o.expected_delivery_date ? formatDateIt(o.expected_delivery_date) : '—'}</td>
                        <td>{o.order_signed_by || '—'}</td>
                        <td>
                          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.4rem' }}>
                            <span>{o.supplier_name || supplierLabel || '—'}</span>
                            {supplierChatUrl ? (
                              <a
                                href={supplierChatUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-whatsapp"
                                style={{ padding: '0.2rem 0.45rem', fontSize: '0.75rem', textDecoration: 'none', lineHeight: 1.2 }}
                                title="Apri chat WhatsApp con il fornitore"
                              >
                                Chat
                              </a>
                            ) : (
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }} title="Aggiungi il cellulare in Fornitori">
                                —
                              </span>
                            )}
                          </div>
                        </td>
                        <td title={o.merchandise_summary || ''}>{truncate(o.merchandise_summary, 56)}</td>
                        <td>{statusLabel(o.status)}</td>
                        <td className="text-end" style={{ whiteSpace: 'nowrap' }}>
                          <button
                            type="button"
                            className="btn btn-whatsapp"
                            style={{ padding: '0.35rem 0.55rem', fontSize: '0.8rem', marginRight: '0.3rem' }}
                            onClick={() => handleWhatsAppSavedOrder(o)}
                            title="Invia testo ordine su WhatsApp"
                          >
                            Ordine WA
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem', marginRight: '0.35rem' }}
                            onClick={() => handleOpenPdf(o.id)}
                          >
                            PDF
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem', marginRight: '0.35rem' }}
                            onClick={() => handleLoadOrderAsNew(o.id)}
                            title="Copia questo ordine nel modulo sopra come nuovo (data odierna); la numerazione interna resta in archivio finché non salvi un nuovo ordine"
                          >
                            Nuovo da questo
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem', marginRight: '0.35rem' }}
                            onClick={() => handleEditOrder(o)}
                          >
                            Modifica
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline-danger"
                            style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem' }}
                            onClick={() => handleDeleteOrder(o)}
                          >
                            Elimina
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {voiceGuideInfoOpen && (
        <div
          className="staff-report-modal-backdrop"
          role="presentation"
          onClick={() => setVoiceGuideInfoOpen(false)}
        >
          <div
            className="card staff-report-modal"
            style={{ maxWidth: 520, width: 'min(96vw, 520px)' }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="voice-guide-info-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="voice-guide-info-title" className="page-subheader" style={{ marginTop: 0 }}>
              Come funziona la guida vocale
            </h3>
            <div style={{ fontSize: '0.92rem', lineHeight: 1.55, color: 'var(--text-body)' }}>
              <ul style={{ margin: '0 0 1rem', paddingLeft: '1.25rem' }}>
                <li>
                  Per ogni campo l&apos;assistente ti fa una domanda e <strong>resta in ascolto</strong>.
                </li>
                <li>
                  Parla quanto vuoi (anche più frasi), poi di&apos; <strong>&quot;andiamo avanti&quot;</strong> per passare al campo successivo.
                </li>
                <li>
                  Comandi utili: <em>passa</em> per saltare il campo, <em>ripeti</em> per riascoltare, <em>fine</em> per terminare la lista prodotti.
                </li>
                <li>
                  Se resti in silenzio per 30 secondi, l&apos;assistente ti chiede &quot;sei pronto ad andare avanti?&quot; e continua ad aspettare.
                </li>
                <li>
                  Se sbagli, premi <strong>Reset campi</strong> nella sezione qui sopra e ricominci.
                </li>
              </ul>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                Suggerimento: usa Chrome o Edge per il riconoscimento vocale. Chiudi questa finestra con <strong>Chiudi</strong>, clic fuori o tasto <strong>Esc</strong>.
              </p>
            </div>
            <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" className="btn btn-primary" onClick={() => setVoiceGuideInfoOpen(false)}>
                Chiudi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
