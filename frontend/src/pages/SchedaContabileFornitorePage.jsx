import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnalisiLoadingBar } from '../components/AnalisiShared.jsx'
import { AmministrazionePageShell } from '../components/BancaShared.jsx'
import FattureCompanySelect from '../components/FattureCompanySelect.jsx'
import { FatturePageShell, eur, formatDate } from '../components/FattureShared.jsx'
import WorkbookGrid from '../components/WorkbookGrid.jsx'
import { useFattureCompany } from '../hooks/useFattureCompany.js'
import {
  loadSchedaContabileFornitori,
  printSchedaContabileFornitore,
} from '../services/schedaContabileFornitore.js'
import { companyLabel } from '../utils/fattureCompany.js'

function monthBounds(d = new Date()) {
  const y = d.getFullYear()
  const m = d.getMonth()
  const from = new Date(y, m, 1)
  const to = new Date(y, m + 1, 0)
  const iso = (x) => x.toISOString().slice(0, 10)
  return { from: iso(from), to: iso(to) }
}

const LIST_COLUMNS = [
  { id: 'name', label: 'Fornitore', width: 32, fluid: true, emphasis: true },
  { id: 'ricevute', label: 'Fatture', width: 8, fluid: true, numeric: true },
  { id: 'pagate', label: 'Pagate', width: 8, fluid: true, numeric: true },
  { id: 'daPagare', label: 'Da pagare', width: 8, fluid: true, numeric: true },
  { id: 'dare', label: 'Dare', width: 12, fluid: true, numeric: true },
  { id: 'avere', label: 'Avere', width: 12, fluid: true, numeric: true },
  { id: 'saldo', label: 'Saldo', width: 14, fluid: true, numeric: true },
]

function listCellValue(row, col) {
  if (!row) return ''
  if (col.id === 'name') return row.name || ''
  if (col.id === 'ricevute') return String(row.ricevuteCount || 0)
  if (col.id === 'pagate') return String(row.pagateCount || 0)
  if (col.id === 'daPagare') return String(row.daPagareCount || 0)
  if (col.id === 'dare') return eur(row.totalDare)
  if (col.id === 'avere') return eur(row.totalAvere)
  if (col.id === 'saldo') return row.finalBalanceLabel || eur(row.finalBalance)
  return ''
}

const DETAIL_COLUMNS = [
  { id: 'date', label: 'Data reg.', width: 10, fluid: true },
  { id: 'documento', label: 'Documento', width: 18, fluid: true },
  { id: 'description', label: 'Descrizione riga', width: 22, fluid: true, emphasis: true },
  { id: 'dare', label: 'Dare', width: 10, fluid: true, numeric: true },
  { id: 'avere', label: 'Avere', width: 10, fluid: true, numeric: true },
  { id: 'contropartita', label: 'Contropartita', width: 14, fluid: true },
  { id: 'saldo', label: 'Saldo progressivo', width: 12, fluid: true, numeric: true },
  { id: 'stato', label: 'Stato', width: 10, fluid: true },
]

function detailCellValue(row, col) {
  if (!row) return ''
  if (col.id === 'date') return formatDate(row.date)
  if (col.id === 'documento') return row.documento || '—'
  if (col.id === 'description') return row.description || '—'
  if (col.id === 'dare') return row.dare ? eur(row.dare) : ''
  if (col.id === 'avere') return row.avere ? eur(row.avere) : ''
  if (col.id === 'contropartita') return row.contropartita || '—'
  if (col.id === 'saldo') return row.progressiveLabel || eur(row.progressiveBalance)
  if (col.id === 'stato') {
    if (row.invoiceKind === 'pagamento') return 'Pagato'
    if (row.paymentStatus === 'paid') return 'Pagata'
    if (row.paymentStatus === 'partial') return 'Parziale'
    if (row.paymentStatus === 'unpaid') return 'Da pagare'
    if (row.invoiceKind === 'emessa') return 'Emessa'
    return '—'
  }
  return ''
}

export function SchedaContabileFornitorePage({
  fattureBase = '/fatture',
  /** amministrazione = sotto Mastrini; fatture = postazioni operative */
  shell = 'amministrazione',
} = {}) {
  const bounds = useMemo(() => monthBounds(), [])
  const { companies, companyId, setCompanyId, loadingCompanies } = useFattureCompany(true)
  const [dateFrom, setDateFrom] = useState(bounds.from)
  const [dateTo, setDateTo] = useState(bounds.to)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState('')

  async function reload() {
    if (!companyId) {
      setData(null)
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await loadSchedaContabileFornitori({
        company: companyId,
        dateFrom,
        dateTo,
      })
      setData(res)
      if (res.warnings?.length) setError(res.warnings.join(' '))
    } catch (e) {
      setError(e?.message || 'Errore caricamento scheda contabile')
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  const parties = useMemo(() => {
    const rows = Array.isArray(data?.parties) ? data.parties : []
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((p) => String(p.name || '').toLowerCase().includes(q))
  }, [data, query])

  const selected = useMemo(
    () => parties.find((p) => p.key === selectedKey) || null,
    [parties, selectedKey],
  )

  const periodLabel = `Dal ${formatDate(dateFrom)} al ${formatDate(dateTo)}`
  const companyName = data?.companyLabel || (companyId ? companyLabel(companyId) : '')
  const Shell = shell === 'fatture' ? FatturePageShell : AmministrazionePageShell
  const shellExtra = shell === 'fatture' ? { fattureBase } : {}

  return (
    <Shell
      {...shellExtra}
      title="Scheda contabile fornitori"
      lead={
        companyId
          ? `${companyName}: elenco fornitori con fatture ricevute (Avere), pagamenti (Dare) e saldo progressivo come in Passcom.`
          : 'Scegli la società nel banner, poi Aggiorna per aprire le schede fornitore.'
      }
      actions={
        <aside className="mastrini-hero-tools" aria-label="Filtri scheda contabile">
          <FattureCompanySelect
            className="mastrini-hero-tools-company"
            companies={companies}
            value={companyId}
            onChange={(id) => {
              setSelectedKey('')
              setCompanyId(id)
            }}
            loading={loadingCompanies}
          />
          <label className="mastrini-hero-tools-dates">
            Dal
            <input type="date" className="form-control" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label className="mastrini-hero-tools-dates">
            Al
            <input type="date" className="form-control" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          <div className="mastrini-hero-tools-btns">
            {shell === 'amministrazione' ? (
              <Link className="btn btn-secondary btn-sm" to="/amministrazione/mastrini">
                ← Mastrini
              </Link>
            ) : null}
            <button type="button" className="btn btn-primary btn-sm" disabled={!companyId || loading} onClick={reload}>
              {loading ? 'Carico…' : 'Aggiorna'}
            </button>
          </div>
        </aside>
      }
    >
      {error ? <p className="form-error">{error}</p> : null}
      {loading ? <AnalisiLoadingBar active label="Caricamento fatture e pagamenti" variant="subtle" /> : null}

      {!companyId ? (
        <p className="fatture-note">Seleziona una società per vedere i fornitori.</p>
      ) : null}

      {companyId && !selected ? (
        <>
          <div className="ui-kpi-row">
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Fornitori</div>
              <div className="ui-kpi-card-value">{data?.metrics?.totalParties ?? '—'}</div>
            </div>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Fatture ricevute</div>
              <div className="ui-kpi-card-value">{data?.metrics?.ricevuteCount ?? '—'}</div>
            </div>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Pagate / Da pagare</div>
              <div className="ui-kpi-card-value">
                {data?.metrics?.pagateCount ?? '—'} / {data?.metrics?.daPagareCount ?? '—'}
              </div>
            </div>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Saldo complessivo</div>
              <div className="ui-kpi-card-value">{eur(data?.metrics?.finalBalance)}</div>
            </div>
          </div>

          <section className="card fatture-panel">
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem', alignItems: 'center' }}>
              <input
                className="form-control"
                placeholder="Cerca fornitore…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ minWidth: 220, maxWidth: 360 }}
              />
              <span className="fatture-note" style={{ margin: 0 }}>
                Clic sul nome per aprire la scheda contabile · {periodLabel}
              </span>
            </div>
            <WorkbookGrid
              title="Elenco fornitori"
              sheetLabel={`${parties.length} fornitori`}
              gridClassName="fatture-excel-grid"
              columns={LIST_COLUMNS}
              rows={parties}
              cellValue={listCellValue}
              emptyMessage="Nessun fornitore con fatture nel periodo."
              rowKey={(row) => row.key}
              onRowClick={(row) => setSelectedKey(row.key)}
              rowClickTitle="Apri scheda contabile"
              totals={{
                ricevute: parties.reduce((a, p) => a + (Number(p.ricevuteCount) || 0), 0),
                pagate: parties.reduce((a, p) => a + (Number(p.pagateCount) || 0), 0),
                daPagare: parties.reduce((a, p) => a + (Number(p.daPagareCount) || 0), 0),
                dare: parties.reduce((a, p) => a + (Number(p.totalDare) || 0), 0),
                avere: parties.reduce((a, p) => a + (Number(p.totalAvere) || 0), 0),
                saldo: parties.reduce((a, p) => a + (Number(p.finalBalance) || 0), 0),
              }}
              totalsLabel={(colId, totals) => {
                if (colId === 'name') return 'TOTALI'
                if (colId === 'ricevute') return String(totals?.ricevute || 0)
                if (colId === 'pagate') return String(totals?.pagate || 0)
                if (colId === 'daPagare') return String(totals?.daPagare || 0)
                if (colId === 'dare') return eur(totals?.dare)
                if (colId === 'avere') return eur(totals?.avere)
                if (colId === 'saldo') return eur(totals?.saldo)
                return ''
              }}
            />
          </section>
        </>
      ) : null}

      {companyId && selected ? (
        <section className="card fatture-panel scheda-contabile-panel">
          <div className="scheda-contabile-head">
            <div className="scheda-contabile-title">SCHEDA CONTABILE</div>
            <div className="scheda-contabile-meta">
              <div>
                <strong>Azienda:</strong> {companyName}
              </div>
              <div>
                <strong>Ordinam:</strong> Conto / Data Registrazione / Data Documento
              </div>
              <div>
                <strong>Dal:</strong> {formatDate(dateFrom)} <strong>al</strong> {formatDate(dateTo)}
              </div>
            </div>
            <div className="scheda-contabile-conto-row">
              <div className="scheda-contabile-conto">
                Conto: {selected.code ? `001.${String(selected.code).padStart(5, '0')} ` : ''}
                {selected.name}
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm scheda-contabile-back"
                onClick={() => setSelectedKey('')}
              >
                ← Torna all&apos;elenco
              </button>
            </div>
            <div className="scheda-contabile-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() =>
                  printSchedaContabileFornitore({
                    party: selected,
                    companyLabelText: companyName,
                    dateFrom,
                    dateTo,
                  })
                }
              >
                Stampa scheda
              </button>
              <Link className="btn btn-secondary btn-sm" to={`${fattureBase}/registrate`}>
                Storico fatture
              </Link>
              <Link className="btn btn-secondary btn-sm" to={`${fattureBase}/pagate`}>
                Fatture pagate
              </Link>
            </div>
          </div>

          <div className="ui-kpi-row" style={{ marginTop: '0.75rem' }}>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Fatture (FR)</div>
              <div className="ui-kpi-card-value">{selected.ricevuteCount || 0}</div>
            </div>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Pagate / Da pagare</div>
              <div className="ui-kpi-card-value">
                {selected.pagateCount || 0} / {selected.daPagareCount || 0}
              </div>
            </div>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Totale Dare</div>
              <div className="ui-kpi-card-value">{eur(selected.totalDare)}</div>
            </div>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Totale Avere</div>
              <div className="ui-kpi-card-value">{eur(selected.totalAvere)}</div>
            </div>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Saldo</div>
              <div className="ui-kpi-card-value">{selected.finalBalanceLabel || eur(selected.finalBalance)}</div>
            </div>
          </div>

          <WorkbookGrid
            title={`Movimenti · ${selected.name}`}
            sheetLabel={`${selected.movements?.length || 0} righe`}
            gridClassName="fatture-excel-grid"
            columns={DETAIL_COLUMNS}
            rows={selected.movements || []}
            cellValue={detailCellValue}
            emptyMessage="Nessun movimento nel periodo."
            rowKey={(row, idx) => `${row.registrationNumber || 'r'}-${idx}`}
            totals={{
              dare: selected.totalDare,
              avere: selected.totalAvere,
              saldo: selected.finalBalance,
            }}
            totalsLabel={(colId, totals) => {
              if (colId === 'description') return 'TOTALI'
              if (colId === 'dare') return eur(totals?.dare)
              if (colId === 'avere') return eur(totals?.avere)
              if (colId === 'saldo') return selected.finalBalanceLabel || eur(totals?.saldo)
              return ''
            }}
          />
          <p className="fatture-note">
            Convenzione Passcom: <strong>FR</strong> (fattura ricevuta) in Avere · <strong>PG</strong> (pagamento) in
            Dare · saldo con suffisso A/D.
          </p>
        </section>
      ) : null}
    </Shell>
  )
}

export default SchedaContabileFornitorePage
