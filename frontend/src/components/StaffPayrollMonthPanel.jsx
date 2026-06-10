import React, { useCallback, useEffect, useState } from 'react'
import {
  createStaffPayrollMonth,
  deleteStaffPayrollMonth,
  fetchStaffPayrollMonth,
  fetchStaffPayrollMonths,
  updateStaffPayrollMonth,
} from '../services/staffService'
import {
  generateMonthlyPayrollPdf,
  payrollMonthPdfFilename,
} from '../utils/staffPayrollMonthPdf'
import WeeklyStaffReportModal from './WeeklyStaffReportModal.jsx'

function formatEurAmount(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n)
}

function monthLabelIt(yearMonth) {
  const [y, m] = String(yearMonth || '').split('-').map(Number)
  if (!y || !m) return yearMonth || ''
  return new Date(y, m - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })
}

/**
 * Mese stipendi compatto: salva / ricarica archivio / PDF senza tabella lunga.
 */
export default function StaffPayrollMonthPanel({
  payrollMonthYm,
  onPayrollMonthYmChange,
  periodFromStr,
  periodToStr,
  buildLinesForSave,
  applySnapshot,
  onNotifyError,
  onNotifySuccess,
  onArchiveChange,
  disabled = false,
}) {
  const [savedMonths, setSavedMonths] = useState([])
  const [loading, setLoading] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [backup, setBackup] = useState(null)
  const [archivePickId, setArchivePickId] = useState('')
  const [pdfBlob, setPdfBlob] = useState(null)
  const [pdfFilename, setPdfFilename] = useState('stipendi.pdf')
  const [pdfOpen, setPdfOpen] = useState(false)
  const [pdfPeriodLabel, setPdfPeriodLabel] = useState('')

  const refreshArchive = useCallback(async () => {
    try {
      const rows = await fetchStaffPayrollMonths()
      const list = Array.isArray(rows) ? rows : []
      setSavedMonths(list)
      onArchiveChange?.(list)
      return list
    } catch {
      setSavedMonths([])
      onArchiveChange?.([])
      return []
    }
  }, [onArchiveChange])

  useEffect(() => {
    refreshArchive()
  }, [refreshArchive])

  const currentSaved = savedMonths.find((m) => m.year_month === payrollMonthYm)
  const pickedArchive = archivePickId
    ? savedMonths.find((m) => String(m.id) === String(archivePickId))
    : null

  useEffect(() => {
    if (currentSaved) {
      setArchivePickId(String(currentSaved.id))
    }
  }, [currentSaved?.id])

  function openPdfForRecord(rec) {
    if (!rec) return
    const blob = generateMonthlyPayrollPdf({
      yearMonth: rec.year_month,
      periodFrom: rec.period_from,
      periodTo: rec.period_to,
      lines: rec.lines || [],
      totalAmount: rec.total_amount,
      notes: rec.notes,
    })
    setPdfBlob(blob)
    setPdfFilename(payrollMonthPdfFilename(rec.year_month))
    setPdfPeriodLabel(monthLabelIt(rec.year_month))
    setPdfOpen(true)
  }

  async function persistToArchive({ asReload = false } = {}) {
    const lines = buildLinesForSave()
    if (!lines.length) {
      onNotifyError?.('Calcola almeno un importo (Calcola o Calcola tutti) prima di salvare in archivio.')
      return false
    }
    setLoading(true)
    try {
      const payload = {
        year_month: payrollMonthYm,
        period_from: periodFromStr,
        period_to: periodToStr,
        lines,
      }
      const existing = savedMonths.find((m) => m.year_month === payrollMonthYm)
      if (existing) {
        await updateStaffPayrollMonth(existing.id, {
          lines,
          period_from: periodFromStr,
          period_to: periodToStr,
        })
        onNotifySuccess?.(
          asReload
            ? `Mese ${monthLabelIt(payrollMonthYm)} ricaricato in archivio.`
            : `Archivio ${monthLabelIt(payrollMonthYm)} aggiornato.`,
        )
      } else {
        await createStaffPayrollMonth(payload)
        onNotifySuccess?.(
          asReload
            ? `Mese ${monthLabelIt(payrollMonthYm)} ricaricato in archivio.`
            : `Mese ${monthLabelIt(payrollMonthYm)} salvato in archivio.`,
        )
      }
      setEditingId(null)
      setBackup(null)
      const list = await refreshArchive()
      const hit = list.find((m) => m.year_month === payrollMonthYm)
      if (hit) setArchivePickId(String(hit.id))
      return true
    } catch (err) {
      const msg = String(err?.message || '')
      onNotifyError?.(msg.replace(/^400:\s*/, '') || 'Salvataggio in archivio non riuscito')
      return false
    } finally {
      setLoading(false)
    }
  }

  async function handleReloadIntoArchive() {
    await persistToArchive({ asReload: true })
  }

  function handleStartEdit() {
    if (currentSaved) {
      applySnapshot(currentSaved)
      setEditingId(currentSaved.id)
      setBackup(currentSaved)
    } else {
      setEditingId(-1)
      setBackup(null)
    }
  }

  function handleCancelEdit() {
    if (backup) {
      applySnapshot(backup)
    }
    setEditingId(null)
    setBackup(null)
    onNotifySuccess?.('Modifiche annullate.')
  }

  async function loadArchiveIntoTable(rec) {
    if (!rec?.id) return
    setLoading(true)
    try {
      const full = await fetchStaffPayrollMonth(rec.id)
      if (!full?.lines?.length) {
        onNotifyError?.('Archivio senza righe salvate: usa Salva dopo Calcola.')
        return
      }
      onPayrollMonthYmChange?.(full.year_month)
      const matched = applySnapshot(full)
      setEditingId(full.id)
      setBackup(full)
      setArchivePickId(String(full.id))
      if (matched === 0) {
        onNotifyError?.(
          'Nessuna riga associata ai dipendenti attuali (nomi cambiati o elenco sostituito). Controlla i nomi in anagrafica.',
        )
        return
      }
      if (matched < full.lines.length) {
        onNotifySuccess?.(
          `${monthLabelIt(full.year_month)} caricato (${matched} di ${full.lines.length} righe: alcuni nomi non sono più in elenco).`,
        )
        return
      }
      onNotifySuccess?.(`${monthLabelIt(full.year_month)} caricato nella tabella.`)
    } catch (err) {
      onNotifyError?.(String(err?.message || 'Caricamento archivio in tabella non riuscito'))
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteArchive(rec) {
    if (!rec) return
    if (
      !window.confirm(
        `Rimuovere ${monthLabelIt(rec.year_month)} dall'archivio? I dati nella tabella restano: potrai usare «Ricarica in archivio» per salvarli di nuovo.`,
      )
    ) {
      return
    }
    setLoading(true)
    try {
      await deleteStaffPayrollMonth(rec.id)
      if (editingId === rec.id) {
        setEditingId(null)
        setBackup(null)
      }
      if (String(archivePickId) === String(rec.id)) {
        setArchivePickId('')
      }
      await refreshArchive()
      onNotifySuccess?.('Rimosso dall\'archivio. Usa «Ricarica in archivio» per salvare di nuovo il mese in corso.')
    } catch {
      onNotifyError?.('Eliminazione non riuscita')
    } finally {
      setLoading(false)
    }
  }

  function shiftMonth(delta) {
    const [y, m] = payrollMonthYm.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    onPayrollMonthYmChange?.(ym)
  }

  const archivePdfTarget = currentSaved || pickedArchive

  return (
    <>
      <div
        style={{
          marginBottom: '0.75rem',
          padding: '0.65rem 0.75rem',
          background: '#f8fafc',
          borderRadius: 8,
          border: '1px solid var(--border, #e5e7eb)',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.55rem' }}>
          <strong style={{ color: '#0d9488' }}>Mese stipendi</strong>
          <button type="button" className="btn btn-secondary btn-sm" disabled={disabled || loading} onClick={() => shiftMonth(-1)}>
            «
          </button>
          <input
            type="month"
            className="form-control"
            style={{ width: 160 }}
            value={payrollMonthYm}
            disabled={disabled || loading}
            onChange={(e) => {
              const v = e.target.value
              if (v) onPayrollMonthYmChange?.(v)
            }}
          />
          <button type="button" className="btn btn-secondary btn-sm" disabled={disabled || loading} onClick={() => shiftMonth(1)}>
            »
          </button>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {periodFromStr} → {periodToStr}
            {currentSaved ? (
              <span style={{ marginLeft: '0.35rem', color: '#059669', fontWeight: 600 }}>· in archivio</span>
            ) : (
              <span style={{ marginLeft: '0.35rem', color: '#b45309' }}>· non in archivio</span>
            )}
            {editingId ? <span style={{ marginLeft: '0.35rem' }}>· modifica</span> : null}
          </span>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center', marginBottom: '0.55rem' }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={disabled || loading}
            onClick={() => persistToArchive()}
            title="Salva il mese selezionato con i dati attuali della tabella"
          >
            {loading ? '…' : 'Salva'}
          </button>
          <button
            type="button"
            className="btn btn-outline-primary btn-sm"
            disabled={disabled || loading}
            onClick={handleReloadIntoArchive}
            title="Salva di nuovo in archivio (anche se avevi eliminato il mese dall'elenco)"
          >
            Ricarica in archivio
          </button>
          {!editingId && currentSaved && (
            <button type="button" className="btn btn-outline-secondary btn-sm" disabled={disabled || loading} onClick={handleStartEdit}>
              Modifica
            </button>
          )}
          {editingId ? (
            <button type="button" className="btn btn-outline-secondary btn-sm" disabled={disabled || loading} onClick={handleCancelEdit}>
              Annulla
            </button>
          ) : null}
          {archivePdfTarget && (
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              disabled={disabled || loading}
              onClick={() => openPdfForRecord(archivePdfTarget)}
            >
              PDF
            </button>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.5rem',
            alignItems: 'center',
            paddingTop: '0.5rem',
            borderTop: '1px solid var(--border, #e5e7eb)',
          }}
        >
          <label style={{ fontSize: '0.85rem', fontWeight: 600, margin: 0 }} htmlFor="staff-archive-month-select">
            Archivio
          </label>
          <select
            id="staff-archive-month-select"
            className="form-control"
            style={{ minWidth: 200, maxWidth: '100%', flex: '1 1 180px' }}
            value={archivePickId}
            disabled={disabled || loading || savedMonths.length === 0}
            onChange={(e) => {
              const id = e.target.value
              setArchivePickId(id)
              const rec = savedMonths.find((m) => String(m.id) === id)
              if (rec) void loadArchiveIntoTable(rec)
            }}
          >
            <option value="">
              {savedMonths.length === 0 ? 'Nessun mese archiviato' : `Mesi archiviati (${savedMonths.length})…`}
            </option>
            {savedMonths.map((rec) => (
              <option key={rec.id} value={String(rec.id)}>
                {monthLabelIt(rec.year_month)} — {formatEurAmount(rec.total_amount)}
              </option>
            ))}
          </select>
          {pickedArchive && (
            <>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                disabled={disabled || loading}
                onClick={() => void loadArchiveIntoTable(pickedArchive)}
              >
                Carica in tabella
              </button>
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                disabled={disabled || loading}
                onClick={() => openPdfForRecord(pickedArchive)}
              >
                PDF
              </button>
              <button
                type="button"
                className="btn btn-outline-danger btn-sm"
                disabled={disabled || loading}
                onClick={() => handleDeleteArchive(pickedArchive)}
              >
                Rimuovi da archivio
              </button>
            </>
          )}
        </div>
      </div>

      <WeeklyStaffReportModal
        open={pdfOpen}
        onClose={() => setPdfOpen(false)}
        pdfBlob={pdfBlob}
        filename={pdfFilename}
        whatsappText=""
        periodLabel={pdfPeriodLabel}
        modalTitle="Stipendi mensili (PDF)"
        onNotify={onNotifySuccess}
      />
    </>
  )
}
