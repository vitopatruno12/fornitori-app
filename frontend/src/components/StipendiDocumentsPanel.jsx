import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  deleteStaffDocument,
  fetchStaffDocuments,
  staffDocumentFileUrl,
  updateStaffDocument,
  uploadStaffDocument,
} from '../services/staffService.js'
import { formatStaffLocaleOptionLabel } from '../utils/staffLocaleCompanyLabels.js'

const DOC_TYPES = [
  { id: 'carta_identita', label: 'Carta d’identità' },
  { id: 'codice_fiscale', label: 'Codice fiscale' },
  { id: 'patente', label: 'Patente' },
  { id: 'permesso_soggiorno', label: 'Permesso di soggiorno' },
]

const CATEGORY_LABELS = {
  contratto: 'Contratto dipendente',
  busta_paga: 'Buste paghe',
  documento_personale: 'Documenti personale',
}

function formatDateIt(iso) {
  if (!iso) return '—'
  const d = String(iso).slice(0, 10)
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return d
  return `${m[3]}/${m[2]}/${m[1]}`
}

function docTypeLabel(id) {
  return DOC_TYPES.find((t) => t.id === id)?.label || id || '—'
}

function ymLabel(ym) {
  const raw = String(ym || '')
  const m = raw.match(/^(\d{4})-(\d{2})$/)
  if (!m) return raw || '—'
  const months = [
    'Gennaio',
    'Febbraio',
    'Marzo',
    'Aprile',
    'Maggio',
    'Giugno',
    'Luglio',
    'Agosto',
    'Settembre',
    'Ottobre',
    'Novembre',
    'Dicembre',
  ]
  const mi = Number(m[2]) - 1
  return `${months[mi] || m[2]} ${m[1]}`
}

const emptyForm = {
  first_name: '',
  last_name: '',
  birth_date: '',
  email: '',
  phone: '',
  ruolo: '',
  document_number: '',
  doc_type: 'carta_identita',
  notes: '',
}

/**
 * Una sola voce documenti (contratto / buste / documenti), come un foglio del Report.
 * La scelta della sezione è nei tab esterni di StipendiPage.
 */
export default function StipendiDocumentsPanel({ localeName, yearMonth, category }) {
  const locale = String(localeName || '').trim()
  const panel = String(category || '').trim()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [editId, setEditId] = useState(null)
  const fileRef = useRef(null)

  const load = useCallback(async () => {
    if (!panel || !locale) {
      setItems([])
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetchStaffDocuments({
        category: panel,
        locale,
        yearMonth: panel === 'busta_paga' ? yearMonth : undefined,
      })
      setItems(Array.isArray(res?.items) ? res.items : [])
    } catch (e) {
      setError(e?.message || 'Errore caricamento documenti')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [panel, locale, yearMonth])

  useEffect(() => {
    setForm(emptyForm)
    setEditId(null)
    setError('')
    setSuccess('')
    if (fileRef.current) fileRef.current.value = ''
    void load()
  }, [load])

  function updateForm(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function resetForm() {
    setForm(emptyForm)
    setEditId(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleUpload(e) {
    e.preventDefault()
    if (!panel || !locale) return
    const file = fileRef.current?.files?.[0]
    if (!editId && !file) {
      setError('Seleziona un PDF da caricare')
      return
    }
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      if (editId) {
        await updateStaffDocument(editId, {
          first_name: form.first_name || null,
          last_name: form.last_name || null,
          birth_date: form.birth_date || null,
          email: form.email || null,
          phone: form.phone || null,
          ruolo: form.ruolo || null,
          document_number: form.document_number || null,
          doc_type: panel === 'documento_personale' ? form.doc_type : panel === 'contratto' ? 'contratto' : 'busta_paga',
          locale_name: locale,
          year_month: panel === 'busta_paga' ? yearMonth : null,
          notes: form.notes || null,
        })
        setSuccess('Documento aggiornato')
      } else {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('category', panel)
        fd.append(
          'doc_type',
          panel === 'documento_personale' ? form.doc_type : panel === 'contratto' ? 'contratto' : 'busta_paga',
        )
        fd.append('locale_name', locale)
        if (panel === 'busta_paga' && yearMonth) fd.append('year_month', yearMonth)
        if (form.first_name) fd.append('first_name', form.first_name)
        if (form.last_name) fd.append('last_name', form.last_name)
        if (form.birth_date) fd.append('birth_date', form.birth_date)
        if (form.email) fd.append('email', form.email)
        if (form.phone) fd.append('phone', form.phone)
        if (form.ruolo) fd.append('ruolo', form.ruolo)
        if (form.document_number) fd.append('document_number', form.document_number)
        if (form.notes) fd.append('notes', form.notes)
        await uploadStaffDocument(fd)
        setSuccess('PDF caricato')
      }
      resetForm()
      await load()
    } catch (err) {
      setError(err?.message || 'Salvataggio fallito')
    } finally {
      setBusy(false)
    }
  }

  function startEdit(row) {
    setEditId(row.id)
    setForm({
      first_name: row.first_name || '',
      last_name: row.last_name || '',
      birth_date: row.birth_date ? String(row.birth_date).slice(0, 10) : '',
      email: row.email || '',
      phone: row.phone || '',
      ruolo: row.ruolo || '',
      document_number: row.document_number || '',
      doc_type: row.doc_type || 'carta_identita',
      notes: row.notes || '',
    })
  }

  async function handleDelete(row) {
    const label = [row.first_name, row.last_name].filter(Boolean).join(' ') || row.original_name || `#${row.id}`
    if (!window.confirm(`Eliminare il documento di «${label}»?`)) return
    setBusy(true)
    setError('')
    try {
      await deleteStaffDocument(row.id)
      setSuccess('Documento eliminato')
      if (editId === row.id) resetForm()
      await load()
    } catch (err) {
      setError(err?.message || 'Eliminazione fallita')
    } finally {
      setBusy(false)
    }
  }

  function openPdf(row) {
    const url = staffDocumentFileUrl(row)
    if (!url) {
      setError('File PDF non disponibile')
      return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const title = useMemo(() => CATEGORY_LABELS[panel] || panel, [panel])

  if (!locale || !panel) return null

  return (
    <div className="stipendi-docs-panel">
      <div className="pagamenti-workbook-toolbar">
        <div className="pagamenti-workbook-toolbar-left">
          <span className="pagamenti-workbook-title">{title}</span>
          <span className="pagamenti-workbook-sheet-label">
            {formatStaffLocaleOptionLabel(locale)}
            {panel === 'busta_paga' ? ` · ${ymLabel(yearMonth)}` : ''}
          </span>
        </div>
      </div>

      {error ? <div className="alert alert-danger">{error}</div> : null}
      {success ? <div className="alert alert-success">{success}</div> : null}

      <form className="stipendi-docs-form" onSubmit={handleUpload} style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="form-group" style={{ margin: 0 }}>
            <span>Nome</span>
            <input className="form-control" value={form.first_name} onChange={(e) => updateForm('first_name', e.target.value)} />
          </label>
          <label className="form-group" style={{ margin: 0 }}>
            <span>Cognome</span>
            <input className="form-control" value={form.last_name} onChange={(e) => updateForm('last_name', e.target.value)} />
          </label>
          {panel !== 'busta_paga' ? (
            <>
              <label className="form-group" style={{ margin: 0 }}>
                <span>Data nascita</span>
                <input
                  type="date"
                  className="form-control"
                  value={form.birth_date}
                  onChange={(e) => updateForm('birth_date', e.target.value)}
                />
              </label>
              <label className="form-group" style={{ margin: 0 }}>
                <span>Email</span>
                <input
                  type="email"
                  className="form-control"
                  value={form.email}
                  onChange={(e) => updateForm('email', e.target.value)}
                />
              </label>
              <label className="form-group" style={{ margin: 0 }}>
                <span>Telefono</span>
                <input className="form-control" value={form.phone} onChange={(e) => updateForm('phone', e.target.value)} />
              </label>
            </>
          ) : (
            <>
              <label className="form-group" style={{ margin: 0 }}>
                <span>N. documento</span>
                <input
                  className="form-control"
                  value={form.document_number}
                  onChange={(e) => updateForm('document_number', e.target.value)}
                />
              </label>
              <label className="form-group" style={{ margin: 0 }}>
                <span>Ruolo</span>
                <input className="form-control" value={form.ruolo} onChange={(e) => updateForm('ruolo', e.target.value)} />
              </label>
            </>
          )}
          {panel === 'documento_personale' ? (
            <label className="form-group" style={{ margin: 0 }}>
              <span>Tipo documento</span>
              <select className="form-control" value={form.doc_type} onChange={(e) => updateForm('doc_type', e.target.value)}>
                {DOC_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {!editId ? (
            <label className="form-group" style={{ margin: 0 }}>
              <span>PDF</span>
              <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="form-control" />
            </label>
          ) : null}
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
            {busy ? 'Salvo…' : editId ? 'Salva modifiche' : 'Carica documento'}
          </button>
          {editId ? (
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={resetForm}>
              Annulla
            </button>
          ) : null}
        </div>
      </form>

      {loading ? (
        <p className="muted">Caricamento…</p>
      ) : (
        <div className="pagamenti-grid-wrap excel-wrap" style={{ overflowX: 'auto' }}>
          <table className="app-table excel-table pagamenti-grid">
            <thead>
              <tr>
                {panel === 'busta_paga' ? (
                  <>
                    <th>N. documento</th>
                    <th>Mese busta</th>
                    <th>Nome</th>
                    <th>Cognome</th>
                    <th>Locale</th>
                    <th>Ruolo</th>
                  </>
                ) : (
                  <>
                    <th>Nome</th>
                    <th>Cognome</th>
                    <th>Data nascita</th>
                    <th>Email</th>
                    <th>Telefono</th>
                    {panel === 'documento_personale' ? <th>Tipo</th> : null}
                  </>
                )}
                <th>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="muted">
                    Nessun documento. Carica un PDF.
                  </td>
                </tr>
              ) : (
                items.map((row) => (
                  <tr key={row.id}>
                    {panel === 'busta_paga' ? (
                      <>
                        <td>{row.document_number || '—'}</td>
                        <td>{ymLabel(row.year_month || yearMonth)}</td>
                        <td>{row.first_name || '—'}</td>
                        <td>{row.last_name || '—'}</td>
                        <td>{row.locale_name || locale}</td>
                        <td>{row.ruolo || '—'}</td>
                      </>
                    ) : (
                      <>
                        <td>{row.first_name || '—'}</td>
                        <td>{row.last_name || '—'}</td>
                        <td>{formatDateIt(row.birth_date)}</td>
                        <td>{row.email || '—'}</td>
                        <td>{row.phone || '—'}</td>
                        {panel === 'documento_personale' ? <td>{docTypeLabel(row.doc_type)}</td> : null}
                      </>
                    )}
                    <td>
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => openPdf(row)}>
                          Apri PDF
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => startEdit(row)}>
                          Modifica
                        </button>
                        <button type="button" className="btn btn-outline-danger btn-sm" disabled={busy} onClick={() => handleDelete(row)}>
                          Elimina
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
