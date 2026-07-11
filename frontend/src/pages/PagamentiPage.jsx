import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import seedWorkbook from '../data/fornitoriRisacca2026.json'
import {
  fetchSupplierPaymentsWorkbook,
  saveSupplierPaymentsWorkbook,
} from '../services/supplierPaymentsService.js'
import {
  MONTHLY_HEADERS,
  addMonthlyInvoiceRow,
  addSubtotalRow,
  addWorkbookSheet,
  bodyRowOffset,
  canDeleteWorkbookSheet,
  classifyRow,
  formatCellDisplay,
  formatUpdatedAt,
  isCellEditable,
  isMonthlySheet,
  isNumericColumn,
  normalizeSheetName,
  parseCellInput,
  recalculateWorkbook,
  removeWorkbookSheet,
  sheetColumnCount,
  sheetHeaders,
  suggestNewSheetName,
} from '../utils/pagamentiWorkbook.js'
import { downloadWorkbookAsExcel, parseExcelFileToWorkbook } from '../utils/pagamentiExcel.js'

function workbookFromApi(data) {
  return {
    title: data?.title || seedWorkbook.title,
    sheets: Array.isArray(data?.sheets) ? data.sheets : seedWorkbook.sheets,
  }
}

export default function PagamentiPage() {
  const [workbook, setWorkbook] = useState(() => recalculateWorkbook(seedWorkbook))
  const [activeSheet, setActiveSheet] = useState(seedWorkbook.sheets[0]?.name || 'GENNAIO')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [updatedAt, setUpdatedAt] = useState('')
  const [importing, setImporting] = useState(false)
  const [newSheetOpen, setNewSheetOpen] = useState(false)
  const [newSheetName, setNewSheetName] = useState('')
  const uploadInputRef = useRef(null)

  const refreshWorkbook = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchSupplierPaymentsWorkbook()
      const next = recalculateWorkbook(workbookFromApi(data))
      setWorkbook(next)
      setUpdatedAt(data?.updated_at || '')
      setDirty(false)
      if (data?.seeded) {
        setSuccess('Registro inizializzato dal file Excel di partenza')
      }
    } catch {
      setWorkbook(recalculateWorkbook(seedWorkbook))
      setError('Impossibile caricare dal server: mostro i dati locali di partenza')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshWorkbook()
  }, [refreshWorkbook])

  const currentSheet = useMemo(
    () => workbook.sheets.find((sheet) => sheet.name === activeSheet) || workbook.sheets[0],
    [workbook.sheets, activeSheet],
  )

  const columnCount = currentSheet ? sheetColumnCount(currentSheet) : 12
  const headers = currentSheet ? sheetHeaders(currentSheet) : MONTHLY_HEADERS
  const rowOffset = currentSheet ? bodyRowOffset(currentSheet.name) : 1
  const canDeleteActiveSheet = currentSheet ? canDeleteWorkbookSheet(currentSheet.name) : false

  const bodyRows = useMemo(() => {
    if (!currentSheet) return []
    if (currentSheet.name === 'TOTALI') return currentSheet.rows.slice(1)
    if (currentSheet.name === 'DELEGHE F24' || currentSheet.name === 'VERSAMENTO CONTANTI') {
      return currentSheet.rows.slice(4)
    }
    return currentSheet.rows.slice(1)
  }, [currentSheet])

  function applyWorkbook(nextWorkbook, message) {
    setWorkbook(recalculateWorkbook(nextWorkbook))
    setDirty(true)
    setSuccess('')
    if (message) setSuccess(message)
  }

  function updateCell(bodyRowIndex, colIndex, rawValue) {
    if (!currentSheet) return
    const sheetRowIndex = bodyRowIndex + rowOffset
    const parsed = parseCellInput(rawValue, colIndex, currentSheet.name)
    const sheets = workbook.sheets.map((sheet) => {
      if (sheet.name !== currentSheet.name) return sheet
      const rows = sheet.rows.map((row) => [...(row || [])])
      if (!rows[sheetRowIndex]) rows[sheetRowIndex] = []
      while (rows[sheetRowIndex].length < columnCount) rows[sheetRowIndex].push(null)
      rows[sheetRowIndex][colIndex] = parsed
      return { ...sheet, rows }
    })
    applyWorkbook({ ...workbook, sheets })
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const payload = recalculateWorkbook(workbook)
      const saved = await saveSupplierPaymentsWorkbook({
        title: payload.title,
        sheets: payload.sheets,
      })
      setWorkbook(recalculateWorkbook(workbookFromApi(saved)))
      setUpdatedAt(saved?.updated_at || '')
      setDirty(false)
      setSuccess('Registro pagamenti salvato sul database')
    } catch (err) {
      setError(err?.message || 'Salvataggio non riuscito')
    } finally {
      setSaving(false)
    }
  }

  function handleAddInvoiceRow() {
    if (!isMonthlySheet(activeSheet)) return
    applyWorkbook(addMonthlyInvoiceRow(workbook, activeSheet))
  }

  function handleAddSubtotalRow() {
    if (!isMonthlySheet(activeSheet)) return
    applyWorkbook(addSubtotalRow(workbook, activeSheet))
  }

  function handleDownloadExcel() {
    setError('')
    try {
      downloadWorkbookAsExcel(recalculateWorkbook(workbook))
      setSuccess('File Excel scaricato')
    } catch (err) {
      setError(err?.message || 'Download Excel non riuscito')
    }
  }

  function handleUploadClick() {
    uploadInputRef.current?.click()
  }

  async function handleUploadExcel(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (dirty) {
      const ok = window.confirm(
        'Caricando un nuovo file Excel sostituirai i dati attuali non ancora salvati. Continuare?',
      )
      if (!ok) return
    }
    setImporting(true)
    setError('')
    setSuccess('')
    try {
      const imported = await parseExcelFileToWorkbook(file)
      const next = recalculateWorkbook(imported)
      setWorkbook(next)
      setActiveSheet(next.sheets[0]?.name || 'GENNAIO')
      setDirty(true)
      setSuccess(`File "${file.name}" caricato. Clicca Salva per registrarlo sul database.`)
    } catch (err) {
      setError(err?.message || 'Caricamento Excel non riuscito')
    } finally {
      setImporting(false)
    }
  }

  function openNewSheetModal() {
    setError('')
    setNewSheetName(suggestNewSheetName(workbook.sheets))
    setNewSheetOpen(true)
  }

  function closeNewSheetModal() {
    setNewSheetOpen(false)
    setNewSheetName('')
  }

  function confirmNewSheet() {
    setError('')
    try {
      const createdName = normalizeSheetName(newSheetName)
      const next = addWorkbookSheet(workbook, newSheetName)
      setWorkbook(next)
      setActiveSheet(createdName)
      setDirty(true)
      setSuccess(`Foglio "${createdName}" aggiunto. Clicca Salva per registrarlo.`)
      closeNewSheetModal()
    } catch (err) {
      setError(err?.message || 'Impossibile creare il foglio')
    }
  }

  function handleDeleteSheet(sheetName) {
    const name = sheetName || activeSheet
    if (!canDeleteWorkbookSheet(name)) return
    if (!window.confirm(`Eliminare il foglio "${name}"? L'operazione si applica al registro corrente.`)) return
    setError('')
    try {
      const next = removeWorkbookSheet(workbook, name)
      const deletedIndex = workbook.sheets.findIndex((sheet) => sheet.name === name)
      const fallback =
        next.sheets[Math.max(0, deletedIndex - 1)]?.name ||
        next.sheets[0]?.name ||
        'GENNAIO'
      setWorkbook(next)
      setActiveSheet(fallback)
      setDirty(true)
      setSuccess(`Foglio "${name}" eliminato. Clicca Salva per aggiornare il database.`)
    } catch (err) {
      setError(err?.message || 'Eliminazione foglio non riuscita')
    }
  }

  return (
    <div className="pagamenti-page">
      <section className="staff-page-hero">
        <h1 className="page-header staff-page-title">Pagamenti fornitori</h1>
        <p className="staff-page-lead">
          Registro pagamenti Risacca 2026 — modificabile e salvato sul database. Puoi anche caricare o scaricare file Excel
          per aggiungere altri registri.
        </p>
      </section>

      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <section className="card pagamenti-workbook-card">
        <div className="pagamenti-workbook-toolbar">
          <div className="pagamenti-workbook-toolbar-left">
            <span className="pagamenti-workbook-title">{workbook.title}</span>
            <span className="pagamenti-workbook-sheet-label">Foglio: {currentSheet?.name}</span>
            {updatedAt ? (
              <span className="pagamenti-workbook-updated">Ultimo salvataggio: {formatUpdatedAt(updatedAt)}</span>
            ) : null}
            {dirty ? <span className="pagamenti-workbook-dirty">Modifiche non salvate</span> : null}
          </div>
          <div className="pagamenti-workbook-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={loading || importing}
              onClick={openNewSheetModal}
            >
              + Nuovo foglio
            </button>
            {canDeleteActiveSheet ? (
              <button
                type="button"
                className="btn btn-outline-danger btn-sm"
                disabled={loading || importing}
                onClick={() => handleDeleteSheet(activeSheet)}
              >
                Elimina foglio
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={loading || importing}
              onClick={handleUploadClick}
            >
              {importing ? 'Caricamento…' : 'Upload Excel'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={loading || importing}
              onClick={handleDownloadExcel}
            >
              Download Excel
            </button>
            <input
              ref={uploadInputRef}
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="pagamenti-upload-input"
              onChange={(e) => void handleUploadExcel(e)}
            />
            {isMonthlySheet(activeSheet) ? (
              <>
                <button type="button" className="btn btn-secondary btn-sm" onClick={handleAddInvoiceRow}>
                  + Riga fattura
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={handleAddSubtotalRow}>
                  + Totale fornitore
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={saving || loading || !dirty}
              onClick={() => void handleSave()}
            >
              {saving ? 'Salvataggio…' : 'Salva'}
            </button>
          </div>
        </div>

        {loading ? (
          <p className="loading pagamenti-loading">Caricamento registro pagamenti…</p>
        ) : (
          <div className="pagamenti-grid-wrap excel-wrap">
            <table className="app-table excel-table pagamenti-grid">
              <thead>
                <tr>
                  {Array.from({ length: columnCount }, (_, colIndex) => (
                    <th key={`h-${colIndex}`}>{formatCellDisplay(headers[colIndex])}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bodyRows.map((row, rowIndex) => {
                  const kind = classifyRow(row, rowIndex + rowOffset, currentSheet?.name)
                  if (kind === 'empty') {
                    return (
                      <tr key={`r-${rowIndex}`} className="pagamenti-row-empty">
                        {Array.from({ length: columnCount }, (_, colIndex) => {
                          const editable = isCellEditable('empty', colIndex, currentSheet?.name)
                          return (
                            <td key={`c-${colIndex}`}>
                              {editable ? (
                                <input
                                  className="excel-cell"
                                  value=""
                                  placeholder=" "
                                  onChange={(e) => updateCell(rowIndex, colIndex, e.target.value)}
                                />
                              ) : (
                                '\u00a0'
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  }
                  return (
                    <tr key={`r-${rowIndex}`} className={`pagamenti-row-${kind}`}>
                      {Array.from({ length: columnCount }, (_, colIndex) => {
                        const value = row[colIndex]
                        const display = formatCellDisplay(value)
                        const numeric = isNumericColumn(colIndex, currentSheet?.name)
                        const editable = isCellEditable(kind, colIndex, currentSheet?.name)
                        const emphasis = kind === 'subtotal' || kind === 'totals'
                        return (
                          <td key={`c-${colIndex}`}>
                            <input
                              className={`excel-cell${numeric ? ' excel-cell-num' : ''}${emphasis ? ' pagamenti-cell-emphasis' : ''}${editable ? '' : ' pagamenti-cell-readonly'}`}
                              value={display}
                              readOnly={!editable}
                              onChange={(e) => updateCell(rowIndex, colIndex, e.target.value)}
                              aria-label={display || `Riga ${rowIndex + 1} colonna ${colIndex + 1}`}
                            />
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="pagamenti-sheet-tabs" role="tablist" aria-label="Fogli Excel">
          {workbook.sheets.map((sheet) => {
            const deletable = canDeleteWorkbookSheet(sheet.name)
            return (
              <div
                key={sheet.name}
                className={`pagamenti-sheet-tab-wrap${sheet.name === activeSheet ? ' is-active' : ''}`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={sheet.name === activeSheet}
                  className={`pagamenti-sheet-tab${sheet.name === activeSheet ? ' is-active' : ''}`}
                  onClick={() => setActiveSheet(sheet.name)}
                >
                  {sheet.name}
                </button>
                {deletable ? (
                  <button
                    type="button"
                    className="pagamenti-sheet-tab-delete"
                    title={`Elimina foglio ${sheet.name}`}
                    aria-label={`Elimina foglio ${sheet.name}`}
                    onClick={() => handleDeleteSheet(sheet.name)}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            )
          })}
          <button
            type="button"
            className="pagamenti-sheet-tab pagamenti-sheet-tab-add"
            title="Aggiungi nuovo foglio"
            aria-label="Aggiungi nuovo foglio"
            onClick={openNewSheetModal}
          >
            +
          </button>
        </div>
      </section>

      {newSheetOpen && (
        <div className="staff-report-modal-backdrop" role="presentation" onClick={closeNewSheetModal}>
          <div
            className="card staff-report-modal pagamenti-new-sheet-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pagamenti-new-sheet-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="pagamenti-new-sheet-title" className="page-subheader" style={{ marginTop: 0 }}>
              Nuovo foglio
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: '-0.25rem' }}>
              Come in Excel: aggiungi un foglio nel registro corrente con le colonne fatture/pagamenti.
            </p>
            <div className="form-group">
              <label htmlFor="pagamenti-new-sheet-name">Nome foglio</label>
              <input
                id="pagamenti-new-sheet-name"
                className="form-control"
                value={newSheetName}
                onChange={(e) => setNewSheetName(e.target.value)}
                placeholder="es. LUGLIO, AGOSTO, FOGLIO1"
                maxLength={31}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmNewSheet()
                }}
              />
            </div>
            <div className="btn-group" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" onClick={confirmNewSheet}>
                Crea foglio
              </button>
              <button type="button" className="btn btn-secondary" onClick={closeNewSheetModal}>
                Annulla
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
