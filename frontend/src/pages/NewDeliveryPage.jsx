import React, { useEffect, useMemo, useState } from 'react'
import { fetchSuppliers } from '../services/suppliersService'
import { createDeliveryBatch, fetchDeliveries } from '../services/deliveriesService'
import { fetchPriceList, addPriceListBatch, deletePriceListItem } from '../services/priceListService'
import {
  PRICE_LIST_WORKBOOK_COLUMNS,
  PRICE_LIST_WORKBOOK_TITLE,
  priceListWorkbookCellValue,
  priceListWorkbookTotals,
  priceListWorkbookTotalsLabel,
} from '../utils/priceListWorkbook.js'
import {
  DELIVERY_ITEMS_WORKBOOK_COLUMNS,
  DELIVERY_ITEMS_WORKBOOK_TITLE,
  deliveryItemDiffTone,
  deliveryItemReadonlyCellValue,
  deliveryItemsWorkbookTotals,
  deliveryItemsWorkbookTotalsLabel,
} from '../utils/deliveryItemsWorkbook.js'
import { fetchSupplierOrder, fetchSupplierOrders } from '../services/supplierOrdersService'
import { AnalisiLoadingBar } from '../components/AnalisiShared.jsx'

const emptyItem = () => ({
  product_description: '',
  weight_kg: '',
  pieces: '',
  unit_price: '',
  note: '',
  anomaly_note: '',
})
const emptyPriceRow = () => ({ product_description: '', unit_price: '' })

function listPriceForDescription(priceList, description) {
  const d = (description || '').trim()
  if (!d) return null
  const row = priceList.find((x) => x.product_description.trim() === d)
  return row != null ? Number(row.unit_price) : null
}

function diffVsList(priceList, description, unitPriceStr) {
  const lp = listPriceForDescription(priceList, description)
  const up = Number(unitPriceStr)
  if (lp == null || Number.isNaN(up)) return null
  return (up - lp).toFixed(2)
}

/** Righe ordine fornitore → righe consegna (prezzo da prezzario se la descrizione coincide). */
function mapOrderItemsToDeliveryItems(orderItems, priceList) {
  const list = Array.isArray(priceList) ? priceList : []
  return (orderItems || []).map((it) => {
    const desc = (it.product_description || '').trim()
    const listRow = list.find((x) => (x.product_description || '').trim() === desc)
    return {
      product_description: it.product_description || '',
      weight_kg: it.weight_kg != null && it.weight_kg !== '' ? String(it.weight_kg) : '',
      pieces: it.pieces != null && it.pieces !== '' ? String(it.pieces) : '',
      unit_price: listRow != null ? String(listRow.unit_price) : '',
      note: it.note || '',
      anomaly_note: '',
    }
  })
}

function deliveryItemsHaveUserInput(rows) {
  return (rows || []).some((it) => {
    const d = (it.product_description || '').trim()
    const w = Number(it.weight_kg) || 0
    const p = Number(it.pieces) || 0
    const u = Number(it.unit_price) || 0
    const n = (it.anomaly_note || '').trim()
    const rowNote = (it.note || '').trim()
    return Boolean(d || w || p || u || rowNote || n)
  })
}

function orderImportDisplayNum(o) {
  if (!o || typeof o !== 'object') return ''
  const n = o.sequence_number
  if (n != null && n !== '' && Number.isFinite(Number(n))) return String(n)
  return String(o.id ?? '')
}

function formatOrderOptionLabel(o) {
  const d = o.order_date ? String(o.order_date).slice(0, 10) : ''
  const raw = (o.merchandise_summary || '').trim()
  const sum = raw.length > 56 ? `${raw.slice(0, 56)}…` : raw
  const bits = [`n. ${orderImportDisplayNum(o)}`, d, sum].filter(Boolean)
  return bits.join(' · ')
}

function normalizeDdt(value) {
  return String(value || '').trim().toLowerCase()
}

export default function NewDeliveryPage({ operatorMode = false }) {
  const [suppliers, setSuppliers] = useState([])
  const [supplierId, setSupplierId] = useState('')
  const [date, setDate] = useState('')
  const [ddtNumber, setDdtNumber] = useState('')
  const [vatPercent, setVatPercent] = useState('23')
  const [deliveryLocation, setDeliveryLocation] = useState('')
  const [orderSignedBy, setOrderSignedBy] = useState('')
  const [unloadingSignedBy, setUnloadingSignedBy] = useState('')
  const [note, setNote] = useState('')
  const [items, setItems] = useState([emptyItem()])
  const [loadingSuppliers, setLoadingSuppliers] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [priceList, setPriceList] = useState([])
  const [priceListLoading, setPriceListLoading] = useState(false)
  const [priceRows, setPriceRows] = useState([emptyPriceRow()])
  const [savingPrice, setSavingPrice] = useState(false)
  const [orderImportLoading, setOrderImportLoading] = useState(false)
  const [ordersForImport, setOrdersForImport] = useState([])
  const [ordersForImportLoading, setOrdersForImportLoading] = useState(false)
  const [selectedOrderId, setSelectedOrderId] = useState('')

  const supplierLabel = useMemo(() => {
    const s = suppliers.find((x) => String(x.id) === String(supplierId))
    return s ? s.name : ''
  }, [suppliers, supplierId])

  const priceListTotals = useMemo(() => priceListWorkbookTotals(priceList), [priceList])

  const deliveryItemsTotals = useMemo(() => deliveryItemsWorkbookTotals(items), [items])

  useEffect(() => {
    loadSuppliers()
  }, [])

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('deliveryPrefillFromOrder')
      if (!raw) return
      const data = JSON.parse(raw)
      sessionStorage.removeItem('deliveryPrefillFromOrder')
      if (data?.supplier_id != null) setSupplierId(String(data.supplier_id))
      if (Array.isArray(data.items) && data.items.length) {
        setItems(
          data.items.map((it) => ({
            product_description: it.product_description || '',
            weight_kg: it.weight_kg != null && it.weight_kg !== '' ? String(it.weight_kg) : '',
            pieces: it.pieces != null && it.pieces !== '' ? String(it.pieces) : '',
            unit_price: it.unit_price != null && it.unit_price !== '' ? String(it.unit_price) : '',
            note: it.note || '',
            anomaly_note: it.anomaly_note || '',
          })),
        )
      }
      if (data.note_hint) setNote(String(data.note_hint))
      if (data.order_signed_by) setOrderSignedBy(String(data.order_signed_by))
      if (data.unloading_signed_by) setUnloadingSignedBy(String(data.unloading_signed_by))
      if (data.delivery_location) setDeliveryLocation(String(data.delivery_location))
    } catch {
      try {
        sessionStorage.removeItem('deliveryPrefillFromOrder')
      } catch {
        // ignore
      }
    }
  }, [])

  useEffect(() => {
    if (supplierId) {
      loadPriceList()
    } else {
      setPriceList([])
    }
  }, [supplierId])

  useEffect(() => {
    if (!supplierId) {
      setOrdersForImport([])
      setSelectedOrderId('')
      return
    }
    let cancelled = false
    ;(async () => {
      setOrdersForImport([])
      setSelectedOrderId('')
      setOrdersForImportLoading(true)
      try {
        const data = await fetchSupplierOrders({ supplierId: Number(supplierId), limit: 80 })
        const list = Array.isArray(data) ? data : []
        if (cancelled) return
        setOrdersForImport(list)
        if (list.length === 0) {
          setSelectedOrderId('')
        } else {
          setSelectedOrderId((prev) =>
            list.some((o) => String(o.id) === String(prev)) ? String(prev) : String(list[0].id),
          )
        }
      } catch {
        if (!cancelled) {
          setOrdersForImport([])
          setSelectedOrderId('')
        }
      } finally {
        if (!cancelled) setOrdersForImportLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [supplierId])

  async function loadSuppliers() {
    try {
      setLoadingSuppliers(true)
      const data = await fetchSuppliers()
      setSuppliers(Array.isArray(data) ? data : [])
    } catch (e) {
      setError('Errore nel caricamento fornitori')
    } finally {
      setLoadingSuppliers(false)
    }
  }

  async function loadPriceList() {
    try {
      setPriceListLoading(true)
      const data = await fetchPriceList(supplierId)
      setPriceList(data)
    } catch {
      setPriceList([])
    } finally {
      setPriceListLoading(false)
    }
  }

  function updatePriceRow(index, field, value) {
    setPriceRows((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)))
  }

  function addPriceRow() {
    setPriceRows((prev) => [...prev, emptyPriceRow()])
  }

  function removePriceRow(index) {
    if (priceRows.length <= 1) return
    setPriceRows((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleAddPrice(e) {
    e.preventDefault()
    if (!supplierId) return
    const validRows = priceRows
      .map((row) => ({
        product_description: row.product_description?.trim() || '',
        unit_price: Number(row.unit_price) || 0,
      }))
      .filter((row) => row.product_description && row.unit_price > 0)

    if (validRows.length === 0) {
      setError('Inserisci almeno una merce con prezzo valido')
      return
    }
    try {
      setSavingPrice(true)
      setError('')
      await addPriceListBatch({
        supplier_id: Number(supplierId),
        items: validRows.map((row) => ({
          supplier_id: Number(supplierId),
          product_description: row.product_description,
          unit_price: row.unit_price,
        })),
      })
      setPriceRows([emptyPriceRow()])
      setSuccess('Prezzario aggiornato')
      await loadPriceList()
    } catch (e) {
      setError('Errore nel salvataggio del prezzario')
    } finally {
      setSavingPrice(false)
    }
  }

  async function handleDeletePrice(item) {
    if (!window.confirm(`Rimuovere "${item.product_description}" dal prezzario?`)) return
    try {
      await deletePriceListItem(item.id)
      await loadPriceList()
      setSuccess('Voce rimossa')
    } catch {
      setError("Errore nell'eliminazione")
    }
  }

  function applyPriceToItem(priceItem) {
    setItems((prev) => [
      ...prev,
      {
        product_description: priceItem.product_description,
        weight_kg: '',
        pieces: '',
        unit_price: String(priceItem.unit_price),
        note: '',
        anomaly_note: '',
      },
    ])
  }

  function updateItem(index, field, value) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, [field]: value } : it)))
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem()])
  }

  function removeItem(index) {
    setItems((prev) => {
      const next = prev.filter((_, i) => i !== index)
      return next.length === 0 ? [emptyItem()] : next
    })
  }

  async function loadFromPurchasedOrder() {
    if (!supplierId) {
      setError('Seleziona prima un fornitore')
      return
    }
    const oid = selectedOrderId ? Number(selectedOrderId) : NaN
    if (!oid || Number.isNaN(oid)) {
      setError('Seleziona un ordine dall’elenco.')
      return
    }
    if (deliveryItemsHaveUserInput(items)) {
      if (
        !window.confirm(
          'Sostituire le righe già inserite con quelle dell’ordine merce selezionato?',
        )
      ) {
        return
      }
    }
    setError('')
    setSuccess('')
    setOrderImportLoading(true)
    try {
      const plist = await fetchPriceList(supplierId)
      setPriceList(plist)
      const o = await fetchSupplierOrder(oid)
      if (!o || Number(o.supplier_id) !== Number(supplierId)) {
        setError('Ordine non valido per il fornitore selezionato.')
        return
      }
      const lines = o.items || []
      if (!lines.length) {
        setError('Questo ordine non contiene righe merce.')
        return
      }
      const mapped = mapOrderItemsToDeliveryItems(lines, plist)
      setItems(mapped.length ? mapped : [emptyItem()])
      if (o.vat_percent != null && o.vat_percent !== '') {
        setVatPercent(String(o.vat_percent))
      }
      const orderDest = (o.delivery_location || '').trim()
      if (orderDest) {
        setDeliveryLocation(orderDest)
      }
      const d = o.order_date ? new Date(`${String(o.order_date).slice(0, 10)}T12:00:00`).toLocaleDateString('it-IT') : ''
      const destSuffix = orderDest ? ` Destinazione: ${orderDest}.` : ''
      setSuccess(`Righe caricate dall’ordine n. ${orderImportDisplayNum(o)}${d ? ` del ${d}` : ''}.${destSuffix} Controlla prezzi e completamento dati prima di salvare.`)
    } catch {
      setError('Impossibile caricare l’ordine. Verifica la connessione e riprova.')
    } finally {
      setOrderImportLoading(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!supplierId) {
      setError('Seleziona un fornitore')
      return
    }
    if (!unloadingSignedBy.trim()) {
      setError("Inserisci la firma: chi fa lo scarico")
      return
    }
    if (await ensureDdtUniqueForSupplier(true)) return

    const validItems = items
      .map((it) => ({
        product_description: it.product_description?.trim() || null,
        weight_kg: it.weight_kg ? Number(it.weight_kg) : null,
        pieces: it.pieces ? Number(it.pieces) : null,
        unit_price: Number(it.unit_price) || 0,
        anomaly_note: (() => {
          const rowNote = it.note?.trim() || ''
          const anomaly = it.anomaly_note?.trim() || ''
          if (rowNote && anomaly) return `Nota: ${rowNote}\nAnomalia: ${anomaly}`
          return rowNote || anomaly || null
        })(),
      }))
      .filter((it) => (it.weight_kg > 0 || it.pieces > 0) && it.unit_price > 0)

    if (validItems.length === 0) {
      setError('Aggiungi almeno una merce con peso o pezzi e prezzo unitario')
      return
    }

    const dest = deliveryLocation.trim()
    const noteParts = []
    if (dest) noteParts.push(`Destinazione scarico: ${dest}`)
    if (note?.trim()) noteParts.push(note.trim())
    const mergedNote = noteParts.length ? noteParts.join('\n\n') : null

    try {
      setSaving(true)
      await createDeliveryBatch({
        supplier_id: Number(supplierId),
        delivery_date: date || null,
        ddt_number: ddtNumber?.trim() || null,
        order_signed_by: orderSignedBy.trim() || null,
        unloading_signed_by: unloadingSignedBy.trim() || null,
        vat_percent: Number(vatPercent) || 23,
        note: mergedNote,
        items: validItems,
      })
      setSuccess(`Consegna registrata${supplierLabel ? ` — ${supplierLabel}` : ''}`)
      setItems([emptyItem()])
      setDate('')
      setDdtNumber('')
      setVatPercent('23')
      setDeliveryLocation('')
      setOrderSignedBy('')
      setUnloadingSignedBy('')
      setNote('')
    } catch (e) {
      const msg = e?.message || ''
      if (msg.includes('DDT') && msg.toLowerCase().includes('gia presente')) {
        window.alert('Numero DDT già presente per questo fornitore. Inserisci un numero univoco.')
        setError('Numero DDT già presente per questo fornitore')
      } else {
        setError('Errore nel salvataggio della consegna')
      }
    } finally {
      setSaving(false)
    }
  }

  async function ensureDdtUniqueForSupplier(showPopup = false) {
    const ddt = normalizeDdt(ddtNumber)
    if (!supplierId || !ddt) return false
    try {
      const rows = await fetchDeliveries({ supplier_id: Number(supplierId) })
      const duplicate = (Array.isArray(rows) ? rows : []).some((r) => normalizeDdt(r?.ddt_number) === ddt)
      if (duplicate) {
        if (showPopup) window.alert('Numero DDT già presente per questo fornitore.')
        setError('Numero DDT già presente per questo fornitore')
        return true
      }
      return false
    } catch {
      return false
    }
  }

  return (
    <div>
      <section className="staff-page-hero">
        <div className="delivery-hero-row">
          <div className="delivery-hero-copy">
            <h1 className="page-header staff-page-title">Nuova consegna (scarico merce)</h1>
            <p className="staff-page-lead">
              {operatorMode ? (
                <>
                  Registra scarichi merce con DDT e righe prodotto. I dati vengono salvati nel gestionale ATLAS come nel modulo
                  completo.
                </>
              ) : (
                <>
                  Registra DDT, data di consegna e righe merce. Il confronto con il listino è calcolato in base al prezzario del
                  fornitore (stessa descrizione prodotto). Sotto puoi inserire liberamente la <strong>destinazione scarico /
                  spedizione</strong>, che viene registrata nelle note della consegna.
                </>
              )}
            </p>
          </div>
        </div>
      </section>

      {loadingSuppliers && <AnalisiLoadingBar active label="Caricamento fornitori" variant="subtle" />}
      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <section className="card">
        <form onSubmit={handleSubmit}>
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
              <label>Data consegna</label>
              <input type="date" className="form-control" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Numero DDT</label>
              <input
                className="form-control"
                value={ddtNumber}
                onChange={(e) => setDdtNumber(e.target.value)}
                onBlur={() => ensureDdtUniqueForSupplier(true)}
                placeholder="es. 123/2026"
                style={{ maxWidth: 200 }}
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
            <div className="form-group" style={{ minWidth: 220, maxWidth: 320 }}>
              <label>Destinazione diversa (scarico / spedizione)</label>
              <input
                className="form-control"
                value={deliveryLocation}
                onChange={(e) => setDeliveryLocation(e.target.value)}
                placeholder="Inserisci indirizzo o punto di scarico"
                title="Dove scaricare o far consegnare la merce; riportato nelle note della consegna"
              />
            </div>
          </div>

          <div
            style={{
              marginTop: '1rem',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              gap: '0.75rem',
            }}
          >
            <h3 className="page-subheader" style={{ margin: 0, alignSelf: 'center' }}>
              {DELIVERY_ITEMS_WORKBOOK_TITLE}
            </h3>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'flex-end',
                gap: '0.5rem',
                flex: '1 1 280px',
                justifyContent: 'flex-end',
              }}
            >
              <div className="form-group" style={{ marginBottom: 0, flex: '1 1 220px', minWidth: 200 }}>
                <label htmlFor="delivery-import-order" style={{ fontSize: '0.85rem' }}>
                  Ordine fornitore
                </label>
                <select
                  id="delivery-import-order"
                  className="form-control"
                  value={selectedOrderId}
                  onChange={(e) => setSelectedOrderId(e.target.value)}
                  disabled={!supplierId || ordersForImportLoading || !ordersForImport.length}
                >
                  {!supplierId ? (
                    <option value="">Seleziona un fornitore…</option>
                  ) : ordersForImportLoading ? (
                    <option value="">Caricamento ordini…</option>
                  ) : ordersForImport.length === 0 ? (
                    <option value="">Nessun ordine salvato</option>
                  ) : (
                    ordersForImport.map((o) => (
                      <option key={o.id} value={String(o.id)}>
                        {formatOrderOptionLabel(o)}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <button
                type="button"
                className="btn btn-vino"
                style={{ padding: '0.4rem 0.85rem', fontSize: '0.85rem', flex: '0 0 auto' }}
                disabled={
                  !supplierId ||
                  !selectedOrderId ||
                  orderImportLoading ||
                  ordersForImportLoading ||
                  loadingSuppliers ||
                  !ordersForImport.length
                }
                onClick={loadFromPurchasedOrder}
                title="Compila le righe dall’ordine scelto (stesso testo merce; prezzo da prezzario se la descrizione coincide)"
              >
                {orderImportLoading ? 'Caricamento…' : 'Carica da ordine'}
              </button>
            </div>
          </div>
          <div className="pagamenti-workbook-card workbook-card-nested" style={{ marginBottom: '1rem' }}>
            <div className="pagamenti-workbook-toolbar">
              <div className="pagamenti-workbook-toolbar-left">
                <span className="pagamenti-workbook-title">{DELIVERY_ITEMS_WORKBOOK_TITLE}</span>
                <span className="pagamenti-workbook-sheet-label">{items.length} righe</span>
              </div>
            </div>
            <div className="pagamenti-grid-wrap excel-wrap workbook-grid-wrap">
              <table className="app-table excel-table pagamenti-grid workbook-grid delivery-items-grid">
                <colgroup>
                  {DELIVERY_ITEMS_WORKBOOK_COLUMNS.map((col) => (
                    <col key={col.id} style={{ minWidth: col.width }} />
                  ))}
                  <col style={{ minWidth: 100 }} />
                </colgroup>
                <thead>
                  <tr>
                    {DELIVERY_ITEMS_WORKBOOK_COLUMNS.map((col) => (
                      <th
                        key={col.id}
                        className={[
                          col.numeric ? 'text-end' : '',
                          col.sticky === 'left' ? 'workbook-col-sticky-left' : '',
                        ].filter(Boolean).join(' ')}
                      >
                        {col.label}
                      </th>
                    ))}
                    <th className="sup-actions-col">Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => {
                    const listP = listPriceForDescription(priceList, item.product_description)
                    const diff = diffVsList(priceList, item.product_description, item.unit_price)
                    const destination = deliveryLocation.trim()
                    return (
                      <tr key={index} className="workbook-grid-row">
                        {DELIVERY_ITEMS_WORKBOOK_COLUMNS.map((col) => {
                          if (col.readonly) {
                            const diffTone = col.id === 'price_diff' ? deliveryItemDiffTone(diff) : ''
                            return (
                              <td
                                key={col.id}
                                className={col.sticky === 'left' ? 'workbook-col-sticky-left' : ''}
                              >
                                <input
                                  className={[
                                    'excel-cell',
                                    'pagamenti-cell-readonly',
                                    col.numeric ? 'excel-cell-num' : '',
                                    col.emphasis ? 'workbook-cell-emphasis' : '',
                                    diffTone,
                                  ].filter(Boolean).join(' ')}
                                  value={deliveryItemReadonlyCellValue(item, col, {
                                    rowIndex: index,
                                    listPrice: listP,
                                    diff,
                                    destination,
                                  })}
                                  readOnly
                                  tabIndex={-1}
                                  aria-label={`${col.label} riga ${index + 1}`}
                                />
                              </td>
                            )
                          }
                          const fieldValue = item[col.id] ?? ''
                          return (
                            <td
                              key={col.id}
                              className={col.sticky === 'left' ? 'workbook-col-sticky-left' : ''}
                            >
                              <input
                                className={[
                                  'excel-cell',
                                  col.numeric ? 'excel-cell-num' : '',
                                  col.emphasis ? 'workbook-cell-emphasis' : '',
                                ].filter(Boolean).join(' ')}
                                type={col.numeric && col.id !== 'product_description' ? 'number' : 'text'}
                                step={col.id === 'weight_kg' ? '0.001' : col.id === 'unit_price' ? '0.01' : undefined}
                                value={fieldValue}
                                onChange={(e) => updateItem(index, col.id, e.target.value)}
                                placeholder={
                                  col.id === 'product_description'
                                    ? 'Descrizione prodotto'
                                    : col.id === 'note' || col.id === 'anomaly_note'
                                      ? 'opzionale'
                                      : undefined
                                }
                                aria-label={`${col.label} riga ${index + 1}`}
                              />
                            </td>
                          )
                        })}
                        <td className="sup-actions-col">
                          <div className="sup-actions-btns">
                            <button
                              type="button"
                              className="btn btn-outline-danger btn-sm"
                              onClick={() => removeItem(index)}
                            >
                              Rimuovi
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  <tr className="workbook-row-totals">
                    {DELIVERY_ITEMS_WORKBOOK_COLUMNS.map((col) => (
                      <td
                        key={`tot-${col.id}`}
                        className={col.sticky === 'left' ? 'workbook-col-sticky-left' : ''}
                      >
                        <input
                          className={[
                            'excel-cell',
                            'pagamenti-cell-readonly',
                            col.numeric ? 'excel-cell-num' : '',
                            'workbook-cell-total',
                          ].filter(Boolean).join(' ')}
                          value={deliveryItemsWorkbookTotalsLabel(col.id, deliveryItemsTotals)}
                          readOnly
                          tabIndex={-1}
                        />
                      </td>
                    ))}
                    <td className="sup-actions-col" />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <button type="button" className="btn btn-secondary" onClick={addItem} style={{ marginBottom: '1rem' }}>
            + Aggiungi riga
          </button>

          <div className="form-group">
            <label>Note documento</label>
            <textarea className="form-control" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
          <div className="form-row" style={{ alignItems: 'flex-end', marginBottom: '0.75rem' }}>
            <div className="form-group" style={{ minWidth: 260, marginBottom: 0 }}>
              <label>Firma (chi fa lo scarico) *</label>
              <input
                className="form-control"
                value={unloadingSignedBy}
                onChange={(e) => setUnloadingSignedBy(e.target.value)}
                placeholder="Nome e cognome"
              />
            </div>
          </div>
          <div className="btn-group">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Salvataggio...' : 'Salva consegna'}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2 className="page-subheader" style={{ marginTop: 0 }}>
          Prezzario fornitore
        </h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.9rem' }}>
          Il confronto in tabella usa la descrizione prodotto identica a una voce del listino. Clicca &quot;Usa&quot; per
          aggiungere una riga con merce e prezzo dal listino.
        </p>

        {supplierId ? (
          <>
            <form onSubmit={handleAddPrice} className="filter-bar" style={{ marginBottom: '1rem' }}>
              <div style={{ width: '100%' }}>
                {priceRows.map((row, index) => (
                  <div key={index} className="form-row" style={{ alignItems: 'flex-end', marginBottom: '0.5rem' }}>
                    <div className="form-group" style={{ flex: '1 1 240px' }}>
                      <label>Tipo merce</label>
                      <input
                        className="form-control"
                        value={row.product_description}
                        onChange={(e) => updatePriceRow(index, 'product_description', e.target.value)}
                        placeholder="Descrizione prodotto"
                      />
                    </div>
                    <div className="form-group" style={{ flex: '0 1 140px' }}>
                      <label>Prezzo unit. (€)</label>
                      <input
                        type="number"
                        step="0.01"
                        className="form-control"
                        value={row.unit_price}
                        onChange={(e) => updatePriceRow(index, 'unit_price', e.target.value)}
                      />
                    </div>
                    <div className="form-group" style={{ flex: '0 0 auto' }}>
                      <button
                        type="button"
                        className="btn btn-outline-danger"
                        onClick={() => removePriceRow(index)}
                        disabled={priceRows.length <= 1}
                      >
                        Rimuovi
                      </button>
                    </div>
                  </div>
                ))}
                <div className="btn-group">
                  <button type="button" className="btn btn-secondary" onClick={addPriceRow}>
                    + Aggiungi merce al prezzario
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={savingPrice}>
                    {savingPrice ? 'Salvataggio...' : 'Salva prezzario'}
                  </button>
                </div>
              </div>
            </form>

            {priceListLoading && <AnalisiLoadingBar active label="Caricamento prezzario" variant="subtle" />}
            {!priceListLoading && (
              <div className="pagamenti-workbook-card workbook-card-nested">
                <div className="pagamenti-workbook-toolbar">
                  <div className="pagamenti-workbook-toolbar-left">
                    <span className="pagamenti-workbook-title">{PRICE_LIST_WORKBOOK_TITLE}</span>
                    {supplierLabel ? (
                      <span className="pagamenti-workbook-sheet-label">{supplierLabel}</span>
                    ) : null}
                    <span className="pagamenti-workbook-sheet-label">{priceList.length} voci</span>
                  </div>
                </div>
                {priceList.length > 0 ? (
                  <div className="pagamenti-grid-wrap excel-wrap workbook-grid-wrap">
                    <table className="app-table excel-table pagamenti-grid workbook-grid price-list-grid">
                      <colgroup>
                        {PRICE_LIST_WORKBOOK_COLUMNS.map((col) => (
                          <col key={col.id} style={{ minWidth: col.width }} />
                        ))}
                        <col style={{ minWidth: 140 }} />
                      </colgroup>
                      <thead>
                        <tr>
                          {PRICE_LIST_WORKBOOK_COLUMNS.map((col) => (
                            <th
                              key={col.id}
                              className={[
                                col.numeric ? 'text-end' : '',
                                col.sticky === 'left' ? 'workbook-col-sticky-left' : '',
                              ].filter(Boolean).join(' ')}
                            >
                              {col.label}
                            </th>
                          ))}
                          <th className="sup-actions-col">Azioni</th>
                        </tr>
                      </thead>
                      <tbody>
                        {priceList.map((p, rowIndex) => (
                          <tr key={p.id} className="workbook-grid-row">
                            {PRICE_LIST_WORKBOOK_COLUMNS.map((col) => (
                              <td
                                key={col.id}
                                className={col.sticky === 'left' ? 'workbook-col-sticky-left' : ''}
                              >
                                <input
                                  className={[
                                    'excel-cell',
                                    'pagamenti-cell-readonly',
                                    col.numeric ? 'excel-cell-num' : '',
                                    col.emphasis ? 'workbook-cell-emphasis' : '',
                                  ].filter(Boolean).join(' ')}
                                  value={priceListWorkbookCellValue(p, col, { rowIndex })}
                                  readOnly
                                  tabIndex={-1}
                                  aria-label={`${col.label} ${p.product_description}`}
                                />
                              </td>
                            ))}
                            <td className="sup-actions-col">
                              <div className="sup-actions-btns">
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => applyPriceToItem(p)}
                                >
                                  Usa
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-outline-danger btn-sm"
                                  onClick={() => handleDeletePrice(p)}
                                >
                                  Elimina
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        <tr className="workbook-row-totals">
                          {PRICE_LIST_WORKBOOK_COLUMNS.map((col) => (
                            <td
                              key={`tot-${col.id}`}
                              className={col.sticky === 'left' ? 'workbook-col-sticky-left' : ''}
                            >
                              <input
                                className={[
                                  'excel-cell',
                                  'pagamenti-cell-readonly',
                                  col.numeric ? 'excel-cell-num' : '',
                                  'workbook-cell-total',
                                ].filter(Boolean).join(' ')}
                                value={priceListWorkbookTotalsLabel(col.id, priceListTotals)}
                                readOnly
                                tabIndex={-1}
                              />
                            </td>
                          ))}
                          <td className="sup-actions-col" />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="empty-state" style={{ padding: '1rem' }}>
                    Nessuna voce nel prezzario per questo fornitore. Aggiungine una sopra.
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="empty-state">Seleziona un fornitore per visualizzare il prezzario.</p>
        )}
      </section>
    </div>
  )
}
