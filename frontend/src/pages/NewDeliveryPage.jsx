import React, { useEffect, useMemo, useState } from 'react'
import { fetchSuppliers } from '../services/suppliersService'
import { createDeliveryBatch } from '../services/deliveriesService'
import { fetchPriceList, addPriceListBatch, deletePriceListItem } from '../services/priceListService'

const emptyItem = () => ({
  product_description: '',
  weight_kg: '',
  pieces: '',
  unit_price: '',
  anomaly_note: '',
})
const emptyPriceRow = () => ({ product_description: '', unit_price: '' })

function lineImponibile(item) {
  const w = Number(item.weight_kg) || 0
  const p = Number(item.pieces) || 0
  const up = Number(item.unit_price) || 0
  if (w > 0) return (w * up).toFixed(2)
  if (p > 0) return (p * up).toFixed(2)
  return '—'
}

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

export default function NewDeliveryPage() {
  const [suppliers, setSuppliers] = useState([])
  const [supplierId, setSupplierId] = useState('')
  const [date, setDate] = useState('')
  const [ddtNumber, setDdtNumber] = useState('')
  const [vatPercent, setVatPercent] = useState('23')
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

  const supplierLabel = useMemo(() => {
    const s = suppliers.find((x) => String(x.id) === String(supplierId))
    return s ? s.name : ''
  }, [suppliers, supplierId])

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
            anomaly_note: it.anomaly_note || '',
          })),
        )
      }
      if (data.note_hint) setNote(String(data.note_hint))
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

  async function loadSuppliers() {
    try {
      setLoadingSuppliers(true)
      const data = await fetchSuppliers()
      setSuppliers(data)
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
    if (items.length <= 1) return
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!supplierId) {
      setError('Seleziona un fornitore')
      return
    }

    const validItems = items
      .map((it) => ({
        product_description: it.product_description?.trim() || null,
        weight_kg: it.weight_kg ? Number(it.weight_kg) : null,
        pieces: it.pieces ? Number(it.pieces) : null,
        unit_price: Number(it.unit_price) || 0,
        anomaly_note: it.anomaly_note?.trim() || null,
      }))
      .filter((it) => (it.weight_kg > 0 || it.pieces > 0) && it.unit_price > 0)

    if (validItems.length === 0) {
      setError('Aggiungi almeno una merce con peso o pezzi e prezzo unitario')
      return
    }

    try {
      setSaving(true)
      await createDeliveryBatch({
        supplier_id: Number(supplierId),
        delivery_date: date || null,
        ddt_number: ddtNumber?.trim() || null,
        vat_percent: Number(vatPercent) || 23,
        note: note?.trim() || null,
        items: validItems,
      })
      setSuccess(`Consegna registrata${supplierLabel ? ` — ${supplierLabel}` : ''}`)
      setItems([emptyItem()])
      setDate('')
      setDdtNumber('')
      setVatPercent('23')
      setNote('')
    } catch (e) {
      setError('Errore nel salvataggio della consegna')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h1 className="page-header">Nuova consegna (scarico merce)</h1>
      <p style={{ color: 'var(--text-muted)', marginTop: '-0.5rem', marginBottom: '1rem', maxWidth: '52rem' }}>
        Registra DDT, data di consegna e righe merce. Il confronto con il listino è calcolato in base al prezzario del
        fornitore (stessa descrizione prodotto). Utile per bar, ristoranti e negozi.
      </p>

      {loadingSuppliers && <p className="loading">Caricamento fornitori...</p>}
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
          </div>

          <h3 className="page-subheader" style={{ marginTop: '1rem' }}>
            Prodotti consegnati
          </h3>
          <div className="table-wrap" style={{ marginBottom: '1rem' }}>
            <table className="app-table">
              <thead>
                <tr>
                  <th>Prodotto</th>
                  <th style={{ minWidth: 90 }}>Peso (kg)</th>
                  <th style={{ minWidth: 80 }}>Pezzi</th>
                  <th style={{ minWidth: 110 }}>Prezzo unit. €</th>
                  <th style={{ minWidth: 100 }}>Tot. riga (imp.)</th>
                  <th style={{ minWidth: 100 }}>Listino €</th>
                  <th style={{ minWidth: 100 }}>Diff. listino</th>
                  <th style={{ minWidth: 160 }}>Note anomalie</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const listP = listPriceForDescription(priceList, item.product_description)
                  const diff = diffVsList(priceList, item.product_description, item.unit_price)
                  return (
                    <tr key={index}>
                      <td>
                        <input
                          className="form-control"
                          value={item.product_description}
                          onChange={(e) => updateItem(index, 'product_description', e.target.value)}
                          placeholder="es. carciofi, arance"
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.001"
                          className="form-control"
                          value={item.weight_kg}
                          onChange={(e) => updateItem(index, 'weight_kg', e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          className="form-control"
                          value={item.pieces}
                          onChange={(e) => updateItem(index, 'pieces', e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          className="form-control"
                          value={item.unit_price}
                          onChange={(e) => updateItem(index, 'unit_price', e.target.value)}
                        />
                      </td>
                      <td className="text-end amount">{lineImponibile(item)}</td>
                      <td className="text-end amount">{listP != null ? listP.toFixed(2) : '—'}</td>
                      <td
                        className="text-end amount"
                        style={{
                          color:
                            diff != null && Number(diff) > 0
                              ? 'var(--danger, #c0392b)'
                              : diff != null && Number(diff) < 0
                                ? 'var(--success, #1e8449)'
                                : undefined,
                        }}
                      >
                        {diff != null ? `${Number(diff) > 0 ? '+' : ''}${diff}` : '—'}
                      </td>
                      <td>
                        <input
                          className="form-control"
                          value={item.anomaly_note}
                          onChange={(e) => updateItem(index, 'anomaly_note', e.target.value)}
                          placeholder="opzionale"
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-outline-danger"
                          onClick={() => removeItem(index)}
                          disabled={items.length <= 1}
                          style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem' }}
                        >
                          Rimuovi
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn btn-secondary" onClick={addItem} style={{ marginBottom: '1rem' }}>
            + Aggiungi riga
          </button>

          <div className="form-group">
            <label>Note documento</label>
            <textarea className="form-control" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
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
                        placeholder="es. carciofi"
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

            {priceListLoading && <p className="loading">Caricamento prezzario...</p>}
            {!priceListLoading && priceList.length > 0 && (
              <div className="table-wrap">
                <table className="app-table">
                  <thead>
                    <tr>
                      <th>Tipo merce</th>
                      <th className="text-end amount">Prezzo unit. (€)</th>
                      <th>Azioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {priceList.map((p) => (
                      <tr key={p.id}>
                        <td>{p.product_description}</td>
                        <td className="text-end amount">{Number(p.unit_price).toFixed(2)}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ marginRight: '0.25rem', padding: '0.35rem 0.6rem', fontSize: '0.85rem' }}
                            onClick={() => applyPriceToItem(p)}
                          >
                            Usa
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline-danger"
                            style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem' }}
                            onClick={() => handleDeletePrice(p)}
                          >
                            Elimina
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!priceListLoading && priceList.length === 0 && (
              <p className="empty-state">Nessuna voce nel prezzario per questo fornitore. Aggiungine una sopra.</p>
            )}
          </>
        ) : (
          <p className="empty-state">Seleziona un fornitore per visualizzare il prezzario.</p>
        )}
      </section>
    </div>
  )
}
