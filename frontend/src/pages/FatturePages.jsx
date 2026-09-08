import React, { useEffect, useMemo, useState } from 'react'
import {
  FattureLink,
  FattureNavigate,
  FattureNavBaseContext,
  FatturePageShell,
  FattureStubCard,
  PaymentBadge,
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
} from '../services/invoicesService'
import FattureCompanySelect from '../components/FattureCompanySelect.jsx'
import FattureScopeTools from '../components/FattureScopeTools.jsx'
import { useFattureCompany } from '../hooks/useFattureCompany.js'
import { companyLabel, FATTURE_COMPANY_ORDER, isGestionaleFattureContext } from '../utils/fattureCompany.js'

const SYNC_LOG_KEY = 'fattureAdeSdiSyncLog'

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
      const next = {
        companies: {
          mediazione: Array.isArray(companies.mediazione) ? companies.mediazione : [],
          via_lattea: Array.isArray(companies.via_lattea) ? companies.via_lattea : [],
          risacca: Array.isArray(companies.risacca) ? companies.risacca : [],
          pg: Array.isArray(companies.pg) ? companies.pg : [],
        },
        non_classificata: Array.isArray(data?.non_classificata) ? data.non_classificata : [],
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
      <div className="table-wrap pn-table-wrap" style={{ marginBottom: '0.75rem' }}>
        <table className="app-table">
          <thead>
            <tr>
              <th>Numero</th>
              <th>Data</th>
              <th>Fornitore</th>
              <th>P.IVA dest.</th>
              <th>Destinazione</th>
              <th>Azioni</th>
              {withAssign ? <th>Assegna</th> : null}
            </tr>
          </thead>
          <tbody>
            {list.map((item) => (
              <tr key={`sdi-${item.id}`}>
                <td>{item.invoice_number || '—'}</td>
                <td>{formatDate(item.invoice_date)}</td>
                <td>{item.supplier_name || '—'}</td>
                <td>{item.receiver_vat || '—'}</td>
                <td>{item.destination || '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <a
                    className="btn btn-primary"
                    style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem', textDecoration: 'none', marginRight: '0.35rem' }}
                    href={getSdiInvoicePdfUrl(item.id)}
                    target="_blank"
                    rel="noreferrer"
                    title="Apri PDF (allegato FatturaPA o anteprima generata dall'XML)"
                  >
                    PDF
                  </a>
                  <a
                    className="btn btn-secondary"
                    style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem', textDecoration: 'none' }}
                    href={getSdiInvoiceDownloadUrl(item.id)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    XML
                  </a>
                </td>
                {withAssign ? (
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {FATTURE_COMPANY_ORDER.map((cid) => (
                      <button
                        key={cid}
                        type="button"
                        className="btn btn-secondary"
                        style={{ marginRight: '0.25rem', marginBottom: '0.25rem', padding: '0.35rem 0.6rem', fontSize: '0.8rem' }}
                        onClick={() => handleManualAssign(item, cid)}
                      >
                        {companyLabel(cid)}
                      </button>
                    ))}
                  </td>
                ) : null}
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={withAssign ? 7 : 6} className="empty-state">
                  {companyId
                    ? `Nessuna fattura per ${companyLabel(companyId)} in questo periodo.`
                    : 'Seleziona una società dal menu in alto.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
        <div className="table-wrap">
          <table className="app-table">
            <thead>
              <tr>
                <th>N.</th>
                <th>Fornitore</th>
                <th>Data</th>
                <th className="text-end">Totale</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr
                  key={row.id}
                  className={selectedId === row.id ? 'pn-row-click workbook-row-selected' : 'pn-row-click'}
                  onClick={() => setSelectedId(row.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <td>{row.invoice_number}</td>
                  <td>{row.supplier_name || '—'}</td>
                  <td>{formatDate(row.invoice_date)}</td>
                  <td className="text-end">{eur(row.total_amount)}</td>
                </tr>
              ))}
              {!loading && items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty-state">
                    Nessuna fattura ricevuta. Usa Importa XML o il canale SDI.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
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
  const [importBusy, setImportBusy] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const [error, setError] = useState('')
  const importInputRef = React.useRef(null)

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
          `Caricata n. ${inv?.invoice_number || '—'} · ${inv?.supplier_name || inv?.customer_name || 'documento'} · ${eur(inv?.total_amount)}`,
        )
      }
    } catch (e) {
      setError(e?.message || 'Caricamento XML fallito')
    } finally {
      setImportBusy(false)
    }
  }

  return (
    <FatturePageShell
      title="Fatture emesse"
      lead={
        gestionaleMode
          ? 'Fatture attive / emesse per società. Società e caricamento XML manuale nel banner verde.'
          : companyId
            ? `Fatture emesse del registro ${companyLabel(companyId)}.`
            : 'Fatture emesse del registro locale.'
      }
      actions={
        <aside className="mastrini-hero-tools fatture-hero-tools" aria-label="Società e caricamento XML">
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
              title="Carica una FatturaPA XML emessa in Atlas"
            >
              {importBusy ? 'Caricamento…' : 'Carica XML'}
            </button>
          </div>
          {importMsg ? <p className="fatture-hero-tools-msg">{importMsg}</p> : null}
        </aside>
      }
    >
      {error && <div className="alert alert-danger">{error}</div>}
      {!companyId ? (
        <div className="alert alert-info">
          Scegli la società nel banner verde, oppure usa <strong>Carica XML</strong> per inserire una fattura
          emessa manualmente.
        </div>
      ) : (
        <section className="card fatture-panel">
          <h2 className="fatture-panel-title">Emesse · {companyLabel(companyId)}</h2>
          <p className="fatture-note">
            Puoi caricare una FatturaPA XML dal banner verde. L’elenco da canale AdE / SDI attive sarà collegato
            qui.
          </p>
          <div className="table-wrap pn-table-wrap">
            <table className="app-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Numero</th>
                  <th>Cliente</th>
                  <th>Imponibile</th>
                  <th>IVA</th>
                  <th>Totale</th>
                  <th>Stato</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={7} className="empty-state">
                    Nessuna fattura emessa in archivio per {companyLabel(companyId)}. Usa «Carica XML» nel banner.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
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
        <div className="table-wrap pn-table-wrap">
          <table className="app-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Numero</th>
                <th>Fornitore</th>
                <th>Imponibile</th>
                <th>IVA</th>
                <th>Totale</th>
                <th>Scadenza</th>
                <th>Stato</th>
                <th>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td>{formatDate(inv.invoice_date)}</td>
                  <td>{inv.invoice_number}</td>
                  <td>{inv.supplier_name}</td>
                  <td>{eur(inv.imponibile)}</td>
                  <td>{eur(inv.vat_amount)}</td>
                  <td>{eur(inv.total)}</td>
                  <td>{formatDate(inv.due_date)}</td>
                  <td>
                    <PaymentBadge status={inv.payment_status} ignored={inv.ignored} />
                  </td>
                  <td>
                    <FattureLink className="btn btn-secondary btn-sm" to="/fatture/registrate">
                      Apri elenco
                    </FattureLink>
                  </td>
                </tr>
              ))}
              {!loading && scopeReady && invoices.length === 0 && (
                <tr>
                  <td colSpan={9} className="empty-state">
                    Nessuna fattura da registrare.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
        <div className="table-wrap pn-table-wrap">
          <table className="app-table">
            <thead>
              <tr>
                <th>Scadenza</th>
                <th>Data doc.</th>
                <th>Numero</th>
                <th>Fornitore</th>
                <th>Totale</th>
                <th>Stato</th>
                <th>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td>{formatDate(inv.due_date)}</td>
                  <td>{formatDate(inv.invoice_date)}</td>
                  <td>{inv.invoice_number}</td>
                  <td>{inv.supplier_name}</td>
                  <td>{eur(inv.total)}</td>
                  <td>
                    <PaymentBadge status={inv.payment_status} ignored={inv.ignored} />
                  </td>
                  <td style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => markPaid(inv)} disabled={inv.payment_status === 'paid'}>
                      Segna pagata
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => toggleIgnore(inv)}>
                      {inv.ignored ? 'Ripristina' : 'Ignora'}
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && invoices.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-state">
                    Nessuna fattura in questa vista per {companyLabel(companyId)}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
