import React, { useCallback, useEffect, useMemo, useState } from 'react'
import WorkbookGrid from '../components/WorkbookGrid.jsx'
import { AnalisiLoadingBar } from '../components/AnalisiShared.jsx'
import {
  createStaffStipendiMonth,
  deleteStaffStipendiMonth,
  fetchStaffMembers,
  fetchStaffStipendiMonths,
  updateStaffStipendiMonth,
} from '../services/staffService.js'
import { downloadWorkbookAsExcel } from '../utils/pagamentiExcel.js'

const MONTH_LABELS = [
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

const STIPENDI_COLUMNS = [
  { id: 'name', label: 'Nominativo', width: 22, fluid: true },
  { id: 'busta', label: 'Busta', width: 11, fluid: true, numeric: true },
  { id: 'fuori', label: 'Fuori', width: 11, fluid: true, numeric: true },
  { id: 'tfr_attuale', label: 'TFR attuale', width: 12, fluid: true, numeric: true },
  { id: 'acconto_tfr', label: 'Acconto TFR (−)', width: 13, fluid: true, numeric: true },
  { id: 'nuovo_tfr', label: 'Nuovo TFR', width: 12, fluid: true, numeric: true },
  { id: 'tfr_anticipato', label: 'Anticipato/sottratto', width: 14, fluid: true, numeric: true },
  { id: 'totale', label: 'Totale busta', width: 12, fluid: true, numeric: true },
]

function eur(n) {
  const v = Number(n) || 0
  return v.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
}

function toYmd(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function ymLabel(ym) {
  const [y, m] = String(ym || '').split('-')
  const mi = Number(m) - 1
  if (!y || Number.isNaN(mi) || mi < 0 || mi > 11) return ym || '—'
  const shortY = String(y).slice(-2)
  return `${MONTH_LABELS[mi]}${shortY}`
}

function currentYearMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function periodForYm(ym) {
  const [y, m] = String(ym).split('-').map(Number)
  const from = new Date(y, m - 1, 1)
  const to = new Date(y, m, 0)
  return { period_from: toYmd(from), period_to: toYmd(to) }
}

function emptyLine(partial = {}) {
  const tfr_attuale = Number(partial.tfr_attuale) || 0
  const acconto_tfr = Number(partial.acconto_tfr) || 0
  const nuovo_tfr =
    partial.nuovo_tfr != null && partial.nuovo_tfr !== ''
      ? Number(partial.nuovo_tfr) || 0
      : Math.round((tfr_attuale - acconto_tfr) * 100) / 100
  return {
    staff_member_id: partial.staff_member_id ?? null,
    name: partial.name || '',
    busta: Number(partial.busta) || 0,
    acconto_tfr,
    fuori: Number(partial.fuori) || 0,
    tfr_attuale,
    tfr_anticipato: Number(partial.tfr_anticipato) || 0,
    nuovo_tfr,
  }
}

/** Totale busta paga = Busta + Fuori − Acconto TFR */
function lineTotale(row) {
  return (Number(row.busta) || 0) + (Number(row.fuori) || 0) - (Number(row.acconto_tfr) || 0)
}

/** Saldo TFR aggiornato = TFR attuale − Acconto */
function lineNuovoTfr(row) {
  return Math.round(((Number(row.tfr_attuale) || 0) - (Number(row.acconto_tfr) || 0)) * 100) / 100
}

function parseMoneyInput(raw) {
  const s = String(raw ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(/€/g, '')
  if (!s) return 0
  let n
  if (s.includes(',')) {
    n = Number(s.replace(/\./g, '').replace(',', '.'))
  } else {
    n = Number(s)
  }
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0
}

function stipendiCellValue(row, col) {
  if (col.id === 'name') return row?.name || '—'
  if (col.id === 'busta') return eur(row?.busta)
  if (col.id === 'acconto_tfr') return eur(row?.acconto_tfr)
  if (col.id === 'fuori') return eur(row?.fuori)
  if (col.id === 'tfr_attuale') return eur(row?.tfr_attuale)
  if (col.id === 'nuovo_tfr') return eur(lineNuovoTfr(row))
  if (col.id === 'tfr_anticipato') return eur(row?.tfr_anticipato)
  if (col.id === 'totale') return eur(lineTotale(row))
  return ''
}

function moneyDisplay(n) {
  const v = Number(n) || 0
  return v ? String(v).replace('.', ',') : ''
}

export default function StipendiPage() {
  const [yearMonth, setYearMonth] = useState(currentYearMonth)
  const [archives, setArchives] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [lines, setLines] = useState([])
  const [notes, setNotes] = useState('')
  const [draft, setDraft] = useState(() => emptyLine())
  const [editIndex, setEditIndex] = useState(null)
  const [selectedIndex, setSelectedIndex] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const totals = useMemo(() => {
    const busta = lines.reduce((a, r) => a + (Number(r.busta) || 0), 0)
    const tfr = lines.reduce((a, r) => a + (Number(r.acconto_tfr) || 0), 0)
    const fuori = lines.reduce((a, r) => a + (Number(r.fuori) || 0), 0)
    const tfrAttuale = lines.reduce((a, r) => a + (Number(r.tfr_attuale) || 0), 0)
    const tfrAnticipato = lines.reduce((a, r) => a + (Number(r.tfr_anticipato) || 0), 0)
    const nuovoTfr = lines.reduce((a, r) => a + lineNuovoTfr(r), 0)
    return {
      busta,
      tfr,
      fuori,
      tfrAttuale,
      tfrAnticipato,
      nuovoTfr,
      amount: busta + fuori - tfr,
    }
  }, [lines])

  const resetDraft = useCallback(() => {
    setDraft(emptyLine())
    setEditIndex(null)
  }, [])

  const loadArchives = useCallback(async () => {
    const rows = await fetchStaffStipendiMonths()
    setArchives(Array.isArray(rows) ? rows : [])
    return Array.isArray(rows) ? rows : []
  }, [])

  const bootstrapFromMembers = useCallback(async () => {
    const members = await fetchStaffMembers()
    const list = Array.isArray(members) ? members : []
    const next = list
      .filter((m) => m?.is_active !== false)
      .map((m) =>
        emptyLine({
          staff_member_id: m.id,
          name: m.name || [m.first_name, m.last_name].filter(Boolean).join(' '),
        }),
      )
    setLines(next)
    setNotes('')
    setActiveId(null)
    setSelectedIndex(null)
    resetDraft()
  }, [resetDraft])

  const openArchive = useCallback(
    (row) => {
      setActiveId(row.id)
      setYearMonth(row.year_month)
      setLines((row.lines || []).map((l) => emptyLine(l)))
      setNotes(row.notes || '')
      setSelectedIndex(null)
      resetDraft()
      setSuccess(`Aperto archivio ${ymLabel(row.year_month)}`)
    },
    [resetDraft],
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const rows = await loadArchives()
        if (cancelled) return
        const ym = currentYearMonth()
        const hit = rows.find((r) => r.year_month === ym)
        if (hit) {
          openArchive(hit)
        } else {
          setYearMonth(ym)
          await bootstrapFromMembers()
        }
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Errore caricamento stipendi')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [bootstrapFromMembers, loadArchives, openArchive])

  function updateDraft(field, value) {
    setDraft((prev) => {
      if (field === 'name') return { ...prev, name: value }
      const next = { ...prev, [field]: parseMoneyInput(value) }
      if (field === 'acconto_tfr' || field === 'tfr_attuale') {
        next.nuovo_tfr = lineNuovoTfr(next)
        if (field === 'acconto_tfr') {
          // l'acconto inserito è anche quanto anticipato/sottratto in questo mese
          next.tfr_anticipato = next.acconto_tfr
        }
      }
      return next
    })
  }

  function handleNuovaRiga() {
    setSelectedIndex(null)
    resetDraft()
    setSuccess('Nuova riga — compila e premi Aggiungi')
  }

  function handleAggiungi() {
    const cleaned = emptyLine({
      ...draft,
      nuovo_tfr: lineNuovoTfr(draft),
    })
    if (!String(cleaned.name || '').trim()) {
      setError('Inserisci il nominativo prima di aggiungere')
      return
    }
    setError('')
    if (editIndex !== null) {
      setLines((prev) => prev.map((row, i) => (i === editIndex ? cleaned : row)))
      setSuccess(`Riga aggiornata: ${cleaned.name} · Nuovo TFR ${eur(cleaned.nuovo_tfr)}`)
      setSelectedIndex(editIndex)
    } else {
      setLines((prev) => [...prev, cleaned])
      setSuccess(`Riga aggiunta: ${cleaned.name} · Nuovo TFR ${eur(cleaned.nuovo_tfr)}`)
      setSelectedIndex(lines.length)
    }
    resetDraft()
  }

  function handleModifica() {
    const idx = selectedIndex
    if (idx === null || idx < 0 || idx >= lines.length) {
      setError('Seleziona una riga già inserita da modificare')
      return
    }
    setError('')
    setDraft(emptyLine(lines[idx]))
    setEditIndex(idx)
    setSuccess(`Modifica riga: ${lines[idx].name || '—'} — poi premi Aggiorna`)
  }

  function handleEliminaRiga() {
    const idx = editIndex !== null ? editIndex : selectedIndex
    if (idx === null || idx < 0 || idx >= lines.length) {
      setError('Seleziona una riga da eliminare')
      return
    }
    const name = lines[idx]?.name || 'riga'
    setLines((prev) => prev.filter((_, i) => i !== idx))
    setSelectedIndex(null)
    resetDraft()
    setError('')
    setSuccess(`Eliminata: ${name}`)
  }

  async function handleSave() {
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const cleaned = lines
        .map((l) => emptyLine(l))
        .filter((l) => String(l.name || '').trim())
      if (!cleaned.length) {
        setError('Inserisci almeno un nominativo')
        return
      }
      const period = periodForYm(yearMonth)
      const payload = {
        year_month: yearMonth,
        ...period,
        lines: cleaned,
        notes: notes || null,
      }
      let saved
      if (activeId) {
        saved = await updateStaffStipendiMonth(activeId, {
          lines: cleaned,
          notes: notes || null,
          period_from: period.period_from,
          period_to: period.period_to,
        })
      } else {
        const existing = archives.find((a) => a.year_month === yearMonth)
        if (existing) {
          saved = await updateStaffStipendiMonth(existing.id, {
            lines: cleaned,
            notes: notes || null,
            period_from: period.period_from,
            period_to: period.period_to,
          })
        } else {
          saved = await createStaffStipendiMonth(payload)
        }
      }
      setActiveId(saved.id)
      setLines((saved.lines || []).map((l) => emptyLine(l)))
      setSelectedIndex(null)
      resetDraft()
      await loadArchives()
      setSuccess(`Stipendi ${ymLabel(yearMonth)} salvati`)
    } catch (e) {
      setError(e?.message || 'Salvataggio non riuscito')
    } finally {
      setBusy(false)
    }
  }

  async function handleNewMonth() {
    setError('')
    setSuccess('')
    await bootstrapFromMembers()
    setSuccess(`Nuovo foglio ${ymLabel(yearMonth)} — compila e salva`)
  }

  async function handleDelete() {
    if (!activeId) return
    const ok = window.confirm(`Eliminare l'archivio stipendi ${ymLabel(yearMonth)}?`)
    if (!ok) return
    setBusy(true)
    setError('')
    try {
      await deleteStaffStipendiMonth(activeId)
      await loadArchives()
      await bootstrapFromMembers()
      setSuccess('Archivio eliminato')
    } catch (e) {
      setError(e?.message || 'Eliminazione non riuscita')
    } finally {
      setBusy(false)
    }
  }

  function handleExcel() {
    try {
      const header = [
        'Nominativo',
        'Busta',
        'Fuori',
        'TFR attuale',
        'Acconto TFR (−)',
        'Nuovo TFR',
        'Anticipato/sottratto',
        'Totale busta',
      ]
      const body = lines.map((r) => [
        r.name,
        Number(r.busta) || 0,
        Number(r.fuori) || 0,
        Number(r.tfr_attuale) || 0,
        Number(r.acconto_tfr) || 0,
        lineNuovoTfr(r),
        Number(r.tfr_anticipato) || 0,
        lineTotale(r),
      ])
      body.push([
        'TOTALI',
        totals.busta,
        totals.fuori,
        totals.tfrAttuale,
        totals.tfr,
        totals.nuovoTfr,
        totals.tfrAnticipato,
        totals.amount,
      ])
      downloadWorkbookAsExcel({
        title: `Stipendi_${yearMonth}`,
        sheets: [{ name: ymLabel(yearMonth), rows: [header, ...body] }],
      })
      setSuccess('Excel scaricato')
    } catch (e) {
      setError(e?.message || 'Download Excel non riuscito')
    }
  }

  return (
    <div className="pagamenti-page staff-report-page stipendi-page">
      <header className="staff-page-hero">
        <div>
          <p className="staff-kicker">Personale</p>
          <h1>Stipendi</h1>
        </div>
      </header>

      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <section className="card pagamenti-workbook-card stipendi-toolbar-card">
        <div className="stipendi-toolbar">
          <label className="stipendi-month-field">
            <span className="muted">Mese</span>
            <input
              type="month"
              className="form-control"
              value={yearMonth}
              onChange={(e) => setYearMonth(e.target.value)}
            />
            <strong>{ymLabel(yearMonth)}</strong>
          </label>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy || loading} onClick={handleNewMonth}>
            Nuovo da dipendenti
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || loading} onClick={handleSave}>
            {busy ? 'Salvo…' : activeId ? 'Aggiorna mese' : 'Salva mese'}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy || loading} onClick={handleExcel}>
            Scarica Excel
          </button>
          {activeId ? (
            <button type="button" className="btn btn-outline-danger btn-sm" disabled={busy} onClick={handleDelete}>
              Elimina archivio
            </button>
          ) : null}
        </div>
        {archives.length > 0 && (
          <div className="pagamenti-sheet-tabs stipendi-month-tabs">
            {archives.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`pagamenti-sheet-tab${a.id === activeId ? ' is-active' : ''}`}
                onClick={() => openArchive(a)}
              >
                {ymLabel(a.year_month)}
              </button>
            ))}
          </div>
        )}
      </section>

      {loading ? (
        <AnalisiLoadingBar active label="Caricamento stipendi" variant="subtle" />
      ) : (
        <>
          <section className="card pagamenti-workbook-card stipendi-edit-card">
            <h2 className="stipendi-section-title">Compila voci</h2>
            <p className="muted stipendi-edit-hint">
              {editIndex !== null
                ? `Modifica riga ${editIndex + 1} (${draft.name || '—'}). Premi Aggiorna, poi vedi il foglio Excel sotto.`
                : 'Compila e premi Aggiungi: i dati compaiono solo nel foglio Excel. Seleziona una riga lì per Modifica o Elimina.'}
            </p>
            <div className="stipendi-edit-row stipendi-draft-row">
              <input
                className="form-control stipendi-edit-name"
                value={draft.name}
                onChange={(e) => updateDraft('name', e.target.value)}
                placeholder="Nominativo"
              />
              <label className="stipendi-edit-field">
                <span>Busta</span>
                <input
                  className="form-control"
                  inputMode="decimal"
                  value={moneyDisplay(draft.busta)}
                  onChange={(e) => updateDraft('busta', e.target.value)}
                  placeholder="0,00"
                />
              </label>
              <label className="stipendi-edit-field">
                <span>Fuori</span>
                <input
                  className="form-control"
                  inputMode="decimal"
                  value={moneyDisplay(draft.fuori)}
                  onChange={(e) => updateDraft('fuori', e.target.value)}
                  placeholder="0,00"
                />
              </label>
              <label className="stipendi-edit-field">
                <span>TFR attuale</span>
                <input
                  className="form-control"
                  inputMode="decimal"
                  value={moneyDisplay(draft.tfr_attuale)}
                  onChange={(e) => updateDraft('tfr_attuale', e.target.value)}
                  placeholder="0,00"
                />
              </label>
              <label className="stipendi-edit-field">
                <span>Acconto TFR (−)</span>
                <input
                  className="form-control"
                  inputMode="decimal"
                  value={moneyDisplay(draft.acconto_tfr)}
                  onChange={(e) => updateDraft('acconto_tfr', e.target.value)}
                  placeholder="0,00"
                />
              </label>
              <div className="stipendi-edit-field stipendi-nuovo-tfr" title="TFR attuale − Acconto">
                <span>Nuovo TFR</span>
                <strong>{eur(lineNuovoTfr(draft))}</strong>
              </div>
              <label className="stipendi-edit-field">
                <span>Anticipato/sottratto</span>
                <input
                  className="form-control"
                  inputMode="decimal"
                  value={moneyDisplay(draft.tfr_anticipato)}
                  onChange={(e) => updateDraft('tfr_anticipato', e.target.value)}
                  placeholder="0,00"
                />
              </label>
              <div className="stipendi-edit-total" title="Busta + Fuori − Acconto TFR">
                {eur(lineTotale(draft))}
              </div>
            </div>

            <div className="stipendi-edit-footer">
              <div className="stipendi-row-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={handleNuovaRiga}>
                  + riga
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={handleAggiungi}>
                  {editIndex !== null ? 'Aggiorna' : 'Aggiungi'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleModifica}
                  disabled={editIndex === null && selectedIndex === null}
                >
                  Modifica
                </button>
                <button
                  type="button"
                  className="btn btn-outline-danger btn-sm"
                  onClick={handleEliminaRiga}
                  disabled={editIndex === null && selectedIndex === null}
                >
                  Elimina
                </button>
              </div>
              <div className="stipendi-edit-totals">
                <span>Busta {eur(totals.busta)}</span>
                <span>Acconti (−) {eur(totals.tfr)}</span>
                <span>Fuori {eur(totals.fuori)}</span>
                <span>TFR att. {eur(totals.tfrAttuale)}</span>
                <span>Nuovo TFR {eur(totals.nuovoTfr)}</span>
                <span>Anticip. {eur(totals.tfrAnticipato)}</span>
                <strong>Totale busta {eur(totals.amount)}</strong>
              </div>
            </div>

            <label className="stipendi-notes">
              <span className="muted">Note</span>
              <input
                className="form-control"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Note mese (opzionale)"
              />
            </label>
          </section>

          <section className="card pagamenti-workbook-card stipendi-excel-card">
            <WorkbookGrid
              title={`Foglio Excel · ${ymLabel(yearMonth)}`}
              sheetLabel={
                selectedIndex !== null && lines[selectedIndex]
                  ? `${lines.length} nominativi · selezionato: ${lines[selectedIndex].name || '—'}`
                  : `${lines.length} nominativi · clicca una riga per selezionarla`
              }
              columns={STIPENDI_COLUMNS}
              rows={lines}
              cellValue={stipendiCellValue}
              emptyMessage="Nessuna riga. Compila sopra e premi Aggiungi."
              gridClassName="stipendi-excel-grid"
              rowKey={(row, idx) => `${row.staff_member_id || row.name}-${idx}`}
              onRowClick={(_row, idx) => {
                setSelectedIndex(idx)
                setError('')
              }}
              rowClickTitle="Seleziona riga per eliminarla o modificarla"
              getRowClassName={(_row, idx) =>
                [
                  selectedIndex === idx ? 'stipendi-excel-row-selected' : '',
                  editIndex === idx ? 'stipendi-excel-row-editing' : '',
                ]
                  .filter(Boolean)
                  .join(' ')
              }
              toolbarActions={
                <button
                  type="button"
                  className="btn btn-outline-danger btn-sm"
                  disabled={editIndex === null && selectedIndex === null}
                  onClick={handleEliminaRiga}
                >
                  Elimina riga selezionata
                </button>
              }
              totals={{
                busta: totals.busta,
                fuori: totals.fuori,
                tfr_attuale: totals.tfrAttuale,
                acconto_tfr: totals.tfr,
                nuovo_tfr: totals.nuovoTfr,
                tfr_anticipato: totals.tfrAnticipato,
                totale: totals.amount,
              }}
              totalsLabel={(colId, t) => {
                if (colId === 'name') return 'TOTALI'
                if (colId === 'busta') return eur(t?.busta)
                if (colId === 'fuori') return eur(t?.fuori)
                if (colId === 'tfr_attuale') return eur(t?.tfr_attuale)
                if (colId === 'acconto_tfr') return eur(t?.acconto_tfr)
                if (colId === 'nuovo_tfr') return eur(t?.nuovo_tfr)
                if (colId === 'tfr_anticipato') return eur(t?.tfr_anticipato)
                if (colId === 'totale') return eur(t?.totale)
                return ''
              }}
            />
          </section>
        </>
      )}
    </div>
  )
}
