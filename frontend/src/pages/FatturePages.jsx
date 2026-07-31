import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
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
  fetchInvoices,
  fetchInvoicesAnalyticsSummary,
  fetchSdiReceivedInvoices,
  fetchSdiStatus,
  getSdiInvoiceDownloadUrl,
  markInvoicePaid,
  postSdiReceiveXml,
  setInvoiceIgnored,
} from '../services/invoicesService'

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
  return [...(rows.abba || []), ...(rows.zanardelli || []), ...(rows.non_classificata || [])]
}

export function AdeSdiInvoicesPanel({ title = 'Fatture ricevute (Agenzia Entrate / SDI)', showAssign = true, autoLoad = true }) {
  const [days, setDays] = useState('60')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [rows, setRows] = useState({ abba: [], zanardelli: [], non_classificata: [] })

  async function load(daysOverride) {
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const d = Number(daysOverride || days || 60)
      const data = await fetchSdiReceivedInvoices({ days: d })
      const next = {
        abba: Array.isArray(data?.abba) ? data.abba : [],
        zanardelli: Array.isArray(data?.zanardelli) ? data.zanardelli : [],
        non_classificata: Array.isArray(data?.non_classificata) ? data.non_classificata : [],
      }
      setRows(next)
      const count = flattenSdi(next).length
      pushSyncLog({ ok: true, days: d, count, message: `Caricate ${count} fatture SDI (ultimi ${d} gg)` })
      setSuccess(`Inbox aggiornata: ${count} documenti.`)
    } catch (e) {
      const msg = e?.message || 'Errore caricamento inbox SDI'
      pushSyncLog({ ok: false, days: Number(days), count: 0, message: msg })
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (autoLoad) load(60)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad])

  async function handleManualAssign(item, section) {
    try {
      await assignSdiInvoiceSection(item.id, section)
      setSuccess(`Assegnata a ${section === 'abba' ? 'Via Abba' : 'Via Zanardelli'}`)
      await load()
    } catch (e) {
      setError(e?.message || 'Errore assegnazione')
    }
  }

  function renderTable(list, label, withAssign = false) {
    return (
      <div className="table-wrap pn-table-wrap" style={{ marginBottom: '0.75rem' }}>
        <table className="app-table">
          <thead>
            <tr>
              <th colSpan={withAssign ? 6 : 5}>
                {label} ({list.length})
              </th>
            </tr>
            <tr>
              <th>Numero</th>
              <th>Data</th>
              <th>Fornitore</th>
              <th>Destinazione</th>
              <th>Azioni</th>
              {withAssign ? <th>Assegna</th> : null}
            </tr>
          </thead>
          <tbody>
            {list.map((item) => (
              <tr key={`${label}-${item.id}`}>
                <td>{item.invoice_number || '—'}</td>
                <td>{formatDate(item.invoice_date)}</td>
                <td>{item.supplier_name || '—'}</td>
                <td>{item.destination || '—'}</td>
                <td>
                  <a
                    className="btn btn-secondary"
                    style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem', textDecoration: 'none' }}
                    href={getSdiInvoiceDownloadUrl(item.id)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Scarica XML
                  </a>
                </td>
                {withAssign ? (
                  <td>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ marginRight: '0.35rem', padding: '0.35rem 0.6rem', fontSize: '0.85rem' }}
                      onClick={() => handleManualAssign(item, 'abba')}
                    >
                      Via Abba
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem' }}
                      onClick={() => handleManualAssign(item, 'zanardelli')}
                    >
                      Via Zanardelli
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={withAssign ? 6 : 5} className="empty-state">
                  Nessuna fattura in questo gruppo.
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
            {title}
          </h2>
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>
            Inbox locale da canale SDI / Agenzia Entrate. Classificazione dalla destinazione nell&apos;XML.
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
          <button type="button" className="btn btn-primary" onClick={() => load()} disabled={loading}>
            {loading ? 'Aggiornamento…' : 'Aggiorna inbox'}
          </button>
          <Link className="btn btn-secondary" to="/fatture/importa-xml">
            Importa XML
          </Link>
        </div>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}
      {renderTable(rows.abba, 'Via Abba')}
      {renderTable(rows.zanardelli, 'Via Zanardelli')}
      {renderTable(rows.non_classificata, 'Non classificate', showAssign)}
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
              <Link className="btn btn-secondary btn-sm" to="/fatture/ricevute">
                Fatture ricevute
              </Link>
              <Link className="btn btn-secondary btn-sm" to="/fatture/da-registrare">
                Da registrare
              </Link>
              <Link className="btn btn-secondary btn-sm" to="/fatture/scadenziario">
                Scadenziario
              </Link>
              <Link className="btn btn-secondary btn-sm" to="/fatture/sincronizzazione">
                Sincronizza
              </Link>
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
  return (
    <FatturePageShell
      title="Fatture ricevute"
      lead="Documenti SDI / Agenzia Entrate in inbox Atlas, classificati per destinazione."
    >
      <AdeSdiInvoicesPanel />
    </FatturePageShell>
  )
}

export function FattureDaRegistrarePage() {
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const rows = await fetchInvoices({ include_ignored: false })
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
  }, [])

  return (
    <FatturePageShell
      title="Da registrare"
      lead="Fatture in elenco senza movimento di Prima Nota collegato — da portare in contabilità."
    >
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
                    <Link className="btn btn-secondary btn-sm" to="/fatture/registrate">
                      Apri elenco
                    </Link>
                  </td>
                </tr>
              ))}
              {!loading && invoices.length === 0 && (
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
  const [mode, setMode] = useState('overdue')
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  async function load(filter = mode) {
    setLoading(true)
    setError('')
    try {
      const rows = await fetchInvoices({ due_filter: filter, include_ignored: false })
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
  }, [mode])

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
      lead="Fatture scadute o in scadenza entro 7 giorni."
      actions={
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button
            type="button"
            className={`btn btn-sm ${mode === 'overdue' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setMode('overdue')}
          >
            Scadute
          </button>
          <button
            type="button"
            className={`btn btn-sm ${mode === 'due_soon' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setMode('due_soon')}
          >
            In arrivo
          </button>
        </div>
      }
    >
      {loading && <AnalisiLoadingBar active label="Caricamento fatture" variant="subtle" />}
      {error && <div className="alert alert-danger">{error}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}
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
                    Nessuna fattura in questa vista.
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

export function FattureSincronizzazionePage() {
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
            <Link to="/fatture/importa-xml">Importa XML</Link>.
          </li>
        </ul>
      </section>
      <AdeSdiInvoicesPanel title="Inbox SDI" showAssign />
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
      await postSdiReceiveXml(file)
      setSuccess('XML inviato a /sdi/receive. Controlla le fatture ricevute / elenco.')
      setFile(null)
    } catch (err) {
      setError(err?.message || 'Import fallito')
    } finally {
      setLoading(false)
    }
  }

  return (
    <FatturePageShell title="Importa XML" lead="Carica un file FatturaPA XML (export AdE / canale SDI) nell’inbox Atlas.">
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
            {loading ? 'Invio…' : 'Importa XML'}
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
  return (
    <FatturePageShell title="Impostazioni" lead="Configurazione attuale via variabili ambiente backend (sola lettura).">
      <section className="card fatture-panel">
        <h2 className="fatture-panel-title">Variabili usate</h2>
        <ul className="fatture-suggestions">
          <li>SDI_RECEIVE_TOKEN (opzionale su POST /sdi/receive)</li>
          <li>SDI_DEST_ABBA_KEYWORDS / SDI_DEST_ZANARDELLI_KEYWORDS</li>
          <li>Endpoint: POST /sdi/receive · GET /sdi/invoices/received</li>
        </ul>
        <p className="fatture-note">La modifica da UI arriverà in una fase successiva; ora si configura nel .env del server.</p>
      </section>
      <FattureStubCard
        title="Evoluzione futura"
        points={[
          'Suggerimento centro di costo',
          'Fatture ricorrenti e anomalie',
          'Notifiche scadenze',
          'Confronto con ordini e DDT',
          'Classificazione spese con AI',
        ]}
      />
    </FatturePageShell>
  )
}
