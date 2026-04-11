import React, { useEffect, useMemo, useState } from 'react'
import { fetchSuppliers } from '../services/suppliersService'
import { fetchPriceList } from '../services/priceListService'
import { checkAiAnomalies, suggestOrderLines } from '../services/aiService'
import {
  createSupplierOrder,
  deleteSupplierOrder,
  fetchSupplierOrder,
  fetchSupplierOrders,
  supplierOrderPdfUrl,
  updateSupplierOrder,
} from '../services/supplierOrdersService'

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

function statusLabel(s) {
  if (s === 'sent') return 'Inviato'
  return 'In sospeso'
}

function truncate(str, n) {
  if (!str) return '—'
  const t = String(str)
  return t.length <= n ? t : `${t.slice(0, n)}…`
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
    `Ordine merce — ${supplierName || 'Fornitore'} (riferimento n. #${order.id}):`,
    `Data ordine: ${formatDateIt(order.order_date)}`,
    `IVA indicativa: ${order.vat_percent ?? '—'}%`,
    `Stato: ${statusLabel(order.status)}`,
  ]
  if (order.expected_delivery_date) {
    lines.push(`Consegna richiesta entro: ${formatDateIt(order.expected_delivery_date)}`)
  }
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

export default function NewOrderPage({ onNavigate }) {
  const [suppliers, setSuppliers] = useState([])
  const [supplierId, setSupplierId] = useState('')
  const [orderDate, setOrderDate] = useState(todayIso)
  const [vatPercent, setVatPercent] = useState('23')
  const [orderStatus, setOrderStatus] = useState('pending')
  const [orderNote, setOrderNote] = useState('')
  const [orderNoteInternal, setOrderNoteInternal] = useState('')
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('')
  const [rows, setRows] = useState([emptyRow()])
  const [loadingSuppliers, setLoadingSuppliers] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [successDetail, setSuccessDetail] = useState(null)
  const [recentOrders, setRecentOrders] = useState([])
  const [editingOrderId, setEditingOrderId] = useState(null)
  const [historyMonth, setHistoryMonth] = useState('')
  const [historyStatus, setHistoryStatus] = useState('')
  const [priceList, setPriceList] = useState([])
  const [priceListLoading, setPriceListLoading] = useState(false)
  const [aiOrderText, setAiOrderText] = useState('')
  const [aiOrderLoading, setAiOrderLoading] = useState(false)
  const [anomalyReport, setAnomalyReport] = useState(null)

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
    setOrderDate(todayIso())
    setVatPercent('23')
    setOrderStatus('pending')
    setOrderNote('')
    setOrderNoteInternal('')
    setExpectedDeliveryDate('')
    setRows([emptyRow()])
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

  async function duplicateLastOrder() {
    if (!recentOrders.length) {
      setError('Nessun ordine nello storico filtrato da duplicare')
      return
    }
    const first = recentOrders[0]
    setError('')
    try {
      const o = await fetchSupplierOrder(first.id)
      setEditingOrderId(null)
      setSupplierId(String(o.supplier_id))
      setOrderDate(todayIso())
      setVatPercent(String(o.vat_percent ?? '23'))
      setOrderStatus('pending')
      setOrderNote(o.note || '')
      setOrderNoteInternal(o.note_internal || '')
      setExpectedDeliveryDate(o.expected_delivery_date ? String(o.expected_delivery_date).slice(0, 10) : '')
      const list = (o.items || []).length
        ? o.items.map((it) => ({
            product_description: it.product_description || '',
            pieces: it.pieces != null ? String(it.pieces) : '',
            weight_kg: it.weight_kg != null && it.weight_kg !== '' ? String(it.weight_kg) : '',
            note: it.note || '',
          }))
        : [emptyRow()]
      setRows(list)
      setSuccess('Ordine duplicato come nuovo (data odierna, stato in sospeso)')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      setError('Impossibile duplicare l’ordine')
    }
  }

  async function handleAiSuggest() {
    const t = aiOrderText.trim()
    if (!t) return
    try {
      setAiOrderLoading(true)
      setError('')
      const r = await suggestOrderLines(t)
      const lines = r?.suggested_lines || []
      if (!lines.length) {
        setError('Nessuna riga ricavata dal testo')
        return
      }
      setRows(
        lines.map((l) => ({
          product_description: l.product_description || '',
          pieces: l.pieces != null ? String(l.pieces) : '',
          weight_kg: l.weight_kg != null && l.weight_kg !== '' ? String(l.weight_kg) : '',
          note: l.note || '',
        })),
      )
      setSuccess('Righe ordine generate da testo (controlla quantità e nomi)')
    } catch {
      setError('Servizio suggerimento ordine non disponibile')
    } finally {
      setAiOrderLoading(false)
    }
  }

  async function handleSave(e) {
    e.preventDefault()
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
        setSuccess(`Ordine #${editingOrderId} aggiornato`)
      } else {
        saved = await createSupplierOrder(payload)
        setSuccess('Ordine salvato')
      }
      setSuccessDetail({
        id: saved?.id,
        date: saved?.order_date,
        supplier: saved?.supplier_name || supplierLabel,
        merchandise: saved?.merchandise_summary,
        status: saved?.status || orderStatus,
      })
      setEditingOrderId(null)
      setOrderDate(todayIso())
      setVatPercent('23')
      setOrderStatus('pending')
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
          <td>#${o.id}</td>
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
          items: payload.items.map((it) => ({
            product_description: it.product_description,
            weight_kg: it.weight_kg != null && it.weight_kg !== '' ? String(it.weight_kg) : '',
            pieces: it.pieces != null ? String(it.pieces) : '',
            unit_price: '',
            anomaly_note: it.note || '',
          })),
          note_hint: orderNote.trim() || null,
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
      setSupplierId(String(o.supplier_id))
      setOrderDate(String(o.order_date).slice(0, 10))
      setVatPercent(String(o.vat_percent ?? '23'))
      setOrderStatus(o.status === 'sent' ? 'sent' : 'pending')
      setOrderNote(o.note || '')
      setOrderNoteInternal(o.note_internal || '')
      setExpectedDeliveryDate(o.expected_delivery_date ? String(o.expected_delivery_date).slice(0, 10) : '')
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

  const waPreview = buildWhatsAppMessage()

  return (
    <div>
      <h1 className="page-header">Nuovo ordine</h1>
      <p style={{ color: 'var(--text-muted)', marginTop: '-0.5rem', marginBottom: '1rem', maxWidth: '52rem' }}>
        Ordine verso un fornitore con più righe merce, note al fornitore e note interne, consegna prevista e controlli
        rapidi. Dopo il salvataggio puoi scaricare il PDF, inviare email o passare a Nuova consegna con righe
        precompilate.
      </p>

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
                  <strong>N. ordine:</strong> #{successDetail.id}{' '}
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
            Stai modificando l’ordine <strong>#{editingOrderId}</strong>.
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
            Compila ordine da testo (AI)
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: 0 }}>
            Incolla un elenco (una riga per prodotto). Esempi: <code>10 arance</code>, <code>5x pasta</code>,{' '}
            <code>2,5 kg patate</code>, <code>arance 10 kg</code>
          </p>
          <textarea
            className="form-control"
            rows={3}
            value={aiOrderText}
            onChange={(e) => setAiOrderText(e.target.value)}
            placeholder="arance 5&#10;pasta 3 pz&#10;vino rosso x2"
          />
          <div className="btn-group" style={{ marginBottom: '1rem' }}>
            <button type="button" className="btn btn-secondary" disabled={aiOrderLoading} onClick={handleAiSuggest}>
              {aiOrderLoading ? 'Analisi...' : 'Genera righe da testo'}
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

          <div className="form-group">
            <label>Note al fornitore (incluse in WhatsApp / email / PDF)</label>
            <textarea className="form-control" value={orderNote} onChange={(e) => setOrderNote(e.target.value)} rows={2} />
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

          <div className="btn-group" style={{ flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Salvataggio...' : editingOrderId != null ? 'Aggiorna ordine' : 'Salva ordine'}
            </button>
            <button type="button" className="btn btn-whatsapp" onClick={handleWhatsApp} disabled={!supplierId}>
              Invia ordine via WhatsApp
            </button>
            <button type="button" className="btn btn-secondary" onClick={handleEmail} disabled={!supplierId}>
              Email al fornitore
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => handleRegisterDelivery()} disabled={!supplierId}>
              Registra consegna (precompila)
            </button>
            <button type="button" className="btn btn-secondary" onClick={saveTemplate}>
              Salva modello righe
            </button>
            <button type="button" className="btn btn-secondary" onClick={loadTemplate}>
              Carica modello righe
            </button>
            <button type="button" className="btn btn-secondary" onClick={duplicateLastOrder} disabled={!supplierId || !recentOrders.length}>
              Duplica ultimo ordine (lista)
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
            <strong>PDF</strong>. Usa &quot;Stampa elenco&quot; per un riepilogo stampabile / salvabile come PDF dello storico filtrato.
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
          </div>
          {recentOrders.length === 0 ? (
            <p className="empty-state">Nessun ordine con i filtri attuali.</p>
          ) : (
            <div className="table-wrap">
              <table className="app-table app-table--compact">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Consegna prev.</th>
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
                        <td>{o.expected_delivery_date ? formatDateIt(o.expected_delivery_date) : '—'}</td>
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
    </div>
  )
}
