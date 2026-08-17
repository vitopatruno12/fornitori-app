import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchSuppliers } from '../services/suppliersService'
import { fetchPriceList } from '../services/priceListService'
import { checkAiAnomalies, suggestOrderFull } from '../services/aiService'
import { mapOrderLinesToRows } from '../utils/orderLinesNormalize.js'
import { applyOrderAiResponse, mergeOrderProductRows } from '../utils/orderAiApply.js'
import OrderVoiceFieldAssistant from '../components/OrderVoiceFieldAssistant.jsx'
import WorkbookGrid from '../components/WorkbookGrid.jsx'
import { AnalisiLoadingBar } from '../components/AnalisiShared.jsx'
import { useAppNavigate } from '../hooks/useAppNavigate'
import {
  createSupplierOrder,
  deleteSupplierOrder,
  deleteAllSupplierOrders,
  fetchSupplierOrder,
  fetchSupplierOrders,
  supplierOrderPdfUrl,
  updateSupplierOrder,
} from '../services/supplierOrdersService'
import { ORDER_QUICK_PRODUCTS } from '../constants/orderQuickProducts.js'
import { quickProductBtnClassName } from '../utils/orderQuickProductColors.js'
import {
  SUPPLIER_PRODUCT_BLOCKED_MESSAGE,
  isProductAllowedForSupplier,
  isProductCategoryAllowedForSupplier,
  resolveQuickProductCategory,
} from '../utils/supplierOrderProducts.js'
import {
  ORDER_HISTORY_COLUMNS,
  ORDER_HISTORY_WORKBOOK_TITLE,
  orderHistoryCellValue,
} from '../utils/orderHistoryWorkbook.js'
import {
  ORDER_MERCHANDISE_COLUMNS,
  ORDER_MERCHANDISE_WORKBOOK_TITLE,
  orderMerchandiseCellValue,
  orderMerchandiseListinoMeta,
  orderMerchandiseTotals,
  orderMerchandiseTotalsLabel,
} from '../utils/orderMerchandiseWorkbook.js'
import {
  buildCourierPickupMessage,
  loadOrderCourierContact,
  mapApiCarriersToEditor,
  resolveCourierEmailsForSend,
  resolveCouriersForWhatsApp,
  saveOrderCourierContact,
} from '../utils/orderCourierContact.js'
import OrderCourierEditor from '../components/OrderCourierEditor.jsx'
import { fetchCarriers, setCarrierInService } from '../services/carriersService'

const emptyRow = () => ({ product_description: '', pieces: '', weight_kg: '', volume_liters: '', note: '' })
const TEMPLATE_LS = 'fornitori_app_order_row_template_v1'

function appendOrderLineQtyBits(bits, item) {
  const it = item || {}
  if (it.pieces != null && it.pieces !== '' && !Number.isNaN(Number(it.pieces))) bits.push(`${it.pieces} pz`)
  if (it.weight_kg != null && it.weight_kg !== '' && !Number.isNaN(Number(it.weight_kg))) bits.push(`${it.weight_kg} kg`)
  if (it.volume_liters != null && it.volume_liters !== '' && !Number.isNaN(Number(it.volume_liters))) {
    bits.push(`${it.volume_liters} l`)
  }
}

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

function buildWhatsAppUrl(phone, message) {
  const encoded = encodeURIComponent(message)
  const waNum = normalizeWhatsAppNumber(phone)
  return waNum ? `https://wa.me/${waNum}?text=${encoded}` : `https://wa.me/?text=${encoded}`
}

function openWhatsAppWithMessage(phone, message) {
  const url = buildWhatsAppUrl(phone, message)
  window.open(url, '_blank', 'noopener,noreferrer')
  return { url }
}

function courierWhatsAppTargets({ couriers, phones, message }) {
  const msg = String(message || '').trim()
  if (!msg) return []
  const wanted = (Array.isArray(phones) ? phones : [phones]).map((p) => String(p || '').trim()).filter(Boolean)
  const list = Array.isArray(couriers) ? couriers : []
  const out = []
  const seen = new Set()
  for (const phone of wanted) {
    if (!normalizeWhatsAppNumber(phone) || seen.has(phone)) continue
    seen.add(phone)
    const hit = list.find((c) => String(c.phone || '').trim() === phone)
    out.push({
      role: 'trasportatore',
      name: String(hit?.name || '').trim() || phone,
      phone,
      url: buildWhatsAppUrl(phone, msg),
    })
  }
  return out
}

function openOrderEmailClient({ supplierEmail, courierEmail, sendCopyToCourier, subject, body, courierBody }) {
  const to = String(supplierEmail || '').trim()
  if (!to) throw new Error('Email fornitore mancante in anagrafica')
  const params = new URLSearchParams()
  params.set('subject', subject)
  const emailBody =
    sendCopyToCourier && courierBody ? `${body}\n\n---\n\n${courierBody}` : body
  params.set('body', emailBody)
  const cc = sendCopyToCourier
    ? (Array.isArray(courierEmail) ? courierEmail : [courierEmail])
        .map((e) => String(e || '').trim())
        .filter(Boolean)
        .join(',')
    : ''
  if (cc) params.set('cc', cc)
  window.location.href = `mailto:${encodeURIComponent(to)}?${params.toString()}`
}

function formatDateIt(iso) {
  if (!iso) return ''
  const [y, m, day] = String(iso).slice(0, 10).split('-')
  if (!y || !m || !day) return iso
  return `${day}/${m}/${y}`
}

function escapeHtml(s) {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function todayIso() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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
    appendOrderLineQtyBits(bits, it)
    if (it.note) bits.push(`(${it.note})`)
    lines.push(`• ${bits.filter(Boolean).join(' — ')}`)
  })
  const on = (order.note || '').trim()
  if (on) lines.push('', `Note ordine: ${on}`)
  lines.push('', 'Grazie.')
  return lines.join('\n')
}

export default function NewOrderPage({ operatorMode = false }) {
  const appNavigate = useAppNavigate()
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
  const [rows, setRows] = useState([])
  const [lineEditor, setLineEditor] = useState(null)
  const [productChoice, setProductChoice] = useState(null)
  const [supplierProductBlock, setSupplierProductBlock] = useState(null)
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
  const [voiceRowIndex, setVoiceRowIndex] = useState(0)
  const [aiOrderLoading, setAiOrderLoading] = useState(false)
  const [anomalyReport, setAnomalyReport] = useState(null)
  const [copyFromOrderId, setCopyFromOrderId] = useState('')
  const [deletingAllOrders, setDeletingAllOrders] = useState(false)
  const [aiSummary, setAiSummary] = useState('')
  const initialCourier = loadOrderCourierContact()
  const [sendCopyToCourier, setSendCopyToCourier] = useState(() => Boolean(initialCourier.sendCopyToCourier))
  const [couriers, setCouriers] = useState([])
  const [couriersLoading, setCouriersLoading] = useState(true)
  const [pendingCourierWhatsAppUrls, setPendingCourierWhatsAppUrls] = useState([])
  const notifyPanelRef = useRef(null)

  const loadCouriersFromApi = useCallback(async () => {
    setCouriersLoading(true)
    try {
      const rows = await fetchCarriers()
      setCouriers(mapApiCarriersToEditor(rows))
    } catch {
      setCouriers([])
    } finally {
      setCouriersLoading(false)
    }
  }, [])

  useEffect(() => {
    loadCouriersFromApi()
  }, [loadCouriersFromApi])

  useEffect(() => {
    saveOrderCourierContact({ sendCopyToCourier, carriers: [] })
  }, [sendCopyToCourier])

  const handleToggleCourierInService = useCallback(
    async (carrier, nextValue) => {
      if (!carrier?.id) return
      try {
        await setCarrierInService(carrier.id, nextValue)
        await loadCouriersFromApi()
      } catch (e) {
        setError(e?.message || 'Impossibile aggiornare «In servizio»')
      }
    },
    [loadCouriersFromApi],
  )

  const supplierLabel = useMemo(() => {
    const s = suppliers.find((x) => String(x.id) === String(supplierId))
    return s ? s.name : ''
  }, [suppliers, supplierId])

  const orderVoiceApplyContext = useMemo(
    () => ({
      suppliers,
      rows,
      setRows,
      setSupplierId,
      setOrderDate,
      setExpectedDeliveryDate,
      setDeliveryLocation,
      setOrderSignedBy,
      setUnloadingSignedBy,
      setVatPercent,
      setOrderNote,
      setOrderNoteInternal,
      voiceRowIndex,
      setVoiceRowIndex,
      addRow,
    }),
    [
      suppliers,
      rows,
      voiceRowIndex,
      setSupplierId,
      setOrderDate,
      setExpectedDeliveryDate,
      setDeliveryLocation,
      setOrderSignedBy,
      setUnloadingSignedBy,
      setVatPercent,
      setOrderNote,
      setOrderNoteInternal,
    ],
  )

  const selectedSupplier = useMemo(
    () => suppliers.find((x) => String(x.id) === String(supplierId)) || null,
    [suppliers, supplierId],
  )

  const isQuickProductAllowed = useCallback(
    (categoryLabel) => {
      if (!supplierId || !selectedSupplier) return false
      return isProductCategoryAllowedForSupplier(selectedSupplier, categoryLabel)
    },
    [supplierId, selectedSupplier],
  )

  useEffect(() => {
    if (!productChoice?.title) return
    if (!supplierId || !isQuickProductAllowed(productChoice.title)) {
      setProductChoice(null)
    }
  }, [supplierId, productChoice, isQuickProductAllowed])

  const couriersForWhatsApp = useMemo(
    () => resolveCouriersForWhatsApp(couriers, normalizeWhatsAppNumber),
    [couriers],
  )

  const courierPhonesForSend = useMemo(
    () => couriersForWhatsApp.map((c) => c.phone).filter(Boolean),
    [couriersForWhatsApp],
  )

  const courierEmailsForSend = useMemo(() => resolveCourierEmailsForSend(couriers), [couriers])

  const canWhatsAppWithCourier = courierPhonesForSend.length > 0

  const activeCouriersLabel = useMemo(
    () => couriersForWhatsApp.map((c) => c.name || c.phone).filter(Boolean).join(', '),
    [couriersForWhatsApp],
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

  const merchandiseLines = useMemo(
    () =>
      rows
        .map((row, sourceIndex) => ({ ...row, __sourceIndex: sourceIndex }))
        .filter((row) => (row.product_description || '').trim()),
    [rows],
  )

  const merchandiseWorkbookTotals = useMemo(
    () => orderMerchandiseTotals(filledRows),
    [filledRows],
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
    if (sendCopyToCourier) {
      if (!courierPhonesForSend.length) {
        w.push('Nessun cellulare trasportatore valido: WhatsApp andrà solo al fornitore (controlla «In servizio» e «Attivo»).')
      }
      if (!courierEmailsForSend.length) {
        w.push('Email corriere assente: l’email andrà solo al fornitore (senza copia).')
      }
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
  }, [supplierId, selectedSupplier, sendCopyToCourier, courierPhonesForSend, courierEmailsForSend, expectedDeliveryDate, orderDate, filledRows, dupDescriptions])

  function validateOrderDraftForSend() {
    if (!supplierId) {
      setError('Seleziona un fornitore')
      return false
    }
    const payload = buildPayload()
    if (payload.items.length === 0) {
      setError('Aggiungi almeno un prodotto con descrizione')
      return false
    }
    return true
  }

  useEffect(() => {
    loadSuppliers()
  }, [])

  useEffect(() => {
    const fn = (e) => {
      const lines = e.detail?.suggested_lines || e.detail?.lines
      if (!Array.isArray(lines) || !lines.length) return
      setRows((prev) => mergeOrderProductRows(prev, mapOrderLinesToRows(lines)))
    }
    window.addEventListener('ai-apply-order', fn)
    return () => window.removeEventListener('ai-apply-order', fn)
  }, [])

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
    const onDataSynced = () => void refreshRecentOrders()
    window.addEventListener('atlas-refresh-data', onDataSynced)
    return () => window.removeEventListener('atlas-refresh-data', onDataSynced)
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
      setSuppliers(Array.isArray(data) ? data : [])
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
    setRows([])
    setLineEditor(null)
    setProductChoice(null)
    setSuccessDetail(null)
    setAnomalyReport(null)
  }

  function updateRow(index, field, value) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)))
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()])
  }

  function removeRow(index) {
    setRows((prev) => prev.filter((_, i) => i !== index))
  }

  function showSupplierProductBlock(productLabel) {
    setSupplierProductBlock({
      message: SUPPLIER_PRODUCT_BLOCKED_MESSAGE,
      product: productLabel || '',
      supplier: selectedSupplier?.name || supplierLabel || '',
    })
  }

  function assertSupplierProductCategory(categoryLabel) {
    if (!selectedSupplier) return true
    if (isProductCategoryAllowedForSupplier(selectedSupplier, categoryLabel)) return true
    showSupplierProductBlock(categoryLabel)
    return false
  }

  function assertSupplierProductName(productName) {
    if (!selectedSupplier) return true
    if (isProductAllowedForSupplier(selectedSupplier, productName)) return true
    const category = resolveQuickProductCategory(productName) || productName
    showSupplierProductBlock(category)
    return false
  }

  function openAddProductLine(product) {
    if (!supplierId) {
      setError('Seleziona un fornitore prima di aggiungere prodotti')
      return
    }
    setError('')
    setProductChoice(null)
    setLineEditor({ mode: 'add', product, pieces: '', weight_kg: '', volume_liters: '', note: '' })
  }

  function handleQuickProductClick(item) {
    if (!supplierId) {
      setError('Seleziona un fornitore prima di aggiungere prodotti')
      return
    }
    if (!assertSupplierProductCategory(item.label)) return
    setError('')
    if (item.variants?.length) {
      setProductChoice({ title: item.label, options: item.variants })
      return
    }
    openAddProductLine(item.label)
  }

  function closeProductChoice() {
    setProductChoice(null)
  }

  function pickProductVariant(option) {
    if (productChoice?.title && !assertSupplierProductCategory(productChoice.title)) return
    closeProductChoice()
    openAddProductLine(option)
  }

  function openEditProductLine(index) {
    const row = rows[index]
    if (!row || !(row.product_description || '').trim()) return
    setError('')
    setLineEditor({
      mode: 'edit',
      index,
      product: (row.product_description || '').trim(),
      pieces: row.pieces ?? '',
      weight_kg: row.weight_kg ?? '',
      volume_liters: row.volume_liters ?? '',
      note: row.note ?? '',
    })
  }

  function closeLineEditor() {
    setLineEditor(null)
  }

  function updateLineEditorField(field, value) {
    setLineEditor((prev) => (prev ? { ...prev, [field]: value } : prev))
  }

  function saveLineEditor() {
    if (!lineEditor) return
    const product = (lineEditor.product || '').trim()
    if (!product) return
    if (!assertSupplierProductName(product)) return
    const pieces = lineEditor.pieces
    const weight_kg = lineEditor.weight_kg
    const volume_liters = lineEditor.volume_liters
    const note = String(lineEditor.note || '').trim()
    const hasPieces = pieces !== '' && pieces != null && !Number.isNaN(Number(pieces))
    const hasKg = weight_kg !== '' && weight_kg != null && !Number.isNaN(Number(weight_kg))
    const hasLiters = volume_liters !== '' && volume_liters != null && !Number.isNaN(Number(volume_liters))
    if (!hasPieces && !hasKg && !hasLiters && !note) {
      setError('Inserisci almeno pezzi, kg, litri o una nota')
      return
    }
    const row = {
      product_description: product,
      pieces: hasPieces ? pieces : '',
      weight_kg: hasKg ? weight_kg : '',
      volume_liters: hasLiters ? volume_liters : '',
      note,
    }
    if (lineEditor.mode === 'add') {
      setRows((prev) => [...prev, row])
    } else if (lineEditor.mode === 'edit' && lineEditor.index != null) {
      setRows((prev) => prev.map((r, i) => (i === lineEditor.index ? row : r)))
    }
    setError('')
    closeLineEditor()
  }

  function removeLineFromEditor() {
    if (!lineEditor || lineEditor.mode !== 'edit' || lineEditor.index == null) return
    removeRow(lineEditor.index)
    closeLineEditor()
  }

  function removeProductLine(index) {
    const row = rows[index]
    const desc = (row?.product_description || '').trim()
    if (!desc) return
    if (!window.confirm(`Rimuovere "${desc}" dall'ordine?`)) return
    removeRow(index)
    if (lineEditor?.mode === 'edit' && lineEditor.index === index) {
      closeLineEditor()
    }
  }

  function buildPayload() {
    const items = rows
      .map((r) => {
        const wkRaw = r.weight_kg === '' || r.weight_kg == null ? null : Number(r.weight_kg)
        const weight_kg = wkRaw != null && !Number.isNaN(wkRaw) ? wkRaw : null
        const volRaw = r.volume_liters === '' || r.volume_liters == null ? null : Number(r.volume_liters)
        const volume_liters = volRaw != null && !Number.isNaN(volRaw) ? volRaw : null
        return {
          product_description: (r.product_description || '').trim(),
          pieces: r.pieces === '' || r.pieces == null ? null : Number(r.pieces),
          weight_kg,
          volume_liters,
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
      appendOrderLineQtyBits(bits, it)
      if (it.note) bits.push(`(${it.note})`)
      lines.push(`• ${bits.join(' — ')}`)
    })
    const on = orderNote.trim()
    if (on) lines.push('', `Note ordine: ${on}`)
    lines.push('', 'Grazie.')
    return lines.join('\n')
  }

  function buildCourierMessageMetaFromDraft() {
    const payload = buildPayload()
    const primary = couriersForWhatsApp[0]
    return {
      courierName: primary?.name || null,
      orderDate: formatDateIt(orderDate),
      expectedDeliveryDate: expectedDeliveryDate ? formatDateIt(expectedDeliveryDate) : null,
      deliveryLocation: deliveryLocation.trim() || null,
      items: payload.items,
      note: orderNote.trim() || null,
      supplierName: supplierLabel || null,
    }
  }

  function buildCourierMessageMetaFromOrder(order, supplier) {
    const primary = couriersForWhatsApp[0]
    return {
      courierName: primary?.name || null,
      orderNumber: orderDisplayNum(order),
      orderDate: formatDateIt(order.order_date),
      expectedDeliveryDate: order.expected_delivery_date ? formatDateIt(order.expected_delivery_date) : null,
      deliveryLocation: (order.delivery_location || '').trim() || null,
      items: order.items || [],
      note: (order.note || '').trim() || null,
      supplierName: order.supplier_name || supplier?.name || null,
    }
  }

  function buildCourierMessageFromDraft() {
    return buildCourierPickupMessage(selectedSupplier, buildCourierMessageMetaFromDraft())
  }

  function buildCourierMessageFromOrder(order, supplier) {
    return buildCourierPickupMessage(supplier, buildCourierMessageMetaFromOrder(order, supplier))
  }

  function saveTemplate() {
    try {
      const snap = rows.map((r) => ({
        product_description: r.product_description || '',
        pieces: r.pieces || '',
        weight_kg: r.weight_kg || '',
        volume_liters: r.volume_liters || '',
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
          volume_liters: r.volume_liters != null && r.volume_liters !== '' ? String(r.volume_liters) : '',
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
            volume_liters: it.volume_liters != null && it.volume_liters !== '' ? String(it.volume_liters) : '',
            note: it.note || '',
          }))
        : []
      setRows(list)
      setLineEditor(null)
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
      setError('Parla o scrivi un comando prima di inviare')
      return
    }
    if (loadingSuppliers) {
      setError('Attendi il caricamento fornitori, poi riprova.')
      return
    }
    try {
      setAiOrderLoading(true)
      setError('')
      setSuccess('')
      setAiSummary('')
      const supplierNames = suppliers.map((s) => s.name).filter(Boolean)
      const r = await suggestOrderFull(t, supplierNames)
      const result = applyOrderAiResponse(r, suppliers, {
        setSupplierId,
        setOrderDate,
        setExpectedDeliveryDate,
        setDeliveryLocation,
        setOrderSignedBy,
        setUnloadingSignedBy,
        setVatPercent,
        setOrderNote,
        setRows,
      })

      const { applied, warnings } = result
      const viaAi = Boolean(r?.ai_used)
      const fast = Boolean(r?.local_fallback)
      if (applied.length) {
        setSuccess(
          `${viaAi ? 'Atlas AI' : fast ? 'Analisi rapida' : 'Compilato'}: ${applied.join(', ')}. Controlla e salva.`,
        )
        setAiSummary(applied.join(' • '))
      }
      const warnText = warnings.filter(Boolean).join(' · ')
      if (!applied.length) {
        setError(
          warnText ||
            'Nessun dato estratto dal comando. Esempio: «Ordine a Rossi: 10 arance, 5 kg pasta».',
        )
      } else if (warnText) {
        setAiSummary((prev) => [prev, warnText].filter(Boolean).join(' • '))
      }
    } catch (err) {
      console.warn('[ordine AI]', err)
      setError('Atlas AI non disponibile. Avvia Ollama e il backend (porta 8000), poi riprova.')
    } finally {
      setAiOrderLoading(false)
    }
  }

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
    const blocked = payload.items.find((item) => !isProductAllowedForSupplier(selectedSupplier, item.product_description))
    if (blocked) {
      showSupplierProductBlock(blocked.product_description)
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
      setRows([])
      setLineEditor(null)
      setAnomalyReport(null)
      await refreshRecentOrders()
    } catch {
      setError('Operazione non riuscita. Verifica server e migrazioni database (ordini).')
    } finally {
      setSaving(false)
    }
  }

  function persistTransporterContact() {
    saveOrderCourierContact({ sendCopyToCourier, carriers: couriers })
  }

  function applyCourierWhatsAppResult(pendingCourierUrls, { supplierName } = {}) {
    const pending = Array.isArray(pendingCourierUrls) ? pendingCourierUrls : []
    setPendingCourierWhatsAppUrls(pending)
    const who = pending.map((item) => item.name || item.phone).filter(Boolean).join(', ')
    const fornitore = supplierName || supplierLabel || 'fornitore'
    setSuccess(
      pending.length
        ? `WhatsApp aperto per ${fornitore}. Ora clicca sotto per avvisare il trasportatore${who ? `: ${who}` : ''}.`
        : `WhatsApp aperto per ${fornitore}.`,
    )
    window.setTimeout(() => {
      notifyPanelRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    }, 50)
  }

  function openSupplierThenQueueCouriers({ supplierPhone, supplierName, supplierMessage, courierMessage }) {
    persistTransporterContact()
    const pending = courierWhatsAppTargets({
      couriers: couriersForWhatsApp,
      phones: courierPhonesForSend,
      message: courierMessage,
    })
    if (!pending.length) {
      setError('Impossibile preparare WhatsApp per il trasportatore: manca cellulare o messaggio ritiro.')
      return false
    }
    openWhatsAppWithMessage(supplierPhone, supplierMessage)
    applyCourierWhatsAppResult(pending, { supplierName })
    return true
  }

  function handleWhatsApp() {
    setError('')
    setSuccess('')
    setSuccessDetail(null)
    setPendingCourierWhatsAppUrls([])
    if (!validateOrderDraftForSend()) return
    const supplierMessage = buildWhatsAppMessage()
    if (sendCopyToCourier && courierPhonesForSend.length) {
      openSupplierThenQueueCouriers({
        supplierPhone: selectedSupplier?.phone,
        supplierName: selectedSupplier?.name || supplierLabel,
        supplierMessage,
        courierMessage: buildCourierMessageFromDraft(),
      })
      return
    }
    openWhatsAppWithMessage(selectedSupplier?.phone, supplierMessage)
    if (sendCopyToCourier && !courierPhonesForSend.length) {
      setSuccess('WhatsApp aperto per il fornitore. Seleziona un trasportatore in servizio con cellulare valido.')
    }
  }

  function handleWhatsAppWithCourier() {
    setError('')
    setSuccess('')
    setSuccessDetail(null)
    setPendingCourierWhatsAppUrls([])
    if (!validateOrderDraftForSend()) return
    if (!courierPhonesForSend.length) {
      setError('Seleziona un trasportatore in servizio (o attivo) con cellulare valido')
      return
    }
    openSupplierThenQueueCouriers({
      supplierPhone: selectedSupplier?.phone,
      supplierName: selectedSupplier?.name || supplierLabel,
      supplierMessage: buildWhatsAppMessage(),
      courierMessage: buildCourierMessageFromDraft(),
    })
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
    try {
      const supplierMessage = buildWhatsAppMessage()
      const courierMessage = sendCopyToCourier ? buildCourierMessageFromDraft() : ''
      openOrderEmailClient({
        supplierEmail: em,
        courierEmail: courierEmailsForSend,
        sendCopyToCourier,
        subject: `Ordine merce — ${supplierLabel || 'Fornitore'} — ${formatDateIt(orderDate)}`,
        body: supplierMessage,
        courierBody: courierMessage,
      })
      if (sendCopyToCourier && !courierEmailsForSend.length) {
        setSuccess('Email aperta per il fornitore. Aggiungi l’email del corriere per inviare anche la copia.')
      }
    } catch (err) {
      setError(err?.message || 'Impossibile aprire l’email')
    }
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
    setPendingCourierWhatsAppUrls([])
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
    const supplierMessage = buildWhatsAppTextFromOrder(full)
    if (sendCopyToCourier && courierPhonesForSend.length) {
      openSupplierThenQueueCouriers({
        supplierPhone: sup?.phone,
        supplierName: full.supplier_name || sup?.name,
        supplierMessage,
        courierMessage: buildCourierMessageFromOrder(full, sup),
      })
      return
    }
    openWhatsAppWithMessage(sup?.phone, supplierMessage)
    if (sendCopyToCourier && !courierPhonesForSend.length) {
      setSuccess('WhatsApp aperto per il fornitore. Seleziona un trasportatore in servizio con cellulare valido.')
    }
  }

  async function handleWhatsAppSavedOrderWithCourier(order) {
    setError('')
    setPendingCourierWhatsAppUrls([])
    if (!courierPhonesForSend.length) {
      setError('Seleziona un trasportatore in servizio (o attivo) con cellulare valido')
      return
    }
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
    openSupplierThenQueueCouriers({
      supplierPhone: sup?.phone,
      supplierName: full.supplier_name || sup?.name,
      supplierMessage: buildWhatsAppTextFromOrder(full),
      courierMessage: buildCourierMessageFromOrder(full, sup),
    })
  }

  async function handleEmailSavedOrder(order) {
    setError('')
    let full = order
    if (!order.items || order.items.length === 0) {
      try {
        full = await fetchSupplierOrder(order.id)
      } catch {
        setError('Impossibile caricare l’ordine per email')
        return
      }
    }
    const sup = supplierById[full.supplier_id]
    const em = (sup?.email || '').trim()
    if (!em) {
      setError('Email fornitore mancante in anagrafica')
      return
    }
    try {
      const supplierMessage = buildWhatsAppTextFromOrder(full)
      const courierMessage = sendCopyToCourier ? buildCourierMessageFromOrder(full, sup) : ''
      openOrderEmailClient({
        supplierEmail: em,
        courierEmail: courierEmailsForSend,
        sendCopyToCourier,
        subject: `Ordine merce — ${full.supplier_name || sup?.name || 'Fornitore'} — ${formatDateIt(full.order_date)}`,
        body: supplierMessage,
        courierBody: courierMessage,
      })
      if (sendCopyToCourier && !courierEmailsForSend.length) {
        setSuccess('Email aperta per il fornitore. Aggiungi l’email del corriere per inviare anche la copia.')
      }
    } catch (err) {
      setError(err?.message || 'Impossibile aprire l’email')
    }
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

  async function handleWhatsAppAfterSaveWithCourier(orderId) {
    if (!orderId) return
    setError('')
    try {
      const full = await fetchSupplierOrder(orderId)
      await handleWhatsAppSavedOrderWithCourier(full)
    } catch {
      setError('Impossibile aprire WhatsApp con copia trasportatore')
    }
  }

  async function handleEmailAfterSave(orderId) {
    if (!orderId) return
    setError('')
    try {
      const full = await fetchSupplierOrder(orderId)
      await handleEmailSavedOrder(full)
    } catch {
      setError('Impossibile aprire l’email per questo ordine')
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
            volume_liters: it.volume_liters != null && it.volume_liters !== '' ? String(it.volume_liters) : '',
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
    if (operatorMode) {
      window.dispatchEvent(new CustomEvent('navigate-app', { detail: { page: 'new-delivery' } }))
    } else {
      appNavigate('new-delivery')
    }
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
            volume_liters: it.volume_liters != null && it.volume_liters !== '' ? String(it.volume_liters) : '',
            note: it.note || '',
          }))
        : []
      setRows(list)
      setLineEditor(null)
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
  const courierPreview =
    courierPhonesForSend.length || sendCopyToCourier ? buildCourierMessageFromDraft() : ''

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

      {loadingSuppliers && <AnalisiLoadingBar active label="Caricamento fornitori" variant="subtle" />}
      {error && <div className="alert alert-danger">{error}</div>}
      {pendingCourierWhatsAppUrls.length ? (
        <div ref={notifyPanelRef} className="alert alert-warning">
          <strong>Chi notificare su WhatsApp</strong>
          <p style={{ margin: '0.4rem 0 0.65rem' }}>
            È aperta la chat del <strong>fornitore</strong>. Il browser non può aprire due WhatsApp insieme:
            clicca per avvisare il <strong>trasportatore</strong> del ritiro.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {pendingCourierWhatsAppUrls.map((item) => (
              <button
                key={`${item.phone}-${item.url}`}
                type="button"
                className="btn btn-whatsapp"
                onClick={() => window.open(item.url, '_blank', 'noopener,noreferrer')}
              >
                WhatsApp a {item.name || item.phone} (trasportatore)
              </button>
            ))}
          </div>
        </div>
      ) : null}
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
                    WhatsApp fornitore
                  </button>
                  <button
                    type="button"
                    className="btn btn-whatsapp btn-sm"
                    style={{ marginLeft: '0.35rem' }}
                    disabled={!canWhatsAppWithCourier}
                    onClick={() => handleWhatsAppAfterSaveWithCourier(successDetail.id)}
                    title={canWhatsAppWithCourier ? 'Ordine al fornitore e avviso ritiro al trasportatore' : 'Imposta un trasportatore in servizio con cellulare valido'}
                  >
                    WhatsApp + trasportatore
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ marginLeft: '0.35rem' }}
                    onClick={() => handleEmailAfterSave(successDetail.id)}
                  >
                    Invia via email
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
                id="order-expected-delivery-date"
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

          <OrderVoiceFieldAssistant
            text={aiOrderText}
            onTextChange={setAiOrderText}
            disabled={loadingSuppliers}
            compiling={aiOrderLoading}
            applyContext={orderVoiceApplyContext}
            onFullCompile={(spoken) => handleAiSuggestFull(spoken)}
          />

          {aiSummary && (
            <div className="alert alert-success" style={{ marginBottom: '0.5rem' }}>
              <strong>Gemini:</strong> {aiSummary}
            </div>
          )}

          <h3 className="page-subheader" style={{ marginTop: '1rem' }}>
            Prodotti da ordinare
          </h3>
          {!supplierId ? (
            <p className="alert alert-warning" style={{ fontSize: '0.85rem', marginBottom: '0.65rem' }}>
              Scegli un fornitore per abilitare i pulsanti prodotti.
            </p>
          ) : (
            <p style={{ fontSize: '0.85rem', marginBottom: '0.65rem', color: 'var(--text-muted)' }}>
              Restano attivi solo i prodotti associati a questo fornitore (categorie merceologiche in anagrafica).
            </p>
          )}
          <div className="order-product-grid" role="group" aria-label="Prodotti rapidi">
            {ORDER_QUICK_PRODUCTS.map((item) => {
              const categoryAllowed = isQuickProductAllowed(item.label)
              const blockedForSupplier = Boolean(supplierId) && !categoryAllowed
              return (
                <button
                  key={item.label}
                  type="button"
                  className={quickProductBtnClassName(item.label, { choice: Boolean(item.variants?.length) })}
                  disabled={!supplierId || saving || !categoryAllowed}
                  aria-disabled={!supplierId || saving || !categoryAllowed}
                  onClick={() => handleQuickProductClick(item)}
                  title={
                    blockedForSupplier
                      ? SUPPLIER_PRODUCT_BLOCKED_MESSAGE
                      : item.variants?.length
                        ? `Scegli tipo di ${item.label.toLowerCase()}`
                        : `Aggiungi ${item.label} all'ordine`
                  }
                >
                  {item.label}
                </button>
              )
            })}
          </div>

          {productChoice && (
            <div className="staff-report-modal-backdrop" role="presentation" onClick={closeProductChoice}>
              <div
                className="card staff-report-modal order-product-choice-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="order-product-choice-title"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 id="order-product-choice-title" className="page-subheader" style={{ marginTop: 0 }}>
                  Scegli {productChoice.title.toLowerCase()}
                </h3>
                <div className="order-product-choice-grid" role="group" aria-label={`Varianti ${productChoice.title}`}>
                  {productChoice.options.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={quickProductBtnClassName(productChoice.title, { extra: 'order-product-choice-option' })}
                      onClick={() => pickProductVariant(option)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: '1rem' }}>
                  <button type="button" className="btn btn-secondary" onClick={closeProductChoice}>
                    Annulla
                  </button>
                </div>
              </div>
            </div>
          )}

          {supplierProductBlock && (
            <div
              className="staff-report-modal-backdrop"
              role="presentation"
              onClick={() => setSupplierProductBlock(null)}
            >
              <div
                className="card staff-report-modal order-product-choice-modal"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="supplier-product-block-title"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 id="supplier-product-block-title" className="page-subheader" style={{ marginTop: 0 }}>
                  Prodotto non consentito
                </h3>
                <p style={{ margin: '0.5rem 0 0', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  {supplierProductBlock.message}
                  {supplierProductBlock.supplier ? (
                    <>
                      <br />
                      Fornitore: <strong>{supplierProductBlock.supplier}</strong>
                    </>
                  ) : null}
                  {supplierProductBlock.product ? (
                    <>
                      <br />
                      Prodotto: <strong>{supplierProductBlock.product}</strong>
                    </>
                  ) : null}
                </p>
                <div style={{ marginTop: '1rem' }}>
                  <button type="button" className="btn btn-primary" onClick={() => setSupplierProductBlock(null)}>
                    OK
                  </button>
                </div>
              </div>
            </div>
          )}

          {priceListLoading && supplierId && (
            <AnalisiLoadingBar active label="Caricamento listino fornitore" variant="subtle" />
          )}
          <WorkbookGrid
            title={ORDER_MERCHANDISE_WORKBOOK_TITLE}
            sheetLabel={`${filledRows.length} prodotti`}
            columns={ORDER_MERCHANDISE_COLUMNS}
            rows={merchandiseLines}
            cellValue={(row, column, ctx) => {
              const listino = orderMerchandiseListinoMeta(priceList, row.product_description)
              return orderMerchandiseCellValue(row, column, {
                ...ctx,
                listinoText: listino.text,
              })
            }}
            totalsLabel={orderMerchandiseTotalsLabel}
            totals={merchandiseWorkbookTotals}
            gridClassName="order-merchandise-grid"
            emptyMessage="Nessun prodotto. Usa i pulsanti sopra o la compilazione a voce / AI."
            rowKey={(row) => `${row.__sourceIndex}-${row.product_description}`}
            getRowClassName={(row) =>
              dupDescriptions.has((row.product_description || '').trim().toLowerCase()) ? 'order-line-row--dup' : ''
            }
            getCellTitle={(row, column) =>
              column.id === 'listino'
                ? orderMerchandiseListinoMeta(priceList, row.product_description).title
                : ''
            }
            actionsHeader="Azioni"
            renderActions={(row) => {
              const desc = (row.product_description || '').trim()
              const sourceIndex = row.__sourceIndex
              return (
                <div className="sup-actions-btns order-line-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => openEditProductLine(sourceIndex)}
                    title={`Modifica ${desc}`}
                  >
                    Modifica
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-danger btn-sm"
                    onClick={() => removeProductLine(sourceIndex)}
                    title={`Elimina ${desc}`}
                  >
                    Elimina
                  </button>
                </div>
              )
            }}
          />

          {lineEditor && (
            <div className="staff-report-modal-backdrop" role="presentation" onClick={closeLineEditor}>
              <div
                className="card staff-report-modal order-line-editor-modal"
                style={{ maxWidth: 480 }}
                role="dialog"
                aria-modal="true"
                aria-labelledby="order-line-editor-title"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 id="order-line-editor-title" className="page-subheader" style={{ marginTop: 0 }}>
                  {lineEditor.mode === 'add' ? 'Aggiungi' : 'Modifica'}: {lineEditor.product}
                </h3>
                <div className="form-row" style={{ marginBottom: '0.75rem' }}>
                  <div className="form-group" style={{ flex: '1 1 100px', marginBottom: 0 }}>
                    <label htmlFor="order-line-editor-pcs">Pezzi</label>
                    <input
                      id="order-line-editor-pcs"
                      type="number"
                      min="0"
                      className="form-control"
                      value={lineEditor.pieces}
                      onChange={(e) => updateLineEditorField('pieces', e.target.value)}
                      placeholder="opz."
                      autoFocus
                    />
                  </div>
                  <div className="form-group" style={{ flex: '1 1 100px', marginBottom: 0 }}>
                    <label htmlFor="order-line-editor-kg">Kg</label>
                    <input
                      id="order-line-editor-kg"
                      type="number"
                      min="0"
                      step="0.001"
                      className="form-control"
                      value={lineEditor.weight_kg}
                      onChange={(e) => updateLineEditorField('weight_kg', e.target.value)}
                      placeholder="opz."
                    />
                  </div>
                  <div className="form-group" style={{ flex: '1 1 100px', marginBottom: 0 }}>
                    <label htmlFor="order-line-editor-lit">Litri</label>
                    <input
                      id="order-line-editor-lit"
                      type="number"
                      min="0"
                      step="0.001"
                      className="form-control"
                      value={lineEditor.volume_liters}
                      onChange={(e) => updateLineEditorField('volume_liters', e.target.value)}
                      placeholder="opz."
                      title="Volume in litri (es. bottiglie, bibite, vino alla spina)"
                    />
                  </div>
                </div>
                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label htmlFor="order-line-editor-note">Note</label>
                  <input
                    id="order-line-editor-note"
                    className="form-control"
                    value={lineEditor.note}
                    onChange={(e) => updateLineEditorField('note', e.target.value)}
                    placeholder="opzionale"
                  />
                </div>
                <div className="btn-group" style={{ flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-primary" onClick={saveLineEditor}>
                    {lineEditor.mode === 'add' ? 'Aggiungi' : 'Salva modifiche'}
                  </button>
                  {lineEditor.mode === 'edit' && (
                    <button type="button" className="btn btn-outline-danger" onClick={removeLineFromEditor}>
                      Rimuovi
                    </button>
                  )}
                  <button type="button" className="btn btn-secondary" onClick={closeLineEditor}>
                    Annulla
                  </button>
                </div>
              </div>
            </div>
          )}

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
          <div
            className="form-group"
            style={{
              marginBottom: '1rem',
              padding: '0.75rem',
              background: 'var(--surface-2, rgba(0,0,0,0.04))',
              borderRadius: 8,
              border: '1px solid var(--border-subtle, rgba(0,0,0,0.08))',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.65rem' }}>
              <strong>Trasportatore / corriere</strong>
              {courierPhonesForSend.length ? (
                <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                  In servizio: {activeCouriersLabel || '—'}
                </span>
              ) : null}
            </div>
            <OrderCourierEditor
              carriers={couriers}
              loading={couriersLoading}
              onToggleInService={handleToggleCourierInService}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', cursor: 'pointer', marginTop: '0.65rem', marginBottom: 0 }}>
              <input
                type="checkbox"
                checked={sendCopyToCourier}
                onChange={(e) => setSendCopyToCourier(e.target.checked)}
              />
              <span style={{ fontSize: '0.9rem' }}>
                Includi trasportatore su WhatsApp ed email (usa quello «In servizio», altrimenti il primo attivo con cellulare)
              </span>
            </label>
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
            <p style={{ margin: '0.75rem 0 0.35rem', fontSize: '0.85rem', fontWeight: 600 }}>Messaggio al fornitore</p>
            <pre
              style={{
                marginTop: 0,
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
            {courierPreview ? (
              <>
                <p style={{ margin: '0.75rem 0 0.35rem', fontSize: '0.85rem', fontWeight: 600 }}>Messaggio al trasportatore (ritiro)</p>
                <pre
                  style={{
                    marginTop: 0,
                    whiteSpace: 'pre-wrap',
                    fontSize: '0.88rem',
                    maxHeight: 220,
                    overflow: 'auto',
                    background: 'var(--surface-2, #f5f5f5)',
                    padding: '0.6rem',
                    borderRadius: 6,
                  }}
                >
                  {courierPreview}
                </pre>
              </>
            ) : null}
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
              WhatsApp al fornitore
            </button>
            <button
              type="button"
              className="btn btn-whatsapp"
              onClick={handleWhatsAppWithCourier}
              disabled={!supplierId || !canWhatsAppWithCourier}
              title={
                canWhatsAppWithCourier
                  ? 'Invia ordine al fornitore e avviso ritiro al trasportatore salvato'
                  : 'Imposta un trasportatore in servizio con cellulare valido'
              }
            >
              WhatsApp fornitore + trasportatore
            </button>
            <button type="button" className="btn btn-secondary" onClick={handleEmail} disabled={!supplierId}>
              Invia ordine via email
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
          {canWhatsAppWithCourier && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.45rem', marginBottom: 0 }}>
              Con la spunta «Includi trasportatore» oppure <strong>WhatsApp fornitore + trasportatore</strong> si aprono due chat: viene usato il trasportatore «In servizio» (o il primo attivo disponibile).
            </p>
          )}
        </form>
      </section>

      {supplierId && (
        <section className="card pagamenti-workbook-card suppliers-workbook-card">
          <div className="pagamenti-workbook-toolbar">
            <div className="pagamenti-workbook-toolbar-left">
              <span className="pagamenti-workbook-title">{ORDER_HISTORY_WORKBOOK_TITLE}</span>
              <span className="pagamenti-workbook-sheet-label">
                {recentOrders.length} ordini
              </span>
            </div>
            <div className="pagamenti-workbook-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={!recentOrders.length}
                onClick={handlePrintHistoryPdf}
                title="Apre una finestra di stampa: scegli Salva come PDF"
              >
                Stampa / PDF elenco
              </button>
              {!operatorMode && (
                <button
                  type="button"
                  className="btn btn-outline-danger btn-sm"
                  disabled={deletingAllOrders || !supplierId}
                  onClick={handleDeleteAllOrders}
                  title="Elimina tutti gli ordini del fornitore selezionato"
                >
                  {deletingAllOrders ? 'Eliminazione...' : 'Elimina tutto lo storico'}
                </button>
              )}
            </div>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '0 1rem 0.75rem' }}>
            Dal fornitore puoi aprire la chat WhatsApp; da Azioni invii il testo dell&apos;ordine o apri il PDF.
            <strong> Nuovo da questo</strong> copia l&apos;ordine nel modulo; <strong>Modifica</strong> aggiorna l&apos;ordine salvato.
          </p>
          <div className="form-row" style={{ margin: '0 1rem 0.75rem', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Filtra per mese (data ordine)</label>
              <input type="month" className="form-control" value={historyMonth} onChange={(e) => setHistoryMonth(e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Stato</label>
              <select className="form-control" value={historyStatus} onChange={(e) => setHistoryStatus(e.target.value)} style={{ maxWidth: 200 }}>
                <option value="">Tutti</option>
                <option value="pending">In sospeso</option>
                <option value="sent">Inviato</option>
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setHistoryMonth(''); setHistoryStatus('') }}>
                Reset filtri
              </button>
            </div>
          </div>
          <WorkbookGrid
            title={ORDER_HISTORY_WORKBOOK_TITLE}
            sheetLabel={`${recentOrders.length} righe`}
            columns={ORDER_HISTORY_COLUMNS}
            rows={recentOrders}
            cellValue={(order, column, ctx) =>
              orderHistoryCellValue(order, column, { ...ctx, supplierLabel })
            }
            gridClassName="order-history-grid"
            emptyMessage="Nessun ordine con i filtri attuali."
            rowKey={(order) => String(order.id)}
            getCellTitle={(order, column) =>
              column.id === 'merchandise_summary' ? String(order.merchandise_summary || '') : ''
            }
            actionsHeader="Azioni"
            renderActions={(order) => {
              const supplierChatUrl = whatsappUrlForSupplierChat(order.supplier_id)
              return (
                <div className="sup-actions-btns order-line-actions" onClick={(e) => e.stopPropagation()}>
                  {supplierChatUrl ? (
                    <a
                      href={supplierChatUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-whatsapp btn-sm"
                      title="Apri chat WhatsApp con il fornitore"
                    >
                      Chat
                    </a>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-whatsapp btn-sm"
                    onClick={() => handleWhatsAppSavedOrder(order)}
                    title="Invia testo ordine su WhatsApp al fornitore"
                  >
                    WA fornitore
                  </button>
                  <button
                    type="button"
                    className="btn btn-whatsapp btn-sm"
                    onClick={() => handleWhatsAppSavedOrderWithCourier(order)}
                    disabled={!canWhatsAppWithCourier}
                    title={
                      canWhatsAppWithCourier
                        ? 'Ordine al fornitore e avviso ritiro al trasportatore'
                        : 'Imposta un trasportatore in servizio con cellulare valido'
                    }
                  >
                    WA + trasport.
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleEmailSavedOrder(order)}
                    title="Invia ordine via email (copia corriere in CC se attiva)"
                  >
                    Email
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleOpenPdf(order.id)}
                  >
                    PDF
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleLoadOrderAsNew(order.id)}
                    title="Copia questo ordine nel modulo sopra come nuovo"
                  >
                    Nuovo
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleEditOrder(order)}
                  >
                    Modifica
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-danger btn-sm"
                    onClick={() => handleDeleteOrder(order)}
                  >
                    Elimina
                  </button>
                </div>
              )
            }}
          />
        </section>
      )}
    </div>
  )
}
