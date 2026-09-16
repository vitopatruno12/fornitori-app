import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AmministrazionePageShell,
  BancaPageShell,
  eur,
  formatDate,
} from '../components/BancaShared.jsx'
import { AnalisiLoadingBar } from '../components/AnalisiShared.jsx'
import FattureCompanySelect from '../components/FattureCompanySelect.jsx'
import { useFattureCompany } from '../hooks/useFattureCompany.js'
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
  postBancaRiconciliazioneAuto,
  startEnableBankingAuth,
  syncBancaAccount,
  syncEnableBankingAccount,
  updateBancaAccount,
} from '../services/bancaService'
import { SeriesBars } from '../components/FattureShared.jsx'
import WorkbookGrid from '../components/WorkbookGrid.jsx'
import { parseBanFile } from '../utils/banFileParser'
import { companyLabel, FATTURE_COMPANY_ORDER, FATTURE_COMPANY_LABELS } from '../utils/fattureCompany.js'

function resolveEnableBankingPayload(account) {
  const bank = String(account?.bank_name || '').toLowerCase()
  const label = `${bank} ${String(account?.account_name || '').toLowerCase()} ${String(account?.notes || '').toLowerCase()}`
  if (bank.includes('unicredit')) {
    return { aspsp_name: 'UniCredit', aspsp_country: 'IT', psu_type: 'personal' }
  }
  if (bank.includes('bbva')) {
    return { aspsp_name: 'BBVA', aspsp_country: 'IT', psu_type: 'personal' }
  }
  if ((bank.includes('bppb') || bank.includes('puglia') || bank.includes('basilicata')) && !bank.includes('bcc')) {
    return {
      aspsp_name: 'Banca Popolare di Puglia e Basilicata',
      aspsp_country: 'IT',
      psu_type: 'business',
    }
  }
  if (bank.includes('intesa') || bank.includes('sanpaolo')) {
    return {
      aspsp_name: 'Intesa Sanpaolo',
      aspsp_country: 'IT',
      psu_type: label.includes('business') || label.includes('s.r.l') ? 'business' : 'personal',
    }
  }
  if (
    bank.includes('terra')
    || bank.includes("d'otranto")
    || bank.includes('dotranto')
    || bank.includes('bcc')
    || label.includes('otranto')
    || label.includes('carmiano')
  ) {
    return {
      aspsp_name: "BCC Terra d'Otranto",
      aspsp_country: 'IT',
      psu_type: 'personal',
    }
  }
  return { psu_type: label.includes('business') || label.includes('s.r.l') ? 'business' : 'personal' }
}

function isBccTerraOtrantoAccount(account) {
  const bank = String(account?.bank_name || '').toLowerCase()
  const label = `${bank} ${String(account?.account_name || '').toLowerCase()} ${String(account?.notes || '').toLowerCase()}`
  return (
    bank.includes('terra')
    || bank.includes("d'otranto")
    || bank.includes('dotranto')
    || bank.includes('bcc')
    || label.includes('otranto')
    || label.includes('carmiano')
    || (String(account?.iban || '').replace(/\s/g, '').toUpperCase().startsWith('IT')
      && ['IT37M0844516000000000967252', 'IT06B0844516000000000972450'].includes(
        String(account?.iban || '').replace(/\s/g, '').toUpperCase(),
      ))
  )
}

const BCC_SEED_ACCOUNTS = [
  {
    bank_name: "BCC Terra d'Otranto",
    account_name: "Via Lattea · BCC Terra d'Otranto",
    iban: 'IT37M0844516000000000967252',
    company: 'via_lattea',
    ledger_code: '1100',
    notes:
      "LA VIA LATTEA · BCC Terra d'Otranto S.C. · IBAN IT37M0844516000000000967252 · BIC ICRAITRRCD0",
  },
  {
    bank_name: "BCC Terra d'Otranto",
    account_name: "Mediazione · BCC Terra d'Otranto",
    iban: 'IT06B0844516000000000972450',
    company: 'mediazione_a',
    ledger_code: '1100',
    notes:
      "MEDIAZIONE · BCC Terra d'Otranto S.C. · IBAN IT06B0844516000000000972450 · BIC ICRAITRRCD0 · Carmiano (LE)",
  },
]

function isBppbAccount(account) {
  const bank = String(account?.bank_name || '').toLowerCase()
  const iban = String(account?.iban || '').replace(/\s/g, '').toUpperCase()
  return (
    bank.includes('bppb')
    || bank.includes('puglia')
    || bank.includes('basilicata')
    || ['IT25D0538516000CC1410004514', 'IT55B0538516000CC1410004512', 'IT25D0538516000CC410004514'].includes(iban)
  )
}

/** Etichetta chiara in filtri/elenchi: banca · società · IBAN corto. */
function formatBankAccountOptionLabel(account) {
  if (account?.label) return String(account.label)
  const bank = String(account?.bank_name || 'Banca').trim() || 'Banca'
  const company = account?.company ? companyLabel(account.company) : ''
  const name = String(account?.account_name || '').trim()
  const iban = String(account?.iban || '').replace(/\s/g, '').toUpperCase()
  const ibanShort = iban.length > 8 ? `${iban.slice(0, 4)}…${iban.slice(-6)}` : iban
  const bits = [bank]
  if (company) bits.push(company)
  else if (name && !name.toLowerCase().includes(bank.toLowerCase().slice(0, 8))) bits.push(name)
  if (ibanShort) bits.push(ibanShort)
  return bits.join(' · ')
}

const BPPB_SEED_ACCOUNTS = [
  {
    bank_name: 'BPPB - Banca Popolare di Puglia e Basilicata',
    account_name: 'Via Lattea · CC1410004514',
    iban: 'IT25D0538516000CC1410004514',
    company: 'via_lattea',
    ledger_code: '1100',
    notes:
      "LA VIA LATTEA · BPPB · IBAN IT25D0538516000CC1410004514 · Enable Banking b88c128a-68e1-4b2e-b999-e87cc80c13b8",
  },
  {
    bank_name: 'BPPB - Banca Popolare di Puglia e Basilicata',
    account_name: 'CC1410004512',
    iban: 'IT55B0538516000CC1410004512',
    company: '',
    ledger_code: '1100',
    notes: 'Conto BPPB Mediazione (ABI 05385). Collegare via Enable Banking in produzione.',
  },
]

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
  { id: 'bank', label: 'Banca', width: 22, fluid: true, emphasis: true },
  { id: 'iban', label: 'IBAN', width: 16, fluid: true, mono: true },
  { id: 'company', label: 'Società mastrini', width: 14, fluid: true },
  { id: 'ledger_code', label: 'Mastro', width: 8, fluid: true, mono: true },
  { id: 'saldo_disponibile', label: 'Saldo disponibile', width: 12, fluid: true, numeric: true },
  { id: 'saldo_contabile', label: 'Saldo contabile', width: 12, fluid: true, numeric: true },
  { id: 'status', label: 'Stato', width: 10, fluid: true },
  { id: 'last_sync', label: 'Ultima sync', width: 12, fluid: true },
]

function bankAccountsCellValue(row, col) {
  if (col.id === 'bank') return [row?.bank_name || '—', row?.account_name || ''].filter(Boolean).join(' · ')
  if (col.id === 'iban') return row?.iban || '—'
  if (col.id === 'company') return row?.company ? companyLabel(row.company) : 'Condiviso (tutte)'
  if (col.id === 'ledger_code') return row?.ledger_code || '1100'
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
  { id: 'account', label: 'Conto', width: 18, fluid: true },
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
  if (col.id === 'account') {
    if (row?.account_label) return row.account_label
    const bits = [row?.account_bank_name || row?.bank_name, row?.account_name, row?.account_company]
      .map((x) => String(x || '').trim())
      .filter(Boolean)
    return bits.length ? bits.join(' · ') : '—'
  }
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

const BANK_INVOICE_STATUS_COLUMNS = [
  { id: 'invoice_number', label: 'N. doc.', width: 12, fluid: true, emphasis: true },
  { id: 'invoice_date', label: 'Data', width: 10, fluid: true },
  { id: 'supplier_name', label: 'Fornitore', width: 24, fluid: true },
  { id: 'total', label: 'Totale', width: 12, fluid: true, numeric: true },
  { id: 'residuo', label: 'Residuo', width: 12, fluid: true, numeric: true },
  { id: 'bank_hit', label: 'Movimento banca', width: 20, fluid: true },
  { id: 'reason', label: 'Esito', width: 10, fluid: true },
]

function bankReconCellValue(row, col) {
  if (col.id === 'movement') {
    return [formatDate(row?.movement?.movement_date), row?.movement?.description || '—'].filter(Boolean).join(' · ')
  }
  if (col.id === 'amount') return eur(row?.movement?.amount)
  if (col.id === 'invoice') {
    if (!row?.suggested_invoice) return 'Nessuna proposta'
    const inv = row.suggested_invoice
    const quality = inv.match_quality === 'number' ? 'n. doc.' : inv.match_quality === 'exact' ? 'importo' : 'vicino'
    return `${inv.supplier_name || '—'} · n. ${inv.invoice_number || '—'} · Residuo ${eur(inv.residuo)} (${quality})`
  }
  if (col.id === 'difference') return row?.suggested_invoice ? eur(row.suggested_invoice.difference) : '—'
  if (col.id === 'status') return row?.status || '—'
  return ''
}

function bankInvoiceStatusCellValue(row, col) {
  if (col.id === 'invoice_number') return row?.invoice_number || '—'
  if (col.id === 'invoice_date') return formatDate(row?.invoice_date)
  if (col.id === 'supplier_name') return row?.supplier_name || '—'
  if (col.id === 'total') return eur(row?.total)
  if (col.id === 'residuo') return eur(row?.residuo)
  if (col.id === 'bank_hit') {
    const m = row?.matched_movement
    if (!m) return '—'
    return [formatDate(m.movement_date), m.description || m.causale || `BA-${m.id}`].filter(Boolean).join(' · ')
  }
  if (col.id === 'reason') {
    if (row?.match_reason === 'numero_in_movimento') return 'N. in banca'
    if (row?.match_reason === 'matched') return 'Riconciliata'
    if (row?.match_reason === 'gia_pagata_in_atlas') return 'Pagata'
    if (row?.match_reason === 'da_pagare') return 'Da pagare'
    return row?.match_reason || '—'
  }
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search || '')
    const eb = params.get('eb')
    if (!eb) return
    if (eb === 'ok') {
      const n = params.get('imported')
      setSuccess(
        n != null
          ? `Enable Banking collegato: ${n} movimenti importati.`
          : 'Enable Banking collegato correttamente.',
      )
    } else if (eb === 'error') {
      const raw = params.get('msg') || 'Collegamento Enable Banking non riuscito'
      const low = raw.toLowerCase()
      const aspspQ = String(params.get('aspsp') || '')
      const bankQ = String(params.get('bank') || '').toLowerCase()
      const appQ = String(params.get('app') || '')
      let pending = null
      try {
        pending = JSON.parse(sessionStorage.getItem('atlasEbPendingAuth') || 'null')
      } catch {
        pending = null
      }
      try {
        sessionStorage.removeItem('atlasEbPendingAuth')
      } catch {
        /* ignore */
      }
      const aspsp = aspspQ || String(pending?.aspsp_name || '')
      const aspspL = aspsp.toLowerCase()
      const isBcc =
        bankQ === 'bcc'
        || aspspL.includes('bcc')
        || aspspL.includes('otranto')
        || appQ === '4625919e-22a1-4d40-8267-7587ff2360c0'
      const isBppb =
        bankQ === 'bppb'
        || aspspL.includes('puglia')
        || aspspL.includes('basilicata')
        || aspspL.includes('bppb')
        || appQ === 'b88c128a-68e1-4b2e-b999-e87cc80c13b8'
      if (low.includes('server_error')) {
        if (isBppb && !isBcc) {
          setError(
            'BPPB Via Lattea (Enable Banking): errore lato banca (server_error) durante Collega. '
              + 'Non è BCC: stai collegando Banca Popolare di Puglia e Basilicata'
              + (appQ ? ` (app ${appQ})` : ' (app b88c128a…)')
              + '. Riprova Collega BPPB; se «Sincronizza conti BPPB» funziona, quel conto è già collegato e puoi usare solo Sincronizza.',
          )
        } else if (isBcc) {
          setError(
            "BCC Terra d'Otranto (Enable Banking beta): errore lato banca (server_error). "
              + 'Riprova Collega BCC con l’altro canale (privato↔impresa). '
              + 'Se persiste, Control Panel → app 4625919e… → Requests.',
          )
        } else {
          setError(
            `Enable Banking: errore lato banca (server_error)${aspsp ? ` su ${aspsp}` : ''}. `
              + 'Riprova Collega; se persiste controlla i log ASPSP nel Control Panel.',
          )
        }
      } else {
        setError(raw)
      }
    }
    params.delete('eb')
    params.delete('msg')
    params.delete('imported')
    params.delete('account_id')
    const qs = params.toString()
    const next = `${window.location.pathname}${qs ? `?${qs}` : ''}`
    window.history.replaceState({}, '', next)
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

  async function startEnableBanking(accountId) {
    setBusyId(accountId)
    setError('')
    setSuccess('')
    try {
      const account = items.find((x) => x.id === accountId)
      let payload = resolveEnableBankingPayload(account)
      if (isBccTerraOtrantoAccount(account) || payload.aspsp_name === "BCC Terra d'Otranto") {
        let lastPsu = ''
        try {
          lastPsu = String(sessionStorage.getItem('atlasEbBccLastPsu') || '')
        } catch {
          lastPsu = ''
        }
        const suggestBusiness = lastPsu === 'personal'
        const useBusiness = window.confirm(
          "BCC Terra d'Otranto su Enable Banking è in beta (diverso da BPPB).\n\n" +
            'Sincronizza BPPB funziona solo se il conto BPPB è già collegato.\n'
            + 'Qui stai collegando BCC: serve un nuovo login RelaxBanking.\n\n'
            + (suggestBusiness
              ? 'Ultimo tentativo era PRIVATO e ha fallito → consigliato IMPRESA.\n\n'
              : 'Prova prima PRIVATO; se torna server_error, ripeti con IMPRESA.\n\n')
            + 'OK = accesso IMPRESA (business)\n'
            + 'Annulla = accesso PRIVATO (personal)',
        )
        payload = {
          ...payload,
          aspsp_name: "BCC Terra d'Otranto",
          aspsp_country: 'IT',
          psu_type: useBusiness ? 'business' : 'personal',
        }
        try {
          sessionStorage.setItem('atlasEbBccLastPsu', payload.psu_type)
        } catch {
          /* ignore */
        }
      }
      try {
        sessionStorage.setItem(
          'atlasEbPendingAuth',
          JSON.stringify({
            accountId,
            aspsp_name: payload.aspsp_name || '',
            psu_type: payload.psu_type || '',
            at: Date.now(),
          }),
        )
      } catch {
        /* ignore */
      }
      const res = await startEnableBankingAuth(accountId, payload)
      if (res?.url) {
        setSuccess(
          `${res.message || 'Reindirizzamento alla banca…'}`
            + (res.enable_banking_app_id ? ` · app ${res.enable_banking_app_id}` : ''),
        )
        window.location.assign(res.url)
        return
      }
      setError('Enable Banking non ha restituito l’URL di login')
    } catch (err) {
      setError(err?.message || 'Impossibile avviare Enable Banking')
    } finally {
      setBusyId(null)
    }
  }

  async function syncBankAccount(accountId) {
    setBusyId(accountId)
    setError('')
    setSuccess('')
    try {
      const res = await syncEnableBankingAccount(accountId)
      const imported = Number(res?.imported || 0)
      const saldo = res?.account?.saldo_disponibile
      const bits = []
      if (Number.isFinite(saldo)) bits.push(`saldo ${eur(saldo)}`)
      bits.push(`${imported} nuovi movimenti`)
      setSuccess(res?.message || `Conti sincronizzati: ${bits.join(' · ')}. Vedi Movimenti banca.`)
      await reload()
    } catch (err) {
      setError(err?.message || 'Sincronizzazione fallita')
    } finally {
      setBusyId(null)
    }
  }

  async function syncAllBppbAccounts() {
    let bppb = items.filter(isBppbAccount)
    if (!bppb.length) {
      setBusyId(-2)
      setError('')
      setSuccess('')
      try {
        const existingIbans = new Set(
          items.map((a) => String(a.iban || '').replace(/\s/g, '').toUpperCase()).filter(Boolean),
        )
        // Aggiorna eventuale IBAN Via Lattea precedente
        const oldVl = items.find(
          (a) => String(a.iban || '').replace(/\s/g, '').toUpperCase() === 'IT25D0538516000CC410004514',
        )
        if (oldVl?.id) {
          await updateBancaAccount(oldVl.id, {
            iban: 'IT25D0538516000CC1410004514',
            account_name: 'Via Lattea · CC1410004514',
            bank_name: 'BPPB - Banca Popolare di Puglia e Basilicata',
            company: 'via_lattea',
            ledger_code: '1100',
          })
          existingIbans.delete('IT25D0538516000CC410004514')
          existingIbans.add('IT25D0538516000CC1410004514')
        }
        for (const seed of BPPB_SEED_ACCOUNTS) {
          const iban = seed.iban.replace(/\s/g, '').toUpperCase()
          if (existingIbans.has(iban)) continue
          await createBancaAccount(seed)
        }
        const res = await fetchBancaAccounts()
        const next = Array.isArray(res?.items) ? res.items : []
        setItems(next)
        bppb = next.filter(isBppbAccount)
      } catch (err) {
        setError(err?.message || 'Impossibile creare i conti BPPB')
        setBusyId(null)
        return
      } finally {
        setBusyId(null)
      }
    }
    if (!bppb.length) {
      setError('Nessun conto BPPB in elenco.')
      return
    }
    const connected = bppb.filter((a) => a.enable_banking_connected)
    if (!connected.length) {
      // Preferisci Via Lattea (app b88c128a…) se presente
      const prefer =
        bppb.find((a) => String(a.company || '').toLowerCase() === 'via_lattea')
        || bppb.find((a) => String(a.iban || '').replace(/\s/g, '').toUpperCase() === 'IT25D0538516000CC1410004514')
        || bppb[0]
      await startEnableBanking(prefer.id)
      return
    }
    setError('')
    setSuccess('')
    let totalImported = 0
    for (const acc of connected) {
      setBusyId(acc.id)
      try {
        const res = await syncEnableBankingAccount(acc.id)
        totalImported += Number(res?.imported || 0)
      } catch (err) {
        setError(err?.message || `Sync fallito per ${acc.bank_name}`)
        setBusyId(null)
        await reload()
        return
      }
    }
    setBusyId(null)
    setSuccess(
      `BPPB sincronizzato: ${connected.length} conti, ${totalImported} nuovi movimenti. Apri Movimenti banca per visualizzarli.`,
    )
    await reload()
  }

  async function syncAllBccAccounts() {
    let bcc = items.filter(isBccTerraOtrantoAccount)
    if (!bcc.length) {
      setBusyId(-1)
      setError('')
      setSuccess('')
      try {
        const existingIbans = new Set(
          items.map((a) => String(a.iban || '').replace(/\s/g, '').toUpperCase()).filter(Boolean),
        )
        for (const seed of BCC_SEED_ACCOUNTS) {
          const iban = seed.iban.replace(/\s/g, '').toUpperCase()
          if (existingIbans.has(iban)) continue
          await createBancaAccount(seed)
        }
        const res = await fetchBancaAccounts()
        const next = Array.isArray(res?.items) ? res.items : []
        setItems(next)
        bcc = next.filter(isBccTerraOtrantoAccount)
      } catch (err) {
        setError(err?.message || 'Impossibile creare i conti BCC')
        setBusyId(null)
        return
      } finally {
        setBusyId(null)
      }
    }
    if (!bcc.length) {
      setError("Nessun conto BCC Terra d'Otranto in elenco.")
      return
    }
    const connected = bcc.filter((a) => a.enable_banking_connected)
    if (!connected.length) {
      const prefer =
        bcc.find((a) => String(a.company || '').toLowerCase() === 'via_lattea') || bcc[0]
      await startEnableBanking(prefer.id)
      return
    }
    setError('')
    setSuccess('')
    let totalImported = 0
    for (const acc of connected) {
      setBusyId(acc.id)
      try {
        const res = await syncEnableBankingAccount(acc.id)
        totalImported += Number(res?.imported || 0)
      } catch (err) {
        setError(err?.message || `Sync fallito per ${acc.bank_name}`)
        setBusyId(null)
        await reload()
        return
      }
    }
    setBusyId(null)
    setSuccess(
      `BCC sincronizzato: ${connected.length} conti, ${totalImported} nuovi movimenti. Apri Movimenti banca per visualizzarli.`,
    )
    await reload()
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

  async function saveMastriniLink(account, { company, ledger_code }) {
    setBusyId(account.id)
    setError('')
    setSuccess('')
    try {
      await updateBancaAccount(account.id, {
        company: company === undefined ? account.company || '' : company,
        ledger_code: ledger_code || account.ledger_code || '1100',
      })
      const label = company ? companyLabel(company) : 'Condiviso (tutte le società)'
      setSuccess(
        isBppbAccount(account)
          ? `Popolare Puglia e Basilicata → mastrini: ${label} (mastro ${ledger_code || account.ledger_code || '1100'})`
          : `Conto associato ai mastrini: ${label}`,
      )
      await reload()
    } catch (err) {
      setError(err?.message || 'Errore associazione mastrini')
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
          Enable Banking:{' '}
          {connectProfile.enable_banking?.configured ? (
            <>
              attivo ({connectProfile.enable_banking.environment || 'sandbox'})
              {connectProfile.enable_banking.aspsp_name
                ? ` · test ASPSP: ${connectProfile.enable_banking.aspsp_name} (${connectProfile.enable_banking.aspsp_country})`
                : ''}
            </>
          ) : (
            <strong>non configurato</strong>
          )}
          {' · '}
          Login .env + OTP:{' '}
          {connectProfile.credentials_configured ? (
            <>
              configurato ({connectProfile.username_hint || 'user'})
              {connectProfile.bank_name ? ` · ${connectProfile.bank_name}` : ''}
            </>
          ) : (
            <strong>mancano BANK_USERNAME / BANK_PASSWORD</strong>
          )}
          .
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
        <h2 className="fatture-panel-title">BPPB — Sincronizza conti</h2>
        <p className="fatture-note" style={{ marginBottom: '0.75rem' }}>
          Scarica saldi e movimenti da Banca Popolare di Puglia e Basilicata (Via Lattea
          IT25D0538516000CC1410004514 · app Enable Banking b88c128a…) e li mostra in Atlas.
          Se i conti non ci sono, li crea automaticamente.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busyId != null || !connectProfile?.enable_banking?.configured}
            onClick={syncAllBppbAccounts}
            title="Collega o sincronizza i conti BPPB via Enable Banking"
          >
            {busyId != null && (busyId === -2 || items.some((a) => a.id === busyId && isBppbAccount(a)))
              ? 'Sincronizzo…'
              : items.some((a) => isBppbAccount(a) && a.enable_banking_connected)
                ? 'Sincronizza conti BPPB'
                : 'Collega e sincronizza BPPB'}
          </button>
          <Link className="btn btn-secondary" to="/banca/movimenti">
            Vedi movimenti
          </Link>
        </div>
        {!connectProfile?.enable_banking?.configured ? (
          <p className="fatture-note" style={{ marginTop: '0.6rem' }}>
            Enable Banking non configurato sul server.
          </p>
        ) : null}
      </section>

      <section className="card fatture-panel">
        <h2 className="fatture-panel-title">BCC — Sincronizza conti</h2>
        <p className="fatture-note" style={{ marginBottom: '0.75rem' }}>
          Scarica saldi e movimenti da BCC Terra d&apos;Otranto e li mostra in Atlas
          (Conti + Movimenti banca). Se i conti non ci sono, li crea automaticamente.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busyId != null || !connectProfile?.enable_banking?.configured}
            onClick={syncAllBccAccounts}
            title="Collega o sincronizza i conti BCC via Enable Banking"
          >
            {busyId != null && (busyId === -1 || items.some((a) => a.id === busyId && isBccTerraOtrantoAccount(a)))
              ? 'Sincronizzo…'
              : items.some((a) => isBccTerraOtrantoAccount(a) && a.enable_banking_connected)
                ? 'Sincronizza conti BCC'
                : 'Collega e sincronizza BCC'}
          </button>
          <Link className="btn btn-secondary" to="/banca/movimenti">
            Vedi movimenti
          </Link>
        </div>
        {!connectProfile?.enable_banking?.configured ? (
          <p className="fatture-note" style={{ marginTop: '0.6rem' }}>
            Enable Banking non configurato sul server.
          </p>
        ) : null}
      </section>

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
        {pendingMovements.length > 0 ? (
          <p className="fatture-note" style={{ marginTop: '0.75rem' }}>
            <strong>{pendingMovements.length} movimenti</strong> pronti per l’import.
          </p>
        ) : null}
      </section>

      <section className="card fatture-panel banca-fit-panel">
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
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                <select
                  className="form-control"
                  style={{ minWidth: 150, maxWidth: 190, padding: '0.2rem 0.35rem', fontSize: '0.8rem' }}
                  value={a.company || ''}
                  disabled={busyId === a.id}
                  title="Società per i mastrini"
                  onChange={(e) => saveMastriniLink(a, { company: e.target.value, ledger_code: a.ledger_code || '1100' })}
                >
                  <option value="">Condiviso (tutte)</option>
                  {FATTURE_COMPANY_ORDER.map((id) => (
                    <option key={id} value={id}>
                      {FATTURE_COMPANY_LABELS[id] || id}
                    </option>
                  ))}
                </select>
                <select
                  className="form-control"
                  style={{ minWidth: 88, maxWidth: 100, padding: '0.2rem 0.35rem', fontSize: '0.8rem' }}
                  value={a.ledger_code || '1100'}
                  disabled={busyId === a.id}
                  title="Codice mastro banca"
                  onChange={(e) => saveMastriniLink(a, { company: a.company || '', ledger_code: e.target.value })}
                >
                  <option value="1100">1100</option>
                  <option value="1101">1101</option>
                  <option value="1102">1102</option>
                </select>
                {a.enable_banking_connected || a.connection_status === 'connected' ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busyId === a.id}
                    onClick={() => run(a.id, disconnectBancaAccount, 'Conto disconnesso')}
                  >
                    Disconnetti
                  </button>
                ) : null}
                {a.enable_banking_connected ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busyId === a.id}
                    title="Scarica saldi e movimenti e aggiorna Atlas"
                    onClick={() => syncBankAccount(a.id)}
                  >
                    {busyId === a.id
                      ? '…'
                      : isBppbAccount(a) || isBccTerraOtrantoAccount(a)
                        ? 'Sincronizza conti'
                        : 'Sincronizza'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busyId === a.id || !connectProfile?.enable_banking?.configured}
                    onClick={() => startEnableBanking(a.id)}
                    title="Collega via Enable Banking (SCA + consenso API)"
                  >
                    {isBppbAccount(a) ? 'Collega BPPB' : isBccTerraOtrantoAccount(a) ? 'Collega BCC' : 'Enable Banking'}
                  </button>
                )}
                {!a.enable_banking_connected && a.connection_status !== 'connected' ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busyId === a.id}
                    onClick={() => startConnect(a.id)}
                    title="Login con BANK_USERNAME/PASSWORD da .env + OTP"
                  >
                    {a.connection_status === 'pending' ? 'Reinvia OTP' : 'Collega OTP'}
                  </button>
                ) : null}
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
                  className="btn btn-secondary btn-sm"
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
  const [syncBusy, setSyncBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [lastSyncedLabel, setLastSyncedLabel] = useState('')

  const selectedAccount = accountId
    ? accounts.find((a) => String(a.id) === String(accountId)) || null
    : null

  const viewAccountLabel = selectedAccount
    ? formatBankAccountOptionLabel(selectedAccount)
    : lastSyncedLabel || 'Tutti i conti'

  const pageTitle = selectedAccount
    ? `Movimenti bancari · ${selectedAccount.bank_name || 'Banca'}`
    : 'Movimenti bancari'

  const pageLead = selectedAccount
    ? `Conto: ${formatBankAccountOptionLabel(selectedAccount)}`
    : lastSyncedLabel
      ? `Ultimo aggiornamento: ${lastSyncedLabel}. Seleziona un conto nel filtro per vedere solo quello.`
      : 'Seleziona banca/conto nel filtro, poi Filtra o Aggiorna. Nella colonna Conto vedi banca · società · IBAN.'

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

  async function aggiornaMovimenti() {
    setSyncBusy(true)
    setError('')
    setSuccess('')
    try {
      const selected = accountId
        ? accounts.find((a) => String(a.id) === String(accountId))
        : null
      const targets = selected
        ? selected.enable_banking_connected
          ? [selected]
          : []
        : accounts.filter((a) => a.enable_banking_connected)

      if (!targets.length) {
        if (selected && !selected.enable_banking_connected) {
          setError(
            `Il conto «${formatBankAccountOptionLabel(selected)}» non è collegato a Enable Banking. Collegalo da Conti correnti.`,
          )
        } else {
          setError('Nessun conto Enable Banking collegato. Usa Collega/Sincronizza in Conti correnti.')
        }
        await load()
        return
      }

      let totalImported = 0
      for (const acc of targets) {
        const res = await syncEnableBankingAccount(acc.id)
        totalImported += Number(res?.imported || 0)
      }
      if (targets.length === 1) {
        const label = formatBankAccountOptionLabel(targets[0])
        setLastSyncedLabel(label)
        // Resta sul conto aggiornato così titolo ed elenco coincidono
        setAccountId(String(targets[0].id))
        setSuccess(`Aggiornato ${label}: ${totalImported} nuovi movimenti.`)
      } else {
        setLastSyncedLabel(`${targets.length} conti sincronizzati`)
        setSuccess(`Aggiornati ${targets.length} conti: ${totalImported} nuovi movimenti.`)
      }
      await load()
    } catch (e) {
      setError(e?.message || 'Aggiornamento movimenti fallito')
      await load()
    } finally {
      setSyncBusy(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  return (
    <BancaPageShell title={pageTitle} lead={pageLead}>
      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}
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
          <label style={{ minWidth: 280, flex: '1 1 280px' }}>
            Banca / conto
            <select
              className="form-control"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              title="Scegli quale banca e conto stai guardando"
            >
              <option value="">Tutti i conti</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {formatBankAccountOptionLabel(a)}
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
          <button type="submit" className="btn btn-primary" disabled={loading || syncBusy}>
            Filtra
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={loading || syncBusy}
            onClick={() => void aggiornaMovimenti()}
            title={
              accountId
                ? `Aggiorna solo: ${viewAccountLabel}`
                : 'Aggiorna tutti i conti Enable Banking collegati'
            }
          >
            {syncBusy ? 'Aggiorno…' : 'Aggiorna'}
          </button>
        </form>
        <p className="fatture-note" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
          Stai vedendo:{' '}
          <strong>{viewAccountLabel}</strong>
          {selectedAccount?.company ? (
            <> · società mastrini: <strong>{companyLabel(selectedAccount.company)}</strong></>
          ) : null}
        </p>
      </section>

      <section className="card fatture-panel banca-fit-panel">
        {loading || syncBusy ? (
          <AnalisiLoadingBar
            active
            label={
              syncBusy
                ? `Sincronizzazione · ${viewAccountLabel}`
                : `Caricamento · ${viewAccountLabel}`
            }
            variant="subtle"
          />
        ) : (
          <WorkbookGrid
            title={`Movimenti bancari · ${viewAccountLabel}`}
            sheetLabel={`${items.length} movimenti`}
            columns={BANK_MOVEMENTS_COLUMNS}
            rows={items}
            cellValue={bankMovementsCellValue}
            emptyMessage={`Nessun movimento per «${viewAccountLabel}». Usa Aggiorna oppure Sincronizza in Conti correnti.`}
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
  const { companies, companyId, setCompanyId, loadingCompanies } = useFattureCompany(true)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busyId, setBusyId] = useState(null)

  async function reload(nextCompany = companyId, { auto = true } = {}) {
    if (!nextCompany) {
      setData(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = auto
        ? await postBancaRiconciliazioneAuto(nextCompany)
        : await fetchBancaRiconciliazione(nextCompany)
      setData(res)
      const n = Number(res?.auto_applied) || 0
      if (auto && n > 0) {
        setSuccess(`Riconciliati automaticamente ${n} movimenti (n. documento o importo esatto).`)
      } else if (auto) {
        setSuccess('Nessun nuovo match sicuro da applicare. Restano difference e unmatched da controllare.')
      }
    } catch (e) {
      setError(e?.message || 'Errore riconciliazione')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload(companyId, { auto: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

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
      await reload(companyId, { auto: true })
    } catch (e) {
      setError(e?.message || 'Errore salvataggio')
    } finally {
      setBusyId(null)
    }
  }

  const paidRows = data?.paid_by_bank || []
  const unpaidRows = data?.da_pagare || []
  const companyName = companyId ? companyLabel(companyId) : ''
  const pendingSuggestions = (data?.suggestions || []).filter((s) => s?.status !== 'matched')

  return (
    <BancaPageShell
      title="Riconciliazione automatica"
      lead={
        companyId
          ? `Fatture ${companyName}: i match sicuri (n. documento o importo uguale) si applicano da soli. Controlla solo difference e unmatched.`
          : 'Scegli la società nel banner verde: Atlas riconcilia automaticamente i match sicuri.'
      }
      actions={
        <aside className="mastrini-hero-tools" aria-label="Società riconciliazione">
          <FattureCompanySelect
            className="mastrini-hero-tools-company"
            companies={[...companies, { id: 'non_classificata', label: 'Non classificate' }]}
            value={companyId}
            onChange={setCompanyId}
            loading={loadingCompanies}
          />
          <div className="mastrini-hero-tools-btns">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setSuccess('')
                reload(companyId, { auto: true })
              }}
              disabled={loading || !companyId}
            >
              {loading ? 'Riconcilio…' : 'Aggiorna e riconcilia'}
            </button>
          </div>
        </aside>
      }
    >
      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {!companyId ? (
        <p className="fatture-note">Seleziona una società dal menu nel banner verde per avviare la riconciliazione.</p>
      ) : null}

      {companyId ? (
        <>
          <div className="ui-kpi-row">
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Pagate / trovate in banca</div>
              <div className="ui-kpi-card-value">{data?.paid_count ?? paidRows.length ?? '—'}</div>
            </div>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Da pagare</div>
              <div className="ui-kpi-card-value">{data?.open_invoices_count ?? unpaidRows.length ?? '—'}</div>
            </div>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Uscite da riconciliare</div>
              <div className="ui-kpi-card-value">{data?.unmatched_movements ?? '—'}</div>
            </div>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Conti usati</div>
              <div className="ui-kpi-card-value" style={{ fontSize: '0.95rem' }}>
                {(data?.accounts_used || []).map((a) => a.label).filter(Boolean).join(' · ') || '—'}
              </div>
            </div>
          </div>

          {loading ? <AnalisiLoadingBar active label="Confronto fatture e movimenti banca" variant="subtle" /> : null}

          {!loading ? (
            <>
              <section className="card fatture-panel banca-fit-panel">
                <h2 className="fatture-panel-title">Da pagare</h2>
                <p className="fatture-note" style={{ marginTop: 0 }}>
                  Fatture aperte senza n. documento nei movimenti banca del c/c collegato a questa società.
                </p>
                <WorkbookGrid
                  title="Fatture da pagare"
                  sheetLabel={`${unpaidRows.length} doc.`}
                  columns={BANK_INVOICE_STATUS_COLUMNS}
                  rows={unpaidRows}
                  cellValue={bankInvoiceStatusCellValue}
                  emptyMessage="Nessuna fattura da pagare per questa società (o tutte trovano riscontro in banca)."
                  gridClassName="banca-fit-grid"
                  rowKey={(row) => row.invoice_id}
                  totals={
                    unpaidRows.length
                      ? {
                          total: unpaidRows.reduce((a, r) => a + (Number(r.total) || 0), 0),
                          residuo: unpaidRows.reduce((a, r) => a + (Number(r.residuo) || 0), 0),
                        }
                      : null
                  }
                  totalsLabel={(colId, totals) => {
                    if (colId === 'supplier_name') return 'TOTALI'
                    if (colId === 'total') return eur(totals?.total)
                    if (colId === 'residuo') return eur(totals?.residuo)
                    return ''
                  }}
                />
              </section>

              <section className="card fatture-panel banca-fit-panel">
                <h2 className="fatture-panel-title">Pagate / trovate in banca</h2>
                <p className="fatture-note" style={{ marginTop: 0 }}>
                  Fatture già pagate in Atlas oppure con n. documento presente in descrizione/causale movimento.
                </p>
                <WorkbookGrid
                  title="Fatture pagate o trovate"
                  sheetLabel={`${paidRows.length} doc.`}
                  columns={BANK_INVOICE_STATUS_COLUMNS}
                  rows={paidRows}
                  cellValue={bankInvoiceStatusCellValue}
                  emptyMessage="Nessuna fattura trovata come pagata o nei movimenti."
                  gridClassName="banca-fit-grid"
                  rowKey={(row) => `paid-${row.invoice_id}`}
                  totals={
                    paidRows.length
                      ? {
                          total: paidRows.reduce((a, r) => a + (Number(r.total) || 0), 0),
                          residuo: paidRows.reduce((a, r) => a + (Number(r.residuo) || 0), 0),
                        }
                      : null
                  }
                  totalsLabel={(colId, totals) => {
                    if (colId === 'supplier_name') return 'TOTALI'
                    if (colId === 'total') return eur(totals?.total)
                    if (colId === 'residuo') return eur(totals?.residuo)
                    return ''
                  }}
                />
              </section>

              <section className="card fatture-panel banca-fit-panel">
                <h2 className="fatture-panel-title">Da controllare (difference / unmatched)</h2>
                <p className="fatture-note" style={{ marginTop: 0 }}>
                  I match sicuri sono già salvati in automatico. Qui restano solo importi diversi (
                  <strong>difference</strong>) o senza fattura (<strong>unmatched</strong>) — conferma a mano se serve.
                </p>
                <WorkbookGrid
                  title="Residui da controllare"
                  sheetLabel={`${pendingSuggestions.length} righe`}
                  columns={BANK_RECON_COLUMNS}
                  rows={pendingSuggestions}
                  cellValue={bankReconCellValue}
                  emptyMessage="Niente da controllare: tutto riconciliato automaticamente o nessun movimento in uscita."
                  gridClassName="banca-fit-grid"
                  rowKey={(row, idx) => row?.movement?.id || idx}
                  totals={{
                    amount: pendingSuggestions.reduce((acc, row) => acc + (Number(row?.movement?.amount) || 0), 0),
                    difference: pendingSuggestions.reduce(
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
              </section>
            </>
          ) : null}
        </>
      ) : null}
    </BancaPageShell>
  )
}
