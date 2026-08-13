import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AmministrazionePageShell,
  BancaPageShell,
  eur,
  formatDate,
} from '../components/BancaShared.jsx'
import { AnalisiLoadingBar } from '../components/AnalisiShared.jsx'
import {
  confirmBancaConnectOtp,
  connectBancaAccount,
  createBancaAccount,
  deleteBancaAccount,
  disconnectBancaAccount,
  fetchBancaAccounts,
  fetchBancaConnectProfile,
  fetchBancaDashboard,
  fetchBancaMovimenti,
  fetchBancaRiconciliazione,
  importBanMovements,
  postBancaRiconcilia,
  syncBancaAccount,
} from '../services/bancaService'
import { SeriesBars } from '../components/FattureShared.jsx'
import WorkbookGrid from '../components/WorkbookGrid.jsx'
import { parseBanFile } from '../utils/banFileParser'

const BANK_LAST_MOVEMENTS_COLUMNS = [
  { id: 'date', label: 'Data', width: 14, fluid: true },
  { id: 'description', label: 'Descrizione', width: 42, fluid: true, emphasis: true },
  { id: 'type', label: 'Tipo', width: 12, fluid: true },
  { id: 'amount', label: 'Importo', width: 16, fluid: true, numeric: true },
  { id: 'status', label: 'Stato', width: 16, fluid: true },
]

function bankLastMovementsCellValue(row, col) {
  if (col.id === 'date') return formatDate(row?.movement_date)
  if (col.id === 'description') return row?.description || '—'
  if (col.id === 'type') return row?.movement_type === 'entrata' ? 'Entrata' : 'Uscita'
  if (col.id === 'amount') return eur(row?.amount)
  if (col.id === 'status') return row?.reconciliation_status || '—'
  return ''
}

const BANK_ACCOUNTS_COLUMNS = [
  { id: 'bank', label: 'Banca', width: 28, fluid: true, emphasis: true },
  { id: 'iban', label: 'IBAN', width: 18, fluid: true, mono: true },
  { id: 'saldo_disponibile', label: 'Saldo disponibile', width: 14, fluid: true, numeric: true },
  { id: 'saldo_contabile', label: 'Saldo contabile', width: 14, fluid: true, numeric: true },
  { id: 'status', label: 'Stato', width: 12, fluid: true },
  { id: 'last_sync', label: 'Ultima sync', width: 14, fluid: true },
]

function bankAccountsCellValue(row, col) {
  if (col.id === 'bank') return [row?.bank_name || '—', row?.account_name || ''].filter(Boolean).join(' · ')
  if (col.id === 'iban') return row?.iban || '—'
  if (col.id === 'saldo_disponibile') return eur(row?.saldo_disponibile)
  if (col.id === 'saldo_contabile') return eur(row?.saldo_contabile)
  if (col.id === 'status') return row?.connection_status || '—'
  if (col.id === 'last_sync') return row?.last_sync_at ? formatDate(row.last_sync_at) : '—'
  return ''
}

const BANK_MOVEMENTS_COLUMNS = [
  { id: 'date', label: 'Data', width: 9, fluid: true },
  { id: 'description', label: 'Descrizione', width: 22, fluid: true, emphasis: true },
  { id: 'linked_invoice', label: 'Fattura collegata', width: 16, fluid: true },
  { id: 'causale', label: 'Causale', width: 14, fluid: true },
  { id: 'type', label: 'Entrata/Uscita', width: 9, fluid: true },
  { id: 'amount', label: 'Importo', width: 11, fluid: true, numeric: true },
  { id: 'account', label: 'Conto', width: 11, fluid: true },
  { id: 'status', label: 'Riconciliazione', width: 8, fluid: true },
]

function bankMovementsCellValue(row, col) {
  if (col.id === 'date') return formatDate(row?.movement_date)
  if (col.id === 'description') return row?.description || '—'
  if (col.id === 'linked_invoice') {
    const inv = row?.matched_invoice
    if (!inv) return row?.matched_invoice_id ? `Fattura #${row.matched_invoice_id}` : '—'
    const num = inv.invoice_number || inv.id
    const supplier = inv.supplier_name ? ` · ${inv.supplier_name}` : ''
    return `Fattura ${num}${supplier}`
  }
  if (col.id === 'causale') return row?.causale || '—'
  if (col.id === 'type') return row?.movement_type === 'entrata' ? 'Entrata' : 'Uscita'
  if (col.id === 'amount') return eur(row?.amount)
  if (col.id === 'account') return row?.account_label || '—'
  if (col.id === 'status') return row?.reconciliation_status || '—'
  return ''
}

const BANK_RECON_COLUMNS = [
  { id: 'movement', label: 'Movimento', width: 32, fluid: true, emphasis: true },
  { id: 'amount', label: 'Importo', width: 12, fluid: true, numeric: true },
  { id: 'invoice', label: 'Proposta fattura', width: 32, fluid: true },
  { id: 'difference', label: 'Differenza', width: 12, fluid: true, numeric: true },
  { id: 'status', label: 'Esito', width: 12, fluid: true },
]

function bankReconCellValue(row, col) {
  if (col.id === 'movement') {
    return [formatDate(row?.movement?.movement_date), row?.movement?.description || '—'].filter(Boolean).join(' · ')
  }
  if (col.id === 'amount') return eur(row?.movement?.amount)
  if (col.id === 'invoice') {
    if (!row?.suggested_invoice) return 'Nessuna proposta'
    const inv = row.suggested_invoice
    return `${inv.supplier_name || '—'} · n. ${inv.invoice_number || '—'} · Residuo ${eur(inv.residuo)}`
  }
  if (col.id === 'difference') return row?.suggested_invoice ? eur(row.suggested_invoice.difference) : '—'
  if (col.id === 'status') return row?.status || '—'
  return ''
}

export function AmministrazioneDashboardPage() {
  return (
    <AmministrazionePageShell
      title="Dashboard"
      lead="Centro operativo amministrazione: banca, fatture fornitori e prima nota."
    >
      <div className="ui-kpi-row">
        <Link className="ui-kpi-card" to="/banca" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="ui-kpi-card-label">Banca</div>
          <div className="ui-kpi-card-value" style={{ fontSize: '1.1rem' }}>
            Conti e movimenti
          </div>
          <div className="dashboard-kpi-sub">Saldi, sync e riconciliazione</div>
        </Link>
        <Link className="ui-kpi-card" to="/fatture" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="ui-kpi-card-label">Fatture Fornitori</div>
          <div className="ui-kpi-card-value" style={{ fontSize: '1.1rem' }}>
            SDI e scadenze
          </div>
          <div className="dashboard-kpi-sub">Ricevute, registrate, sync AdE</div>
        </Link>
        <Link className="ui-kpi-card" to="/prima-nota" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="ui-kpi-card-label">Prima Nota</div>
          <div className="ui-kpi-card-value" style={{ fontSize: '1.1rem' }}>
            Cassa e banca
          </div>
          <div className="dashboard-kpi-sub">Movimenti manuali e collegamenti</div>
        </Link>
        <Link className="ui-kpi-card" to="/amministrazione/mastrini" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="ui-kpi-card-label">Mastrini</div>
          <div className="ui-kpi-card-value" style={{ fontSize: '1.1rem' }}>
            Piano contabile
          </div>
          <div className="dashboard-kpi-sub">Dare/Avere, dettaglio conto e stampe</div>
        </Link>
      </div>
      <section className="card fatture-panel">
        <h2 className="fatture-panel-title">Accesso rapido</h2>
        <div className="analisi-panel-actions">
          <Link className="btn btn-primary btn-sm" to="/banca/conti">
            Conti correnti
          </Link>
          <Link className="btn btn-secondary btn-sm" to="/banca/riconciliazione">
            Riconciliazione
          </Link>
          <Link className="btn btn-secondary btn-sm" to="/fatture/scadenziario">
            Scadenziario fatture
          </Link>
          <Link className="btn btn-secondary btn-sm" to="/pagamenti">
            Pagamenti
          </Link>
          <Link className="btn btn-secondary btn-sm" to="/amministrazione/mastrini">
            Mastrini contabili
          </Link>
        </div>
      </section>
    </AmministrazionePageShell>
  )
}

export function AmministrazioneImpostazioniPage() {
  return (
    <AmministrazionePageShell
      title="Impostazioni"
      lead="Configurazione amministrazione (sola lettura / variabili ambiente)."
    >
      <section className="card fatture-panel">
        <h2 className="fatture-panel-title">Moduli</h2>
        <ul className="fatture-suggestions">
          <li>
            Banca — API <code>/banca/*</code>, sync da Prima Nota
          </li>
          <li>
            Fatture — SDI <code>/sdi/receive</code>, token <code>SDI_RECEIVE_TOKEN</code>
          </li>
          <li>
            Prima Nota — movimenti cassa/banca in <code>cash_entries</code>
          </li>
          <li>
            Mastrini contabili — aggregazione automatica su Prima Nota, fatture e banca
          </li>
        </ul>
        <p className="fatture-note">Open banking e collegamento diretto agli istituti arriveranno in una fase successiva.</p>
      </section>
    </AmministrazionePageShell>
  )
}

export function BancaDashboardPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const res = await fetchBancaDashboard()
        if (!cancelled) setData(res)
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Errore dashboard banca')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <BancaPageShell title="Dashboard bancaria" lead="Saldi, liquidità, flussi e ultimi movimenti.">
      {error && <div className="alert alert-danger">{error}</div>}
      {loading && <AnalisiLoadingBar active label="Caricamento banca" variant="subtle" />}
      {!loading && data && (
        <>
          <div className="ui-kpi-row">
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Saldo totale</div>
              <div className="ui-kpi-card-value">{eur(data.saldo_totale)}</div>
            </div>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Entrate di oggi</div>
              <div className="ui-kpi-card-value" style={{ color: 'var(--success)' }}>
                {eur(data.entrate_oggi)}
              </div>
            </div>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Uscite di oggi</div>
              <div className="ui-kpi-card-value" style={{ color: 'var(--danger)' }}>
                {eur(data.uscite_oggi)}
              </div>
            </div>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Liquidità disponibile</div>
              <div className="ui-kpi-card-value">{eur(data.liquidita_disponibile)}</div>
            </div>
          </div>

          <section className="card fatture-panel">
            <h2 className="fatture-panel-title">Flusso di cassa (6 mesi)</h2>
            <SeriesBars rows={data.flussi_mensili || []} valueKey="netto" labelKey="month_label" />
          </section>

          <section className="card fatture-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
              <h2 className="fatture-panel-title" style={{ margin: 0 }}>
                Ultimi movimenti
              </h2>
              <Link className="btn btn-secondary btn-sm" to="/banca/movimenti">
                Vedi tutti
              </Link>
            </div>
            <WorkbookGrid
              title="Ultimi movimenti"
              sheetLabel={`${(data.ultimi_movimenti || []).length} righe`}
              columns={BANK_LAST_MOVEMENTS_COLUMNS}
              rows={data.ultimi_movimenti || []}
              cellValue={bankLastMovementsCellValue}
              emptyMessage="Nessun movimento. Sincronizza un conto da Conti correnti."
              gridClassName="banca-fit-grid"
              rowKey={(row) => row.id}
            />
          </section>

          <section className="card fatture-panel">
            <h2 className="fatture-panel-title">Avvisi</h2>
            <ul className="fatture-suggestions">
              {(data.avvisi || []).map((a) => (
                <li key={a}>{a}</li>
              ))}
              {(data.avvisi || []).length === 0 && <li>Nessun avviso.</li>}
            </ul>
          </section>
        </>
      )}
    </BancaPageShell>
  )
}

export function BancaContiPage() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [bankName, setBankName] = useState('')
  const [iban, setIban] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [banBusy, setBanBusy] = useState(false)
  const [pendingMovements, setPendingMovements] = useState([])
  const [connectProfile, setConnectProfile] = useState(null)
  const [otpAccountId, setOtpAccountId] = useState(null)
  const [otpValue, setOtpValue] = useState('')
  const [otpHint, setOtpHint] = useState('')
  const [otpBusy, setOtpBusy] = useState(false)
  const banInputRef = useRef(null)
  const banImportAccountRef = useRef(null)
  const banImportInputRef = useRef(null)

  async function reload() {
    setLoading(true)
    setError('')
    try {
      const [res, profile] = await Promise.all([fetchBancaAccounts(), fetchBancaConnectProfile().catch(() => null)])
      setItems(Array.isArray(res?.items) ? res.items : [])
      if (profile) setConnectProfile(profile)
    } catch (e) {
      setError(e?.message || 'Errore caricamento conti')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  async function onCreate(e) {
    e.preventDefault()
    setError('')
    setSuccess('')
    try {
      const account = await createBancaAccount({ bank_name: bankName || 'Banca', iban: iban || null })
      let importMsg = ''
      if (pendingMovements.length && account?.id) {
        const imported = await importBanMovements(account.id, pendingMovements)
        importMsg = ` · ${imported?.message || `${imported?.created || 0} movimenti importati`}`
      }
      setBankName('')
      setIban('')
      setPendingMovements([])
      setSuccess(`Conto aggiunto${importMsg}`)
      await reload()
    } catch (err) {
      setError(err?.message || 'Errore creazione conto')
    }
  }

  async function onBanUpload(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBanBusy(true)
    setError('')
    setSuccess('')
    try {
      const parsed = await parseBanFile(file)
      if (parsed.iban) setIban(parsed.iban)
      if (parsed.bankName) setBankName(parsed.bankName)
      setPendingMovements(Array.isArray(parsed.movements) ? parsed.movements : [])
      if (!parsed.iban && !parsed.bankName && !(parsed.movements || []).length) {
        setError(parsed.warnings?.[0] || 'File BAN non riconosciuto')
      } else {
        const bits = []
        if (parsed.bankName) bits.push(`banca: ${parsed.bankName}`)
        if (parsed.iban) bits.push(`IBAN: ${parsed.iban}`)
        if (parsed.movements?.length) bits.push(`${parsed.movements.length} movimenti pronti`)
        const note = parsed.warnings?.length ? ` · ${parsed.warnings.join(' · ')}` : ''
        setSuccess(`Dati BAN caricati (${bits.join(' · ')})${note}`)
      }
    } catch (err) {
      setError(err?.message || 'Errore lettura file BAN')
    } finally {
      setBanBusy(false)
    }
  }

  async function onBanImportExisting(e) {
    const file = e.target.files?.[0]
    const accountId = banImportAccountRef.current
    e.target.value = ''
    banImportAccountRef.current = null
    if (!file || !accountId) return
    setBusyId(accountId)
    setError('')
    setSuccess('')
    try {
      const parsed = await parseBanFile(file)
      if (!parsed.movements?.length) {
        setError(parsed.warnings?.[0] || 'Nessun movimento trovato nel file BAN')
        return
      }
      const imported = await importBanMovements(accountId, parsed.movements)
      setSuccess(imported?.message || `Importati ${imported?.created || 0} movimenti`)
      await reload()
    } catch (err) {
      setError(err?.message || 'Errore import BAN')
    } finally {
      setBusyId(null)
    }
  }

  async function startConnect(accountId) {
    setBusyId(accountId)
    setError('')
    setSuccess('')
    try {
      const res = await connectBancaAccount(accountId)
      setOtpAccountId(accountId)
      setOtpValue(res?.debug_otp ? String(res.debug_otp) : '')
      setOtpHint(res?.phone_hint || '')
      setSuccess(res?.message || 'OTP inviato: inserisci il codice per collegare il conto.')
      if (res?.debug_otp) {
        setSuccess(`OTP inviato (debug): ${res.debug_otp}. Confermalo per collegare.`)
      }
      await reload()
    } catch (err) {
      setError(err?.message || 'Impossibile avviare login banca')
    } finally {
      setBusyId(null)
    }
  }

  async function confirmOtp(e) {
    e?.preventDefault?.()
    if (!otpAccountId) return
    setOtpBusy(true)
    setError('')
    setSuccess('')
    try {
      const res = await confirmBancaConnectOtp(otpAccountId, otpValue)
      setSuccess(res?.message || 'Conto collegato')
      setOtpAccountId(null)
      setOtpValue('')
      setOtpHint('')
      await reload()
    } catch (err) {
      setError(err?.message || 'OTP non valido')
    } finally {
      setOtpBusy(false)
    }
  }

  async function run(id, fn, okMsg) {
    setBusyId(id)
    setError('')
    setSuccess('')
    try {
      const res = await fn(id)
      setSuccess(res?.message || okMsg)
      await reload()
    } catch (err) {
      setError(err?.message || 'Operazione fallita')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <BancaPageShell title="Conti correnti" lead="Conti collegati, saldi e sincronizzazione.">
      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}
      {connectProfile && (
        <p className="fatture-note">
          Login banca da <code>.env</code>:{' '}
          {connectProfile.credentials_configured ? (
            <>
              configurato ({connectProfile.username_hint || 'user'})
              {connectProfile.bank_name ? ` · ${connectProfile.bank_name}` : ''}
            </>
          ) : (
            <strong>mancano BANK_USERNAME / BANK_PASSWORD</strong>
          )}
          . Il collegamento richiede OTP sul telefono.
        </p>
      )}

      {otpAccountId != null && (
        <section className="card fatture-panel">
          <h2 className="fatture-panel-title">Conferma OTP collegamento banca</h2>
          <form onSubmit={confirmOtp} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className="form-control"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="OTP 6 cifre"
              value={otpValue}
              onChange={(e) => setOtpValue(e.target.value.replace(/\D/g, '').slice(0, 6))}
              style={{ minWidth: 140, maxWidth: 160 }}
            />
            <button type="submit" className="btn btn-primary" disabled={otpBusy || otpValue.length !== 6}>
              {otpBusy ? 'Verifico…' : 'Conferma OTP'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={otpBusy}
              onClick={() => {
                setOtpAccountId(null)
                setOtpValue('')
                setOtpHint('')
              }}
            >
              Annulla
            </button>
          </form>
          <p className="fatture-note" style={{ marginTop: '0.6rem' }}>
            Login avviato con credenziali <code>.env</code>
            {otpHint ? <> · OTP inviato a <strong>{otpHint}</strong></> : null}.
          </p>
        </section>
      )}

      <section className="card fatture-panel">
        <h2 className="fatture-panel-title">Collega conto</h2>
        <form onSubmit={onCreate} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="form-control"
            placeholder="Nome banca"
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            style={{ minWidth: 180 }}
          />
          <input
            className="form-control"
            placeholder="IBAN"
            value={iban}
            onChange={(e) => setIban(e.target.value)}
            style={{ minWidth: 260 }}
          />
          <input
            ref={banInputRef}
            type="file"
            accept=".ban,.cbi,.txt,.asc,text/plain"
            style={{ display: 'none' }}
            onChange={onBanUpload}
          />
          <input
            ref={banImportInputRef}
            type="file"
            accept=".ban,.cbi,.txt,.asc,text/plain"
            style={{ display: 'none' }}
            onChange={onBanImportExisting}
          />
          <button
            type="button"
            className="btn btn-secondary"
            disabled={banBusy}
            onClick={() => banInputRef.current?.click()}
            title="Carica file BAN/CBI: IBAN, nome banca e movimenti"
          >
            {banBusy ? 'Carico…' : 'Upload BAN'}
          </button>
          <button type="submit" className="btn btn-primary">
            Collega conto
          </button>
        </form>
        <p className="fatture-note" style={{ marginTop: '0.75rem' }}>
          Carica un file <strong>BAN/CBI</strong> (estratto conto) per compilare IBAN, nome banca e importare i movimenti.
          Premendo «Collega conto» il conto viene creato e i movimenti vengono importati.
          <br />
          <strong>Importa BAN</strong> = movimenti reali dall’estratto. <strong>Sync Prima Nota</strong> = solo movimenti
          già registrati in Prima Nota. <strong>Collega</strong> = login con credenziali <code>.env</code> + OTP.
          {pendingMovements.length > 0 ? (
            <>
              {' '}
              <strong>{pendingMovements.length} movimenti</strong> pronti per l’import.
            </>
          ) : null}
        </p>
      </section>

      <section className="card fatture-panel banca-fit-panel">
        <h2 className="fatture-panel-title">Elenco conti</h2>
        {loading ? (
          <AnalisiLoadingBar active label="Caricamento banca" variant="subtle" />
        ) : (
          <WorkbookGrid
            title="Elenco conti"
            sheetLabel={`${items.length} conti`}
            columns={BANK_ACCOUNTS_COLUMNS}
            rows={items}
            cellValue={bankAccountsCellValue}
            emptyMessage="Nessun conto."
            gridClassName="banca-fit-grid"
            rowKey={(row) => row.id}
            totals={{
              saldo_disponibile: items.reduce((acc, a) => acc + (Number(a?.saldo_disponibile) || 0), 0),
              saldo_contabile: items.reduce((acc, a) => acc + (Number(a?.saldo_contabile) || 0), 0),
            }}
            totalsLabel={(colId, totals) => {
              if (colId === 'bank') return 'TOTALI'
              if (colId === 'saldo_disponibile') return eur(totals?.saldo_disponibile)
              if (colId === 'saldo_contabile') return eur(totals?.saldo_contabile)
              return ''
            }}
            actionsHeader="Azioni"
            renderActions={(a) => (
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
                {a.connection_status === 'connected' ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busyId === a.id}
                    onClick={() => run(a.id, disconnectBancaAccount, 'Conto disconnesso')}
                  >
                    Disconnetti
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busyId === a.id}
                    onClick={() => startConnect(a.id)}
                    title="Login con BANK_USERNAME/PASSWORD da .env + OTP"
                  >
                    {a.connection_status === 'pending' ? 'Reinvia OTP' : 'Collega'}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busyId === a.id}
                  onClick={() => {
                    banImportAccountRef.current = a.id
                    banImportInputRef.current?.click()
                  }}
                  title="Importa movimenti da file BAN su questo conto"
                >
                  Importa BAN
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busyId === a.id}
                  title="Importa da Prima Nota i movimenti con conto banca/bonifico (non collega la banca reale)"
                  onClick={() => run(a.id, syncBancaAccount, 'Sincronizzazione completata')}
                >
                  {busyId === a.id ? '…' : 'Sync Prima Nota'}
                </button>
                <button
                  type="button"
                  className="btn btn-outline-danger btn-sm"
                  disabled={busyId === a.id}
                  title="Elimina conto da Atlas"
                  onClick={() => {
                    const label = [a.bank_name, a.account_name].filter(Boolean).join(' · ')
                    const ok = window.confirm(
                      `Eliminare il conto «${label || a.id}» da Atlas?\nVerranno rimossi anche i movimenti collegati.`,
                    )
                    if (!ok) return
                    run(a.id, deleteBancaAccount, 'Conto eliminato da Atlas')
                  }}
                >
                  Elimina
                </button>
              </div>
            )}
          />
        )}
      </section>
    </BancaPageShell>
  )
}

export function BancaMovimentiPage() {
  const [items, setItems] = useState([])
  const [accounts, setAccounts] = useState([])
  const [accountId, setAccountId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [category, setCategory] = useState('')
  const [counterparty, setCounterparty] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [mov, acc] = await Promise.all([
        fetchBancaMovimenti({
          account_id: accountId || undefined,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          category: category || undefined,
          counterparty: counterparty || undefined,
        }),
        fetchBancaAccounts(),
      ])
      setItems(Array.isArray(mov?.items) ? mov.items : [])
      setAccounts(Array.isArray(acc?.items) ? acc.items : [])
    } catch (e) {
      setError(e?.message || 'Errore caricamento movimenti')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <BancaPageShell title="Movimenti bancari" lead="Estratto movimenti con filtri e stato di riconciliazione.">
      {error && <div className="alert alert-danger">{error}</div>}
      <section className="card fatture-panel">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            load()
          }}
          style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'end' }}
        >
          <label>
            Periodo da
            <input className="form-control" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label>
            a
            <input className="form-control" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          <label>
            Conto
            <select className="form-control" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Tutti</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.bank_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Categoria
            <input className="form-control" value={category} onChange={(e) => setCategory(e.target.value)} />
          </label>
          <label>
            Cliente/Fornitore
            <input className="form-control" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-primary">
            Filtra
          </button>
        </form>
      </section>

      <section className="card fatture-panel banca-fit-panel">
        {loading ? (
          <AnalisiLoadingBar active label="Caricamento banca" variant="subtle" />
        ) : (
          <WorkbookGrid
            title="Movimenti bancari"
            sheetLabel={`${items.length} movimenti`}
            columns={BANK_MOVEMENTS_COLUMNS}
            rows={items}
            cellValue={bankMovementsCellValue}
            emptyMessage="Nessun movimento nel filtro. Usa Sincronizza in Conti correnti."
            gridClassName="banca-fit-grid"
            rowKey={(row) => row.id}
            totals={{
              amountEntrate: items.reduce(
                (acc, m) => acc + (String(m?.movement_type || '').toLowerCase() === 'entrata' ? Number(m?.amount) || 0 : 0),
                0,
              ),
              amountUscite: items.reduce(
                (acc, m) => acc + (String(m?.movement_type || '').toLowerCase() !== 'entrata' ? Number(m?.amount) || 0 : 0),
                0,
              ),
            }}
            totalsLabel={(colId, totals) => {
              const netto = (Number(totals?.amountEntrate) || 0) - (Number(totals?.amountUscite) || 0)
              if (colId === 'description') return `TOTALI · Netto ${eur(netto)}`
              if (colId === 'amount') {
                return `E ${eur(totals?.amountEntrate)} / U ${eur(totals?.amountUscite)}`
              }
              return ''
            }}
          />
        )}
      </section>
    </BancaPageShell>
  )
}

export function BancaRiconciliazionePage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busyId, setBusyId] = useState(null)

  async function reload() {
    setLoading(true)
    setError('')
    try {
      const res = await fetchBancaRiconciliazione()
      setData(res)
    } catch (e) {
      setError(e?.message || 'Errore riconciliazione')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  async function confirmMatch(row) {
    const movId = row?.movement?.id
    if (!movId || typeof movId !== 'number') {
      setError('Sincronizza prima i movimenti bancari.')
      return
    }
    setBusyId(movId)
    setError('')
    setSuccess('')
    try {
      const invId = row.suggested_invoice?.invoice_id
      const status = row.status === 'difference' ? 'difference' : 'matched'
      await postBancaRiconcilia(movId, { invoice_id: invId, status })
      setSuccess('Abbinamento salvato')
      await reload()
    } catch (e) {
      setError(e?.message || 'Errore salvataggio')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <BancaPageShell
      title="Riconciliazione automatica"
      lead="Atlas propone abbinamenti tra movimenti bancari e fatture fornitori aperte."
    >
      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}
      <section className="card fatture-panel banca-fit-panel">
        <p className="fatture-note" style={{ marginTop: 0 }}>
          Fatture aperte considerate: {data?.open_invoices_count ?? '—'} · Movimenti uscita da riconciliare:{' '}
          {data?.unmatched_movements ?? '—'}
        </p>
        {loading ? (
          <AnalisiLoadingBar active label="Analisi movimenti in corso" variant="subtle" />
        ) : (
          <WorkbookGrid
            title="Suggerimenti riconciliazione"
            sheetLabel={`${(data?.suggestions || []).length} righe`}
            columns={BANK_RECON_COLUMNS}
            rows={data?.suggestions || []}
            cellValue={bankReconCellValue}
            emptyMessage="Nessun movimento da riconciliare. Sincronizza i conti e riprova."
            gridClassName="banca-fit-grid"
            rowKey={(row, idx) => row?.movement?.id || idx}
            totals={{
              amount: (data?.suggestions || []).reduce((acc, row) => acc + (Number(row?.movement?.amount) || 0), 0),
              difference: (data?.suggestions || []).reduce(
                (acc, row) => acc + (Number(row?.suggested_invoice?.difference) || 0),
                0,
              ),
            }}
            totalsLabel={(colId, totals) => {
              if (colId === 'movement') return 'TOTALI'
              if (colId === 'amount') return eur(totals?.amount)
              if (colId === 'difference') return eur(totals?.difference)
              return ''
            }}
            actionsHeader="Azioni"
            renderActions={(row) =>
              row?.suggested_invoice && typeof row?.movement?.id === 'number' ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busyId === row.movement.id}
                  onClick={(e) => {
                    e.stopPropagation()
                    confirmMatch(row)
                  }}
                >
                  Conferma
                </button>
              ) : null
            }
          />
        )}
      </section>
    </BancaPageShell>
  )
}
