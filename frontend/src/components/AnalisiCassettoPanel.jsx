import React, { useEffect, useMemo, useState } from 'react'
import { createEntry, deleteEntry, fetchEntries } from '../services/cashService'
import { readStoredPrimaNotaAccessCode } from '../utils/primaNotaLocaleAccess'
import { vneMachineLabel } from '../constants/vneMachines.js'

const CONTO = 'MOVIMENTO_CASSETTO'

const MODEL_ACTIVITY = {
  'model-1': 'risacca',
  'model-2': 'via_abba',
  'model-3': 'via_lattea',
  'model-4': 'via_zanardelli',
  'model-5': 'pg',
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDay(value) {
  const raw = String(value || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const [y, m, d] = raw.split('-')
  return `${d}/${m}/${y}`
}

export function activityForAnalisiModel(modelId) {
  return MODEL_ACTIVITY[String(modelId || '').trim()] || ''
}

export function AnalisiCassettoPanel({ modelId, dateFrom, dateTo, periodLabel }) {
  const activity = activityForAnalisiModel(modelId)
  const localeLabel = vneMachineLabel(modelId)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [day, setDay] = useState(dateTo || '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDay(dateTo || '')
  }, [dateTo, modelId])

  async function load() {
    if (!activity || !dateFrom || !dateTo) {
      setRows([])
      return
    }
    setLoading(true)
    setError('')
    try {
      const code = readStoredPrimaNotaAccessCode(activity)
      const list = await fetchEntries({
        date_from: dateFrom,
        date_to: dateTo,
        activity,
        access_code: code,
      })
      const filtered = (Array.isArray(list) ? list : []).filter((row) => row?.conto === CONTO)
      filtered.sort((a, b) => String(a.entry_date || '').localeCompare(String(b.entry_date || '')))
      setRows(filtered)
    } catch (err) {
      setRows([])
      setError(err?.message || 'Movimenti cassetto non disponibili. Apri il locale in Prima Nota e sbloccalo.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [activity, dateFrom, dateTo])

  const total = useMemo(
    () => rows.reduce((sum, row) => sum + Math.abs(Number(row.amount || 0)), 0),
    [rows],
  )

  async function handleAdd(event) {
    event.preventDefault()
    setError('')
    setSuccess('')
    const desc = description.trim()
    const value = Number(String(amount).replace(',', '.'))
    if (!activity) {
      setError('Scegli un locale.')
      return
    }
    if (!desc) {
      setError('Scrivi la causale del movimento cassetto.')
      return
    }
    if (!Number.isFinite(value) || value <= 0) {
      setError('Importo non valido.')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      setError('Scegli il giorno.')
      return
    }
    setSaving(true)
    try {
      const code = readStoredPrimaNotaAccessCode(activity)
      await createEntry(
        {
          entry_date: `${day}T12:00:00`,
          type: 'uscita',
          amount: value,
          description: desc,
          note: null,
          conto: CONTO,
          activity,
        },
        code,
      )
      setDescription('')
      setAmount('')
      setSuccess(`Movimento cassetto scritto in prima nota di ${localeLabel}.`)
      await load()
    } catch (err) {
      setError(err?.message || 'Salvataggio non riuscito. Apri il locale in Prima Nota e sbloccalo, poi riprova.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(row) {
    if (!window.confirm('Eliminare questo movimento cassetto dalla prima nota?')) return
    setError('')
    setSuccess('')
    try {
      const code = readStoredPrimaNotaAccessCode(activity)
      await deleteEntry(row.id, code)
      setSuccess('Movimento cassetto eliminato dalla prima nota.')
      await load()
    } catch (err) {
      setError(err?.message || 'Eliminazione non riuscita.')
    }
  }

  return (
    <section className="card analisi-panel analisi-attr-panel" style={{ marginTop: '1rem' }}>
      <h2 className="analisi-panel-title">Movimento cassetto · {localeLabel}</h2>
      <p className="analisi-machine-scope">
        Uscite dal cassetto del {periodLabel}. Ogni riga si scrive in prima nota del locale, colonna Cassetto, e non entra nelle vendite.
        Totale periodo: <strong>€ {formatAmount(total)}</strong>
        {loading ? ' · caricamento…' : ` · ${rows.length} movimenti`}
      </p>
      {error ? <div className="alert alert-danger">{error}</div> : null}
      {success ? <div className="alert alert-success">{success}</div> : null}
      <form onSubmit={handleAdd} className="filter-bar" style={{ alignItems: 'flex-end', marginBottom: '0.75rem' }}>
        <div className="form-group">
          <label>Giorno</label>
          <input
            type="date"
            className="form-control"
            value={day}
            min={dateFrom || undefined}
            max={dateTo || undefined}
            onChange={(e) => setDay(e.target.value)}
          />
        </div>
        <div className="form-group" style={{ flex: '1 1 220px' }}>
          <label>Causale</label>
          <input
            className="form-control"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="es. Pane, lavanderia"
          />
        </div>
        <div className="form-group">
          <label>Importo (€)</label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            className="form-control"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={{ maxWidth: 140 }}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={saving || loading}>
          {saving ? 'Salvataggio…' : 'Scrivi in prima nota'}
        </button>
      </form>
      {rows.length === 0 && !loading ? (
        <p className="empty-state">Nessun movimento cassetto in questo periodo.</p>
      ) : (
        <div className="pagamenti-grid-wrap">
          <table className="pagamenti-grid">
            <thead>
              <tr>
                <th>Giorno</th>
                <th>Causale</th>
                <th>Importo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDay(row.entry_date)}</td>
                  <td>{row.description || 'Movimento cassetto'}</td>
                  <td>€ {formatAmount(row.amount)}</td>
                  <td>
                    <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => handleDelete(row)}>
                      Elimina
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
