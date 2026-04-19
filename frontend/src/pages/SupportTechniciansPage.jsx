import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createSupportActivity,
  createSupportTechnician,
  deleteAllSupportTechnicians,
  deleteSupportActivity,
  deleteSupportTechnician,
  fetchSupportActivities,
  fetchSupportTechnicians,
  seedSupportDefaults,
  supportWhatsappUrl,
  updateSupportActivity,
  updateSupportTechnician,
  uploadSupportTechnicianInvoice,
} from '../services/supportTechniciansService'
import { apiUrl } from '../services/api'
import { durationHours, generateSupportTechnicianPdf } from '../utils/supportTechnicianReport'

function toYmd(d) {
  const x = new Date(d)
  const y = x.getFullYear()
  const m = String(x.getMonth() + 1).padStart(2, '0')
  const day = String(x.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Lunedì della settimana ISO contenente `d`. */
function startOfIsoWeek(d) {
  const x = new Date(d)
  const day = x.getDay()
  const delta = day === 0 ? -6 : 1 - day
  x.setDate(x.getDate() + delta)
  return x
}

function endOfIsoWeek(d) {
  const s = startOfIsoWeek(d)
  const e = new Date(s)
  e.setDate(e.getDate() + 6)
  return e
}

export default function SupportTechniciansPage() {
  const [technicians, setTechnicians] = useState([])
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [actLoading, setActLoading] = useState(false)
  const [error, setError] = useState('')
  const [viewMode, setViewMode] = useState('week')
  const [viewDate, setViewDate] = useState(() => new Date())
  const [filterTechId, setFilterTechId] = useState('')
  const [pdfHourlyRate, setPdfHourlyRate] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceUploadBusy, setInvoiceUploadBusy] = useState(false)
  const [uploadNotice, setUploadNotice] = useState('')
  /** Anteprima ultimo PDF caricato sul server (`/uploads/...`). */
  const [uploadedInvoicePreview, setUploadedInvoicePreview] = useState(null)
  const invoiceFileInputRef = useRef(null)

  const [techModal, setTechModal] = useState(null)
  const [techForm, setTechForm] = useState({ full_name: '', phone: '', specialty: '' })

  const [actModal, setActModal] = useState(null)
  const [actForm, setActForm] = useState({
    technician_id: '',
    activity_date: toYmd(new Date()),
    time_start: '',
    time_end: '',
    location: '',
    notes: '',
    kind: 'planned',
  })

  const range = useMemo(() => {
    if (viewMode === 'day') {
      const y = toYmd(viewDate)
      return { from: y, to: y }
    }
    return { from: toYmd(startOfIsoWeek(viewDate)), to: toYmd(endOfIsoWeek(viewDate)) }
  }, [viewMode, viewDate])

  const loadTechnicians = useCallback(async (opts = {}) => {
    const allowSeed = opts.allowSeed !== false
    setError('')
    try {
      let list = await fetchSupportTechnicians()
      if (!list.length && allowSeed) {
        await seedSupportDefaults()
        list = await fetchSupportTechnicians()
      }
      setTechnicians(list)
    } catch (e) {
      setError(e?.message || 'Errore caricamento tecnici')
      setTechnicians([])
    } finally {
      setLoading(false)
    }
  }, [])

  const loadActivities = useCallback(async () => {
    setActLoading(true)
    setError('')
    try {
      const tid = filterTechId ? Number(filterTechId) : undefined
      const rows = await fetchSupportActivities(range.from, range.to, tid)
      setActivities(rows)
    } catch (e) {
      setError(e?.message || 'Errore caricamento attività')
      setActivities([])
    } finally {
      setActLoading(false)
    }
  }, [range.from, range.to, filterTechId])

  useEffect(() => {
    loadTechnicians()
  }, [loadTechnicians])

  useEffect(() => {
    if (!loading) loadActivities()
  }, [loading, loadActivities])

  function openNewTech() {
    setTechForm({ full_name: '', phone: '', specialty: '' })
    setTechModal('new')
  }

  function openEditTech(t) {
    setTechForm({
      full_name: t.full_name || '',
      phone: t.phone || '',
      specialty: t.specialty || '',
    })
    setTechModal(t.id)
  }

  async function saveTech() {
    setError('')
    try {
      if (!techForm.full_name.trim()) {
        setError('Inserisci nome e cognome del tecnico')
        return
      }
      if (techModal === 'new') {
        await createSupportTechnician({
          full_name: techForm.full_name.trim(),
          phone: techForm.phone.trim(),
          specialty: techForm.specialty.trim() || null,
          sort_order: technicians.length,
        })
      } else {
        await updateSupportTechnician(techModal, {
          full_name: techForm.full_name.trim(),
          phone: techForm.phone.trim(),
          specialty: techForm.specialty.trim() || null,
        })
      }
      setTechModal(null)
      await loadTechnicians()
    } catch (e) {
      setError(e?.message || 'Salvataggio fallito')
    }
  }

  async function removeTech(id) {
    if (!window.confirm('Eliminare questo tecnico e le attività collegate?')) return
    setError('')
    try {
      await deleteSupportTechnician(id)
      await loadTechnicians()
      await loadActivities()
    } catch (e) {
      setError(e?.message || 'Eliminazione fallita')
    }
  }

  async function removeAllTechnicians() {
    if (!technicians.length) return
    if (
      !window.confirm(
        'Eliminare tutti i tecnici dall’elenco? Verranno rimosse anche tutte le attività collegate. L’operazione non si può annullare.',
      )
    )
      return
    setError('')
    try {
      await deleteAllSupportTechnicians()
      setFilterTechId('')
      await loadTechnicians({ allowSeed: false })
      await loadActivities()
    } catch (e) {
      setError(e?.message || 'Eliminazione elenco fallita')
    }
  }

  function openNewActivity() {
    setActForm({
      technician_id: filterTechId || (technicians[0]?.id ?? ''),
      activity_date: range.from,
      time_start: '',
      time_end: '',
      location: '',
      notes: '',
      kind: 'planned',
    })
    setActModal('new')
  }

  function openEditActivity(a) {
    setActForm({
      technician_id: String(a.technician_id),
      activity_date: a.activity_date,
      time_start: a.time_start || '',
      time_end: a.time_end || '',
      location: a.location || '',
      notes: a.notes || '',
      kind: a.kind || 'planned',
    })
    setActModal(a.id)
  }

  async function saveActivity() {
    setError('')
    try {
      const tid = Number(actForm.technician_id)
      if (!tid) {
        setError('Seleziona un tecnico')
        return
      }
      const payload = {
        technician_id: tid,
        activity_date: actForm.activity_date,
        time_start: actForm.time_start || '',
        time_end: actForm.time_end || '',
        location: actForm.location.trim() || null,
        notes: actForm.notes.trim() || null,
        kind: actForm.kind,
      }
      if (actModal === 'new') await createSupportActivity(payload)
      else await updateSupportActivity(actModal, payload)
      setActModal(null)
      await loadActivities()
    } catch (e) {
      setError(e?.message || 'Salvataggio fallito')
    }
  }

  async function removeActivity(id) {
    if (!window.confirm('Eliminare questa voce?')) return
    setError('')
    try {
      await deleteSupportActivity(id)
      await loadActivities()
    } catch (e) {
      setError(e?.message || 'Eliminazione fallita')
    }
  }

  function shiftPeriod(dir) {
    const x = new Date(viewDate)
    if (viewMode === 'day') x.setDate(x.getDate() + dir)
    else x.setDate(x.getDate() + dir * 7)
    setViewDate(x)
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  function exportSupportPdf() {
    if (!activities.length) {
      setError('Nessuna attività nel periodo selezionato')
      return
    }
    const selected = technicians.find((t) => String(t.id) === String(filterTechId))
    const periodLabel = range.from === range.to ? range.from : `${range.from} / ${range.to}`
    const blob = generateSupportTechnicianPdf({
      periodLabel,
      rows: activities,
      technicianName: selected?.full_name || '',
      hourlyRate: pdfHourlyRate,
    })
    const safeTech = (selected?.full_name || 'tutti')
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9\-]/g, '')
    downloadBlob(blob, `assistenza-tecnica-${safeTech}-${range.from}-${range.to}.pdf`)
  }

  function sendWhatsAppSummary() {
    const completedRows = activities.filter((a) => a.kind === 'completed')
    if (!completedRows.length) {
      setError('Nessuna attività completata nel periodo selezionato')
      return
    }
    const selected = technicians.find((t) => String(t.id) === String(filterTechId))
    const periodLabel = range.from === range.to ? range.from : `${range.from} / ${range.to}`
    const lines = [
      `*Assistenza tecnica svolta*`,
      `Periodo: ${periodLabel}`,
      `Tecnico: ${selected?.full_name || 'Tutti'}`,
      '',
    ]
    let total = 0
    for (const a of completedRows) {
      const h = durationHours(a.time_start, a.time_end)
      total += h
      const dateIt = new Date(`${a.activity_date}T12:00:00`).toLocaleDateString('it-IT')
      const hrs = h > 0 ? ` (${h.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} h)` : ''
      lines.push(`- ${dateIt} ${a.time_start || '--:--'}-${a.time_end || '--:--'}${hrs}`)
      lines.push(`  Dove: ${a.location || '—'}`)
      lines.push(`  Intervento: ${a.notes || '—'}`)
    }
    lines.push('', `Totale ore: ${total.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} h`)
    const wa = `https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`
    window.open(wa, '_blank', 'noopener,noreferrer')
  }

  function triggerInvoiceUpload() {
    setError('')
    setUploadNotice('')
    invoiceFileInputRef.current?.click()
  }

  async function handleInvoiceFileSelected(e) {
    const input = e.target
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Per il caricamento è accettato solo un file PDF.')
      return
    }
    setInvoiceUploadBusy(true)
    setError('')
    setUploadNotice('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('date_from', range.from)
      fd.append('date_to', range.to)
      if (filterTechId) fd.append('technician_id', filterTechId)
      if (invoiceNumber.trim()) fd.append('invoice_number', invoiceNumber.trim())
      const data = await uploadSupportTechnicianInvoice(fd)
      const rel = String(data.storage_path || '').replace(/^\/+/, '')
      if (rel) {
        setUploadedInvoicePreview({
          url: apiUrl(`/uploads/${rel}`),
          title: data.original_name || file.name,
          id: data.id,
        })
      } else {
        setUploadedInvoicePreview(null)
      }
      setUploadNotice(`Fattura salvata sul server: ${file.name}`)
      window.setTimeout(() => setUploadNotice(''), 8000)
    } catch (err) {
      setError(err?.message || 'Caricamento fattura fallito')
    } finally {
      setInvoiceUploadBusy(false)
    }
  }

  const rangeLabel =
    range.from === range.to
      ? new Date(range.from + 'T12:00:00').toLocaleDateString('it-IT', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : `${new Date(range.from + 'T12:00:00').toLocaleDateString('it-IT')} — ${new Date(range.to + 'T12:00:00').toLocaleDateString('it-IT')}`
  const phoneDigits = (techForm.phone || '').replace(/\D/g, '')
  const phoneLooksShort = phoneDigits.length > 0 && phoneDigits.length < 9

  return (
    <div className="support-page">
      <header className="support-page-hero">
        <div className="support-page-hero-inner">
          <h1 className="page-header support-page-title">Assistenza tecnici</h1>
          <p className="support-page-lead">
            Contatti WhatsApp, report dei lavori e pianificazione per giorno o settimana. Gestisci l&apos;elenco tecnici
            con aggiunta, modifica ed eliminazione.
          </p>
        </div>
      </header>

      {error && <div className="alert alert-danger">{error}</div>}
      {uploadNotice && <div className="alert alert-success">{uploadNotice}</div>}

      <section className="card support-section">
        <h2 className="page-subheader">Tecnici</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '-0.5rem' }}>
          Pulsante verde per aprire WhatsApp. Modifica o elimina dalla scheda.
        </p>
        {loading ? (
          <p className="loading">Caricamento…</p>
        ) : (
          <>
            <div className="btn-group" style={{ marginBottom: '1rem' }}>
              <button type="button" className="btn btn-vino" onClick={openNewTech}>
                Aggiungi tecnico
              </button>
              <button
                type="button"
                className="btn btn-vino-outline"
                onClick={removeAllTechnicians}
                disabled={!technicians.length}
                title="Svuota l’elenco tecnici"
              >
                Elimina elenco tecnici
              </button>
            </div>
            <div className="support-tech-grid">
              {technicians.map((t) => {
                const wa = supportWhatsappUrl(t.phone)
                return (
                  <article key={t.id} className="support-tech-card">
                    <div className="support-tech-card-head">
                      <h3 className="support-tech-name">{t.full_name}</h3>
                      {t.specialty ? <span className="support-tech-role">{t.specialty}</span> : null}
                    </div>
                    <div className="support-tech-phone">{t.phone}</div>
                    <div className="support-tech-actions">
                      {wa ? (
                        <a
                          className="btn btn-whatsapp btn-sm"
                          href={wa}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Apri WhatsApp"
                        >
                          WhatsApp
                        </a>
                      ) : null}
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEditTech(t)}>
                        Modifica
                      </button>
                      <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => removeTech(t.id)}>
                        Elimina
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          </>
        )}
      </section>

      <section className="card support-section">
        <h2 className="page-subheader">Report e pianificazione</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '-0.5rem' }}>
          Voci <strong>completate</strong> (lavoro svolto) e <strong>pianificate</strong> (impegno futuro o da svolgere). Filtra
          per periodo e tecnico.
        </p>

        <div className="support-invoice-work-row">
        <div className="support-toolbar">
          <div className="support-toolbar-mode">
            <button
              type="button"
              className={`btn btn-sm ${viewMode === 'day' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setViewMode('day')}
            >
              Giorno
            </button>
            <button
              type="button"
              className={`btn btn-sm ${viewMode === 'week' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setViewMode('week')}
            >
              Settimana
            </button>
          </div>
          <div className="support-toolbar-nav">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => shiftPeriod(-1)}>
              ← Indietro
            </button>
            <span className="support-toolbar-label">{rangeLabel}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => shiftPeriod(1)}>
              Avanti →
            </button>
          </div>
          <div className="form-group support-toolbar-filter">
            <label htmlFor="support-filter-tech">Tecnico</label>
            <select
              id="support-filter-tech"
              className="form-control"
              style={{ maxWidth: 280 }}
              value={filterTechId}
              onChange={(e) => setFilterTechId(e.target.value)}
            >
              <option value="">Tutti</option>
              {technicians.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.full_name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group support-toolbar-filter">
            <label htmlFor="support-hourly-rate">Tariffa €/h (PDF)</label>
            <input
              id="support-hourly-rate"
              className="form-control"
              style={{ maxWidth: 130 }}
              value={pdfHourlyRate}
              onChange={(e) => setPdfHourlyRate(e.target.value)}
              inputMode="decimal"
              placeholder="es. 35"
            />
          </div>
          <div className="form-group support-toolbar-filter">
            <label htmlFor="support-invoice-number">N. fattura</label>
            <input
              id="support-invoice-number"
              className="form-control"
              style={{ maxWidth: 130 }}
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder="es. 12/2026"
            />
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={exportSupportPdf}>
            Scarica PDF assistenza
          </button>
          <input
            ref={invoiceFileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            style={{ display: 'none' }}
            aria-hidden
            onChange={(ev) => void handleInvoiceFileSelected(ev)}
          />
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={triggerInvoiceUpload}
            disabled={invoiceUploadBusy}
            title="Carica un PDF fattura del tecnico (max 15 MB). Usa periodo e filtro tecnico correnti; opzionale N. fattura."
          >
            {invoiceUploadBusy ? 'Caricamento…' : 'Carica fattura'}
          </button>
          <button type="button" className="btn btn-whatsapp btn-sm" onClick={sendWhatsAppSummary}>
            WhatsApp riepilogo
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={openNewActivity} disabled={!technicians.length}>
            Aggiungi voce
          </button>
        </div>

        {uploadedInvoicePreview ? (
          <aside className="support-uploaded-pdf-aside" aria-label="Anteprima fattura caricata">
            <div className="support-uploaded-pdf-aside-head">
              <strong className="support-uploaded-pdf-aside-title">Fattura caricata</strong>
              <div className="support-uploaded-pdf-aside-actions">
                <a
                  className="btn btn-secondary btn-sm"
                  href={uploadedInvoicePreview.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Apri PDF
                </a>
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  onClick={() => setUploadedInvoicePreview(null)}
                >
                  Chiudi anteprima
                </button>
              </div>
            </div>
            <p className="support-uploaded-pdf-filename" title={uploadedInvoicePreview.title}>
              {uploadedInvoicePreview.title}
            </p>
            <iframe
              key={uploadedInvoicePreview.id}
              title={`Anteprima PDF: ${uploadedInvoicePreview.title}`}
              src={uploadedInvoicePreview.url}
              className="support-uploaded-pdf-frame"
            />
          </aside>
        ) : null}
        </div>

        {actLoading ? (
          <p className="loading">Caricamento attività…</p>
        ) : activities.length === 0 ? (
          <p className="empty-state">Nessuna voce nel periodo. Aggiungi un intervento pianificato o un lavoro completato.</p>
        ) : (
          <div className="table-wrap">
            <table className="app-table app-table--compact">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Tecnico</th>
                  <th>Tipo</th>
                  <th>Orario</th>
                  <th>Ore</th>
                  <th>Luogo</th>
                  <th>Note</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {activities.map((a) => (
                  <tr key={a.id}>
                    <td>{new Date(a.activity_date + 'T12:00:00').toLocaleDateString('it-IT')}</td>
                    <td>{a.technician_name || '—'}</td>
                    <td>
                      <span className={a.kind === 'completed' ? 'support-badge support-badge--done' : 'support-badge support-badge--plan'}>
                        {a.kind === 'completed' ? 'Completato' : 'Pianificato'}
                      </span>
                    </td>
                    <td>{[a.time_start || '--:--', a.time_end || '--:--'].join(' - ')}</td>
                    <td>{durationHours(a.time_start, a.time_end).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</td>
                    <td>{a.location || '—'}</td>
                    <td style={{ maxWidth: 220 }}>{a.notes || '—'}</td>
                    <td className="text-end">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEditActivity(a)}>
                        Modifica
                      </button>{' '}
                      <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => removeActivity(a.id)}>
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

      {techModal != null && (
        <div className="staff-report-modal-backdrop" role="presentation" onClick={() => setTechModal(null)}>
          <div className="card staff-report-modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h3 className="page-subheader">{techModal === 'new' ? 'Nuovo tecnico' : 'Modifica tecnico'}</h3>
            <div className="form-group">
              <label>Nome e cognome</label>
              <input
                className="form-control"
                value={techForm.full_name}
                onChange={(e) => setTechForm((s) => ({ ...s, full_name: e.target.value }))}
                maxLength={255}
              />
            </div>
            <div className="form-group">
              <label>Telefono (anche senza prefisso)</label>
              <input
                className="form-control"
                value={techForm.phone}
                onChange={(e) => setTechForm((s) => ({ ...s, phone: e.target.value }))}
                inputMode="tel"
              />
              <div style={{ marginTop: '0.35rem', fontSize: '0.78rem', color: phoneLooksShort ? 'var(--danger)' : 'var(--text-muted)' }}>
                {phoneLooksShort
                  ? 'Numero breve: per WhatsApp inserisci almeno 9 cifre.'
                  : 'Consigliato: numero valido (10 cifre IT) per aprire WhatsApp dal pulsante tecnico.'}
              </div>
            </div>
            <div className="form-group">
              <label>Mansione / specialità</label>
              <input
                className="form-control"
                value={techForm.specialty}
                onChange={(e) => setTechForm((s) => ({ ...s, specialty: e.target.value }))}
                placeholder="es. Idraulico, Frigorista…"
              />
            </div>
            <div className="btn-group">
              <button type="button" className="btn btn-primary" onClick={saveTech}>
                Salva
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setTechModal(null)}>
                Annulla
              </button>
            </div>
          </div>
        </div>
      )}

      {actModal != null && (
        <div className="staff-report-modal-backdrop" role="presentation" onClick={() => setActModal(null)}>
          <div className="card staff-report-modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <h3 className="page-subheader">{actModal === 'new' ? 'Nuova voce' : 'Modifica voce'}</h3>
            <div className="form-group">
              <label>Tecnico</label>
              <select
                className="form-control"
                value={actForm.technician_id}
                onChange={(e) => setActForm((s) => ({ ...s, technician_id: e.target.value }))}
              >
                <option value="">—</option>
                {technicians.map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {t.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Data</label>
              <input
                type="date"
                className="form-control"
                value={actForm.activity_date}
                onChange={(e) => setActForm((s) => ({ ...s, activity_date: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label>Tipo</label>
              <select
                className="form-control"
                value={actForm.kind}
                onChange={(e) => setActForm((s) => ({ ...s, kind: e.target.value }))}
              >
                <option value="planned">Pianificato</option>
                <option value="completed">Completato (lavoro svolto)</option>
              </select>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Ora inizio</label>
                <input
                  type="time"
                  className="form-control"
                  value={actForm.time_start}
                  onChange={(e) => setActForm((s) => ({ ...s, time_start: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label>Ora fine</label>
                <input
                  type="time"
                  className="form-control"
                  value={actForm.time_end}
                  onChange={(e) => setActForm((s) => ({ ...s, time_end: e.target.value }))}
                />
              </div>
            </div>
            <div className="form-group">
              <label>Luogo / dove</label>
              <input
                className="form-control"
                value={actForm.location}
                onChange={(e) => setActForm((s) => ({ ...s, location: e.target.value }))}
                placeholder="Reparto, piano, indirizzo…"
              />
            </div>
            <div className="form-group">
              <label>Note</label>
              <textarea
                className="form-control"
                rows={3}
                value={actForm.notes}
                onChange={(e) => setActForm((s) => ({ ...s, notes: e.target.value }))}
              />
            </div>
            <div className="btn-group">
              <button type="button" className="btn btn-primary" onClick={saveActivity}>
                Salva
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setActModal(null)}>
                Annulla
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
