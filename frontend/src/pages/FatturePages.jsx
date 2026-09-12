import React, { useEffect, useMemo, useState } from 'react'
import {
  FattureLink,
  FattureNavigate,
  FattureNavBaseContext,
  FatturePageShell,
  FattureStubCard,
  SeriesBars,
  eur,
  formatDate,
} from '../components/FattureShared.jsx'
import { AnalisiLoadingBar } from '../components/AnalisiShared.jsx'
import {
  assignSdiInvoiceSection,
  fetchAdeProfiles,
  fetchIncomingInvoice,
  fetchIncomingInvoices,
  fetchInvoices,
  fetchInvoicesAnalyticsSummary,
  fetchSdiReceivedInvoices,
  fetchSdiStatus,
  getSdiInvoiceDownloadUrl,
  getSdiInvoicePdfUrl,
  importInvoiceXml,
  markInvoicePaid,
  postSdiReceiveXml,
  setInvoiceIgnored,
  updateAdeFisconlineCredentials,
  fetchIssuedInvoices,
  uploadIssuedInvoice,
  getIssuedInvoiceFileUrl,
  deleteIssuedInvoice,
} from '../services/invoicesService'
import FattureCompanySelect from '../components/FattureCompanySelect.jsx'
import FattureScopeTools from '../components/FattureScopeTools.jsx'
import FattureActionsMenu from '../components/FattureActionsMenu.jsx'
import WorkbookGrid from '../components/WorkbookGrid.jsx'
import { useFattureCompany } from '../hooks/useFattureCompany.js'
import { companyLabel, FATTURE_COMPANY_ORDER, isGestionaleFattureContext } from '../utils/fattureCompany.js'

const SYNC_LOG_KEY = 'fattureAdeSdiSyncLog'

const SDI_INVOICE_COLUMNS = [
  { id: 'invoice_number', label: 'Numero', width: 12, fluid: true },
  { id: 'invoice_date', label: 'Data', width: 12, fluid: true },
  { id: 'supplier_name', label: 'Fornitore', width: 28, fluid: true },
  { id: 'receiver_vat', label: 'P.IVA dest.', width: 16, fluid: true },
  { id: 'destination', label: 'Destinazione', width: 32, fluid: true },
]

const EMESSE_COLUMNS = [
  { id: 'created_at', label: 'Data carico', width: 14, fluid: true },
  { id: 'file_kind', label: 'Tipo', width: 10, fluid: true },
  { id: 'original_filename', label: 'File', width: 30, fluid: true },
  { id: 'invoice_number', label: 'Numero', width: 14, fluid: true },
  { id: 'total_amount', label: 'Importo', width: 14, fluid: true, numeric: true },
  { id: 'status', label: 'Stato', width: 12, fluid: true },
]

const DA_REGISTRARE_COLUMNS = [
  { id: 'invoice_date', label: 'Data', width: 11, fluid: true },
  { id: 'invoice_number', label: 'Numero', width: 12, fluid: true },
  { id: 'supplier_name', label: 'Fornitore', width: 22, fluid: true },
  { id: 'imponibile', label: 'Imponibile', width: 12, fluid: true, numeric: true },
  { id: 'vat_amount', label: 'IVA', width: 10, fluid: true, numeric: true },
  { id: 'total', label: 'Totale', width: 12, fluid: true, numeric: true, emphasis: true },
  { id: 'due_date', label: 'Scadenza', width: 11, fluid: true },
  { id: 'payment_status', label: 'Stato', width: 10, fluid: true },
]

const SCADENZIARIO_COLUMNS = [
  { id: 'due_date', label: 'Scadenza', width: 12, fluid: true },
  { id: 'invoice_date', label: 'Data doc.', width: 12, fluid: true },
  { id: 'invoice_number', label: 'Numero', width: 14, fluid: true },
  { id: 'supplier_name', label: 'Fornitore', width: 28, fluid: true },
  { id: 'total', label: 'Totale', width: 14, fluid: true, numeric: true, emphasis: true },
  { id: 'payment_status', label: 'Stato', width: 12, fluid: true },
]

function paymentStatusText(status, ignored) {
  if (ignored) return 'Ignorata'
  if (status === 'paid') return 'Pagata'
  if (status === 'partial') return 'Parziale'
  return 'Da pagare'
}

function sumField(rows, key) {
  return (Array.isArray(rows) ? rows : []).reduce((acc, row) => acc + (Number(row?.[key]) || 0), 0)
}

function moneyTotalsLabel(colId, totals) {
  if (colId === 'invoice_number' || colId === 'invoice_date' || colId === 'created_at') return 'Totali'
  if (colId === 'supplier_name' || colId === 'file_kind' || colId === 'original_filename') {
    return totals?.count != null ? `${totals.count} doc.` : ''
  }
  if (colId === 'imponibile') return eur(totals?.imponibile)
  if (colId === 'vat_amount') return eur(totals?.vat_amount)
  if (colId === 'total' || colId === 'total_amount') return eur(totals?.total)
  return ''
}

function pushSyncLog(entry) {
  try {
    const prev = JSON.parse(sessionStorage.getItem(SYNC_LOG_KEY) || '[]')
    const next = [{ id: `${Date.now()}`, at: new Date().toISOString(), ...entry }, ...prev].slice(0, 40)
    sessionStorage.setItem(SYNC_LOG_KEY, JSON.stringify(next))
    return next
  } catch {
    return []
  }
}

function readSyncLog() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(SYNC_LOG_KEY) || '[]')
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function flattenSdi(rows) {
  if (rows?.companies && typeof rows.companies === 'object') {
    return FATTURE_COMPANY_ORDER.flatMap((id) => rows.companies[id] || []).concat(rows.non_classificata || [])
  }
  return [...(rows.abba || []), ...(rows.zanardelli || []), ...(rows.non_classificata || [])]
}

function sdiListForCompany(rows, companyId) {
  if (!companyId) return []
  if (rows?.companies?.[companyId]) return rows.companies[companyId]
  if (companyId === 'non_classificata') return rows?.non_classificata || []
  return []
}

export function AdeSdiInvoicesPanel({
  title = 'Fatture ricevute (Agenzia Entrate / SDI)',
  showAssign = true,
  autoLoad = true,
  companyId = '',
  embeddedMode = false,
  hideImportLink = false,
}) {
  const [days, setDays] = useState('60')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [rows, setRows] = useState({ companies: {}, non_classificata: [] })

  async function load(daysOverride) {
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const d = Number(daysOverride || days || 60)
      const data = await fetchSdiReceivedInvoices({ days: d, company: companyId || undefined })
      const companies = data?.companies && typeof data.companies === 'object' ? data.companies : {}
      const nextCompanies = {}
      for (const cid of FATTURE_COMPANY_ORDER) {
        nextCompanies[cid] = Array.isArray(companies[cid]) ? companies[cid] : []
      }
      // Compat: eventuali residui sotto id "mediazione" → non classificate
      const legacyMediazione = Array.isArray(companies.mediazione) ? companies.mediazione : []
      const next = {
        companies: nextCompanies,
        non_classificata: [
          ...(Array.isArray(data?.non_classificata) ? data.non_classificata : []),
          ...legacyMediazione,
        ],
      }
      setRows(next)
      const count = companyId ? sdiListForCompany(next, companyId).length : flattenSdi(next).length
      pushSyncLog({
        ok: true,
        days: d,
        count,
        company: companyId || null,
        message: companyId
          ? `${count} fatture SDI · ${companyLabel(companyId)} (ultimi ${d} gg)`
          : `Caricate ${count} fatture SDI (ultimi ${d} gg)`,
      })
      setSuccess(
        companyId
          ? `${companyLabel(companyId)}: ${count} documenti negli ultimi ${d} giorni.`
          : `Inbox aggiornata: ${count} documenti.`,
      )
    } catch (e) {
      const msg = e?.message || 'Errore caricamento inbox SDI'
      pushSyncLog({ ok: false, days: Number(days), count: 0, company: companyId || null, message: msg })
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (autoLoad) load(60)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad, companyId])

  async function handleManualAssign(item, section) {
    try {
      await assignSdiInvoiceSection(item.id, section)
      setSuccess(`Assegnata a ${companyLabel(section)}`)
      await load()
    } catch (e) {
      setError(e?.message || 'Errore assegnazione')
    }
  }

  const visibleList = companyId ? sdiListForCompany(rows, companyId) : []
  const panelTitle = companyId ? `${title} · ${companyLabel(companyId)}` : title

  function renderTable(list, withAssign = false) {
    return (
      <WorkbookGrid
        title="Inbox SDI"
        sheetLabel={`${list.length} documenti`}
        hideToolbar
        gridClassName="fatture-excel-grid"
        columns={SDI_INVOICE_COLUMNS}
        rows={list}
        rowKey={(row) => `sdi-${row.id}`}
        cellValue={(row, col) => {
          if (col.id === 'invoice_date') return formatDate(row.invoice_date)
          return row[col.id] || '—'
        }}
        emptyMessage={
          companyId
            ? `Nessuna fattura per ${companyLabel(companyId)} in questo periodo.`
            : 'Seleziona una società dal menu in alto.'
        }
        actionsHeader={withAssign ? 'Azioni / Assegna' : 'Azioni'}
        actionsColWidth={withAssign ? '9.5rem' : '8.75rem'}
        renderActions={(item) => (
          <FattureActionsMenu
            primary={
              <a
                className="btn btn-primary btn-sm"
                href={getSdiInvoicePdfUrl(item.id)}
                target="_blank"
                rel="noreferrer"
                title="Apri PDF"
              >
                PDF
              </a>
            }
            items={[
              {
                key: 'xml',
                label: 'Scarica XML',
                href: getSdiInvoiceDownloadUrl(item.id),
              },
              ...(withAssign
                ? FATTURE_COMPANY_ORDER.map((cid) => ({
                    key: `assign-${cid}`,
                    label: `Assegna: ${companyLabel(cid)}`,
                    onClick: () => handleManualAssign(item, cid),
                  }))
                : []),
            ]}
          />
        )}
      />
    )
  }

  return (
    <section className="card fatture-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
        <div>
          <h2 className="fatture-panel-title" style={{ marginBottom: '0.25rem' }}>
            {panelTitle}
          </h2>
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>
            Inbox SDI / Agenzia Entrate. Classificazione automatica dalla P.IVA destinatario nell&apos;XML
            {companyId ? ` (${companyLabel(companyId)})` : ''}.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-muted)' }}>
            Ultimi giorni
            <select className="form-control" value={days} onChange={(e) => setDays(e.target.value)} style={{ minWidth: 100 }}>
              <option value="30">30</option>
              <option value="60">60</option>
              <option value="90">90</option>
            </select>
          </label>
          <button type="button" className="btn btn-primary" onClick={() => load()} disabled={loading || !companyId}>
            {loading ? 'Aggiornamento…' : 'Aggiorna inbox'}
          </button>
          {!embeddedMode && !hideImportLink ? (
            <FattureLink className="btn btn-secondary" to="/fatture/importa-xml">
              Importa XML
            </FattureLink>
          ) : null}
        </div>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}
      {!companyId ? (
        <p className="fatture-note">
          {embeddedMode
            ? 'Registro locale non configurato per questa postazione.'
            : 'Seleziona una società dal menu nel banner verde per vedere le fatture ricevute.'}
        </p>
      ) : (
        renderTable(visibleList, showAssign)
      )}
    </section>
  )
}

export function FattureDashboardPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const res = await fetchInvoicesAnalyticsSummary()
        if (!cancelled) setData(res)
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Errore caricamento dashboard')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <FatturePageShell
      title="Dashboard"
      lead="Colpo d'occhio: ricevute, da registrare, scadenze, totali del mese e IVA."
    >
      {loading && <AnalisiLoadingBar active label="Caricamento fatture" variant="subtle" />}
      {error && <div className="alert alert-danger">{error}</div>}
      {data && (
        <>
          <section className="dashboard-kpi-grid analisi-kpi-grid">
            <div className="dashboard-kpi dashboard-kpi--primary">
              <div className="dashboard-kpi-label">Fatture ricevute oggi</div>
              <div className="dashboard-kpi-value">{data.ricevute_oggi}</div>
              <div className="dashboard-kpi-hint">Documenti con data odierna</div>
            </div>
            <div className="dashboard-kpi dashboard-kpi--warn">
              <div className="dashboard-kpi-label">Da registrare</div>
              <div className="dashboard-kpi-value">{data.da_registrare}</div>
              <div className="dashboard-kpi-hint">Senza movimento cassa collegato</div>
            </div>
            <div className="dashboard-kpi">
              <div className="dashboard-kpi-label">Scadenze in arrivo</div>
              <div className="dashboard-kpi-value">{data.scadenze_in_arrivo}</div>
              <div className="dashboard-kpi-sub">{data.scadute} già scadute</div>
            </div>
            <div className="dashboard-kpi">
              <div className="dashboard-kpi-label">Totale mese</div>
              <div className="dashboard-kpi-value" style={{ fontSize: '1.2rem' }}>
                {eur(data.totale_mese)}
              </div>
            </div>
            <div className="dashboard-kpi">
              <div className="dashboard-kpi-label">Totale IVA mese</div>
              <div className="dashboard-kpi-value" style={{ fontSize: '1.2rem' }}>
                {eur(data.totale_iva_mese)}
              </div>
            </div>
          </section>

          <section className="card fatture-panel">
            <h2 className="fatture-panel-title">Andamento mensile (6 mesi)</h2>
            <SeriesBars rows={data.flussi_mensili || []} />
            <div className="analisi-panel-actions" style={{ marginTop: '0.85rem' }}>
              <FattureLink className="btn btn-secondary btn-sm" to="/fatture/ricevute">
                Fatture ricevute
              </FattureLink>
              <FattureLink className="btn btn-secondary btn-sm" to="/fatture/da-registrare">
                Da registrare
              </FattureLink>
              <FattureLink className="btn btn-secondary btn-sm" to="/fatture/scadenziario">
                Scadenziario
              </FattureLink>
              <FattureLink className="btn btn-secondary btn-sm" to="/fatture/sincronizzazione">
                Sincronizza
              </FattureLink>
            </div>
          </section>

          <section className="card fatture-panel">
            <h2 className="fatture-panel-title">Prossimamente</h2>
            <ul className="fatture-suggestions">
              <li>Suggerimento automatico centro di costo</li>
              <li>Riconoscimento fatture ricorrenti e anomalie</li>
              <li>Notifiche scadenze e match con ordini/DDT</li>
            </ul>
          </section>
        </>
      )}
    </FatturePageShell>
  )
}

export function FattureRicevutePage() {
  const fattureBase = React.useContext(FattureNavBaseContext)
  const gestionaleMode = isGestionaleFattureContext(fattureBase)
  const { companies, companyId, setCompanyId, loadingCompanies } = useFattureCompany(gestionaleMode)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(gestionaleMode)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const importInputRef = React.useRef(null)

  const ricevuteLead = gestionaleMode
    ? 'Fatture dal canale SDI / Agenzia Entrate, suddivise per società (P.IVA destinatario). Società e import XML nel banner.'
    : companyId
      ? `Fatture ricevute del registro locale: ${companyLabel(companyId)}.`
      : 'Fatture ricevute del registro locale di questa postazione.'

  async function reload() {
    if (!gestionaleMode) return
    setLoading(true)
    setError('')
    try {
      const res = await fetchIncomingInvoices(200)
      const list = Array.isArray(res?.items) ? res.items : []
      setItems(list)
      if (!selectedId && list[0]?.id) setSelectedId(list[0].id)
    } catch (e) {
      setError(e?.message || 'Errore caricamento fatture ricevute')
    } finally {
      setLoading(false)
    }
  }

  async function handleBannerImport(ev) {
    const file = ev.target.files?.[0]
    ev.target.value = ''
    if (!file) return
    setImportBusy(true)
    setImportMsg('')
    setError('')
    try {
      const res = await importInvoiceXml(file)
      if (res?.duplicated) {
        setImportMsg('XML già presente in Atlas.')
      } else {
        const inv = res?.incoming_invoice
        setImportMsg(
          `Importata n. ${inv?.invoice_number || '—'} · ${inv?.supplier_name || 'fornitore'} · ${eur(inv?.total_amount)}`,
        )
      }
      await reload()
    } catch (e) {
      setError(e?.message || 'Import XML fallito')
    } finally {
      setImportBusy(false)
    }
  }

  useEffect(() => {
    if (gestionaleMode) reload()
    else setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gestionaleMode])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    let cancelled = false
    ;(async () => {
      setDetailLoading(true)
      try {
        const row = await fetchIncomingInvoice(selectedId)
        if (!cancelled) setDetail(row)
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Errore dettaglio')
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedId])

  const selected = detail || items.find((r) => r.id === selectedId) || null
  const vatRate =
    selected?.lines?.find((l) => l.vat_rate != null)?.vat_rate ??
    (selected?.taxable_amount && selected?.vat_amount
      ? Math.round((Number(selected.vat_amount) / Number(selected.taxable_amount)) * 1000) / 10
      : null)

  return (
    <FatturePageShell
      title="Fatture ricevute"
      lead={ricevuteLead}
      actions={
        <aside className="mastrini-hero-tools fatture-hero-tools" aria-label="Società e import XML">
          {gestionaleMode ? (
            <FattureCompanySelect
              className="mastrini-hero-tools-company"
              companies={[...companies, { id: 'non_classificata', label: 'Non classificate' }]}
              value={companyId}
              onChange={setCompanyId}
              loading={loadingCompanies}
            />
          ) : (
            <div className="fatture-hero-tools-locale">
              <span className="staff-gestionale-locale-select-label">Registro</span>
              <strong>{companyId ? companyLabel(companyId) : 'Locale'}</strong>
            </div>
          )}
          <div className="mastrini-hero-tools-btns">
            <input
              ref={importInputRef}
              type="file"
              accept=".xml,.p7m,application/xml,text/xml"
              style={{ display: 'none' }}
              onChange={(ev) => void handleBannerImport(ev)}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={importBusy}
              onClick={() => importInputRef.current?.click()}
              title="Carica una FatturaPA XML in Atlas"
            >
              {importBusy ? 'Import…' : 'Importa XML'}
            </button>
          </div>
          {importMsg ? <p className="fatture-hero-tools-msg">{importMsg}</p> : null}
        </aside>
      }
    >
      {error && <div className="alert alert-danger">{error}</div>}
      {loading ? <AnalisiLoadingBar active label="Caricamento fatture ricevute" variant="subtle" /> : null}

      <AdeSdiInvoicesPanel
        title="Inbox SDI"
        showAssign={gestionaleMode && companyId === 'non_classificata'}
        autoLoad={Boolean(companyId)}
        companyId={companyId}
        embeddedMode={!gestionaleMode}
        hideImportLink
      />

      {gestionaleMode && !companyId ? (
        <>
      <section className="card fatture-panel">
        <h2 className="fatture-panel-title">Elenco importate (tutte le società)</h2>
        <WorkbookGrid
          title="Elenco importate"
          sheetLabel={`${items.length} documenti`}
          hideToolbar
          gridClassName="fatture-excel-grid"
          columns={[
            { id: 'invoice_number', label: 'N.', width: 18, fluid: true },
            { id: 'supplier_name', label: 'Fornitore', width: 42, fluid: true },
            { id: 'invoice_date', label: 'Data', width: 18, fluid: true },
            { id: 'total_amount', label: 'Totale', width: 22, fluid: true, numeric: true, emphasis: true },
          ]}
          rows={items}
          rowKey={(row) => row.id}
          cellValue={(row, col) => {
            if (col.id === 'invoice_date') return formatDate(row.invoice_date)
            if (col.id === 'total_amount') return eur(row.total_amount)
            return row[col.id] || '—'
          }}
          totals={
            items.length
              ? { count: items.length, total: sumField(items, 'total_amount') }
              : null
          }
          totalsLabel={moneyTotalsLabel}
          emptyMessage="Nessuna fattura ricevuta. Usa Importa XML o il canale SDI."
          onRowClick={(row) => setSelectedId(row.id)}
          getRowClassName={(row) => (selectedId === row.id ? 'workbook-row-selected' : '')}
        />
      </section>

      {selected ? (
        <section className="card fatture-panel">
          <h2 className="fatture-panel-title">
            Fattura {selected.invoice_number}
            {selected.document_type ? ` · ${selected.document_type}` : ''}
          </h2>
          {detailLoading ? <AnalisiLoadingBar active label="Caricamento dettaglio" variant="subtle" /> : null}
          <div className="ui-kpi-row" style={{ marginBottom: '1rem' }}>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Fornitore</div>
              <div className="ui-kpi-card-value" style={{ fontSize: '1.05rem' }}>
                {selected.supplier_name || '—'}
              </div>
            </div>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">P.IVA</div>
              <div className="ui-kpi-card-value" style={{ fontSize: '1.05rem' }}>
                {selected.supplier_vat || selected.supplier_vat_xml || '—'}
              </div>
            </div>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Data</div>
              <div className="ui-kpi-card-value" style={{ fontSize: '1.05rem' }}>
                {formatDate(selected.invoice_date)}
              </div>
            </div>
          </div>
          <div className="ui-kpi-row" style={{ marginBottom: '1rem' }}>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Imponibile</div>
              <div className="ui-kpi-card-value">{eur(selected.taxable_amount)}</div>
            </div>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">
                IVA{vatRate != null ? ` ${Number(vatRate)}%` : ''}
              </div>
              <div className="ui-kpi-card-value">{eur(selected.vat_amount)}</div>
            </div>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Totale</div>
              <div className="ui-kpi-card-value">{eur(selected.total_amount)}</div>
            </div>
          </div>
          <h3 className="fatture-panel-title" style={{ fontSize: '1rem' }}>
            Righe
          </h3>
          <div className="table-wrap">
            <table className="app-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Descrizione</th>
                  <th className="text-end">Q.tà</th>
                  <th className="text-end">Prezzo</th>
                  <th className="text-end">Totale riga</th>
                  <th className="text-end">IVA %</th>
                </tr>
              </thead>
              <tbody>
                {(selected.lines || []).map((ln) => (
                  <tr key={ln.id || ln.line_number}>
                    <td>{ln.line_number}</td>
                    <td>{ln.description || '—'}</td>
                    <td className="text-end">{ln.quantity != null ? Number(ln.quantity).toLocaleString('it-IT') : '—'}</td>
                    <td className="text-end">{ln.unit_price != null ? Number(ln.unit_price).toLocaleString('it-IT', { maximumFractionDigits: 8 }) : '—'}</td>
                    <td className="text-end">{eur(ln.line_total)}</td>
                    <td className="text-end">{ln.vat_rate != null ? `${Number(ln.vat_rate)}%` : '—'}</td>
                  </tr>
                ))}
                {!selected.lines?.length ? (
                  <tr>
                    <td colSpan={6} className="empty-state">
                      Nessuna riga
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {selected.atlas_invoice_id ? (
            <p className="fatture-note" style={{ marginTop: '0.75rem' }}>
              Collegata anche in{' '}
              <FattureLink to="/fatture/registrate">Fatture registrate</FattureLink> (id {selected.atlas_invoice_id}).
            </p>
          ) : null}
        </section>
      ) : null}
        </>
      ) : null}
    </FatturePageShell>
  )
}

export function FattureEmessePage() {
  const fattureBase = React.useContext(FattureNavBaseContext)
  const gestionaleMode = isGestionaleFattureContext(fattureBase)
  const { companies, companyId, setCompanyId, loadingCompanies } = useFattureCompany(gestionaleMode)
  const [uploadKind, setUploadKind] = useState('pdf')
  const [importBusy, setImportBusy] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const [error, setError] = useState('')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const importInputRef = React.useRef(null)

  const acceptByKind = {
    xml: '.xml,.p7m,application/xml,text/xml',
    pdf: '.pdf,application/pdf',
    image: 'image/*,.jpg,.jpeg,.png,.webp,.gif',
  }

  const kindLabel = { xml: 'XML', pdf: 'PDF', image: 'Immagine' }

  async function reload() {
    if (!companyId) {
      setItems([])
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetchIssuedInvoices({ company: companyId, limit: 200 })
      setItems(Array.isArray(res?.items) ? res.items : [])
    } catch (e) {
      setError(e?.message || 'Errore caricamento fatture emesse')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  async function handleBannerImport(ev) {
    const file = ev.target.files?.[0]
    ev.target.value = ''
    if (!file) return
    if (!companyId) {
      setError('Seleziona prima la società nel banner.')
      return
    }
    setImportBusy(true)
    setImportMsg('')
    setError('')
    try {
      const row = await uploadIssuedInvoice({
        file,
        company: companyId,
        fileKind: uploadKind,
      })
      const num = row?.invoice_number || row?.extracted?.invoice_number
      const tot = row?.total_amount ?? row?.extracted?.total_amount
      const warns = Array.isArray(row?.extracted?.warnings) ? row.extracted.warnings.filter(Boolean) : []
      const bits = [
        `Caricato ${kindLabel[uploadKind] || uploadKind}: ${row?.original_filename || file.name}`,
        num ? `n. ${num}` : null,
        tot != null ? `importo ${eur(tot)}` : null,
      ].filter(Boolean)
      setImportMsg(bits.join(' · '))
      if (warns.length) {
        setError(warns.join(' · '))
      }
      await reload()
    } catch (e) {
      setError(e?.message || 'Caricamento fallito')
    } finally {
      setImportBusy(false)
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Eliminare questo documento emesso?')) return
    try {
      await deleteIssuedInvoice(id)
      setImportMsg('Documento eliminato.')
      await reload()
    } catch (e) {
      setError(e?.message || 'Eliminazione fallita')
    }
  }

  return (
    <FatturePageShell
      title="Fatture emesse"
      lead={
        gestionaleMode
          ? 'Fatture attive / emesse per società. Scegli PDF, immagine o XML e caricale dal banner.'
          : companyId
            ? `Fatture emesse del registro ${companyLabel(companyId)}.`
            : 'Fatture emesse del registro locale.'
      }
      actions={
        <aside className="mastrini-hero-tools fatture-hero-tools" aria-label="Società e caricamento documento">
          {gestionaleMode ? (
            <FattureCompanySelect
              className="mastrini-hero-tools-company"
              companies={companies}
              value={companyId}
              onChange={setCompanyId}
              loading={loadingCompanies}
            />
          ) : (
            <div className="fatture-hero-tools-locale">
              <span className="staff-gestionale-locale-select-label">Registro</span>
              <strong>{companyId ? companyLabel(companyId) : 'Locale'}</strong>
            </div>
          )}
          <label className="staff-gestionale-locale-select fatture-company-select mastrini-hero-tools-company">
            <span className="staff-gestionale-locale-select-label">Tipo file</span>
            <select
              className="form-control staff-gestionale-locale-select-field"
              value={uploadKind}
              onChange={(e) => setUploadKind(e.target.value)}
              aria-label="Scegli tipo file da caricare"
            >
              <option value="pdf">PDF</option>
              <option value="image">Immagine</option>
              <option value="xml">XML FatturaPA</option>
            </select>
          </label>
          <div className="mastrini-hero-tools-btns">
            <input
              ref={importInputRef}
              type="file"
              accept={acceptByKind[uploadKind] || acceptByKind.pdf}
              style={{ display: 'none' }}
              onChange={(ev) => void handleBannerImport(ev)}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={importBusy || !companyId}
              onClick={() => importInputRef.current?.click()}
              title={`Carica ${kindLabel[uploadKind] || 'documento'} in Atlas`}
            >
              {importBusy ? 'Caricamento…' : `Carica ${kindLabel[uploadKind] || 'file'}`}
            </button>
          </div>
          {importMsg ? <p className="fatture-hero-tools-msg">{importMsg}</p> : null}
        </aside>
      }
    >
      {error && <div className="alert alert-danger">{error}</div>}
      {!companyId ? (
        <div className="alert alert-info">
          Scegli la società nel banner verde, poi il tipo file (PDF / Immagine / XML) e carica il documento.
        </div>
      ) : (
        <section className="card fatture-panel">
          <h2 className="fatture-panel-title">Emesse · {companyLabel(companyId)}</h2>
          <p className="fatture-note">
            Al caricamento Atlas prova a leggere automaticamente <strong>numero</strong> e{' '}
            <strong>importo</strong> (XML completo; PDF da testo; foto con AI se configurata).
          </p>
          <WorkbookGrid
            title={`Emesse · ${companyLabel(companyId)}`}
            sheetLabel={`${items.length} documenti`}
            hideToolbar
            loading={loading}
            loadingLabel="Caricamento fatture emesse"
            gridClassName="fatture-excel-grid"
            columns={EMESSE_COLUMNS}
            rows={items}
            rowKey={(row) => `emessa-${row.id}`}
            cellValue={(row, col) => {
              if (col.id === 'created_at') return formatDate(row.created_at || row.invoice_date)
              if (col.id === 'file_kind') return kindLabel[row.file_kind] || row.file_kind || '—'
              if (col.id === 'total_amount') return row.total_amount != null ? eur(row.total_amount) : '—'
              return row[col.id] || '—'
            }}
            totals={
              items.length
                ? { count: items.length, total: sumField(items, 'total_amount') }
                : null
            }
            totalsLabel={moneyTotalsLabel}
            emptyMessage={`Nessuna fattura emessa per ${companyLabel(companyId)}. Scegli PDF o Immagine (o XML) e carica dal banner.`}
            actionsHeader="Azioni"
            actionsColWidth="8.75rem"
            renderActions={(row) => (
              <FattureActionsMenu
                primary={
                  <a
                    className="btn btn-primary btn-sm"
                    href={getIssuedInvoiceFileUrl(row.id)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Apri
                  </a>
                }
                items={[
                  {
                    key: 'delete',
                    label: 'Elimina',
                    danger: true,
                    onClick: () => void handleDelete(row.id),
                  },
                ]}
              />
            )}
          />
        </section>
      )}
    </FatturePageShell>
  )
}

/** @deprecated usa FattureRicevutePage — redirect da /fatture/passive */
export function FatturePassivePage() {
  return <FattureNavigate to="/fatture/ricevute" replace />
}

export function FattureDaRegistrarePage() {
  const fattureBase = React.useContext(FattureNavBaseContext)
  const gestionaleMode = isGestionaleFattureContext(fattureBase)
  const { companies, companyId, setCompanyId, loadingCompanies } = useFattureCompany(gestionaleMode)
  const [scopeMode, setScopeMode] = useState(() => {
    try {
      return sessionStorage.getItem('atlasFattureScopeMode:v1') || 'company'
    } catch {
      return 'company'
    }
  })
  const [localeId, setLocaleId] = useState(() => {
    try {
      return sessionStorage.getItem('atlasFattureLocale:v1') || ''
    } catch {
      return ''
    }
  })
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  function changeScopeMode(next) {
    setScopeMode(next)
    try {
      sessionStorage.setItem('atlasFattureScopeMode:v1', next)
    } catch {
      /* ignore */
    }
  }

  function changeLocaleId(next) {
    setLocaleId(next)
    try {
      sessionStorage.setItem('atlasFattureLocale:v1', next)
    } catch {
      /* ignore */
    }
  }

  const scopeReady = gestionaleMode
    ? scopeMode === 'company'
      ? Boolean(companyId)
      : Boolean(localeId)
    : Boolean(companyId)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (gestionaleMode && !scopeReady) {
        setInvoices([])
        setLoading(false)
        return
      }
      setLoading(true)
      setError('')
      try {
        const params = { include_ignored: false }
        if (gestionaleMode) {
          if (scopeMode === 'company' && companyId) params.company = companyId
          if (scopeMode === 'locale' && localeId) params.activity = localeId
        } else if (companyId) {
          params.company = companyId
        }
        const rows = await fetchInvoices(params)
        const list = Array.isArray(rows) ? rows : []
        if (!cancelled) {
          setInvoices(list.filter((inv) => !inv.cash_entry_id && inv.payment_status !== 'paid'))
        }
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Errore caricamento')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [gestionaleMode, scopeMode, companyId, localeId, scopeReady])

  return (
    <FatturePageShell
      title="Da registrare"
      lead="Fatture senza movimento di Prima Nota — filtra per società o locale dal banner."
      actions={
        gestionaleMode ? (
          <FattureScopeTools
            mode={scopeMode}
            onModeChange={changeScopeMode}
            companies={[...companies, { id: 'non_classificata', label: 'Non classificate' }]}
            companyId={companyId}
            onCompanyChange={setCompanyId}
            localeId={localeId}
            onLocaleChange={changeLocaleId}
            loading={loadingCompanies}
          />
        ) : null
      }
    >
      {gestionaleMode && !scopeReady ? (
        <div className="alert alert-info">
          Scegli <strong>Società</strong> o <strong>Locale</strong> nel banner verde per vedere le fatture da
          registrare.
        </div>
      ) : null}
      {loading && <AnalisiLoadingBar active label="Caricamento fatture" variant="subtle" />}
      {error && <div className="alert alert-danger">{error}</div>}
      <section className="card fatture-panel">
        <WorkbookGrid
          title="Da registrare"
          sheetLabel={`${invoices.length} documenti`}
          hideToolbar
          loading={loading}
          gridClassName="fatture-excel-grid"
          columns={DA_REGISTRARE_COLUMNS}
          rows={scopeReady ? invoices : []}
          rowKey={(row) => row.id}
          cellValue={(row, col) => {
            if (col.id === 'invoice_date' || col.id === 'due_date') return formatDate(row[col.id])
            if (col.id === 'imponibile' || col.id === 'vat_amount' || col.id === 'total') return eur(row[col.id])
            if (col.id === 'payment_status') return paymentStatusText(row.payment_status, row.ignored)
            return row[col.id] || '—'
          }}
          totals={
            invoices.length
              ? {
                  count: invoices.length,
                  imponibile: sumField(invoices, 'imponibile'),
                  vat_amount: sumField(invoices, 'vat_amount'),
                  total: sumField(invoices, 'total'),
                }
              : null
          }
          totalsLabel={moneyTotalsLabel}
          emptyMessage="Nessuna fattura da registrare."
          actionsHeader="Azioni"
          renderActions={() => (
            <FattureLink className="btn btn-secondary btn-sm" to="/fatture/registrate">
              Apri elenco
            </FattureLink>
          )}
        />
      </section>
    </FatturePageShell>
  )
}

export function FattureScadenziarioPage() {
  const fattureBase = React.useContext(FattureNavBaseContext)
  const gestionaleMode = isGestionaleFattureContext(fattureBase)
  const { companies, companyId, setCompanyId, loadingCompanies } = useFattureCompany(gestionaleMode)
  const [mode, setMode] = useState('overdue')
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  const scadenziarioLead = gestionaleMode
    ? companyId
      ? `Scadenze ${companyLabel(companyId)}: scadute o in arrivo entro 7 giorni.`
      : 'Scegli la società dal menu per vedere le scadenze del registro corretto.'
    : companyId
      ? `Scadenze del registro locale ${companyLabel(companyId)}.`
      : 'Scadenze del registro locale di questa postazione.'

  async function load(filter = mode) {
    if (!companyId) {
      setInvoices([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const rows = await fetchInvoices({
        due_filter: filter,
        include_ignored: false,
        company: companyId,
      })
      setInvoices(Array.isArray(rows) ? rows : [])
    } catch (e) {
      setError(e?.message || 'Errore caricamento scadenziario')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(mode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, companyId])

  async function toggleIgnore(inv) {
    try {
      await setInvoiceIgnored(inv.id, !inv.ignored)
      setMsg(inv.ignored ? 'Ripristinata nello scadenziario' : 'Ignorata dallo scadenziario')
      await load(mode)
    } catch (e) {
      setError(e?.message || 'Errore aggiornamento')
    }
  }

  async function markPaid(inv) {
    try {
      await markInvoicePaid(inv.id)
      setMsg('Fattura segnata come pagata')
      await load(mode)
    } catch (e) {
      setError(e?.message || 'Errore saldo')
    }
  }

  return (
    <FatturePageShell
      title="Scadenziario fornitori"
      lead={scadenziarioLead}
      actions={
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {gestionaleMode ? (
            <FattureCompanySelect
              companies={[...companies, { id: 'non_classificata', label: 'Non classificate' }]}
              value={companyId}
              onChange={setCompanyId}
              loading={loadingCompanies}
            />
          ) : null}
          <button
            type="button"
            className={`btn btn-sm ${mode === 'overdue' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setMode('overdue')}
            disabled={!companyId}
          >
            Scadute
          </button>
          <button
            type="button"
            className={`btn btn-sm ${mode === 'due_soon' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setMode('due_soon')}
            disabled={!companyId}
          >
            In arrivo
          </button>
        </div>
      }
    >
      {loading && <AnalisiLoadingBar active label="Caricamento fatture" variant="subtle" />}
      {error && <div className="alert alert-danger">{error}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}
      {!companyId ? (
        <p className="fatture-note">
          {gestionaleMode
            ? 'Seleziona una società dal menu nel banner verde per vedere lo scadenziario.'
            : 'Registro locale non configurato per questa postazione.'}
        </p>
      ) : (
      <section className="card fatture-panel">
        <WorkbookGrid
          title={`Scadenziario · ${companyLabel(companyId)}`}
          sheetLabel={`${invoices.length} documenti`}
          hideToolbar
          loading={loading}
          gridClassName="fatture-excel-grid"
          columns={SCADENZIARIO_COLUMNS}
          rows={invoices}
          rowKey={(row) => row.id}
          cellValue={(row, col) => {
            if (col.id === 'due_date' || col.id === 'invoice_date') return formatDate(row[col.id])
            if (col.id === 'total') return eur(row.total)
            if (col.id === 'payment_status') return paymentStatusText(row.payment_status, row.ignored)
            return row[col.id] || '—'
          }}
          totals={
            invoices.length
              ? { count: invoices.length, total: sumField(invoices, 'total') }
              : null
          }
          totalsLabel={moneyTotalsLabel}
          emptyMessage={`Nessuna fattura in questa vista per ${companyLabel(companyId)}.`}
          actionsHeader="Azioni"
          actionsColWidth="8.75rem"
          renderActions={(inv) => (
            <FattureActionsMenu
              primary={
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => markPaid(inv)}
                  disabled={inv.payment_status === 'paid'}
                >
                  Pagata
                </button>
              }
              items={[
                {
                  key: 'ignore',
                  label: inv.ignored ? 'Ripristina' : 'Ignora',
                  onClick: () => toggleIgnore(inv),
                },
              ]}
            />
          )}
        />
      </section>
      )}
    </FatturePageShell>
  )
}

export function FattureSincronizzazionePage() {
  const fattureBase = React.useContext(FattureNavBaseContext)
  const gestionaleMode = isGestionaleFattureContext(fattureBase)
  const { companyId } = useFattureCompany(gestionaleMode)
  const [log, setLog] = useState(() => readSyncLog())
  const [status, setStatus] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const s = await fetchSdiStatus()
        if (!cancelled) setStatus(s)
      } catch {
        if (!cancelled) setStatus(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <FatturePageShell
      title="Sincronizzazione Agenzia Entrate"
      lead="Canale diretto SDI / Agenzia Entrate: import XML e ricezione push su /sdi/receive. Nessun intermediario Aruba."
    >
      <section className="card fatture-panel">
        <h2 className="fatture-panel-title">Stato canale</h2>
        <ul className="fatture-suggestions">
          <li>Canale: {status?.channel || 'agenzia_entrate_sdi'}</li>
          <li>
            Token ricezione ({'SDI_RECEIVE_TOKEN'}):{' '}
            {status?.receive_token_configured ? 'configurato' : 'non impostato (endpoint aperto in locale)'}
          </li>
          <li>Endpoint push: {status?.receive_endpoint || '/sdi/receive'}</li>
          <li>
            Per popolare l&apos;inbox: carica XML da Fatture e Corrispettivi / canale accreditato, oppure usa{' '}
            <FattureLink to="/fatture/importa-xml">Importa XML</FattureLink>.
          </li>
        </ul>
      </section>
      <section className="card fatture-panel">
        <h2 className="fatture-panel-title">AdE agent (automatico)</h2>
        <p style={{ marginTop: 0 }}>
          Scarico fatture ricevute da Agenzia delle Entrate e push su Atlas{' '}
          <code>/sdi/receive</code>. Per sync <strong>senza operatore</strong> usa{' '}
          <code>auth_mode: fisconline</code> (CF + password + PIN Fisconline nel profilo/.env).
          La chiavetta CNS richiede PIN Windows e non è automatizzabile.
        </p>
        <ul className="fatture-suggestions">
          <li>
            Install: <code>pip install -r backend/requirements-ade-agent.txt</code> poi{' '}
            <code>playwright install chrome</code>
          </li>
          <li>
            Script ufficio: <code>backend/scripts/run_ade_sync_ufficio.ps1</code>
            (Request/Download in <strong>headless</strong>, barra progresso + toast assistente)
          </li>
          <li>
            Automatico: <code>ADE_FISCONLINE_PASSWORD</code>, <code>ADE_FISCONLINE_PIN</code>, profilo con{' '}
            <code>auth_mode: fisconline</code>
          </li>
          <li>
            Task Scheduler sul PC agenzia (ogni 1–2 ore), senza chiavetta se usi Fisconline
          </li>
          <li>
            Piano B: <code>auth_mode: drop</code> + XML in <code>drop_dir</code> (import automatico)
          </li>
        </ul>
      </section>
      <AdeSdiInvoicesPanel
        title="Inbox SDI"
        showAssign={gestionaleMode && companyId === 'non_classificata'}
        autoLoad={Boolean(companyId)}
        companyId={companyId}
        embeddedMode={!gestionaleMode}
      />
      <section className="card fatture-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
          <h2 className="fatture-panel-title" style={{ margin: 0 }}>
            Storico sincronizzazioni (sessione)
          </h2>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLog(readSyncLog())}>
            Aggiorna log
          </button>
        </div>
        <ul className="fatture-suggestions" style={{ marginTop: '0.75rem' }}>
          {log.map((e) => (
            <li key={e.id}>
              {formatDate(e.at)} {e.at ? new Date(e.at).toLocaleTimeString('it-IT') : ''} —{' '}
              {e.ok ? 'OK' : 'ERRORE'}: {e.message}
            </li>
          ))}
          {log.length === 0 && <li>Nessuna sincronizzazione in questa sessione browser.</li>}
        </ul>
      </section>
    </FatturePageShell>
  )
}

export function FattureConservazionePage() {
  return (
    <FatturePageShell title="Conservazione digitale" lead="Archiviazione a norma (fase successiva).">
      <FattureStubCard
        title="In arrivo"
        points={[
          'Conservazione sostitutiva conforme',
          'Indice di ricerca e hash documenti',
          'Esportazione pacchetti di conservazione',
        ]}
      />
    </FatturePageShell>
  )
}



export function FattureImportXmlPage() {
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function onSubmit(e) {
    e.preventDefault()
    if (!file) {
      setError('Seleziona un file XML')
      return
    }
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const res = await importInvoiceXml(file)
      if (res?.duplicated) {
        setSuccess('Questa fattura era già in Atlas (stesso XML). Vedi Fatture ricevute.')
      } else {
        const inv = res?.incoming_invoice
        setSuccess(
          `Importata fattura n. ${inv?.invoice_number || '—'} · ${inv?.supplier_name || 'fornitore'} · ${eur(inv?.total_amount)}`,
        )
      }
      setFile(null)
    } catch (err) {
      setError(err?.message || 'Import fallito')
    } finally {
      setLoading(false)
    }
  }

  return (
    <FatturePageShell
      title="Importa XML"
      lead="Carica una FatturaPA XML in Atlas: crea/aggiorna fornitore per P.IVA e registra la fattura ricevuta."
      actions={
        <FattureLink className="btn btn-secondary btn-sm" to="/fatture/ricevute">
          Fatture ricevute
        </FattureLink>
      }
    >
      <section className="card fatture-panel">
        <form onSubmit={onSubmit}>
          <div className="form-group">
            <label>File XML</label>
            <input
              type="file"
              accept=".xml,application/xml,text/xml"
              className="form-control"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>
          {error && <div className="alert alert-danger">{error}</div>}
          {success && <div className="alert alert-success">{success}</div>}
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Import…' : 'Importa in Atlas'}
          </button>
        </form>
      </section>
    </FatturePageShell>
  )
}

export function FattureLogPage() {
  const log = useMemo(() => readSyncLog(), [])
  return (
    <FatturePageShell title="Log sincronizzazioni" lead="Storico aggiornamenti inbox SDI di questa sessione browser.">
      <section className="card fatture-panel">
        <ul className="fatture-suggestions">
          {log.map((e) => (
            <li key={e.id}>
              {e.at} — {e.ok ? 'OK' : 'ERRORE'}: {e.message}
            </li>
          ))}
          {log.length === 0 && <li>Nessun evento registrato. Esegui una sincronizzazione.</li>}
        </ul>
        <p className="fatture-note">In fase 2 i log saranno persistenti sul server.</p>
      </section>
    </FatturePageShell>
  )
}

export function FattureImpostazioniPage() {
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [drafts, setDrafts] = useState({})
  const [savingId, setSavingId] = useState('')

  async function loadProfiles() {
    setLoading(true)
    setError('')
    try {
      const res = await fetchAdeProfiles()
      const items = Array.isArray(res?.items) ? res.items : []
      setProfiles(items)
      setDrafts((prev) => {
        const next = { ...prev }
        for (const p of items) {
          if (!next[p.id]) next[p.id] = { password: '', pin: '' }
        }
        return next
      })
    } catch (e) {
      setError(e?.message || 'Errore caricamento profili AdE')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadProfiles()
  }, [])

  function setDraft(profileId, field, value) {
    setDrafts((prev) => ({
      ...prev,
      [profileId]: { ...(prev[profileId] || { password: '', pin: '' }), [field]: value },
    }))
  }

  async function saveCredentials(profileId) {
    const draft = drafts[profileId] || {}
    const password = String(draft.password || '').trim()
    const pin = String(draft.pin || '').trim()
    if (!password && !pin) {
      setError('Inserisci almeno la nuova password o il PIN')
      return
    }
    setSavingId(profileId)
    setError('')
    setSuccess('')
    try {
      await updateAdeFisconlineCredentials(profileId, {
        password: password || undefined,
        pin: pin || undefined,
      })
      setSuccess(`Credenziali Fisconline aggiornate per ${profileId}.`)
      setDrafts((prev) => ({ ...prev, [profileId]: { password: '', pin: '' } }))
      await loadProfiles()
    } catch (e) {
      setError(e?.message || 'Salvataggio credenziali fallito')
    } finally {
      setSavingId('')
    }
  }

  return (
    <FatturePageShell
      title="Impostazioni"
      lead="Aggiorna password e PIN Fisconline per le società: l’agent AdE userà queste credenziali al prossimo sync."
    >
      {loading && <AnalisiLoadingBar active label="Caricamento impostazioni" variant="subtle" />}
      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <section className="card fatture-panel">
        <h2 className="fatture-panel-title">Credenziali Fisconline (Agenzia Entrate)</h2>
        <p className="fatture-note" style={{ marginTop: 0 }}>
          Quando la password scade, aggiornala qui. Non viene mostrata in chiaro: vedi solo se è già configurata.
        </p>
        <div className="fatture-creds-grid">
          {profiles.map((p) => {
            const draft = drafts[p.id] || { password: '', pin: '' }
            const busy = savingId === p.id
            return (
              <article key={p.id} className="fatture-creds-card">
                <header className="fatture-creds-card-head">
                  <div>
                    <h3 className="fatture-creds-card-title">{p.label || p.id}</h3>
                    <p className="fatture-creds-card-meta">
                      {p.partita_iva ? `P.IVA ${p.partita_iva}` : 'P.IVA —'}
                      {p.codice_fiscale ? ` · CF ${p.codice_fiscale}` : ''}
                      {p.enabled ? '' : ' · disabilitato'}
                    </p>
                  </div>
                  <div className="fatture-creds-badges">
                    <span className={`fatture-creds-badge${p.password_set ? ' is-ok' : ''}`}>
                      {p.password_set ? 'Password ok' : 'Password mancante'}
                    </span>
                    <span className={`fatture-creds-badge${p.pin_set ? ' is-ok' : ''}`}>
                      {p.pin_set ? 'PIN ok' : 'PIN mancante'}
                    </span>
                  </div>
                </header>
                <div className="fatture-creds-fields">
                  <label className="form-group">
                    <span>Nuova password Fisconline</span>
                    <input
                      type="password"
                      className="form-control"
                      autoComplete="new-password"
                      placeholder={p.password_set ? '•••••••• (lascia vuoto per non cambiare)' : 'Inserisci password'}
                      value={draft.password}
                      onChange={(e) => setDraft(p.id, 'password', e.target.value)}
                    />
                  </label>
                  <label className="form-group">
                    <span>Nuovo PIN</span>
                    <input
                      type="password"
                      className="form-control"
                      autoComplete="new-password"
                      placeholder={p.pin_set ? '•••• (lascia vuoto per non cambiare)' : 'Inserisci PIN'}
                      value={draft.pin}
                      onChange={(e) => setDraft(p.id, 'pin', e.target.value)}
                    />
                  </label>
                </div>
                <div className="fatture-creds-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => void saveCredentials(p.id)}
                  >
                    {busy ? 'Salvataggio…' : 'Aggiorna credenziali'}
                  </button>
                </div>
              </article>
            )
          })}
          {!loading && profiles.length === 0 ? (
            <p className="empty-state">Nessun profilo AdE trovato (controlla ADE_PROFILES_PATH / profiles.json).</p>
          ) : null}
        </div>
      </section>

      <section className="card fatture-panel">
        <h2 className="fatture-panel-title">Canale tecnico</h2>
        <ul className="fatture-suggestions">
          <li>SDI_RECEIVE_TOKEN (opzionale su POST /sdi/receive)</li>
          <li>Endpoint: POST /sdi/receive · GET /sdi/invoices/received · PUT /ade/profiles/…/credentials</li>
          <li>Agent: backend/scripts/ade_sync_agent.py</li>
        </ul>
      </section>
    </FatturePageShell>
  )
}
