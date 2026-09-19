import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  deleteStaffDocument,
  fetchStaffDocuments,
  importStaffBuste,
  previewStaffBuste,
  staffDocumentFileUrl,
  updateStaffDocument,
  uploadStaffDocument,
} from '../services/staffService.js'
import {
  formatStaffLocaleOptionLabel,
  resolveTigitoCompanyFromFilename,
} from '../utils/staffLocaleCompanyLabels.js'
import { readGestionaleStaffLocale } from '../utils/gestionaleStaffLocale.js'

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
 * Foglio documenti (contratto / buste / documenti): form di inserimento + tabella.
 * Buste: estrazione automatica da PDF Tigito oppure assegnazione manuale nome/cognome.
 */
export default function StipendiDocumentsPanel({ localeName, yearMonth, category }) {
  const panel = String(category || '').trim()
  const locale = String(localeName || readGestionaleStaffLocale() || '').trim()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [monthHint, setMonthHint] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [editId, setEditId] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [busteMode, setBusteMode] = useState('extract') // extract | assign
  const [pdfPassword, setPdfPassword] = useState('')
  const [detectedSocieta, setDetectedSocieta] = useState('')
  const [previewRows, setPreviewRows] = useState([])
  const [previewGroups, setPreviewGroups] = useState(null)
  const fileRef = useRef(null)
  const importFileRef = useRef(null)

  const title = useMemo(() => CATEGORY_LABELS[panel] || panel || 'Documenti', [panel])
  const isBuste = panel === 'busta_paga'

  function applyFileCompany(file) {
    const hit = resolveTigitoCompanyFromFilename(file?.name)
    if (hit) {
      setDetectedSocieta(hit.shortLabel)
      if (hit.vat) setPdfPassword(hit.vat)
      return hit
    }
    setDetectedSocieta('')
    return null
  }

  const load = useCallback(async () => {
    if (!panel || !locale) {
      setItems([])
      setMonthHint('')
      return
    }
    if (panel === 'busta_paga' && !yearMonth) {
      setItems([])
      setMonthHint('')
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
      setMonthHint('')

      if (panel === 'busta_paga' && yearMonth) {
        const allRes = await fetchStaffDocuments({ category: panel, locale })
        const all = Array.isArray(allRes?.items) ? allRes.items : []
        const otherMonths = [
          ...new Set(all.map((r) => r.year_month).filter((ym) => ym && ym !== yearMonth)),
        ]
        if (otherMonths.length) {
          const nOther = all.filter((r) => r.year_month && r.year_month !== yearMonth).length
          setMonthHint(
            `${nOther} buste di questo locale in altri mesi: ${otherMonths
              .map(ymLabel)
              .join(', ')}. Cambia il mese in alto per vederle.`,
          )
        }
      }
    } catch (e) {
      setError(e?.message || 'Errore caricamento documenti')
      setItems([])
      setMonthHint('')
    } finally {
      setLoading(false)
    }
  }, [panel, locale, yearMonth])

  useEffect(() => {
    setForm(emptyForm)
    setEditId(null)
    setSelectedId(null)
    setError('')
    setSuccess('')
    setMonthHint('')
    setDetectedSocieta('')
    setPreviewRows([])
    setPreviewGroups(null)
    if (fileRef.current) fileRef.current.value = ''
    if (importFileRef.current) importFileRef.current.value = ''
    void load()
  }, [load])

  function updateForm(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function resetForm() {
    setForm(emptyForm)
    setEditId(null)
    setSelectedId(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleUpload(e) {
    e?.preventDefault?.()
    if (!panel) {
      setError('Sezione non valida')
      return
    }
    if (!locale) {
      setError('Apri prima il locale con Accedi (banner sopra).')
      return
    }
    const file = fileRef.current?.files?.[0]
    if (!editId && !file) {
      setError('Seleziona un PDF da caricare')
      return
    }
    if (!String(form.first_name || '').trim() && !String(form.last_name || '').trim()) {
      setError('Inserisci almeno nome o cognome')
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
        setSuccess('PDF caricato e assegnato a nome/cognome')
      }
      resetForm()
      await load()
    } catch (err) {
      setError(err?.message || 'Salvataggio fallito')
    } finally {
      setBusy(false)
    }
  }

  async function handlePreviewExtract() {
    if (!locale) {
      setError('Apri Accedi sul locale (Via Abba o Via Zanardelli) per vedere solo i dipendenti di quella sede.')
      return
    }
    const file = importFileRef.current?.files?.[0]
    if (!file) {
      setError('Seleziona il PDF delle buste (TeamSystem / Tigito)')
      return
    }
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const hit = applyFileCompany(file)
      const fd = new FormData()
      fd.append('file', file)
      const pwd = pdfPassword.trim() || hit?.vat || ''
      if (pwd) fd.append('password', pwd)
      fd.append('locale_name', locale)
      const res = await previewStaffBuste(fd)
      const rows = Array.isArray(res?.employees) ? res.employees : []
      setPreviewRows(rows)
      setPreviewGroups(res?.by_locale || null)
      if (!rows.length) {
        setError(
          `Nessun cedolino per questo locale tra le ${res?.total_pages || 0} pagine. Controlla Accedi (Abba/Zanardelli) e password.`,
        )
      } else {
        const z = res?.by_locale?.zanardelli?.count ?? 0
        const a = res?.by_locale?.abba?.count ?? 0
        const locLabel = formatStaffLocaleOptionLabel(res?.locale_name || locale) || locale
        setSuccess(
          `Anteprima «${locLabel}»: ${rows.length} dipendenti` +
            (res?.shop_label ? ` · sede ${res.shop_label}` : '') +
            ` (PDF: Zanardelli ${z}, Abba ${a}). Premi Importa per salvare solo questi.`,
        )
      }
    } catch (err) {
      setPreviewRows([])
      setPreviewGroups(null)
      setError(err?.message || 'Anteprima fallita')
    } finally {
      setBusy(false)
    }
  }

  async function handleImportExtract() {
    if (!locale) {
      setError('Apri Accedi sul locale (Via Abba o Via Zanardelli): il PDF Mediazione contiene entrambe le sedi.')
      return
    }
    const file = importFileRef.current?.files?.[0]
    if (!file) {
      setError('Seleziona il PDF delle buste')
      return
    }
    const hit = resolveTigitoCompanyFromFilename(file.name)
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const pwd = pdfPassword.trim() || hit?.vat || ''
      if (pwd) fd.append('password', pwd)
      fd.append('locale_name', locale)
      if (yearMonth) fd.append('year_month', yearMonth)
      const res = await importStaffBuste(fd)
      const n = Number(res?.imported) || 0
      const skipped = Number(res?.skipped) || 0
      const imported = Array.isArray(res?.items) ? res.items : []
      if (imported.length) setItems(imported)
      const locLabel = formatStaffLocaleOptionLabel(res?.locale_name || locale) || locale
      const societa = res?.societa || hit?.shortLabel || ''
      setDetectedSocieta(societa)
      setSuccess(
        `Importate ${n} buste per «${locLabel}»${societa ? ` (${societa})` : ''}` +
          (skipped ? ` · escluse ${skipped} di altre sedi` : '') +
          ` · ${ymLabel(res?.year_month || yearMonth)}`,
      )
      setPreviewRows([])
      if (importFileRef.current) importFileRef.current.value = ''
      await load()
    } catch (err) {
      setError(err?.message || 'Import fallito')
    } finally {
      setBusy(false)
    }
  }

  function startEdit(row) {
    setEditId(row.id)
    setSelectedId(row.id)
    setBusteMode('assign')
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
    setSuccess(`Modifica: ${[row.first_name, row.last_name].filter(Boolean).join(' ') || 'documento'}`)
  }

  async function handleDelete(row) {
    const target = row || items.find((r) => r.id === selectedId)
    if (!target) {
      setError('Seleziona una riga da eliminare')
      return
    }
    const label = [target.first_name, target.last_name].filter(Boolean).join(' ') || target.original_name || `#${target.id}`
    if (!window.confirm(`Eliminare il documento di «${label}»?`)) return
    setBusy(true)
    setError('')
    try {
      await deleteStaffDocument(target.id)
      setSuccess('Documento eliminato')
      if (editId === target.id) resetForm()
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

  if (!panel) {
    return (
      <div className="stipendi-docs-panel" style={{ padding: '1rem' }}>
        <p className="muted">Seleziona CONTRATTI, BUSTE o DOCUMENTI dal foglio in basso.</p>
      </div>
    )
  }

  return (
    <div className="stipendi-docs-panel" style={{ padding: '0.75rem 1rem 1rem' }}>
      <div className="stipendi-edit-card stipendi-edit-card--nested">
        <h2 className="stipendi-section-title" style={{ marginTop: 0 }}>
          {title}
          {isBuste ? ` · ${ymLabel(yearMonth)}` : ''}
        </h2>
        <p className="muted stipendi-edit-hint">
          {isBuste
            ? `Locale Accedi: ${formatStaffLocaleOptionLabel(locale) || '—'} · mese ${ymLabel(yearMonth)}. Dal PDF Mediazione restano solo i dipendenti di questo locale (indirizzo Abba/Zanardelli + pack stazione operativa).`
            : `Locale: ${formatStaffLocaleOptionLabel(locale) || '—'} · Compila i campi, scegli il PDF e premi Carica.`}
        </p>

        {!locale ? (
          <div className="alert alert-warning">Apri il locale con Accedi nel banner sopra per caricare e vedere i documenti.</div>
        ) : null}
        {error ? <div className="alert alert-danger">{error}</div> : null}
        {success ? <div className="alert alert-success">{success}</div> : null}
        {monthHint ? <div className="alert alert-warning">{monthHint}</div> : null}

        {isBuste ? (
          <div className="stipendi-row-actions" style={{ marginBottom: '0.75rem', gap: '0.5rem' }}>
            <button
              type="button"
              className={`btn btn-sm ${busteMode === 'extract' ? 'btn-primary' : 'btn-secondary'}`}
              disabled={busy}
              onClick={() => setBusteMode('extract')}
            >
              Estrai da PDF
            </button>
            <button
              type="button"
              className={`btn btn-sm ${busteMode === 'assign' ? 'btn-primary' : 'btn-secondary'}`}
              disabled={busy}
              onClick={() => setBusteMode('assign')}
            >
              Assegna nome/cognome
            </button>
          </div>
        ) : null}

        {isBuste && busteMode === 'extract' ? (
          <div className="stipendi-docs-form">
            <p className="muted" style={{ marginTop: 0 }}>
              PDF Mediazione (<code>PG0218…</code>) con entrambe le sedi: restano solo i cedolini di{' '}
              <strong>{formatStaffLocaleOptionLabel(locale) || locale || 'questo locale'}</strong> (indirizzo Via Abba /
              Via Zanardelli, oppure nome già nel pack Personale / stazione operativa). Password = P.IVA.
              {detectedSocieta ? (
                <>
                  {' '}
                  Società file: <strong>{detectedSocieta}</strong>.
                </>
              ) : null}
            </p>
            <div className="stipendi-edit-row stipendi-draft-row" style={{ alignItems: 'flex-end' }}>
              <label className="stipendi-edit-field" style={{ minWidth: '14rem', flex: '1 1 14rem' }}>
                <span>PDF buste (multi-pagina)</span>
                <input
                  ref={importFileRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="form-control"
                  onChange={(e) => applyFileCompany(e.target.files?.[0])}
                />
              </label>
              <label className="stipendi-edit-field" style={{ minWidth: '10rem' }}>
                <span>Password PDF (P.IVA)</span>
                <input
                  className="form-control"
                  value={pdfPassword}
                  onChange={(e) => setPdfPassword(e.target.value)}
                  placeholder="04945600759"
                  autoComplete="off"
                />
              </label>
              <label className="stipendi-edit-field" style={{ minWidth: '8rem' }}>
                <span>Società</span>
                <input className="form-control" value={detectedSocieta || '—'} readOnly />
              </label>
            </div>
            <div className="stipendi-edit-footer" style={{ marginTop: '0.75rem' }}>
              <div className="stipendi-row-actions">
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !locale} onClick={() => void handlePreviewExtract()}>
                  {busy ? 'Leggo…' : 'Anteprima estrazione'}
                </button>
                <button type="button" className="btn btn-primary btn-sm" disabled={busy || !locale} onClick={() => void handleImportExtract()}>
                  {busy ? 'Importo…' : 'Importa buste'}
                </button>
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy || loading || !locale} onClick={() => void load()}>
                  Aggiorna elenco
                </button>
              </div>
            </div>
            {previewRows.length > 0 ? (
              <div style={{ marginTop: '0.75rem', overflowX: 'auto' }}>
                <p className="muted" style={{ marginBottom: '0.35rem' }}>
                  Solo dipendenti di questo locale ({previewRows.length}). Ripartizione PDF:{' '}
                  Zanardelli {previewGroups?.zanardelli?.count ?? '—'} · Abba {previewGroups?.abba?.count ?? '—'}
                  {(previewGroups?.altro?.count || 0) > 0 ? ` · altro ${previewGroups.altro.count}` : ''}.
                </p>
                <table className="app-table excel-table" style={{ fontSize: '0.85rem' }}>
                  <thead>
                    <tr>
                      <th>Pag.</th>
                      <th>Cognome</th>
                      <th>Nome</th>
                      <th>CF</th>
                      <th>Sede</th>
                      <th>Mese</th>
                      <th>Netto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r) => (
                      <tr key={`${r.page}-${r.codice_fiscale || r.full_name}`}>
                        <td>{r.page}</td>
                        <td>{r.last_name || '—'}</td>
                        <td>{r.first_name || '—'}</td>
                        <td>{r.codice_fiscale || '—'}</td>
                        <td>{r.shop_label || r.suggested_locale || '—'}</td>
                        <td>{r.month_label || ymLabel(r.year_month)}</td>
                        <td>{r.netto != null ? Number(r.netto).toFixed(2) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : (
          <form className="stipendi-docs-form" onSubmit={handleUpload}>
            <div className="stipendi-edit-row stipendi-draft-row" style={{ alignItems: 'flex-end' }}>
              <label className="stipendi-edit-field" style={{ minWidth: '8rem', flex: '1 1 8rem' }}>
                <span>Nome</span>
                <input
                  className="form-control"
                  value={form.first_name}
                  onChange={(e) => updateForm('first_name', e.target.value)}
                  placeholder="Nome"
                />
              </label>
              <label className="stipendi-edit-field" style={{ minWidth: '8rem', flex: '1 1 8rem' }}>
                <span>Cognome</span>
                <input
                  className="form-control"
                  value={form.last_name}
                  onChange={(e) => updateForm('last_name', e.target.value)}
                  placeholder="Cognome"
                />
              </label>

              {isBuste ? (
                <>
                  <label className="stipendi-edit-field">
                    <span>N. documento</span>
                    <input
                      className="form-control"
                      value={form.document_number}
                      onChange={(e) => updateForm('document_number', e.target.value)}
                    />
                  </label>
                  <label className="stipendi-edit-field">
                    <span>Ruolo</span>
                    <input className="form-control" value={form.ruolo} onChange={(e) => updateForm('ruolo', e.target.value)} />
                  </label>
                </>
              ) : (
                <>
                  <label className="stipendi-edit-field">
                    <span>Data nascita</span>
                    <input
                      type="date"
                      className="form-control"
                      value={form.birth_date}
                      onChange={(e) => updateForm('birth_date', e.target.value)}
                    />
                  </label>
                  <label className="stipendi-edit-field" style={{ minWidth: '10rem', flex: '1 1 10rem' }}>
                    <span>Email</span>
                    <input
                      type="email"
                      className="form-control"
                      value={form.email}
                      onChange={(e) => updateForm('email', e.target.value)}
                    />
                  </label>
                  <label className="stipendi-edit-field">
                    <span>Telefono</span>
                    <input className="form-control" value={form.phone} onChange={(e) => updateForm('phone', e.target.value)} />
                  </label>
                </>
              )}

              {panel === 'documento_personale' ? (
                <label className="stipendi-edit-field" style={{ minWidth: '11rem' }}>
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
                <label className="stipendi-edit-field" style={{ minWidth: '12rem', flex: '1 1 12rem' }}>
                  <span>File PDF</span>
                  <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="form-control" />
                </label>
              ) : null}
            </div>

            <div className="stipendi-edit-footer" style={{ marginTop: '0.75rem' }}>
              <div className="stipendi-row-actions">
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={resetForm}>
                  + Nuovo
                </button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !locale}>
                  {busy ? 'Salvo…' : editId ? 'Aggiorna' : 'Carica PDF'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy || selectedId == null}
                  onClick={() => {
                    const row = items.find((r) => r.id === selectedId)
                    if (row) startEdit(row)
                    else setError('Seleziona una riga nella tabella')
                  }}
                >
                  Modifica
                </button>
                <button
                  type="button"
                  className="btn btn-outline-danger btn-sm"
                  disabled={busy || selectedId == null}
                  onClick={() => void handleDelete()}
                >
                  Elimina
                </button>
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy || loading || !locale} onClick={() => void load()}>
                  Aggiorna elenco
                </button>
              </div>
            </div>
          </form>
        )}
      </div>

      <div style={{ marginTop: '1rem' }}>
        <h3 className="stipendi-section-title" style={{ fontSize: '1rem' }}>
          Tabella {title}
          {loading ? ' · caricamento…' : ` · ${items.length} documenti`}
        </h3>
        <div className="pagamenti-grid-wrap excel-wrap" style={{ overflowX: 'auto' }}>
          <table className="app-table excel-table pagamenti-grid stipendi-docs-table">
            <thead>
              <tr>
                {isBuste ? (
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
                <th>File</th>
                <th>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="muted">
                    {locale
                      ? isBuste
                        ? 'Nessuna busta. Usa Estrai da PDF oppure Assegna nome/cognome.'
                        : 'Nessun documento in tabella. Compila sopra e premi Carica PDF.'
                      : 'Apri il locale per vedere e inserire documenti.'}
                  </td>
                </tr>
              ) : (
                items.map((row) => (
                  <tr
                    key={row.id}
                    className={selectedId === row.id ? 'stipendi-excel-row-selected' : ''}
                    onClick={() => setSelectedId(row.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    {isBuste ? (
                      <>
                        <td>{row.document_number || '—'}</td>
                        <td>{ymLabel(row.year_month || yearMonth)}</td>
                        <td>{row.first_name || '—'}</td>
                        <td>{row.last_name || '—'}</td>
                        <td>{formatStaffLocaleOptionLabel(row.locale_name) || row.locale_name || '—'}</td>
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
                    <td>{row.original_name || 'PDF'}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => openPdf(row)}>
                          Apri PDF
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => startEdit(row)}>
                          Modifica
                        </button>
                        <button type="button" className="btn btn-outline-danger btn-sm" disabled={busy} onClick={() => void handleDelete(row)}>
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
      </div>
    </div>
  )
}
