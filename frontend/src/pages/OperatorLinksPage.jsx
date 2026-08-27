import React, { useMemo, useState } from 'react'
import WorkbookGrid from '../components/WorkbookGrid.jsx'
import { buildOperatorLinksCatalog, OPERATOR_LINKS_WORKBOOK_TITLE } from '../utils/operatorLinksCatalog.js'
import { OPERATOR_LINKS_COLUMNS, operatorLinkCellValue } from '../utils/operatorLinksWorkbook.js'

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    try {
      const el = document.createElement('textarea')
      el.value = value
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      return true
    } catch {
      return false
    }
  }
}

export default function OperatorLinksPage() {
  const links = useMemo(() => buildOperatorLinksCatalog(), [])
  const [copiedUrl, setCopiedUrl] = useState('')

  async function handleCopy(url) {
    const ok = await copyText(url)
    if (!ok) return
    setCopiedUrl(url)
    window.setTimeout(() => setCopiedUrl(''), 2500)
  }

  return (
    <div className="pagamenti-page operator-links-page">
      <section className="staff-page-hero">
        <h1 className="page-header staff-page-title">Link operatori</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', margin: 0, maxWidth: 760, lineHeight: 1.5 }}>
          Link PWA per sede: tre postazioni operative con URL e credenziali distinti (
          <strong>/operatore-postazione</strong>, <strong>/operatore-postazione-zanardelli</strong>,{' '}
          <strong>/operatore-postazione-lattea</strong>) e trasportatore guidatore (
          <strong>/operatore-consegne</strong>). Ogni sede ha Fatture fornitori.
        </p>
      </section>

      <section className="card pagamenti-workbook-card suppliers-workbook-card">
        <WorkbookGrid
          title={OPERATOR_LINKS_WORKBOOK_TITLE}
          sheetLabel={`${links.length} link`}
          columns={OPERATOR_LINKS_COLUMNS}
          rows={links}
          cellValue={operatorLinkCellValue}
          gridClassName="operator-links-grid"
          emptyMessage="Nessun link configurato."
          rowKey={(row) => row.id}
          getCellTitle={(row, column) =>
            column.id === 'description' || column.id === 'url' ? String(row[column.id] || '') : ''
          }
          actionsHeader="Azioni"
          renderActions={(row) => (
            <div className="sup-actions-btns order-line-actions" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => handleCopy(row.url)}
              >
                {copiedUrl === row.url ? 'Copiato' : 'Copia link'}
              </button>
              <a
                href={row.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary btn-sm"
              >
                Apri
              </a>
            </div>
          )}
        />
      </section>
    </div>
  )
}
