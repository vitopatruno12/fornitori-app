import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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
  getIssuedInvoicePdfUrl,
  deleteIssuedInvoice,
  assignIssuedInvoiceCompany,
  reclassifyIssuedInvoices,
} from '../services/invoicesService'
import FattureCompanySelect from '../components/FattureCompanySelect.jsx'
import FattureScopeTools from '../components/FattureScopeTools.jsx'
import FattureActionsMenu from '../components/FattureActionsMenu.jsx'
import WorkbookGrid from '../components/WorkbookGrid.jsx'
import VneWorkbookGrid from '../components/VneWorkbookGrid.jsx'
import FattureSupplierDateFilters, {
  filterInvoicesBySupplierAndDate,
  supplierOptionsFromInvoices,
} from '../components/FattureSupplierDateFilters.jsx'
import {
  downloadVneTableCsv,
  downloadVneTableExcel,
  printVneTable,
} from '../utils/vneTableExport.js'
import { useFattureCompany } from '../hooks/useFattureCompany.js'
import { companyLabel, FATTURE_COMPANY_ORDER, isGestionaleFattureContext } from '../utils/fattureCompany.js'
import { fetchBancaRiconciliazione, postBancaRiconciliazioneAuto } from '../services/bancaService.js'
import {
  buildConservationPackage,
  createConservationPackage,
  deleteConservationPackage,
  fetchConservationCandidates,
  fetchConservationPackage,
  fetchConservationPackages,
  getConservationPackageDownloadUrl,
  setConservationPackageStatus,
} from '../services/conservationService.js'

const SYNC_LOG_KEY = 'fattureAdeSdiSyncLog'

const SDI_INVOICE_COLUMNS = [
  { id: 'invoice_number', label: 'Numero', width: 12, fluid: true },
  { id: 'invoice_date', label: 'Data', width: 12, fluid: true },
  { id: 'supplier_name', label: 'Fornitore', width: 28, fluid: true },
  { id: 'receiver_vat', label: 'P.IVA dest.', width: 16, fluid: true },
  { id: 'destination', label: 'Destinazione', width: 32, fluid: true },
]

const EMESSE_COLUMNS = [
  { id: 'created_at', label: 'Data carico', width: 12, fluid: true },
  { id: 'invoice_date', label: 'Data doc.', width: 12, fluid: true },
  { id: 'file_kind', label: 'Tipo', width: 8, fluid: true },
  { id: 'invoice_number', label: 'Numero', width: 12, fluid: true },
  { id: 'customer_name', label: 'Cliente', width: 24, fluid: true },
  { id: 'original_filename', label: 'File', width: 18, fluid: true },
  { id: 'total_amount', label: 'Importo', width: 12, fluid: true, numeric: true },
  { id: 'status', label: 'Stato', width: 10, fluid: true },
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

const PAGATE_FORNITORI_COLUMNS = [
  { id: 'supplier_name', label: 'Fornitore', width: 30, fluid: true, emphasis: true },
  { id: 'pagate_count', label: 'Pagate', width: 10, fluid: true, numeric: true },
  { id: 'da_pagare_count', label: 'Da pagare', width: 10, fluid: true, numeric: true },
  { id: 'total_paid', label: 'Totale pagato', width: 14, fluid: true, numeric: true },
  { id: 'total_open', label: 'Residuo', width: 14, fluid: true, numeric: true, emphasis: true },
  { id: 'last_date', label: 'Ultima data', width: 12, fluid: true },
]

const PAGATE_INVOICE_COLUMNS = [
  { id: 'invoice_date', label: 'Data', width: 11, fluid: true },
  { id: 'invoice_number', label: 'Numero', width: 12, fluid: true, emphasis: true },
  { id: 'total', label: 'Totale', width: 12, fluid: true, numeric: true },
  { id: 'amount_paid', label: 'Pagato', width: 12, fluid: true, numeric: true },
  { id: 'payment_label', label: 'Stato', width: 12, fluid: true },
  { id: 'bank_hit', label: 'Movimento banca', width: 24, fluid: true },
  { id: 'reason', label: 'Esito', width: 14, fluid: true },
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
  if (colId === 'pagate_count' || colId === 'da_pagare_count' || colId === 'invoice_count') {
    return totals?.count != null ? `${totals.count} forn.` : ''
  }
  if (colId === 'imponibile') return eur(totals?.imponibile)
  if (colId === 'vat_amount') return eur(totals?.vat_amount)
  if (
    colId === 'total'
    || colId === 'total_amount'
    || colId === 'total_paid'
    || colId === 'total_open'
    || colId === 'amount_paid'
  ) {
    if (colId === 'total_paid') return eur(totals?.total_paid ?? totals?.total)
    if (colId === 'total_open') return eur(totals?.total_open)
    return eur(totals?.total)
  }
  return ''
}

function matchReasonLabel(reason) {
  if (reason === 'numero_in_movimento') return 'N. in banca'
  if (reason === 'matched') return 'Riconciliata'
  if (reason === 'gia_pagata_in_atlas') return 'Pagata Atlas'
  if (reason === 'file_pagamenti') return 'File Pagamenti'
  if (reason === 'da_pagare') return 'Da pagare'
  return reason || '—'
}

function supplierPartyKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function invoiceIsPaidRow(row) {
  const reason = String(row?.match_reason || '')
  if (reason === 'da_pagare') return false
  if (
    reason === 'numero_in_movimento'
    || reason === 'matched'
    || reason === 'gia_pagata_in_atlas'
    || reason === 'file_pagamenti'
  ) {
    return true
  }
  const status = String(row?.payment_status || '').toLowerCase()
  if (status === 'paid') return true
  const residuo = Number(row?.residuo)
  if (Number.isFinite(residuo)) return residuo <= 0.009
  return Number(row?.amount_paid || 0) >= Number(row?.total || 0) - 0.009
}

function buildBankVerifySuppliers(paidRows, openRows) {
  const map = new Map()
  const all = [
    ...(Array.isArray(paidRows) ? paidRows : []).map((r) => ({ ...r, _bucket: 'paid' })),
    ...(Array.isArray(openRows) ? openRows : []).map((r) => ({ ...r, _bucket: 'open', match_reason: r.match_reason || 'da_pagare' })),
  ]
  for (const row of all) {
    const name = String(row?.supplier_name || '').trim() || 'Senza fornitore'
    const key = supplierPartyKey(name)
    let party = map.get(key)
    if (!party) {
      party = {
        id: key,
        supplier_name: name,
        invoices: [],
        invoice_count: 0,
        pagate_count: 0,
        da_pagare_count: 0,
        total_paid: 0,
        total_open: 0,
        last_date: '',
      }
      map.set(key, party)
    }
    const paid = row._bucket === 'paid' || invoiceIsPaidRow(row)
    party.invoices.push({
      ...row,
      payment_label: paid ? 'Pagata' : 'Da pagare',
    })
    party.invoice_count += 1
    if (paid) {
      party.pagate_count += 1
      party.total_paid += Number(row?.amount_paid ?? row?.total) || 0
    } else {
      party.da_pagare_count += 1
      party.total_open += Number(row?.residuo ?? row?.total) || 0
    }
    const d = String(row?.invoice_date || '').slice(0, 10)
    if (d && (!party.last_date || d > party.last_date)) party.last_date = d
  }
  return Array.from(map.values()).sort((a, b) => {
    if ((b.da_pagare_count || 0) !== (a.da_pagare_count || 0)) {
      return (b.da_pagare_count || 0) - (a.da_pagare_count || 0)
    }
    return a.supplier_name.localeCompare(b.supplier_name, 'it')
  })
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
  nameQuery = '',
  dateFrom = '',
  dateTo = '',
  refreshKey = 0,
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

  useEffect(() => {
    if (refreshKey > 0) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  async function handleManualAssign(item, section) {
    try {
      await assignSdiInvoiceSection(item.id, section)
      setSuccess(`Assegnata a ${companyLabel(section)}`)
      await load()
    } catch (e) {
      setError(e?.message || 'Errore assegnazione')
    }
  }

  const visibleList = filterInvoicesBySupplierAndDate(
    companyId ? sdiListForCompany(rows, companyId) : [],
    { supplierName: nameQuery, dateFrom, dateTo, nameFields: ['supplier_name'] },
  )
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
                Fatture da registrare
              </FattureLink>
              <FattureLink className="btn btn-secondary btn-sm" to="/fatture/pagate">
                Fatture pagate
              </FattureLink>
              <FattureLink className="btn btn-secondary btn-sm" to="/fatture/scadenziario">
                Scadenziario
              </FattureLink>
              <FattureLink className="btn btn-secondary btn-sm" to="/fatture/registrate">
                Storico fatture
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
  const [nameQuery, setNameQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sdiRefreshKey, setSdiRefreshKey] = useState(0)
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
      const res = await fetchIncomingInvoices(500)
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

  const filteredIncoming = useMemo(
    () =>
      filterInvoicesBySupplierAndDate(items, {
        supplierName: nameQuery,
        dateFrom,
        dateTo,
        nameFields: ['supplier_name', 'invoice_number'],
      }),
    [items, nameQuery, dateFrom, dateTo],
  )
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

      <section className="card fatture-panel" style={{ paddingBottom: '0.35rem' }}>
        <FattureSupplierDateFilters
          supplierInput="search"
          supplierLabel="Fornitore"
          supplierPlaceholder="Cerca fornitore…"
          supplierValue={nameQuery}
          onSupplierChange={setNameQuery}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
          onReset={() => {
            setNameQuery('')
            setDateFrom('')
            setDateTo('')
          }}
          onApply={() => {
            void reload()
            setSdiRefreshKey((n) => n + 1)
          }}
          applyDisabled={loading}
        />
      </section>

      <AdeSdiInvoicesPanel
        title="Inbox SDI"
        showAssign={gestionaleMode && companyId === 'non_classificata'}
        autoLoad={Boolean(companyId)}
        companyId={companyId}
        embeddedMode={!gestionaleMode}
        hideImportLink
        nameQuery={nameQuery}
        dateFrom={dateFrom}
        dateTo={dateTo}
        refreshKey={sdiRefreshKey}
      />

      {gestionaleMode && !companyId ? (
        <>
      <section className="card fatture-panel">
        <h2 className="fatture-panel-title">Elenco importate (tutte le società)</h2>
        <WorkbookGrid
          title="Elenco importate"
          sheetLabel={`${filteredIncoming.length} documenti`}
          hideToolbar
          gridClassName="fatture-excel-grid"
          columns={[
            { id: 'invoice_number', label: 'N.', width: 18, fluid: true },
            { id: 'supplier_name', label: 'Fornitore', width: 42, fluid: true },
            { id: 'invoice_date', label: 'Data', width: 18, fluid: true },
            { id: 'total_amount', label: 'Totale', width: 22, fluid: true, numeric: true, emphasis: true },
          ]}
          rows={filteredIncoming}
          rowKey={(row) => row.id}
          cellValue={(row, col) => {
            if (col.id === 'invoice_date') return formatDate(row.invoice_date)
            if (col.id === 'total_amount') return eur(row.total_amount)
            return row[col.id] || '—'
          }}
          totals={
            filteredIncoming.length
              ? { count: filteredIncoming.length, total: sumField(filteredIncoming, 'total_amount') }
              : null
          }
          totalsLabel={moneyTotalsLabel}
          emptyMessage="Nessuna fattura ricevuta con i filtri selezionati. Usa Importa XML o il canale SDI."
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
              <FattureLink to="/fatture/registrate">Storico fatture</FattureLink> (id {selected.atlas_invoice_id}).
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
  const [searchParams, setSearchParams] = useSearchParams()
  const [uploadKind, setUploadKind] = useState('pdf')
  const [importBusy, setImportBusy] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const [error, setError] = useState('')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [nameQuery, setNameQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [focusIssuedId, setFocusIssuedId] = useState('')
  const [focusIssuedNumber, setFocusIssuedNumber] = useState('')
  const [reclassifyBusy, setReclassifyBusy] = useState(false)
  const importInputRef = React.useRef(null)
  const focusAppliedRef = React.useRef('')

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
      const res = await fetchIssuedInvoices({ company: companyId, limit: 500 })
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

  // Deep-link da Mastrini: /fatture/emesse?id=&n=&company=&from=&to=&customer=
  useEffect(() => {
    const qId = String(searchParams.get('id') || '').trim()
    const qNum = String(searchParams.get('n') || '').trim()
    const qCompany = String(searchParams.get('company') || '').trim()
    const qDate = String(searchParams.get('date') || '').trim().slice(0, 10)
    const qFrom = String(searchParams.get('from') || qDate || '').trim().slice(0, 10)
    const qTo = String(searchParams.get('to') || qDate || '').trim().slice(0, 10)
    const qCustomer = String(searchParams.get('customer') || '').trim()

    if (!qId && !qNum && !qCompany && !qFrom && !qTo && !qCustomer) return

    const key = `id:${qId}|n:${qNum}|c:${qCompany}|f:${qFrom}|t:${qTo}|cu:${qCustomer}`
    if (focusAppliedRef.current === key) return
    focusAppliedRef.current = key

    if (qCompany && gestionaleMode && companyId !== qCompany) {
      setCompanyId(qCompany)
    }
    if (qFrom) setDateFrom(qFrom)
    if (qTo) setDateTo(qTo)
    if (qNum) setNameQuery(qNum)
    else if (qCustomer) setNameQuery(qCustomer)

    if (qId) setFocusIssuedId(qId)
    if (qNum) setFocusIssuedNumber(qNum)

    const cleaned = new URLSearchParams()
    if (qId) cleaned.set('id', qId)
    if (qNum) cleaned.set('n', qNum)
    setSearchParams(cleaned, { replace: true })
  }, [searchParams, gestionaleMode, companyId, setCompanyId, setSearchParams])

  const filteredIssued = useMemo(
    () =>
      filterInvoicesBySupplierAndDate(items, {
        supplierName: nameQuery,
        dateFrom,
        dateTo,
        nameFields: ['customer_name', 'original_filename', 'invoice_number'],
        dateField: 'invoice_date',
      }),
    [items, nameQuery, dateFrom, dateTo],
  )

  function rowMatchesFocus(row) {
    if (!row) return false
    if (focusIssuedId && String(row.id) === String(focusIssuedId)) return true
    if (focusIssuedNumber) {
      const norm = focusIssuedNumber.toLowerCase()
      return String(row.invoice_number || '')
        .trim()
        .toLowerCase() === norm
    }
    return false
  }

  useEffect(() => {
    if (loading) return
    if (!focusIssuedId && !focusIssuedNumber) return
    const match = filteredIssued.find((row) => rowMatchesFocus(row))
    if (!match?.id) return
    const t = window.setTimeout(() => {
      document.getElementById(`issued-row-${match.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 120)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, filteredIssued, focusIssuedId, focusIssuedNumber])

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
        row?.company && row.company !== companyId
          ? `spostata in ${companyLabel(row.company)}`
          : null,
      ].filter(Boolean)
      setImportMsg(bits.join(' · '))
      if (warns.length) {
        setError(warns.join(' · '))
      }
      if (row?.company && row.company !== companyId && gestionaleMode) {
        setCompanyId(row.company)
      } else {
        await reload()
      }
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

  async function handleAssignCompany(row, targetCompany) {
    if (!row?.id || !targetCompany) return
    try {
      await assignIssuedInvoiceCompany(row.id, targetCompany)
      setImportMsg(`Fattura n. ${row.invoice_number || row.id} → ${companyLabel(targetCompany)}`)
      setError('')
      if (targetCompany !== companyId) {
        setItems((prev) => prev.filter((r) => r.id !== row.id))
      } else {
        await reload()
      }
    } catch (e) {
      setError(e?.message || 'Assegnazione fallita')
    }
  }

  async function handleReclassifyMediazione() {
    if (
      !window.confirm(
        'Riallinea le fatture emesse già caricate: le Mediazione con sede Zanardelli/Abba nel file o nel nome vanno in Mediazione Z o A. Continuare?',
      )
    ) {
      return
    }
    setReclassifyBusy(true)
    setError('')
    setImportMsg('')
    try {
      const res = await reclassifyIssuedInvoices({ dryRun: false })
      const moved = Number(res?.reclassified || 0)
      const by = res?.by_company && typeof res.by_company === 'object' ? res.by_company : {}
      const bits = Object.entries(by)
        .map(([cid, n]) => `${companyLabel(cid)}: ${n}`)
        .join(' · ')
      setImportMsg(
        moved
          ? `Separate ${moved} fatture emesse.${bits ? ` ${bits}` : ''}`
          : 'Nessuna fattura da spostare (già classificate o senza hint A/Z nel file). Usa «Sposta a…» sulle singole righe.',
      )
      await reload()
    } catch (e) {
      setError(e?.message || 'Riallineamento fallito')
    } finally {
      setReclassifyBusy(false)
    }
  }

  return (
    <FatturePageShell
      title="Fatture emesse"
      lead={
        gestionaleMode
          ? 'Fatture attive / emesse per società. Mediazione A e Z sono separate: scegli la società nel banner o usa «Separa A/Z».'
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
            {gestionaleMode ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={reclassifyBusy || importBusy}
                onClick={() => void handleReclassifyMediazione()}
                title="Sposta le emesse Mediazione con hint Zanardelli/Abba sotto Z o A"
              >
                {reclassifyBusy ? 'Separazione…' : 'Separa A/Z'}
              </button>
            ) : null}
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
          <FattureSupplierDateFilters
            supplierInput="search"
            supplierLabel="Cliente"
            supplierPlaceholder="Cerca cliente o file…"
            supplierValue={nameQuery}
            onSupplierChange={setNameQuery}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
            onReset={() => {
              setNameQuery('')
              setDateFrom('')
              setDateTo('')
              setFocusIssuedId('')
              setFocusIssuedNumber('')
              focusAppliedRef.current = ''
              setSearchParams({}, { replace: true })
            }}
            onApply={() => void reload()}
            applyDisabled={loading || !companyId}
          />
          <WorkbookGrid
            title={`Emesse · ${companyLabel(companyId)}`}
            sheetLabel={`${filteredIssued.length} documenti`}
            hideToolbar
            loading={loading}
            loadingLabel="Caricamento fatture emesse"
            gridClassName="fatture-excel-grid"
            columns={EMESSE_COLUMNS}
            rows={filteredIssued}
            rowKey={(row) => `emessa-${row.id}`}
            getRowId={(row) => `issued-row-${row.id}`}
            getRowClassName={(row) => (rowMatchesFocus(row) ? 'workbook-row-focus-purple' : '')}
            cellValue={(row, col) => {
              if (col.id === 'created_at' || col.id === 'invoice_date') return formatDate(row[col.id] || (col.id === 'created_at' ? row.invoice_date : ''))
              if (col.id === 'file_kind') return kindLabel[row.file_kind] || row.file_kind || '—'
              if (col.id === 'total_amount') return row.total_amount != null ? eur(row.total_amount) : '—'
              return row[col.id] || '—'
            }}
            totals={
              filteredIssued.length
                ? { count: filteredIssued.length, total: sumField(filteredIssued, 'total_amount') }
                : null
            }
            totalsLabel={moneyTotalsLabel}
            emptyMessage={`Nessuna fattura emessa per ${companyLabel(companyId)} con i filtri selezionati. Scegli PDF o Immagine (o XML) e carica dal banner.`}
            actionsHeader="Azioni"
            actionsColWidth="8.75rem"
            renderActions={(row) => {
              const isXml = String(row.file_kind || '').toLowerCase() === 'xml'
              const openUrl = isXml ? getIssuedInvoicePdfUrl(row.id) : getIssuedInvoiceFileUrl(row.id)
              const assignItems = gestionaleMode
                ? FATTURE_COMPANY_ORDER.filter((cid) => cid !== (row.company || companyId)).map((cid) => ({
                    key: `assign-${cid}`,
                    label: `Sposta a ${companyLabel(cid)}`,
                    onClick: () => void handleAssignCompany(row, cid),
                  }))
                : []
              return (
                <FattureActionsMenu
                  primary={
                    <a
                      className="btn btn-primary btn-sm"
                      href={openUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={isXml ? 'Genera e apri anteprima PDF da XML FatturaPA' : 'Apri documento'}
                    >
                      {isXml ? 'Apri PDF' : 'Apri'}
                    </a>
                  }
                  items={[
                    ...(isXml
                      ? [
                          {
                            key: 'xml',
                            label: 'Scarica XML',
                            href: getIssuedInvoiceFileUrl(row.id),
                          },
                        ]
                      : []),
                    ...assignItems,
                    {
                      key: 'delete',
                      label: 'Elimina',
                      danger: true,
                      onClick: () => void handleDelete(row.id),
                    },
                  ]}
                />
              )
            }}
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
  const [draftSupplier, setDraftSupplier] = useState('')
  const [draftDateFrom, setDraftDateFrom] = useState('')
  const [draftDateTo, setDraftDateTo] = useState('')
  const [appliedSupplier, setAppliedSupplier] = useState('')
  const [appliedDateFrom, setAppliedDateFrom] = useState('')
  const [appliedDateTo, setAppliedDateTo] = useState('')

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
        const params = { include_ignored: false, sync_from_bank: true }
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

  function applyFilters() {
    setAppliedSupplier(draftSupplier)
    setAppliedDateFrom(draftDateFrom)
    setAppliedDateTo(draftDateTo)
  }

  function resetFilters() {
    setDraftSupplier('')
    setDraftDateFrom('')
    setDraftDateTo('')
    setAppliedSupplier('')
    setAppliedDateFrom('')
    setAppliedDateTo('')
  }

  const supplierOptions = useMemo(() => supplierOptionsFromInvoices(invoices), [invoices])
  const filteredInvoices = useMemo(
    () =>
      filterInvoicesBySupplierAndDate(invoices, {
        supplierId: appliedSupplier,
        dateFrom: appliedDateFrom,
        dateTo: appliedDateTo,
      }),
    [invoices, appliedSupplier, appliedDateFrom, appliedDateTo],
  )

  return (
    <FatturePageShell
      title="Fatture da registrare"
      lead="Fatture senza movimento di Prima Nota. Imposta fornitore/periodo e premi Aggiorna; poi stampa o esporta."
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
      {error && <div className="alert alert-danger">{error}</div>}
      <section className="card fatture-panel">
        {scopeReady ? (
          <FattureSupplierDateFilters
            supplierMode="id"
            supplierOptions={supplierOptions}
            supplierValue={draftSupplier}
            onSupplierChange={setDraftSupplier}
            dateFrom={draftDateFrom}
            dateTo={draftDateTo}
            onDateFromChange={setDraftDateFrom}
            onDateToChange={setDraftDateTo}
            onReset={resetFilters}
            onApply={applyFilters}
            applyDisabled={loading}
          />
        ) : null}
        <VneWorkbookGrid
          title="Fatture da registrare"
          sheetLabel={`${filteredInvoices.length} documenti`}
          exportSubtitle={
            [
              appliedSupplier
                ? supplierOptions.find((s) => String(s.supplier_id) === String(appliedSupplier))?.supplier_name
                : null,
              appliedDateFrom || appliedDateTo ? `${appliedDateFrom || '…'} → ${appliedDateTo || '…'}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'Elenco completo'
          }
          loading={loading}
          loadingLabel="Caricamento fatture"
          gridClassName="fatture-excel-grid"
          columns={DA_REGISTRARE_COLUMNS}
          rows={scopeReady ? filteredInvoices : []}
          rowKey={(row) => row.id}
          cellValue={(row, col) => {
            if (col.id === 'invoice_date' || col.id === 'due_date') return formatDate(row[col.id])
            if (col.id === 'imponibile' || col.id === 'vat_amount' || col.id === 'total') return eur(row[col.id])
            if (col.id === 'payment_status') return paymentStatusText(row.payment_status, row.ignored)
            return row[col.id] || '—'
          }}
          totals={
            filteredInvoices.length
              ? {
                  count: filteredInvoices.length,
                  imponibile: sumField(filteredInvoices, 'imponibile'),
                  vat_amount: sumField(filteredInvoices, 'vat_amount'),
                  total: sumField(filteredInvoices, 'total'),
                }
              : null
          }
          totalsLabel={moneyTotalsLabel}
          emptyMessage="Nessuna fattura da registrare con i filtri selezionati."
          actionsHeader="Azioni"
          renderActions={(row) => {
            const params = new URLSearchParams()
            if (row?.supplier_id != null && row.supplier_id !== '') {
              params.set('supplier_id', String(row.supplier_id))
            } else if (row?.supplier_name) {
              params.set('supplier', String(row.supplier_name).trim())
            }
            if (companyId) params.set('company', String(companyId))
            const qs = params.toString()
            return (
              <FattureLink
                className="btn btn-secondary btn-sm"
                to={qs ? `/fatture/registrate?${qs}` : '/fatture/registrate'}
              >
                Apri storico
              </FattureLink>
            )
          }}
        />
      </section>
    </FatturePageShell>
  )
}

export function FatturePagatePage() {
  const { companies, companyId, setCompanyId, loadingCompanies } = useFattureCompany(true)
  const [paidRows, setPaidRows] = useState([])
  const [openRows, setOpenRows] = useState([])
  const [verifySummary, setVerifySummary] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [draftSupplier, setDraftSupplier] = useState('')
  const [draftDateFrom, setDraftDateFrom] = useState('')
  const [draftDateTo, setDraftDateTo] = useState('')
  const [appliedSupplier, setAppliedSupplier] = useState('')
  const [appliedDateFrom, setAppliedDateFrom] = useState('')
  const [appliedDateTo, setAppliedDateTo] = useState('')
  const [selectedSupplierKey, setSelectedSupplierKey] = useState('')

  async function reload(nextCompany = companyId, { auto = false } = {}) {
    if (!nextCompany) {
      setPaidRows([])
      setOpenRows([])
      setVerifySummary('')
      setSelectedSupplierKey('')
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    setVerifySummary('')
    try {
      const res = auto
        ? await postBancaRiconciliazioneAuto(nextCompany)
        : await fetchBancaRiconciliazione(nextCompany)
      const paid = Array.isArray(res?.paid_by_bank) ? res.paid_by_bank : []
      const open = Array.isArray(res?.da_pagare) ? res.da_pagare : []
      setPaidRows(paid)
      setOpenRows(open)
      const marked = Number(res?.bank_sync?.marked_paid ?? res?.auto_applied) || 0
      const fromFile = Number(res?.bank_sync?.marked_from_pagamenti) || 0
      const fileRows = Number(res?.bank_sync?.pagamenti_paid_rows) || 0
      const accounts = Number(
        res?.bank_sync?.accounts_checked
        ?? res?.accounts_used?.length
        ?? res?.accounts?.length,
      ) || 0
      setVerifySummary(
        `Verifica: ${accounts || '—'} c/c · file Pagamenti ${fileRows} righe pagate · ${paid.length} pagate · ${open.length} da pagare`
        + (marked ? ` · ${marked} aggiornate ora` : '')
        + (fromFile ? ` (di cui ${fromFile} da file Pagamenti)` : ''),
      )
      setSelectedSupplierKey((prev) => {
        if (!prev) return ''
        const still = buildBankVerifySuppliers(paid, open).some((s) => s.id === prev)
        return still ? prev : ''
      })
    } catch (e) {
      setError(e?.message || 'Errore verifica pagamenti da banca')
      setPaidRows([])
      setOpenRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload(companyId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  function applyFilters() {
    const name = String(draftSupplier || '').trim()
    setAppliedSupplier(name)
    setAppliedDateFrom(draftDateFrom)
    setAppliedDateTo(draftDateTo)
    // Se scelgo un fornitore nel menu, apro subito la sua scheda
    setSelectedSupplierKey(name ? supplierPartyKey(name) : '')
  }

  function resetFilters() {
    setDraftSupplier('')
    setDraftDateFrom('')
    setDraftDateTo('')
    setAppliedSupplier('')
    setAppliedDateFrom('')
    setAppliedDateTo('')
    setSelectedSupplierKey('')
  }

  function backToSupplierList() {
    resetFilters()
  }

  function openSupplierDetail(row) {
    const name = String(row?.supplier_name || '').trim()
    setSelectedSupplierKey(row.id)
    if (name) {
      setDraftSupplier(name)
      setAppliedSupplier(name)
    }
  }

  const filteredPaidRows = useMemo(
    () =>
      filterInvoicesBySupplierAndDate(paidRows, {
        supplierName: appliedSupplier,
        dateFrom: appliedDateFrom,
        dateTo: appliedDateTo,
      }),
    [paidRows, appliedSupplier, appliedDateFrom, appliedDateTo],
  )

  const filteredOpenRows = useMemo(
    () =>
      filterInvoicesBySupplierAndDate(openRows, {
        supplierName: appliedSupplier,
        dateFrom: appliedDateFrom,
        dateTo: appliedDateTo,
      }),
    [openRows, appliedSupplier, appliedDateFrom, appliedDateTo],
  )

  const supplierOptions = useMemo(
    () => supplierOptionsFromInvoices([...paidRows, ...openRows]),
    [paidRows, openRows],
  )
  const suppliers = useMemo(
    () => buildBankVerifySuppliers(filteredPaidRows, filteredOpenRows),
    [filteredPaidRows, filteredOpenRows],
  )
  const selectedSupplier = useMemo(
    () => suppliers.find((s) => s.id === selectedSupplierKey) || null,
    [suppliers, selectedSupplierKey],
  )

  const supplierTotals = useMemo(
    () => ({
      count: suppliers.length,
      total_paid: suppliers.reduce((acc, s) => acc + (Number(s.total_paid) || 0), 0),
      total_open: suppliers.reduce((acc, s) => acc + (Number(s.total_open) || 0), 0),
      total: suppliers.reduce((acc, s) => acc + (Number(s.total_paid) || 0) + (Number(s.total_open) || 0), 0),
    }),
    [suppliers],
  )

  const invoiceTotals = useMemo(() => {
    const rows = selectedSupplier?.invoices || []
    return {
      count: rows.length,
      total: rows.reduce((acc, r) => acc + (Number(r.total) || 0), 0),
      total_paid: rows.reduce(
        (acc, r) => acc + (Number(r.amount_paid ?? (invoiceIsPaidRow(r) ? r.total : 0)) || 0),
        0,
      ),
    }
  }, [selectedSupplier])

  function supplierCellValue(row, col) {
    if (col.id === 'supplier_name') return row.supplier_name || '—'
    if (col.id === 'pagate_count') return String(row.pagate_count || 0)
    if (col.id === 'da_pagare_count') return String(row.da_pagare_count || 0)
    if (col.id === 'invoice_count') return String(row.invoice_count || 0)
    if (col.id === 'total_paid') return eur(row.total_paid)
    if (col.id === 'total_open') return eur(row.total_open)
    if (col.id === 'last_date') return formatDate(row.last_date)
    return ''
  }

  function invoiceCellValue(row, col) {
    if (col.id === 'invoice_date') return formatDate(row.invoice_date)
    if (col.id === 'invoice_number') return row.invoice_number || '—'
    if (col.id === 'supplier_name') return row.supplier_name || '—'
    if (col.id === 'total') return eur(row.total)
    if (col.id === 'amount_paid') return eur(row.amount_paid ?? (invoiceIsPaidRow(row) ? row.total : 0))
    if (col.id === 'payment_label') return row.payment_label || (invoiceIsPaidRow(row) ? 'Pagata' : 'Da pagare')
    if (col.id === 'bank_hit') {
      const m = row.matched_movement
      if (!m) return invoiceIsPaidRow(row) ? '—' : 'Nessun bonifico'
      return [formatDate(m.movement_date), m.description || m.causale || `BA-${m.id}`].filter(Boolean).join(' · ')
    }
    if (col.id === 'reason') return matchReasonLabel(row.match_reason)
    return ''
  }

  const companyName = companyId ? companyLabel(companyId) : ''
  const filterSubtitle = [
    appliedSupplier || null,
    appliedDateFrom || appliedDateTo ? `${appliedDateFrom || '…'} → ${appliedDateTo || '…'}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <FatturePageShell
      title="Fatture pagate"
      lead={
        companyId
          ? `Verifica bonifici sui conti collegati e file Pagamenti · ${companyName}. Segna pagata se n. fattura in banca o in PAGATO/DATA PAGAMENTO.`
          : 'Scegli la società nel banner per verificare le fatture ricevute su conti e file Pagamenti.'
      }
      actions={
        <div className="mastrini-hero-tools" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <FattureCompanySelect
            className="mastrini-hero-tools-company"
            companies={[...companies, { id: 'non_classificata', label: 'Non classificate' }]}
            value={companyId}
            onChange={setCompanyId}
            loading={loadingCompanies}
            disabled={loadingCompanies}
          />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => reload(companyId, { auto: true })}
            disabled={loading || !companyId}
          >
            {loading ? 'Verifico…' : 'Verifica con banca'}
          </button>
        </div>
      }
    >
      {!companyId ? (
        <div className="alert alert-info">Seleziona una società per verificare i pagamenti da banca.</div>
      ) : null}
      {error ? <div className="alert alert-danger">{error}</div> : null}
      {verifySummary && !error ? <div className="alert alert-info">{verifySummary}</div> : null}

      {companyId ? (
        <section className="card fatture-panel">
          <FattureSupplierDateFilters
            supplierMode="name"
            supplierOptions={supplierOptions}
            supplierValue={draftSupplier}
            onSupplierChange={setDraftSupplier}
            dateFrom={draftDateFrom}
            dateTo={draftDateTo}
            onDateFromChange={setDraftDateFrom}
            onDateToChange={setDraftDateTo}
            onReset={resetFilters}
            onApply={applyFilters}
            applyDisabled={loading}
          />

          {!selectedSupplier ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <div>
                  <h2 className="fatture-panel-title" style={{ margin: 0 }}>
                    Per fornitore
                  </h2>
                  <p className="fatture-note" style={{ margin: '0.35rem 0 0' }}>
                    {filterSubtitle
                      ? `Filtro attivo: ${filterSubtitle}. Clicca un fornitore per l'elenco fatture.`
                      : 'Dopo la verifica: pagate (bonifico o file Pagamenti) e da pagare (nessun match).'}
                  </p>
                </div>
                {appliedSupplier || appliedDateFrom || appliedDateTo ? (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={backToSupplierList}>
                    ← Torna all&apos;elenco
                  </button>
                ) : null}
              </div>
              <VneWorkbookGrid
                title="Fornitori — verifica banca"
                sheetLabel={`${suppliers.length} fornitori`}
                exportSubtitle={[companyName, filterSubtitle || 'Tutti i periodi'].filter(Boolean).join(' · ')}
                loading={loading}
                loadingLabel="Verifica bonifici sui conti collegati"
                gridClassName="fatture-excel-grid"
                columns={PAGATE_FORNITORI_COLUMNS}
                rows={suppliers}
                rowKey={(row) => row.id}
                cellValue={supplierCellValue}
                totals={suppliers.length ? supplierTotals : null}
                totalsLabel={moneyTotalsLabel}
                emptyMessage="Nessuna fattura ricevuta per i filtri. Premi Verifica con banca dopo aver sincronizzato i conti."
                onRowClick={(row) => openSupplierDetail(row)}
                rowClickTitle="Apri fatture del fornitore (pagate e da pagare)"
                actionsHeader="Azioni"
                renderActions={(row) => (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      openSupplierDetail(row)
                    }}
                  >
                    Scheda
                  </button>
                )}
              />
            </>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                <div>
                  <h2 className="fatture-panel-title" style={{ margin: 0 }}>
                    {selectedSupplier.supplier_name}
                  </h2>
                  <p className="fatture-note" style={{ margin: '0.35rem 0 0' }}>
                    {selectedSupplier.pagate_count || 0} pagate · {selectedSupplier.da_pagare_count || 0} da pagare
                    {' · '}Totale pagato {eur(selectedSupplier.total_paid)}
                    {' · '}Residuo {eur(selectedSupplier.total_open)}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={loading || !(selectedSupplier.invoices || []).length}
                    title="Apre la stampa: da lì puoi salvare come PDF"
                    onClick={() => {
                      try {
                        printVneTable({
                          title: `Verifica pagamenti — ${selectedSupplier.supplier_name}`,
                          subtitle: [companyName, selectedSupplier.supplier_name, filterSubtitle]
                            .filter(Boolean)
                            .join(' · '),
                          columns: PAGATE_INVOICE_COLUMNS,
                          rows: selectedSupplier.invoices,
                          cellValue: invoiceCellValue,
                          totalsLabel: moneyTotalsLabel,
                          totals: selectedSupplier.invoices.length ? invoiceTotals : null,
                        })
                      } catch (err) {
                        window.alert(err?.message || 'Stampa non riuscita')
                      }
                    }}
                  >
                    Stampa / PDF
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={loading || !(selectedSupplier.invoices || []).length}
                    onClick={() => {
                      try {
                        downloadVneTableExcel({
                          title: `Verifica pagamenti — ${selectedSupplier.supplier_name}`,
                          columns: PAGATE_INVOICE_COLUMNS,
                          rows: selectedSupplier.invoices,
                          cellValue: invoiceCellValue,
                          totalsLabel: moneyTotalsLabel,
                          totals: selectedSupplier.invoices.length ? invoiceTotals : null,
                          sheetName: 'Verifica pagamenti',
                        })
                      } catch (err) {
                        window.alert(err?.message || 'Export Excel non riuscito')
                      }
                    }}
                  >
                    Scarica Excel
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={loading || !(selectedSupplier.invoices || []).length}
                    onClick={() => {
                      try {
                        downloadVneTableCsv({
                          title: `Verifica pagamenti — ${selectedSupplier.supplier_name}`,
                          columns: PAGATE_INVOICE_COLUMNS,
                          rows: selectedSupplier.invoices,
                          cellValue: invoiceCellValue,
                          totalsLabel: moneyTotalsLabel,
                          totals: selectedSupplier.invoices.length ? invoiceTotals : null,
                        })
                      } catch (err) {
                        window.alert(err?.message || 'Export CSV non riuscito')
                      }
                    }}
                  >
                    Scarica CSV
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={backToSupplierList}>
                    ← Torna all&apos;elenco
                  </button>
                </div>
              </div>
              <VneWorkbookGrid
                title={`Verifica pagamenti — ${selectedSupplier.supplier_name}`}
                sheetLabel={`${selectedSupplier.invoices.length} documenti`}
                exportSubtitle={[companyName, selectedSupplier.supplier_name, filterSubtitle].filter(Boolean).join(' · ')}
                exportEnabled
                loading={loading}
                loadingLabel="Aggiornamento scheda"
                gridClassName="fatture-excel-grid"
                columns={PAGATE_INVOICE_COLUMNS}
                rows={selectedSupplier.invoices}
                rowKey={(row, idx) => `${row.invoice_id || row.invoice_number || 'inv'}-${idx}`}
                cellValue={invoiceCellValue}
                totals={selectedSupplier.invoices.length ? invoiceTotals : null}
                totalsLabel={moneyTotalsLabel}
                emptyMessage="Nessuna fattura per questo fornitore."
              />
            </>
          )}
        </section>
      ) : null}
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
        sync_from_bank: true,
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
  const { companies, companyId, setCompanyId, loadingCompanies } = useFattureCompany(true)
  const [periodFrom, setPeriodFrom] = useState('')
  const [periodTo, setPeriodTo] = useState('')
  const [candidates, setCandidates] = useState([])
  const [selectedKeys, setSelectedKeys] = useState(() => new Set())
  const [packages, setPackages] = useState([])
  const [selectedPkg, setSelectedPkg] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  async function loadPackages(nextCompany = companyId) {
    if (!nextCompany) {
      setPackages([])
      return
    }
    const res = await fetchConservationPackages({ company: nextCompany })
    setPackages(Array.isArray(res?.items) ? res.items : [])
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setError('')
      try {
        if (!cancelled) await loadPackages(companyId)
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Errore caricamento pacchetti')
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  async function loadCandidates() {
    if (!companyId) {
      setError('Seleziona una società')
      return
    }
    setLoading(true)
    setError('')
    setMsg('')
    try {
      const res = await fetchConservationCandidates({
        company: companyId,
        periodFrom,
        periodTo,
        includeIssued: true,
      })
      const items = Array.isArray(res?.items) ? res.items : []
      setCandidates(items)
      setSelectedKeys(new Set(items.map((d) => d.selected_key)))
      setMsg(`${items.length} documenti candidati nel periodo`)
    } catch (e) {
      setError(e?.message || 'Errore caricamento candidati')
      setCandidates([])
    } finally {
      setLoading(false)
    }
  }

  function toggleKey(key) {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function createPackage() {
    if (!companyId) return
    if (selectedKeys.size === 0) {
      setError('Seleziona almeno un documento')
      return
    }
    setBusy(true)
    setError('')
    setMsg('')
    try {
      const pkg = await createConservationPackage({
        company: companyId,
        period_from: periodFrom || null,
        period_to: periodTo || null,
        document_keys: Array.from(selectedKeys),
        label: `Conservazione ${companyLabel(companyId)} ${periodFrom || '…'}→${periodTo || '…'}`,
      })
      setSelectedPkg(pkg)
      setMsg(`Pacchetto #${pkg.id} creato in bozza (${pkg.document_count} file)`)
      await loadPackages(companyId)
    } catch (e) {
      setError(e?.message || 'Creazione pacchetto fallita')
    } finally {
      setBusy(false)
    }
  }

  async function openPackage(id) {
    setBusy(true)
    setError('')
    try {
      const pkg = await fetchConservationPackage(id)
      setSelectedPkg(pkg)
    } catch (e) {
      setError(e?.message || 'Pacchetto non trovato')
    } finally {
      setBusy(false)
    }
  }

  async function buildSelected() {
    if (!selectedPkg?.id) return
    setBusy(true)
    setError('')
    try {
      const pkg = await buildConservationPackage(selectedPkg.id)
      setSelectedPkg(pkg)
      setMsg(`Pacchetto #${pkg.id} pronto · hash ${String(pkg.package_hash || '').slice(0, 12)}…`)
      await loadPackages(companyId)
    } catch (e) {
      setError(e?.message || 'Generazione pacchetto fallita')
    } finally {
      setBusy(false)
    }
  }

  async function advanceStatus(status) {
    if (!selectedPkg?.id) return
    setBusy(true)
    setError('')
    try {
      const pkg = await setConservationPackageStatus(selectedPkg.id, status)
      setSelectedPkg(pkg)
      setMsg(`Stato aggiornato: ${statusLabel(pkg.status)}`)
      await loadPackages(companyId)
    } catch (e) {
      setError(e?.message || 'Aggiornamento stato fallito')
    } finally {
      setBusy(false)
    }
  }

  async function removePackage(id) {
    if (!window.confirm(`Eliminare il pacchetto #${id}?`)) return
    setBusy(true)
    try {
      await deleteConservationPackage(id)
      if (selectedPkg?.id === id) setSelectedPkg(null)
      await loadPackages(companyId)
      setMsg(`Pacchetto #${id} eliminato`)
    } catch (e) {
      setError(e?.message || 'Eliminazione fallita')
    } finally {
      setBusy(false)
    }
  }

  const statusLabel = (s) =>
    ({
      bozza: 'Bozza',
      pronto: 'Pronto',
      esportato: 'Esportato',
      inviato_conservatore: 'Inviato al conservatore',
      conservato: 'Conservato',
      errore: 'Errore',
    })[s] || s

  return (
    <FatturePageShell
      title="Conservazione digitale"
      lead="Prepara pacchetti di conservazione sostitutiva (XML/PDF + indice + hash SHA-256). Poi scarica lo ZIP e invialo al conservatore accreditato."
      actions={
        <FattureCompanySelect
          className="mastrini-hero-tools-company"
          companies={companies}
          value={companyId}
          onChange={setCompanyId}
          loading={loadingCompanies}
          disabled={loadingCompanies}
        />
      }
    >
      {error ? <div className="alert alert-danger">{error}</div> : null}
      {msg ? <div className="alert alert-success">{msg}</div> : null}

      <section className="card fatture-panel">
        <h2 className="fatture-panel-title">1 · Seleziona documenti</h2>
        <p className="fatture-note">
          Scegli società, periodo e documenti (ricevute Atlas + emesse). Poi crea il pacchetto.
        </p>
        <div className="ui-toolbar-one" style={{ flexWrap: 'wrap', gap: '0.65rem', marginBottom: '0.85rem' }}>
          <div className="form-group">
            <label>Data da</label>
            <input type="date" className="form-control" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Data a</label>
            <input type="date" className="form-control" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} />
          </div>
          <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-end' }} onClick={() => void loadCandidates()} disabled={!companyId || loading}>
            {loading ? 'Carico…' : 'Aggiorna candidati'}
          </button>
          <button type="button" className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-end' }} onClick={() => void createPackage()} disabled={!companyId || busy || selectedKeys.size === 0}>
            Crea pacchetto
          </button>
        </div>

        {candidates.length === 0 ? (
          <p className="fatture-note">Nessun candidato caricato. Imposta il periodo e premi Aggiorna candidati.</p>
        ) : (
          <div className="table-wrap">
            <table className="app-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Tipo</th>
                  <th>Numero</th>
                  <th>Data</th>
                  <th>Soggetto</th>
                  <th>Importo</th>
                  <th>File</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((d) => (
                  <tr key={d.selected_key}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedKeys.has(d.selected_key)}
                        onChange={() => toggleKey(d.selected_key)}
                      />
                    </td>
                    <td>{d.source_kind === 'issued' ? 'Emessa' : 'Ricevuta'}</td>
                    <td>{d.invoice_number || '—'}</td>
                    <td>{formatDate(d.invoice_date)}</td>
                    <td>{d.supplier_name || '—'}</td>
                    <td>{d.total_amount != null ? eur(d.total_amount) : '—'}</td>
                    <td>
                      {[d.has_xml ? 'XML' : null, d.has_pdf ? 'PDF' : null].filter(Boolean).join(' + ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card fatture-panel">
        <h2 className="fatture-panel-title">2 · Pacchetti</h2>
        {packages.length === 0 ? (
          <p className="fatture-note">Nessun pacchetto per questa società.</p>
        ) : (
          <div className="table-wrap">
            <table className="app-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Etichetta</th>
                  <th>Periodo</th>
                  <th>Doc.</th>
                  <th>Stato</th>
                  <th>Azioni</th>
                </tr>
              </thead>
              <tbody>
                {packages.map((p) => (
                  <tr key={p.id} className={selectedPkg?.id === p.id ? 'workbook-row-selected' : ''}>
                    <td>{p.id}</td>
                    <td>{p.label || '—'}</td>
                    <td>
                      {formatDate(p.period_from)} → {formatDate(p.period_to)}
                    </td>
                    <td>{p.document_count}</td>
                    <td>{statusLabel(p.status)}</td>
                    <td style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void openPackage(p.id)}>
                        Apri
                      </button>
                      {p.status !== 'conservato' ? (
                        <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => void removePackage(p.id)}>
                          Elimina
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedPkg ? (
        <section className="card fatture-panel">
          <h2 className="fatture-panel-title">3 · Flusso pacchetto #{selectedPkg.id}</h2>
          <p className="fatture-note">
            Stato: <strong>{statusLabel(selectedPkg.status)}</strong>
            {selectedPkg.package_hash ? ` · SHA-256 ${selectedPkg.package_hash}` : ''}
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void buildSelected()}>
              Genera pacchetto (indice + ZIP)
            </button>
            {selectedPkg.package_path || selectedPkg.download_url ? (
              <a className="btn btn-secondary btn-sm" href={getConservationPackageDownloadUrl(selectedPkg.id)} target="_blank" rel="noreferrer">
                Scarica ZIP
              </a>
            ) : null}
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy || (selectedPkg.status !== 'esportato' && selectedPkg.status !== 'pronto')} onClick={() => void advanceStatus('inviato_conservatore')}>
              Segna inviato al conservatore
            </button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy || selectedPkg.status !== 'inviato_conservatore'} onClick={() => void advanceStatus('conservato')}>
              Segna conservato
            </button>
          </div>
          <div className="table-wrap">
            <table className="app-table">
              <thead>
                <tr>
                  <th>Ruolo</th>
                  <th>Numero</th>
                  <th>Soggetto</th>
                  <th>File</th>
                  <th>SHA-256</th>
                </tr>
              </thead>
              <tbody>
                {(selectedPkg.items || []).map((it) => (
                  <tr key={it.id}>
                    <td>{it.file_role}</td>
                    <td>{it.invoice_number || '—'}</td>
                    <td>{it.supplier_name || '—'}</td>
                    <td>{it.original_filename || '—'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{String(it.content_sha256 || '').slice(0, 16)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="fatture-note" style={{ marginTop: '0.75rem' }}>
            Nota legale: Atlas prepara il pacchetto (file + hash + indice). Per la conformità completa serve
            firma qualificata / invio a un <strong>conservatore accreditato</strong> AgID.
          </p>
        </section>
      ) : null}
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
  const [profilesPath, setProfilesPath] = useState('')
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
      setProfilesPath(String(res?.profiles_path || res?.resolved_path || ''))
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
            <p className="empty-state">
              Nessun profilo AdE trovato.
              {profilesPath ? (
                <>
                  {' '}
                  Path: <code>{profilesPath}</code>
                </>
              ) : (
                <> Controlla ADE_PROFILES_PATH o crea <code>backend/uploads/ade/profiles.json</code>.</>
              )}
            </p>
          ) : null}
        </div>
        {profilesPath && profiles.length > 0 ? (
          <p className="fatture-note" style={{ marginTop: '0.75rem' }}>
            File profili: <code>{profilesPath}</code>
          </p>
        ) : null}
      </section>

      <section className="card fatture-panel">
        <h2 className="fatture-panel-title">Canale tecnico</h2>
        <ul className="fatture-suggestions">
          <li>SDI_RECEIVE_TOKEN (opzionale su POST /sdi/receive)</li>
          <li>Endpoint: POST /sdi/receive · GET /sdi/invoices/received · PUT /ade/profiles/…/credentials</li>
          <li>Agent: backend/scripts/ade_sync_agent.py</li>
          {profilesPath ? <li>ADE profiles: {profilesPath}</li> : null}
        </ul>
      </section>
    </FatturePageShell>
  )
}
