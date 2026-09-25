import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AmministrazionePageShell,
  BancaPageShell,
  eur,
  formatDate,
  reconciliationStatusLabel,
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
  fetchBancaRiconciliazioneAgent,
  importBanMovements,
  postBancaRiconcilia,
  postBancaRiconciliazioneAuto,
  runBancaRiconciliazioneAgent,
  startEnableBankingAuth,
  syncBancaAccount,
  syncEnableBankingAccount,
  unsyncBancaAccount,
  updateBancaAccount,
} from '../services/bancaService'
import { SeriesBars } from '../components/FattureShared.jsx'
import WorkbookGrid from '../components/WorkbookGrid.jsx'
import { parseBanFile } from '../utils/banFileParser'
import { companyLabel, FATTURE_COMPANY_ORDER, FATTURE_COMPANY_LABELS } from '../utils/fattureCompany.js'
import { printVneTable } from '../utils/vneTableExport.js'

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
      psu_type: 'business',
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

function isIntesaAccount(account) {
  if (isBppbAccount(account) || isBccTerraOtrantoAccount(account)) return false
  const bank = String(account?.bank_name || '').toLowerCase()
  const label = `${bank} ${String(account?.account_name || '').toLowerCase()} ${String(account?.notes || '').toLowerCase()}`
  const iban = String(account?.iban || '').replace(/\s/g, '').toUpperCase()
  return (
    bank.includes('intesa')
    || bank.includes('sanpaolo')
    || label.includes('intesa')
    || label.includes('sanpaolo')
    || iban === 'IT88N0306979822100000008926'
  )
}

function isUnicreditAccount(account) {
  if (isBppbAccount(account) || isBccTerraOtrantoAccount(account) || isIntesaAccount(account)) return false
  const bank = String(account?.bank_name || '').toLowerCase()
  const label = `${bank} ${String(account?.account_name || '').toLowerCase()} ${String(account?.notes || '').toLowerCase()}`
  const iban = String(account?.iban || '').replace(/\s/g, '').toUpperCase()
  return bank.includes('unicredit') || label.includes('unicredit') || iban === 'IT48Q0200816005000105294153'
}

function bankAccountSortKey(account) {
  const company = String(account?.company || '').toLowerCase()
  if (company === 'via_lattea') return '0'
  if (company.startsWith('mediazione')) return '1'
  if (company === 'risacca') return '2'
  if (company === 'pg') return '3'
  return `9${company}`
}

function sortBankAccounts(list) {
  return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
    const ka = bankAccountSortKey(a)
    const kb = bankAccountSortKey(b)
    if (ka !== kb) return ka.localeCompare(kb)
    return String(a?.account_name || '').localeCompare(String(b?.account_name || ''), 'it')
  })
}

function bankAccountIbanKey(account) {
  return String(account?.iban || '').replace(/\s/g, '').toUpperCase()
}

/** Stesso IBAN: tieni il conto collegato e nascondi il duplicato scollegato. */
function preferConnectedDuplicates(list) {
  const byIban = new Map()
  const withoutIban = []
  for (const account of sortBankAccounts(list)) {
    const key = bankAccountIbanKey(account)
    if (!key) {
      withoutIban.push(account)
      continue
    }
    const previous = byIban.get(key)
    if (!previous || (account.enable_banking_connected && !previous.enable_banking_connected)) {
      byIban.set(key, account)
    }
  }
  return sortBankAccounts([...byIban.values(), ...withoutIban])
}

/** Etichetta chiara in filtri/elenchi: banca · società · IBAN corto. */
function formatBankAccountOptionLabel(account) {
  if (account?.label) return String(account.label)
  const bank = String(account?.bank_name || 'Banca').trim() || 'Banca'
  const companyId = String(account?.company || '').trim().toLowerCase()
  const shortCompany = {
    via_lattea: 'Via Lattea',
    mediazione_a: 'Mediazione A',
    mediazione_z: 'Mediazione Z',
    mediazione: 'Mediazione',
    risacca: 'Risacca',
    pg: 'PG',
  }
  const company = shortCompany[companyId] || (companyId ? companyLabel(account.company) : '')
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
    account_name: 'Mediazione · CC1410004512',
    iban: 'IT55B0538516000CC1410004512',
    company: 'mediazione_a',
    ledger_code: '1100',
    notes: 'MEDIAZIONE · BPPB · IBAN IT55B0538516000CC1410004512 · ABI 05385. Collegare via Enable Banking.',
  },
]

const INTESA_SEED_ACCOUNTS = [
  {
    bank_name: 'Intesa Sanpaolo',
    account_name: 'Risacca · Bar Momento · Intesa',
    iban: 'IT88N0306979822100000008926',
    company: 'risacca',
    ledger_code: '1100',
    notes:
      'RISACCA S.R.L. · Filiale Nardò · BIC BCITITMM · Conto Business Insieme · CC 66494/1000/00008926',
  },
]

const UNICREDIT_SEED_ACCOUNTS = [
  {
    bank_name: 'UniCredit',
    account_name: 'Conto corrente Lecce Foscarini',
    iban: 'IT48Q0200816005000105294153',
    ledger_code: '1100',
    notes: 'UniCredit LECCE FOSCARINI · BIC UNCRITM1L32 · Enable Banking',
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
  if (col.id === 'status') return reconciliationStatusLabel(row?.reconciliation_status)
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
  { id: 'date', label: 'Data', width: 8, fluid: true },
  { id: 'counterparty', label: 'Beneficiario', width: 16, fluid: true, emphasis: true },
  { id: 'description', label: 'Descrizione / causale', width: 20, fluid: true },
  { id: 'linked_invoice', label: 'Fattura collegata', width: 14, fluid: true },
  { id: 'type', label: 'Entrata/Uscita', width: 8, fluid: true },
  { id: 'amount', label: 'Importo', width: 10, fluid: true, numeric: true },
  { id: 'account', label: 'Conto', width: 14, fluid: true },
  { id: 'status', label: 'Riconciliazione', width: 8, fluid: true },
]

function bankMovementsCellValue(row, col) {
  if (col.id === 'date') return formatDate(row?.movement_date)
  if (col.id === 'counterparty') {
    const who = String(row?.counterparty || '').trim()
    if (who) return who
    // Fallback: molte banche mettono solo "BONIFICO DISPOSTO" in descrizione
    return '—'
  }
  if (col.id === 'description') {
    const desc = String(row?.description || '').trim()
    const who = String(row?.counterparty || '').trim()
    if (desc && who && !desc.toLowerCase().includes(who.toLowerCase())) {
      return `${who} · ${desc}`
    }
    return desc || who || '—'
  }
  if (col.id === 'linked_invoice') {
    const inv = row?.matched_invoice
    if (!inv) return row?.matched_invoice_id ? `Fattura #${row.matched_invoice_id}` : '—'
    const num = inv.invoice_number || inv.id
    const supplier = inv.supplier_name ? ` · ${inv.supplier_name}` : ''
    return `Fattura ${num}${supplier}`
  }
  if (col.id === 'type') return row?.movement_type === 'entrata' ? 'Entrata' : 'Uscita'
  if (col.id === 'amount') return eur(row?.amount)
  if (col.id === 'account') {
    if (row?.account_label) return row.account_label
    const bits = [row?.account_bank_name || row?.bank_name, row?.account_name, row?.account_company]
      .map((x) => String(x || '').trim())
      .filter(Boolean)
    return bits.length ? bits.join(' · ') : '—'
  }
  if (col.id === 'status') return reconciliationStatusLabel(row?.reconciliation_status)
  return ''
}

const BANK_RECON_COLUMNS = [
  { id: 'movement', label: 'Movimento', width: 28, fluid: true, emphasis: true },
  { id: 'amount', label: 'Importo', width: 11, fluid: true, numeric: true },
  { id: 'invoice', label: 'Proposta fattura', width: 28, fluid: true },
  { id: 'score', label: 'Score', width: 9, fluid: true, numeric: true },
  { id: 'difference', label: 'Differenza', width: 11, fluid: true, numeric: true },
  {
    id: 'status',
    label: 'Esito',
    width: 13,
    fluid: true,
    tone: (row) =>
      row?.status === 'matched'
        ? 'banca-recon-ok-cell'
        : row?.status === 'difference'
          ? 'banca-recon-warn-cell'
          : 'banca-recon-open-cell',
  },
]

const BANK_INVOICE_STATUS_COLUMNS = [
  { id: 'invoice_number', label: 'N. doc.', width: 10, fluid: true, emphasis: true },
  { id: 'invoice_date', label: 'Data', width: 8, fluid: true },
  { id: 'supplier_name', label: 'Fornitore', width: 18, fluid: true },
  { id: 'total', label: 'Totale fattura', width: 10, fluid: true, numeric: true },
  { id: 'bank_amount', label: 'Importo banca', width: 10, fluid: true, numeric: true },
  { id: 'residuo', label: 'Residuo', width: 9, fluid: true, numeric: true },
  { id: 'bank_hit', label: 'Movimento collegato', width: 15, fluid: true },
  { id: 'score', label: 'Score', width: 7, fluid: true, numeric: true },
  {
    id: 'ok',
    label: 'OK',
    width: 5,
    fluid: true,
    tone: (row) => (invoiceIsAligned(row) ? 'banca-recon-ok-cell' : 'banca-recon-open-cell'),
  },
  { id: 'reason', label: 'Esito', width: 10, fluid: true },
]

function invoiceIsAligned(row) {
  if (!row) return false
  if (row.aligned || row.paid_ok) return true
  if (row.match_band === 'auto' || (Number(row.match_score) || 0) >= 80) return true
  const reason = String(row.match_reason || '')
  if (
    [
      'matched',
      'numero_in_movimento',
      'importo_in_movimento',
      'file_contanti',
      'file_pagamenti',
      'score_auto',
    ].includes(reason)
  ) {
    return true
  }
  return false
}

function formatMatchScore(row) {
  const score = row?.match_score ?? row?.suggested_invoice?.match_score
  if (score == null || score === '') return '—'
  const n = Number(score)
  if (!Number.isFinite(n)) return '—'
  const band = row?.match_band || row?.suggested_invoice?.match_band
  const bandLabel = band === 'auto' ? 'auto' : band === 'probable' ? 'prob.' : band === 'review' ? 'review' : ''
  return bandLabel ? `${Math.round(n)}% · ${bandLabel}` : `${Math.round(n)}%`
}

function bankReconCellValue(row, col) {
  if (col.id === 'movement') {
    const m = row?.movement
    const who = String(m?.counterparty || '').trim()
    const desc = String(m?.description || '').trim()
    const text =
      who && desc && !desc.toLowerCase().includes(who.toLowerCase())
        ? `${who} · ${desc}`
        : who || desc || '—'
    return [formatDate(m?.movement_date), text].filter(Boolean).join(' · ')
  }
  if (col.id === 'amount') return eur(row?.movement?.amount)
  if (col.id === 'invoice') {
    if (!row?.suggested_invoice) return 'Nessuna proposta'
    const inv = row.suggested_invoice
    const quality =
      inv.match_quality === 'number'
        ? 'n. doc.'
        : inv.match_quality === 'exact'
          ? 'importo'
          : inv.match_quality === 'near'
            ? 'vicino'
            : ''
    const bits = [
      inv.supplier_name || '—',
      `n. ${inv.invoice_number || '—'}`,
      `Residuo ${eur(inv.residuo)}`,
    ]
    if (quality) bits.push(quality)
    return bits.join(' · ')
  }
  if (col.id === 'score') return formatMatchScore(row)
  if (col.id === 'difference') return row?.suggested_invoice ? eur(row.suggested_invoice.difference) : '—'
  if (col.id === 'status') {
    if (row?.status === 'matched') return '✔ Riconciliato'
    if (row?.match_band === 'probable' || (Number(row?.match_score) || 0) >= 70) {
      return 'Da confermare'
    }
    return reconciliationStatusLabel(row?.status)
  }
  return ''
}

function bankInvoiceStatusCellValue(row, col) {
  if (col.id === 'ok') return invoiceIsAligned(row) ? '✔' : '○'
  if (col.id === 'invoice_number') return row?.invoice_number || '—'
  if (col.id === 'invoice_date') return formatDate(row?.invoice_date)
  if (col.id === 'supplier_name') return row?.supplier_name || '—'
  if (col.id === 'total') return eur(row?.total)
  if (col.id === 'bank_amount') {
    const m = row?.matched_movement
    if (m?.amount != null && m.amount !== '') return eur(m.amount)
    if (invoiceIsAligned(row)) return eur(row?.total)
    return '—'
  }
  if (col.id === 'residuo') return eur(row?.residuo)
  if (col.id === 'score') return formatMatchScore(row)
  if (col.id === 'bank_hit') {
    const m = row?.matched_movement
    if (!m) {
      if (row?.match_reason === 'file_contanti' || row?.match_reason === 'file_pagamenti') {
        return 'Contanti (file Pagamenti)'
      }
      return invoiceIsAligned(row) ? 'Pagata' : '—'
    }
    const cro = m.bonifico_ref ? `CRO ${m.bonifico_ref}` : ''
    const who = String(m.counterparty || '').trim()
    const desc = String(m.description || m.causale || '').trim()
    const text =
      who && desc && !desc.toLowerCase().includes(who.toLowerCase())
        ? `${who} · ${desc}`
        : who || desc || (m.id != null ? `BA-${m.id}` : '')
    return [formatDate(m.movement_date), cro, text].filter(Boolean).join(' · ')
  }
  if (col.id === 'reason') {
    if (row?.match_reason === 'numero_in_movimento') return '✔ N. in banca'
    if (row?.match_reason === 'importo_in_movimento') return '✔ Importo in banca'
    if (row?.match_reason === 'score_auto') return '✔ Score ≥80'
    if (row?.match_reason === 'matched') return '✔ Riconciliata'
    if (row?.match_reason === 'file_contanti' || row?.match_reason === 'file_pagamenti') {
      return '✔ Contanti'
    }
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

  const societa = Array.isArray(data?.societa) ? data.societa : []
  const banner = societa.length ? (
    <div className="banca-hero-companies" aria-label="Saldi per società">
      {societa.map((row) => (
        <article key={row.company} className="banca-hero-company">
          <header className="banca-hero-company-head">
            <h2>{row.label}</h2>
            <strong>{eur(row.saldo)}</strong>
          </header>
          <p className="banca-hero-company-today">
            Oggi {eur(row.entrate_oggi)} entrate · {eur(row.uscite_oggi)} uscite
          </p>
          <ul className="banca-hero-company-accounts">
            {(row.conti || []).map((conto) => (
              <li key={conto.id}>
                <span>{conto.bank_name || conto.label}</span>
                <span>{eur(conto.saldo_disponibile)}</span>
              </li>
            ))}
          </ul>
          <ul className="banca-hero-company-moves">
            {(row.ultimi_movimenti || []).length === 0 ? (
              <li>Nessun movimento recente</li>
            ) : (
              row.ultimi_movimenti.map((mov) => (
                <li key={mov.id}>
                  <span>{formatDate(mov.movement_date)}</span>
                  <span>{mov.description || '—'}</span>
                  <span className={mov.movement_type === 'entrata' ? 'is-in' : 'is-out'}>
                    {mov.movement_type === 'uscita' ? '−' : '+'}
                    {eur(mov.amount)}
                  </span>
                </li>
              ))
            )}
          </ul>
        </article>
      ))}
    </div>
  ) : null

  return (
    <BancaPageShell
      title="Dashboard bancaria"
      lead="Saldi e ultimi movimenti divisi per società e per conto collegato."
      banner={banner}
    >
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
  const [bppbSelectedId, setBppbSelectedId] = useState('')
  const [bccSelectedId, setBccSelectedId] = useState('')
  const [intesaSelectedId, setIntesaSelectedId] = useState('')
  const [unicreditSelectedId, setUnicreditSelectedId] = useState('')
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
    const bppb = preferConnectedDuplicates(items.filter(isBppbAccount))
    if (!bppb.length) return
    const stillValid = bppb.some((a) => String(a.id) === String(bppbSelectedId))
    if (stillValid) return
    const prefer =
      bppb.find((a) => String(a.company || '').toLowerCase() === 'via_lattea')
      || bppb.find((a) => String(a.iban || '').replace(/\s/g, '').toUpperCase() === 'IT25D0538516000CC1410004514')
      || bppb[0]
    setBppbSelectedId(String(prefer.id))
  }, [items, bppbSelectedId])

  useEffect(() => {
    const bcc = preferConnectedDuplicates(items.filter(isBccTerraOtrantoAccount))
    if (!bcc.length) return
    if (bcc.some((a) => String(a.id) === String(bccSelectedId))) return
    const prefer =
      bcc.find((a) => String(a.company || '').toLowerCase() === 'via_lattea')
      || bcc.find((a) => String(a.iban || '').replace(/\s/g, '').toUpperCase() === 'IT37M0844516000000000967252')
      || bcc[0]
    setBccSelectedId(String(prefer.id))
  }, [items, bccSelectedId])

  useEffect(() => {
    const intesa = preferConnectedDuplicates(items.filter(isIntesaAccount))
    if (!intesa.length) return
    if (intesa.some((a) => String(a.id) === String(intesaSelectedId))) return
    setIntesaSelectedId(String(intesa[0].id))
  }, [items, intesaSelectedId])

  useEffect(() => {
    const unicredit = preferConnectedDuplicates(items.filter(isUnicreditAccount))
    if (!unicredit.length) return
    if (unicredit.some((a) => String(a.id) === String(unicreditSelectedId))) return
    setUnicreditSelectedId(String(unicredit[0].id))
  }, [items, unicreditSelectedId])

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
      const isIntesa =
        bankQ === 'intesa'
        || aspspL.includes('intesa')
        || aspspL.includes('sanpaolo')
        || appQ === 'a72e10f6-6d02-420f-842d-344b892f10e6'
      if (low.includes('server_error')) {
        if (isBppb && !isBcc) {
          setError(
            'BPPB Via Lattea (Enable Banking): errore lato banca (server_error) durante Collega. '
              + 'Non è BCC: stai collegando Banca Popolare di Puglia e Basilicata'
              + (appQ ? ` (app ${appQ})` : ' (app b88c128a…)')
              + '. Riprova Collega BPPB; se «Sincronizza conti BPPB» funziona, quel conto è già collegato e puoi usare solo Sincronizza.',
          )
        } else if (isIntesa) {
          setError(
            'Intesa Sanpaolo (Enable Banking beta): errore lato banca (server_error). '
              + 'Il conto Risacca è un accesso IMPRESA. Riprova Collega; '
              + 'se persiste, Control Panel → app a72e10f6… → Requests.',
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
      const saldoDisp = res?.account?.saldo_disponibile
      const saldoCont = res?.account?.saldo_contabile
      const bits = []
      if (Number.isFinite(Number(saldoDisp))) bits.push(`disponibile ${eur(saldoDisp)}`)
      if (Number.isFinite(Number(saldoCont)) && Number(saldoCont) !== Number(saldoDisp)) {
        bits.push(`contabile ${eur(saldoCont)}`)
      }
      bits.push(`${imported} nuovi movimenti`)
      setSuccess(res?.message || `Conti sincronizzati: ${bits.join(' · ')}. Vedi Movimenti banca.`)
      await reload()
    } catch (err) {
      setError(err?.message || 'Sincronizzazione fallita')
    } finally {
      setBusyId(null)
    }
  }

  async function ensureBppbAccounts() {
    setBusyId(-2)
    setError('')
    setSuccess('')
    try {
      let list = items
      const existingIbans = new Set(
        list.map((a) => String(a.iban || '').replace(/\s/g, '').toUpperCase()).filter(Boolean),
      )
      // Aggiorna eventuale IBAN Via Lattea precedente
      const oldVl = list.find(
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
      // Allinea società/nome se il conto Via Lattea è ancora su Mediazione
      const viaLattea = list.find(
        (a) => String(a.iban || '').replace(/\s/g, '').toUpperCase() === 'IT25D0538516000CC1410004514',
      )
      if (viaLattea?.id && String(viaLattea.company || '').toLowerCase() !== 'via_lattea') {
        await updateBancaAccount(viaLattea.id, {
          account_name: 'Via Lattea · CC1410004514',
          company: 'via_lattea',
          bank_name: 'BPPB - Banca Popolare di Puglia e Basilicata',
        })
      }
      let created = false
      for (const seed of BPPB_SEED_ACCOUNTS) {
        const iban = seed.iban.replace(/\s/g, '').toUpperCase()
        if (existingIbans.has(iban)) continue
        await createBancaAccount(seed)
        created = true
      }
      if (created || oldVl?.id || (viaLattea?.id && String(viaLattea.company || '').toLowerCase() !== 'via_lattea')) {
        const res = await fetchBancaAccounts()
        list = Array.isArray(res?.items) ? res.items : []
        setItems(list)
      }
      return list.filter(isBppbAccount)
    } catch (err) {
      setError(err?.message || 'Impossibile creare i conti BPPB')
      return items.filter(isBppbAccount)
    } finally {
      setBusyId(null)
    }
  }

  async function syncSelectedBppbAccount() {
    let bppb = await ensureBppbAccounts()
    if (!bppb.length) {
      setError('Nessun conto BPPB in elenco.')
      return
    }
    let selected =
      bppb.find((a) => String(a.id) === String(bppbSelectedId))
      || bppb.find((a) => String(a.company || '').toLowerCase() === 'via_lattea')
      || bppb.find((a) => String(a.iban || '').replace(/\s/g, '').toUpperCase() === 'IT25D0538516000CC1410004514')
      || bppb[0]
    setBppbSelectedId(String(selected.id))

    // Allinea etichette/società se il seed Mediazione esiste ma è senza company
    if (
      String(selected.iban || '').replace(/\s/g, '').toUpperCase() === 'IT55B0538516000CC1410004512'
      && !selected.company
    ) {
      try {
        await updateBancaAccount(selected.id, {
          account_name: 'Mediazione · CC1410004512',
          company: 'mediazione_a',
        })
        selected = {
          ...selected,
          account_name: 'Mediazione · CC1410004512',
          company: 'mediazione_a',
        }
      } catch {
        /* ignore label fix errors */
      }
    }

    if (!selected.enable_banking_connected) {
      await startEnableBanking(selected.id)
      return
    }
    setError('')
    setSuccess('')
    setBusyId(selected.id)
    try {
      const res = await syncEnableBankingAccount(selected.id)
      const imported = Number(res?.imported || 0)
      const label = formatBankAccountOptionLabel(selected)
      setSuccess(
        `BPPB «${label}» sincronizzato: ${imported} nuovi movimenti. Apri Movimenti banca per visualizzarli.`,
      )
    } catch (err) {
      setError(err?.message || `Sync fallito per ${formatBankAccountOptionLabel(selected)}`)
    } finally {
      setBusyId(null)
      await reload()
    }
  }

  async function unsyncSelectedBppbAccount() {
    const bppb = items.filter(isBppbAccount)
    const selected = bppb.find((a) => String(a.id) === String(bppbSelectedId)) || bppb[0]
    if (!selected?.id) {
      setError('Seleziona un conto BPPB da scollegare.')
      return
    }
    const label = formatBankAccountOptionLabel(selected)
    const ok = window.confirm(
      `Scollegare «${label}» e cancellare i movimenti importati?\nIl conto resta in elenco: potrai ricollegarlo e reimportare.`,
    )
    if (!ok) return
    setError('')
    setSuccess('')
    setBusyId(selected.id)
    try {
      const res = await unsyncBancaAccount(selected.id)
      setSuccess(res?.message || `Conto «${label}» scollegato.`)
    } catch (err) {
      setError(err?.message || `Scollegamento fallito per ${label}`)
    } finally {
      setBusyId(null)
      await reload()
    }
  }

  async function ensureSeedAccounts(seeds, filterFn, busyMarker, errLabel) {
    setBusyId(busyMarker)
    setError('')
    setSuccess('')
    try {
      let list = items
      const existingIbans = new Set(
        list.map((a) => String(a.iban || '').replace(/\s/g, '').toUpperCase()).filter(Boolean),
      )
      let created = false
      for (const seed of seeds) {
        const seedIban = seed.iban.replace(/\s/g, '').toUpperCase()
        if (existingIbans.has(seedIban)) continue
        await createBancaAccount(seed)
        created = true
      }
      if (created) {
        const res = await fetchBancaAccounts()
        list = Array.isArray(res?.items) ? res.items : []
        setItems(list)
      }
      return list.filter(filterFn)
    } catch (err) {
      setError(err?.message || `Impossibile creare i conti ${errLabel}`)
      return items.filter(filterFn)
    } finally {
      setBusyId(null)
    }
  }

  async function ensureBccAccounts() {
    return ensureSeedAccounts(BCC_SEED_ACCOUNTS, isBccTerraOtrantoAccount, -1, 'BCC')
  }

  async function ensureIntesaAccounts() {
    return ensureSeedAccounts(INTESA_SEED_ACCOUNTS, isIntesaAccount, -3, 'Intesa')
  }

  async function ensureUnicreditAccounts() {
    return ensureSeedAccounts(UNICREDIT_SEED_ACCOUNTS, isUnicreditAccount, -4, 'UniCredit')
  }

  async function syncSelectedBankAccount({
    ensureFn,
    selectedId,
    setSelectedId,
    preferFn,
    bankLabel,
  }) {
    let list = await ensureFn()
    if (!list.length) {
      setError(`Nessun conto ${bankLabel} in elenco.`)
      return
    }
    let selected =
      list.find((a) => String(a.id) === String(selectedId))
      || (preferFn ? preferFn(list) : null)
      || list[0]
    setSelectedId(String(selected.id))

    if (!selected.enable_banking_connected) {
      await startEnableBanking(selected.id)
      return
    }
    setError('')
    setSuccess('')
    setBusyId(selected.id)
    try {
      const res = await syncEnableBankingAccount(selected.id)
      const imported = Number(res?.imported || 0)
      const label = formatBankAccountOptionLabel(selected)
      setSuccess(
        `${bankLabel} «${label}» sincronizzato: ${imported} nuovi movimenti. Apri Movimenti banca per visualizzarli.`,
      )
    } catch (err) {
      setError(err?.message || `Sync fallito per ${formatBankAccountOptionLabel(selected)}`)
    } finally {
      setBusyId(null)
      await reload()
    }
  }

  async function unsyncSelectedBankAccount({ filterFn, selectedId, bankLabel }) {
    const list = items.filter(filterFn)
    const selected = list.find((a) => String(a.id) === String(selectedId)) || list[0]
    if (!selected?.id) {
      setError(`Seleziona un conto ${bankLabel} da scollegare.`)
      return
    }
    const label = formatBankAccountOptionLabel(selected)
    const ok = window.confirm(
      `Scollegare «${label}» e cancellare i movimenti importati?\nIl conto resta in elenco: potrai ricollegarlo e reimportare.`,
    )
    if (!ok) return
    setError('')
    setSuccess('')
    setBusyId(selected.id)
    try {
      const res = await unsyncBancaAccount(selected.id)
      setSuccess(res?.message || `Conto «${label}» scollegato.`)
    } catch (err) {
      setError(err?.message || `Scollegamento fallito per ${label}`)
    } finally {
      setBusyId(null)
      await reload()
    }
  }

  async function syncSelectedBccAccount() {
    await syncSelectedBankAccount({
      ensureFn: ensureBccAccounts,
      selectedId: bccSelectedId,
      setSelectedId: setBccSelectedId,
      preferFn: (list) =>
        list.find((a) => String(a.company || '').toLowerCase() === 'via_lattea')
        || list.find((a) => String(a.iban || '').replace(/\s/g, '').toUpperCase() === 'IT37M0844516000000000967252'),
      bankLabel: 'BCC',
    })
  }

  async function unsyncSelectedBccAccount() {
    await unsyncSelectedBankAccount({
      filterFn: isBccTerraOtrantoAccount,
      selectedId: bccSelectedId,
      bankLabel: 'BCC',
    })
  }

  async function syncSelectedIntesaAccount() {
    await syncSelectedBankAccount({
      ensureFn: ensureIntesaAccounts,
      selectedId: intesaSelectedId,
      setSelectedId: setIntesaSelectedId,
      bankLabel: 'Intesa Sanpaolo',
    })
  }

  async function unsyncSelectedIntesaAccount() {
    await unsyncSelectedBankAccount({
      filterFn: isIntesaAccount,
      selectedId: intesaSelectedId,
      bankLabel: 'Intesa Sanpaolo',
    })
  }

  async function syncSelectedUnicreditAccount() {
    await syncSelectedBankAccount({
      ensureFn: ensureUnicreditAccounts,
      selectedId: unicreditSelectedId,
      setSelectedId: setUnicreditSelectedId,
      bankLabel: 'UniCredit',
    })
  }

  async function unsyncSelectedUnicreditAccount() {
    await unsyncSelectedBankAccount({
      filterFn: isUnicreditAccount,
      selectedId: unicreditSelectedId,
      bankLabel: 'UniCredit',
    })
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
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            className="form-control"
            style={{ minWidth: 260, maxWidth: 420 }}
            value={bppbSelectedId}
            disabled={busyId != null}
            onChange={(e) => setBppbSelectedId(e.target.value)}
            title="Scegli quale conto BPPB importare"
          >
            {items.filter(isBppbAccount).length === 0 ? (
              <option value="">Via Lattea / Mediazione (crea al sync)</option>
            ) : (
              sortBankAccounts(preferConnectedDuplicates(items.filter(isBppbAccount))).map((a) => (
                <option key={a.id} value={String(a.id)}>
                  {formatBankAccountOptionLabel(a)}
                  {a.enable_banking_connected ? ' · collegato' : ' · non collegato'}
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busyId != null || !connectProfile?.enable_banking?.configured}
            onClick={syncSelectedBppbAccount}
            title="Collega o sincronizza solo il conto BPPB selezionato"
          >
            {busyId != null && (busyId === -2 || items.some((a) => a.id === busyId && isBppbAccount(a)))
              ? 'Sincronizzo…'
              : (() => {
                  const sel = items.find((a) => String(a.id) === String(bppbSelectedId) && isBppbAccount(a))
                  if (sel?.enable_banking_connected) return 'Sincronizza conto'
                  return 'Collega e sincronizza'
                })()}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busyId != null || !bppbSelectedId}
            onClick={unsyncSelectedBppbAccount}
            title="Scollega Enable Banking e cancella i movimenti importati del conto selezionato"
          >
            Scollega / svuota movimenti
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
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            className="form-control"
            style={{ minWidth: 260, maxWidth: 420 }}
            value={bccSelectedId}
            disabled={busyId != null}
            onChange={(e) => setBccSelectedId(e.target.value)}
            title="Scegli quale conto BCC importare"
          >
            {items.filter(isBccTerraOtrantoAccount).length === 0 ? (
              <option value="">Via Lattea / Mediazione (crea al sync)</option>
            ) : (
              sortBankAccounts(preferConnectedDuplicates(items.filter(isBccTerraOtrantoAccount))).map((a) => (
                <option key={a.id} value={String(a.id)}>
                  {formatBankAccountOptionLabel(a)}
                  {a.enable_banking_connected ? ' · collegato' : ' · non collegato'}
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busyId != null || !connectProfile?.enable_banking?.configured}
            onClick={syncSelectedBccAccount}
            title="Collega o sincronizza solo il conto BCC selezionato"
          >
            {busyId != null && (busyId === -1 || items.some((a) => a.id === busyId && isBccTerraOtrantoAccount(a)))
              ? 'Sincronizzo…'
              : (() => {
                  const sel = items.find((a) => String(a.id) === String(bccSelectedId) && isBccTerraOtrantoAccount(a))
                  if (sel?.enable_banking_connected) return 'Sincronizza conto'
                  return 'Collega e sincronizza'
                })()}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busyId != null || !bccSelectedId}
            onClick={unsyncSelectedBccAccount}
            title="Scollega Enable Banking e cancella i movimenti importati del conto selezionato"
          >
            Scollega / svuota movimenti
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
        <h2 className="fatture-panel-title">Intesa Sanpaolo — Sincronizza conti</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            className="form-control"
            style={{ minWidth: 260, maxWidth: 420 }}
            value={intesaSelectedId}
            disabled={busyId != null}
            onChange={(e) => setIntesaSelectedId(e.target.value)}
            title="Scegli quale conto Intesa Sanpaolo importare"
          >
            {items.filter(isIntesaAccount).length === 0 ? (
              <option value="">Risacca (crea al sync)</option>
            ) : (
              preferConnectedDuplicates(items.filter(isIntesaAccount)).map((a) => (
                <option key={a.id} value={String(a.id)}>
                  {formatBankAccountOptionLabel(a)}
                  {a.enable_banking_connected ? ' · collegato' : ' · non collegato'}
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busyId != null || !connectProfile?.enable_banking?.configured}
            onClick={syncSelectedIntesaAccount}
            title="Collega o sincronizza solo il conto Intesa selezionato"
          >
            {busyId != null && (busyId === -3 || items.some((a) => a.id === busyId && isIntesaAccount(a)))
              ? 'Sincronizzo…'
              : (() => {
                  const sel = items.find((a) => String(a.id) === String(intesaSelectedId) && isIntesaAccount(a))
                  if (sel?.enable_banking_connected) return 'Sincronizza conto'
                  return 'Collega e sincronizza'
                })()}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busyId != null || !intesaSelectedId}
            onClick={unsyncSelectedIntesaAccount}
            title="Scollega Enable Banking e cancella i movimenti importati del conto selezionato"
          >
            Scollega / svuota movimenti
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
        <h2 className="fatture-panel-title">UniCredit — Sincronizza conti</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            className="form-control"
            style={{ minWidth: 260, maxWidth: 420 }}
            value={unicreditSelectedId}
            disabled={busyId != null}
            onChange={(e) => setUnicreditSelectedId(e.target.value)}
            title="Scegli quale conto UniCredit importare"
          >
            {items.filter(isUnicreditAccount).length === 0 ? (
              <option value="">Lecce Foscarini (crea al sync)</option>
            ) : (
              preferConnectedDuplicates(items.filter(isUnicreditAccount)).map((a) => (
                <option key={a.id} value={String(a.id)}>
                  {formatBankAccountOptionLabel(a)}
                  {a.enable_banking_connected ? ' · collegato' : ' · non collegato'}
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busyId != null || !connectProfile?.enable_banking?.configured}
            onClick={syncSelectedUnicreditAccount}
            title="Collega o sincronizza solo il conto UniCredit selezionato"
          >
            {busyId != null && (busyId === -4 || items.some((a) => a.id === busyId && isUnicreditAccount(a)))
              ? 'Sincronizzo…'
              : (() => {
                  const sel = items.find((a) => String(a.id) === String(unicreditSelectedId) && isUnicreditAccount(a))
                  if (sel?.enable_banking_connected) return 'Sincronizza conto'
                  return 'Collega e sincronizza'
                })()}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busyId != null || !unicreditSelectedId}
            onClick={unsyncSelectedUnicreditAccount}
            title="Scollega Enable Banking e cancella i movimenti importati del conto selezionato"
          >
            Scollega / svuota movimenti
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
      : 'Seleziona banca/conto e Periodo da/a, poi Filtra o Aggiorna (Aggiorna scarica i movimenti sull’intervallo da Enable Banking).'

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
      const periodParams = {
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      }
      for (const acc of targets) {
        const res = await syncEnableBankingAccount(acc.id, periodParams)
        totalImported += Number(res?.imported || 0)
      }
      const periodLabel =
        dateFrom || dateTo
          ? ` (periodo ${dateFrom || '…'} → ${dateTo || '…'})`
          : ''
      if (targets.length === 1) {
        const label = formatBankAccountOptionLabel(targets[0])
        setLastSyncedLabel(label)
        // Resta sul conto aggiornato così titolo ed elenco coincidono
        setAccountId(String(targets[0].id))
        setSuccess(`Aggiornato ${label}: ${totalImported} nuovi movimenti${periodLabel}.`)
      } else {
        setLastSyncedLabel(`${targets.length} conti sincronizzati`)
        setSuccess(`Aggiornati ${targets.length} conti: ${totalImported} nuovi movimenti${periodLabel}.`)
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

  const companyGroups = []
  const byCompany = new Map()
  for (const account of accounts) {
    const id = String(account?.company || '').trim().toLowerCase() || 'condiviso'
    if (!byCompany.has(id)) byCompany.set(id, [])
    byCompany.get(id).push(account)
  }
  const companyIds = [
    ...FATTURE_COMPANY_ORDER.filter((id) => byCompany.has(id)),
    ...[...byCompany.keys()].filter((id) => !FATTURE_COMPANY_ORDER.includes(id)),
  ]
  for (const id of companyIds) {
    companyGroups.push({
      id,
      label: id === 'condiviso' ? 'Condiviso' : companyLabel(id),
      accounts: byCompany.get(id) || [],
    })
  }
  const banner = companyGroups.length ? (
    <div className="banca-hero-companies" aria-label="Conti per società">
      {companyGroups.map((group) => (
        <article key={group.id} className="banca-hero-company">
          <header className="banca-hero-company-head">
            <h2>{group.label}</h2>
            <strong>{group.accounts.length} conti</strong>
          </header>
          <ul className="banca-hero-company-accounts">
            {group.accounts.map((account) => {
              const selected = String(accountId) === String(account.id)
              return (
                <li key={account.id}>
                  <button
                    type="button"
                    className={`banca-hero-account-btn${selected ? ' is-selected' : ''}`}
                    onClick={() => setAccountId(selected ? '' : String(account.id))}
                    title={formatBankAccountOptionLabel(account)}
                  >
                    <span>{account.bank_name || account.account_name || 'Conto'}</span>
                    <span>{eur(account.saldo_disponibile)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </article>
      ))}
    </div>
  ) : null

  return (
    <BancaPageShell title={pageTitle} lead={pageLead} banner={banner}>
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
                ? `Scarica da Enable Banking${dateFrom || dateTo ? ` sul periodo ${dateFrom || '…'} → ${dateTo || '…'}` : ''} · ${viewAccountLabel}`
                : `Aggiorna tutti i conti Enable Banking collegati${dateFrom || dateTo ? ` sul periodo ${dateFrom || '…'} → ${dateTo || '…'}` : ''}`
            }
          >
            {syncBusy ? 'Aggiorno…' : 'Aggiorna'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={loading || syncBusy || !items.length}
            title="Apre la stampa: da lì puoi salvare come PDF"
            onClick={() => {
              try {
                const totals = {
                  amountEntrate: items.reduce(
                    (acc, m) =>
                      acc + (String(m?.movement_type || '').toLowerCase() === 'entrata' ? Number(m?.amount) || 0 : 0),
                    0,
                  ),
                  amountUscite: items.reduce(
                    (acc, m) =>
                      acc + (String(m?.movement_type || '').toLowerCase() !== 'entrata' ? Number(m?.amount) || 0 : 0),
                    0,
                  ),
                }
                printVneTable({
                  title: `Scheda movimenti · ${viewAccountLabel}`,
                  subtitle: [
                    dateFrom || dateTo ? `Periodo ${dateFrom || '…'} → ${dateTo || '…'}` : null,
                    category ? `Categoria: ${category}` : null,
                    counterparty ? `Controparte: ${counterparty}` : null,
                    `${items.length} movimenti`,
                  ]
                    .filter(Boolean)
                    .join(' · '),
                  columns: BANK_MOVEMENTS_COLUMNS,
                  rows: items,
                  cellValue: bankMovementsCellValue,
                  totals,
                  totalsLabel: (colId, t) => {
                    const netto = (Number(t?.amountEntrate) || 0) - (Number(t?.amountUscite) || 0)
                    if (colId === 'description') return `TOTALI · Netto ${eur(netto)}`
                    if (colId === 'amount') {
                      return `E ${eur(t?.amountEntrate)} / U ${eur(t?.amountUscite)}`
                    }
                    return ''
                  },
                })
              } catch (err) {
                window.alert(err?.message || 'Stampa non riuscita')
              }
            }}
          >
            Stampa scheda PDF
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
  const [agentBusy, setAgentBusy] = useState(false)
  const [agentStatus, setAgentStatus] = useState(null)
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
        setSuccess(`Riconciliati automaticamente ${n} movimenti (score ≥80).`)
      } else if (auto) {
        setSuccess('Nessun nuovo match auto (score ≥80). Restano proposte 70–79 da confermare e movimenti senza match.')
      }
    } catch (e) {
      setError(e?.message || 'Errore riconciliazione')
    } finally {
      setLoading(false)
    }
  }

  async function loadAgentStatus() {
    try {
      const st = await fetchBancaRiconciliazioneAgent()
      setAgentStatus(st)
    } catch {
      /* ignore */
    }
  }

  async function runAgent() {
    setAgentBusy(true)
    setError('')
    setSuccess('')
    try {
      const res = await runBancaRiconciliazioneAgent({ force: true })
      setAgentStatus(res)
      if (res?.message) setSuccess(res.message)
      if (companyId) await reload(companyId, { auto: true })
    } catch (e) {
      setError(e?.message || 'Agente riconciliazione non riuscito')
    } finally {
      setAgentBusy(false)
    }
  }

  useEffect(() => {
    void loadAgentStatus()
  }, [])

  useEffect(() => {
    // Allinea subito fatture ↔ movimenti dei conti collegati alla società
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
  const schedaRows = [...unpaidRows, ...paidRows]

  function stampaSchedaRiconciliazione() {
    try {
      if (!schedaRows.length && !pendingSuggestions.length) {
        window.alert('Nessun dato da stampare per questa società.')
        return
      }
      if (schedaRows.length) {
        printVneTable({
          title: `Scheda riconciliazione · ${companyName}`,
          subtitle: [
            `Pagate/trovate ${data?.paid_count ?? paidRows.length}`,
            `Da pagare ${data?.open_invoices_count ?? unpaidRows.length}`,
            `Uscite da riconciliare ${data?.unmatched_movements ?? pendingSuggestions.length}`,
          ].join(' · '),
          columns: BANK_INVOICE_STATUS_COLUMNS,
          rows: schedaRows,
          cellValue: bankInvoiceStatusCellValue,
          totals: {
            total: schedaRows.reduce((a, r) => a + (Number(r.total) || 0), 0),
            residuo: schedaRows.reduce((a, r) => a + (Number(r.residuo) || 0), 0),
          },
          totalsLabel: (colId, totals) => {
            if (colId === 'supplier_name') return 'TOTALI'
            if (colId === 'total') return eur(totals?.total)
            if (colId === 'residuo') return eur(totals?.residuo)
            return ''
          },
        })
        return
      }
      printVneTable({
        title: `Scheda riconciliazione · Da controllare · ${companyName}`,
        subtitle: `${pendingSuggestions.length} movimenti`,
        columns: BANK_RECON_COLUMNS,
        rows: pendingSuggestions,
        cellValue: bankReconCellValue,
        totals: {
          amount: pendingSuggestions.reduce((acc, row) => acc + (Number(row?.movement?.amount) || 0), 0),
          difference: pendingSuggestions.reduce(
            (acc, row) => acc + (Number(row?.suggested_invoice?.difference) || 0),
            0,
          ),
        },
        totalsLabel: (colId, totals) => {
          if (colId === 'movement') return 'TOTALI'
          if (colId === 'amount') return eur(totals?.amount)
          if (colId === 'difference') return eur(totals?.difference)
          return ''
        },
      })
    } catch (err) {
      window.alert(err?.message || 'Stampa non riuscita')
    }
  }

  return (
    <BancaPageShell
      title="Riconciliazione automatica"
      lead={
        companyId
          ? `Fatture ${companyName}: l'agente legge le causali dei bonifici (destinatario / n. fattura), collega i movimenti e per i contanti usa il file fornitori.`
          : "L'agente sincronizza i movimenti banca e riconcilia automaticamente le fatture (bonifico + contanti da Pagamenti)."
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
              onClick={() => void runAgent()}
              disabled={agentBusy || loading}
              title="Scarica movimenti, abbina fatture dalle causali e allinea i contanti dal file fornitori"
            >
              {agentBusy ? 'Agente in corso…' : 'Avvia agente automatico'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setSuccess('')
                reload(companyId, { auto: true })
              }}
              disabled={loading || agentBusy || !companyId}
            >
              {loading ? 'Riconcilio…' : 'Aggiorna e riconcilia'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={loading || agentBusy || !companyId || (!schedaRows.length && !pendingSuggestions.length)}
              title="Apre la stampa: da lì puoi salvare come PDF"
              onClick={stampaSchedaRiconciliazione}
            >
              Stampa scheda PDF
            </button>
          </div>
        </aside>
      }
    >
      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {agentStatus ? (
        <section className="card fatture-panel" style={{ marginBottom: '1rem' }}>
          <h2 className="fatture-panel-title">Agente riconciliazione</h2>
          <p className="fatture-note" style={{ marginTop: 0 }}>
            Automatico <strong>martedì e venerdì alle 7:30</strong> sul server (non serve premere il tasto ogni volta).
            Il pulsante sotto serve solo per un controllo immediato.
          </p>
          <p className="fatture-note" style={{ marginTop: 0 }}>
            {agentStatus.message || '—'}
          </p>
          <p className="fatture-note" style={{ marginBottom: 0 }}>
            Schedule: {agentStatus.schedule || '—'}
            {agentStatus.last_run_at
              ? ` · Ultimo run: ${String(agentStatus.last_run_at).replace('T', ' ').slice(0, 19)}`
              : ''}
            {agentStatus.linked_movements != null ? ` · Collegati: ${agentStatus.linked_movements}` : ''}
            {agentStatus.marked_paid != null ? ` · Pagate: ${agentStatus.marked_paid}` : ''}
            {agentStatus.marked_from_pagamenti != null
              ? ` · Contanti file: ${agentStatus.marked_from_pagamenti}`
              : ''}
            {agentStatus.bank?.imported != null ? ` · Nuovi movimenti: ${agentStatus.bank.imported}` : ''}
          </p>
        </section>
      ) : null}

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
                {(data?.accounts_used || []).map((a) => a.label).filter(Boolean).join(' · ')
                  || (data?.expected_banks || []).join(' · ')
                  || '—'}
              </div>
              {(data?.expected_banks || []).length > 0 ? (
                <div className="dashboard-kpi-sub" style={{ marginTop: '0.35rem' }}>
                  Attesi: {(data.expected_banks || []).join(' + ')}
                </div>
              ) : null}
            </div>
          </div>

          {loading ? <AnalisiLoadingBar active label="Confronto fatture e movimenti banca" variant="subtle" /> : null}

          {!loading ? (
            <>
              <section className="card fatture-panel banca-fit-panel">
                <h2 className="fatture-panel-title">Da pagare</h2>
                <p className="fatture-note" style={{ marginTop: 0 }}>
                  Fatture senza abbinamento score ≥80 sui movimenti e senza pagamenti in CONTANTI nel file fornitori.
                </p>
                <WorkbookGrid
                  title="Fatture da pagare"
                  sheetLabel={`${unpaidRows.length} doc.`}
                  columns={BANK_INVOICE_STATUS_COLUMNS}
                  rows={unpaidRows}
                  cellValue={bankInvoiceStatusCellValue}
                  emptyMessage="Nessuna fattura da pagare: tutte allineate ai movimenti o al file PAGATO."
                  gridClassName="banca-fit-grid"
                  rowKey={(row) => row.invoice_id}
                  getRowClassName={(row) => (invoiceIsAligned(row) ? 'banca-recon-row-ok' : 'banca-recon-row-open')}
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
                <h2 className="fatture-panel-title">Pagate / abbinate (✔ verde)</h2>
                <p className="fatture-note" style={{ marginTop: 0 }}>
                  Match automatici (score ≥80: importo + fornitore + n. fattura + data) oppure riga CONTANTI nel file Pagamenti.
                </p>
                <WorkbookGrid
                  title="Fatture pagate o abbinate"
                  sheetLabel={`${paidRows.length} doc.`}
                  columns={BANK_INVOICE_STATUS_COLUMNS}
                  rows={paidRows}
                  cellValue={bankInvoiceStatusCellValue}
                  emptyMessage="Nessuna fattura ancora abbinata ai movimenti."
                  gridClassName="banca-fit-grid"
                  rowKey={(row) => `paid-${row.invoice_id}`}
                  getRowClassName={() => 'banca-recon-row-ok'}
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
                <h2 className="fatture-panel-title">Da controllare (differenze / da riconciliare)</h2>
                <p className="fatture-note" style={{ marginBottom: '0.75rem' }}>
                  Proposte con score 70–79 (<strong>da confermare</strong>) o sotto 70 / senza fattura (
                  <strong>da riconciliare</strong>). Conferma a mano se serve.
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
