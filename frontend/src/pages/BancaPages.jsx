import React, { useEffect, useMemo, useRef, useState } from 'react'
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
import { invoiceNumbersMatch } from '../utils/pagamentiWorkbook.js'
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
  fetchBancaRiconciliazioneProposte,
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
    account_name: "Mediazione Z · BCC Terra d'Otranto",
    iban: 'IT06B0844516000000000972450',
    company: 'mediazione_z',
    ledger_code: '1100',
    notes:
      "MEDIAZIONE Z · BCC Terra d'Otranto S.C. · IBAN IT06B0844516000000000972450 · BIC ICRAITRRCD0 · Carmiano (LE)",
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

/** Famiglia banca (BPPB / BCC / Intesa / …) per deduplicare seed scollegati. */
function bankFamilyKey(account) {
  const bank = `${account?.bank_name || ''} ${account?.account_name || ''} ${account?.notes || ''}`.toLowerCase()
  const iban = bankAccountIbanKey(account)
  if (
    bank.includes('bppb')
    || bank.includes('puglia')
    || bank.includes('basilicata')
    || ['IT25D0538516000CC1410004514', 'IT55B0538516000CC1410004512', 'IT25D0538516000CC410004514'].includes(iban)
  ) {
    return 'bppb'
  }
  if (
    bank.includes('bcc')
    || bank.includes("terra d'otranto")
    || bank.includes('bellegra')
    || ['IT37M0844516000000000967252', 'IT06B0844516000000000972450'].includes(iban)
  ) {
    return 'bcc'
  }
  if (bank.includes('intesa') || bank.includes('sanpaolo') || iban === 'IT88N0306979822100000008926') {
    return 'intesa'
  }
  if (bank.includes('unicredit') || iban === 'IT48Q0200816005000105294153') {
    return 'unicredit'
  }
  return iban ? `iban:${iban}` : `id:${account?.id || '?'}`
}

function isBankAccountConnected(account) {
  return Boolean(account?.enable_banking_connected || account?.connection_status === 'connected')
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
    if (!previous || (isBankAccountConnected(account) && !isBankAccountConnected(previous))) {
      byIban.set(key, account)
    }
  }
  return sortBankAccounts([...byIban.values(), ...withoutIban])
}

/**
 * Nasconde seed non collegati a €0 se esiste già un conto collegato
 * della stessa società e famiglia banca (es. BCC 0,00 con BCC già sync).
 */
function visibleBankAccounts(list) {
  const deduped = preferConnectedDuplicates(list)
  const connectedKeys = new Set()
  for (const account of deduped) {
    if (!isBankAccountConnected(account)) continue
    const company = String(account?.company || '').trim().toLowerCase() || 'condiviso'
    connectedKeys.add(`${company}|${bankFamilyKey(account)}`)
  }
  return deduped.filter((account) => {
    if (isBankAccountConnected(account)) return true
    const saldo = Math.abs(Number(account?.saldo_disponibile) || 0)
    if (saldo > 0.009) return true
    const company = String(account?.company || '').trim().toLowerCase() || 'condiviso'
    return !connectedKeys.has(`${company}|${bankFamilyKey(account)}`)
  })
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

function invoiceNumberDigitsOnly(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const parts = raw.match(/\d+(?:[/-]\d+)*/g)
  if (!parts || !parts.length) return ''
  return parts.join(', ')
}

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
    const linked = Array.isArray(row?.linked_invoices) && row.linked_invoices.length
      ? row.linked_invoices
      : row?.matched_invoice
        ? [row.matched_invoice]
        : []
    const nums = []
    const seen = new Set()
    for (const inv of linked) {
      const digits = invoiceNumberDigitsOnly(inv?.invoice_number || inv?.id || '')
      if (!digits || seen.has(digits)) continue
      seen.add(digits)
      nums.push(digits)
    }
    if (!nums.length) {
      const fallback = invoiceNumberDigitsOnly(row?.matched_invoice_id)
      return fallback || '—'
    }
    return nums.join(', ')
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

function movementSearchBlob(mov) {
  const inv = mov?.matched_invoice
  const linked = Array.isArray(mov?.linked_invoices) ? mov.linked_invoices : []
  return [
    mov?.description,
    mov?.causale,
    mov?.counterparty,
    mov?.doc_ref,
    mov?.notes,
    inv?.invoice_number,
    inv?.supplier_name,
    mov?.matched_invoice_id != null ? String(mov.matched_invoice_id) : '',
    ...linked.map((x) => x?.invoice_number),
    ...linked.map((x) => x?.supplier_name),
  ]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .join(' ')
}

/** Trova bonifici per n. fattura in causale / fattura collegata, oppure testo libero. */
function movementMatchesSearch(mov, query) {
  const q = String(query || '').trim()
  if (!q) return false
  const invNum = mov?.matched_invoice?.invoice_number
  if (invNum && invoiceNumbersMatch(invNum, q)) return true
  const linked = Array.isArray(mov?.linked_invoices) ? mov.linked_invoices : []
  for (const inv of linked) {
    if (inv?.invoice_number && invoiceNumbersMatch(inv.invoice_number, q)) return true
  }
  if (mov?.doc_ref && invoiceNumbersMatch(mov.doc_ref, q)) return true
  const blob = movementSearchBlob(mov)
  const tokens = blob.split(/[\s,;|·]+/).filter(Boolean)
  for (const token of tokens) {
    if (invoiceNumbersMatch(token, q)) return true
  }
  const foldedQ = q.toUpperCase().replace(/[\s'"]/g, '')
  const foldedBlob = blob.toUpperCase().replace(/[\s'"]/g, '')
  if (foldedQ.length >= 2 && foldedBlob.includes(foldedQ)) return true
  return false
}

const BANK_RECON_COLUMNS = [
  { id: 'date', label: 'Data', width: 10, fluid: true },
  { id: 'bonifico_ref', label: 'N. bonifico', width: 14, fluid: true, emphasis: true },
  { id: 'beneficiary', label: 'Beneficiario', width: 18, fluid: true },
  { id: 'invoice_number', label: 'N. fattura', width: 12, fluid: true, emphasis: true },
  { id: 'issuer', label: 'Emittente', width: 18, fluid: true },
  { id: 'amount', label: 'Importo', width: 11, fluid: true, numeric: true },
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
  { id: 'invoice_number', label: 'N. fattura', width: 12, fluid: true, emphasis: true },
  { id: 'supplier_name', label: 'Emittente', width: 18, fluid: true },
  { id: 'bonifico_ref', label: 'N. bonifico', width: 14, fluid: true, emphasis: true },
  { id: 'beneficiary', label: 'Beneficiario', width: 18, fluid: true },
  { id: 'total', label: 'Importo', width: 10, fluid: true, numeric: true },
  { id: 'amount_paid', label: 'Pagato', width: 10, fluid: true, numeric: true },
  { id: 'residuo', label: 'Residuo', width: 10, fluid: true, numeric: true },
  {
    id: 'ok',
    label: 'OK',
    width: 5,
    fluid: true,
    tone: (row) => (invoiceIsAligned(row) ? 'banca-recon-ok-cell' : 'banca-recon-open-cell'),
  },
  { id: 'reason', label: 'Esito', width: 12, fluid: true },
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
      'saldo_fatture',
      'bundle_fornitore',
    ].includes(reason)
  ) {
    return true
  }
  return false
}

function bankReconCellValue(row, col) {
  if (col.id === 'date') return formatDate(row?.movement?.movement_date)
  if (col.id === 'bonifico_ref') return row?.movement?.bonifico_ref || '—'
  if (col.id === 'doc_ref') return row?.movement?.doc_ref || row?.movement?.bonifico_ref || '—'
  if (col.id === 'beneficiary') {
    return row?.movement?.counterparty || row?.movement?.beneficiary || '—'
  }
  if (col.id === 'invoice_number') return row?.suggested_invoice?.invoice_number || '—'
  if (col.id === 'issuer') return row?.suggested_invoice?.supplier_name || '—'
  if (col.id === 'amount') return eur(row?.movement?.amount)
  if (col.id === 'status') {
    if (row?.status === 'matched') return '✔ Riconciliato'
    if (row?.match_band === 'probable' || (Number(row?.match_score) || 0) >= 70) {
      const score = Number(row?.match_score) || 0
      return score ? `Da confermare (${score})` : 'Da confermare'
    }
    return reconciliationStatusLabel(row?.status)
  }
  return ''
}

function bankInvoiceStatusCellValue(row, col) {
  if (col.id === 'ok') return invoiceIsAligned(row) ? '✔' : '○'
  if (col.id === 'invoice_number') return row?.invoice_number || '—'
  if (col.id === 'supplier_name') return row?.supplier_name || '—'
  if (col.id === 'bonifico_ref') {
    if (row?.match_reason === 'file_contanti' || row?.match_reason === 'file_pagamenti') return '—'
    return row?.matched_movement?.bonifico_ref || '—'
  }
  if (col.id === 'doc_ref') {
    if (row?.match_reason === 'file_contanti' || row?.match_reason === 'file_pagamenti') return '—'
    return row?.matched_movement?.bonifico_ref || row?.matched_movement?.doc_ref || '—'
  }
  if (col.id === 'beneficiary') {
    const m = row?.matched_movement
    // Contanti = match da file Pagamenti, non un beneficiario di bonifico
    if (row?.match_reason === 'file_contanti' || row?.match_reason === 'file_pagamenti') {
      return '—'
    }
    return m?.counterparty || m?.beneficiary || '—'
  }
  if (col.id === 'total') return eur(row?.total)
  if (col.id === 'amount_paid') return eur(row?.amount_paid)
  if (col.id === 'residuo') return eur(row?.residuo)
  if (col.id === 'reason') {
    if (row?.match_reason === 'numero_in_movimento') return '✔ N. in banca'
    if (row?.match_reason === 'importo_in_movimento') return '✔ Importo in banca'
    if (row?.amount_matched_as === 'pagato') return '✔ Importo = pagato'
    if (row?.match_reason === 'saldo_fatture') return '✔ Saldo fatture'
    if (row?.match_reason === 'bundle_fornitore') return '✔ Bonifico multi-fattura'
    if (row?.match_reason === 'score_auto') return '✔ Score ≥80'
    if (row?.match_reason === 'matched') return '✔ Riconciliata'
    if (row?.match_reason === 'file_contanti' || row?.match_reason === 'file_pagamenti') {
      return '✔ Pagato (file Pagamenti)'
    }
    if (row?.match_reason === 'acconto') {
      const left = Number(row?.residuo) || 0
      return left > 0.009 ? `Pagata in parte · residuo ${eur(left)}` : 'Pagata in parte'
    }
    if (row?.match_reason === 'da_pagare') return 'Da pagare'
    return row?.match_reason || '—'
  }
  return ''
}

const AMM_HUB_MODULES = [
  {
    to: '/banca',
    tone: 'banca',
    kicker: 'Liquidità',
    title: 'Banca',
    value: 'Conti e movimenti',
    desc: 'Saldi, sync Enable Banking e riconciliazione automatica',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z"
        />
      </svg>
    ),
  },
  {
    to: '/fatture',
    tone: 'fatture',
    kicker: 'Fornitori',
    title: 'Fatture',
    value: 'SDI e scadenze',
    desc: 'Ricevute, registrate e sync Agenzia Entrate',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm7 1.5V9h4.5L14 4.5ZM8.5 12h7v1.5h-7V12Zm0 3.5h7V17h-7v-1.5Zm0 3.5h5V20.5h-5V19Z"
        />
      </svg>
    ),
  },
  {
    to: '/prima-nota',
    tone: 'prima',
    kicker: 'Cassa',
    title: 'Prima Nota',
    value: 'Cassa e banca',
    desc: 'Movimenti manuali, cartaceo e collegamenti',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M4 5h16a1 1 0 0 1 1 1v3H3V6a1 1 0 0 1 1-1Zm-1 6h18v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8Zm3 2.5h4V16H6v-2.5Z"
        />
      </svg>
    ),
  },
  {
    to: '/amministrazione/mastrini',
    tone: 'mastri',
    kicker: 'Contabilità',
    title: 'Mastrini',
    value: 'Piano contabile',
    desc: 'Dare/Avere, dettaglio conto e stampe',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M5 4h14a1 1 0 0 1 1 1v14l-3-2-3 2-3-2-3 2-3-2V5a1 1 0 0 1 1-1Zm2 3.5v1.5h10V7.5H7Zm0 4v1.5h10V11.5H7Zm0 4v1.5h6V15.5H7Z"
        />
      </svg>
    ),
  },
]

const AMM_HUB_QUICK = [
  { to: '/banca/conti', label: 'Conti correnti' },
  { to: '/banca/riconciliazione', label: 'Riconciliazione' },
  { to: '/fatture/scadenziario', label: 'Scadenziario fatture' },
  { to: '/pagamenti', label: 'Pagamenti' },
  { to: '/amministrazione/mastrini', label: 'Mastrini contabili' },
]

export function AmministrazioneDashboardPage() {
  return (
    <AmministrazionePageShell
      className="amm-hub-page"
      title="Dashboard"
      lead="Centro operativo amministrazione: banca, fatture fornitori e prima nota."
    >
      <div className="amm-hub">
        <div className="amm-hub-modules" role="list">
          {AMM_HUB_MODULES.map((mod, index) => (
            <Link
              key={mod.to}
              to={mod.to}
              className={`amm-hub-module amm-hub-module--${mod.tone}`}
              role="listitem"
              style={{ '--amm-hub-i': index }}
            >
              <span className="amm-hub-module-icon">{mod.icon}</span>
              <span className="amm-hub-module-copy">
                <span className="amm-hub-module-kicker">{mod.kicker}</span>
                <span className="amm-hub-module-title">{mod.title}</span>
                <span className="amm-hub-module-value">{mod.value}</span>
                <span className="amm-hub-module-desc">{mod.desc}</span>
              </span>
              <span className="amm-hub-module-go" aria-hidden="true">
                →
              </span>
            </Link>
          ))}
        </div>

        <section className="amm-hub-quick" aria-label="Accesso rapido">
          <div className="amm-hub-quick-head">
            <h2 className="amm-hub-quick-title">Accesso rapido</h2>
            <p className="amm-hub-quick-lead">Le operazioni più usate, a un click.</p>
          </div>
          <div className="amm-hub-quick-links">
            {AMM_HUB_QUICK.map((item) => (
              <Link key={item.to} className="amm-hub-quick-link" to={item.to}>
                {item.label}
              </Link>
            ))}
          </div>
        </section>
      </div>
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

function BankSyncCard({
  tone,
  kicker,
  title,
  accounts,
  emptyLabel,
  selectedId,
  onSelect,
  busy,
  syncing,
  onSync,
  onUnsync,
  syncEnabled,
  selectTitle,
  syncTitle,
}) {
  const selected = accounts.find((a) => String(a.id) === String(selectedId))
  const connected = Boolean(selected?.enable_banking_connected)
  const status = accounts.length === 0 ? 'In attesa' : connected ? 'Collegato' : 'Non collegato'
  const syncLabel = syncing ? 'Sincronizzo…' : connected ? 'Sincronizza conto' : 'Collega e sincronizza'
  return (
    <section className={`banca-sync-card banca-sync-card--${tone}`}>
      <header className="banca-sync-card-head">
        <div>
          <p className="banca-sync-kicker">{kicker}</p>
          <h2>{title}</h2>
          {selected && Number.isFinite(Number(selected.saldo_disponibile)) ? (
            <p className="banca-sync-saldo">{eur(selected.saldo_disponibile)}</p>
          ) : null}
        </div>
        <span className={`banca-sync-status${connected ? ' is-on' : ''}`}>{status}</span>
      </header>
      <label className="banca-sync-field">
        <span>Conto</span>
        <select
          className="form-control"
          value={selectedId}
          disabled={busy}
          onChange={(e) => onSelect(e.target.value)}
          title={selectTitle}
        >
          {accounts.length === 0 ? (
            <option value="">{emptyLabel}</option>
          ) : (
            accounts.map((a) => (
              <option key={a.id} value={String(a.id)}>
                {formatBankAccountOptionLabel(a)}
                {a.enable_banking_connected ? ' · collegato' : ' · non collegato'}
              </option>
            ))
          )}
        </select>
      </label>
      <div className="banca-sync-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !syncEnabled}
          onClick={onSync}
          title={syncTitle}
        >
          {syncLabel}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy || !selectedId}
          onClick={onUnsync}
          title="Scollega Enable Banking e cancella i movimenti importati del conto selezionato"
        >
          Scollega e svuota
        </button>
        <Link className="btn btn-secondary" to="/banca/movimenti">
          Movimenti
        </Link>
      </div>
      {!syncEnabled ? <p className="banca-sync-note">Enable Banking non configurato sul server.</p> : null}
    </section>
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
      setItems(visibleBankAccounts(Array.isArray(res?.items) ? res.items : []))
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
        list = visibleBankAccounts(Array.isArray(res?.items) ? res.items : [])
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
        list = visibleBankAccounts(Array.isArray(res?.items) ? res.items : [])
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

      <div className="banca-sync-grid">
        <BankSyncCard
          tone="bppb"
          kicker="Popolare Puglia e Basilicata"
          title="BPPB"
          accounts={visibleBankAccounts(items.filter(isBppbAccount))}
          emptyLabel="Via Lattea / Mediazione (crea al sync)"
          selectedId={bppbSelectedId}
          onSelect={setBppbSelectedId}
          busy={busyId != null}
          syncing={busyId != null && (busyId === -2 || items.some((a) => a.id === busyId && isBppbAccount(a)))}
          onSync={syncSelectedBppbAccount}
          onUnsync={unsyncSelectedBppbAccount}
          syncEnabled={Boolean(connectProfile?.enable_banking?.configured)}
          selectTitle="Scegli quale conto BPPB importare"
          syncTitle="Collega o sincronizza solo il conto BPPB selezionato"
        />
        <BankSyncCard
          tone="bcc"
          kicker="Terra d'Otranto"
          title="BCC"
          accounts={visibleBankAccounts(items.filter(isBccTerraOtrantoAccount))}
          emptyLabel="Via Lattea / Mediazione (crea al sync)"
          selectedId={bccSelectedId}
          onSelect={setBccSelectedId}
          busy={busyId != null}
          syncing={busyId != null && (busyId === -1 || items.some((a) => a.id === busyId && isBccTerraOtrantoAccount(a)))}
          onSync={syncSelectedBccAccount}
          onUnsync={unsyncSelectedBccAccount}
          syncEnabled={Boolean(connectProfile?.enable_banking?.configured)}
          selectTitle="Scegli quale conto BCC importare"
          syncTitle="Collega o sincronizza solo il conto BCC selezionato"
        />
        <BankSyncCard
          tone="intesa"
          kicker="Intesa Sanpaolo"
          title="Intesa"
          accounts={visibleBankAccounts(items.filter(isIntesaAccount))}
          emptyLabel="Risacca (crea al sync)"
          selectedId={intesaSelectedId}
          onSelect={setIntesaSelectedId}
          busy={busyId != null}
          syncing={busyId != null && (busyId === -3 || items.some((a) => a.id === busyId && isIntesaAccount(a)))}
          onSync={syncSelectedIntesaAccount}
          onUnsync={unsyncSelectedIntesaAccount}
          syncEnabled={Boolean(connectProfile?.enable_banking?.configured)}
          selectTitle="Scegli quale conto Intesa Sanpaolo importare"
          syncTitle="Collega o sincronizza solo il conto Intesa selezionato"
        />
        <BankSyncCard
          tone="unicredit"
          kicker="UniCredit"
          title="UniCredit"
          accounts={visibleBankAccounts(items.filter(isUnicreditAccount))}
          emptyLabel="Lecce Foscarini (crea al sync)"
          selectedId={unicreditSelectedId}
          onSelect={setUnicreditSelectedId}
          busy={busyId != null}
          syncing={busyId != null && (busyId === -4 || items.some((a) => a.id === busyId && isUnicreditAccount(a)))}
          onSync={syncSelectedUnicreditAccount}
          onUnsync={unsyncSelectedUnicreditAccount}
          syncEnabled={Boolean(connectProfile?.enable_banking?.configured)}
          selectTitle="Scegli quale conto UniCredit importare"
          syncTitle="Collega o sincronizza solo il conto UniCredit selezionato"
        />
      </div>

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
  const [searchQuery, setSearchQuery] = useState('')
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
        }),
        fetchBancaAccounts(),
      ])
      setItems(Array.isArray(mov?.items) ? mov.items : [])
      setAccounts(visibleBankAccounts(Array.isArray(acc?.items) ? acc.items : []))
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
      // Collega beneficiario + n. fattura in causale e chiude le aperte
      try {
        const recon = await postBancaRiconciliazioneAuto()
        const closed = Number(recon?.auto_applied) || 0
        if (closed > 0) {
          setSuccess((prev) =>
            `${prev || 'Movimenti aggiornati.'} Riconciliate ${closed} fatture (beneficiario + n. in causale).`.trim(),
          )
        }
      } catch {
        // Sync movimenti ok anche se la riconciliazione fallisce
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

  const searchHitIds = useMemo(() => {
    const q = searchQuery.trim()
    if (!q) return new Set()
    return new Set(items.filter((m) => movementMatchesSearch(m, q)).map((m) => m.id))
  }, [items, searchQuery])

  const displayRows = useMemo(() => {
    if (!searchHitIds.size) return items
    const hits = []
    const rest = []
    for (const row of items) {
      if (searchHitIds.has(row.id)) hits.push(row)
      else rest.push(row)
    }
    return [...hits, ...rest]
  }, [items, searchHitIds])

  const searchStatusNote = useMemo(() => {
    const q = searchQuery.trim()
    if (!q) return ''
    const n = searchHitIds.size
    if (n > 0) return `Trovati ${n} bonifici/movimenti per «${q}» (evidenziati in giallo).`
    return `Nessun bonifico con fattura/testo «${q}» nei movimenti caricati. Allarga il periodo e premi Cerca.`
  }, [searchQuery, searchHitIds])

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
          className="banca-movimenti-filters"
          onSubmit={(e) => {
            e.preventDefault()
            void load()
          }}
        >
          <div className="banca-movimenti-filters-row">
            <label>
              Periodo da
              <input className="form-control" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label>
              a
              <input className="form-control" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>
            <label className="banca-movimenti-filters-account">
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
                      searchQuery.trim() ? `Cerca: ${searchQuery.trim()}` : null,
                      `${items.length} movimenti`,
                    ]
                      .filter(Boolean)
                      .join(' · '),
                    columns: BANK_MOVEMENTS_COLUMNS,
                    rows: searchHitIds.size ? displayRows.filter((r) => searchHitIds.has(r.id)) : items,
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
          </div>

          <div className="banca-movimenti-filters-row banca-movimenti-filters-search">
            <label className="banca-movimenti-filters-invoice">
              Numero fattura
              <input
                className="form-control"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="es. 27/2026 oppure solo 27"
                title="Cerca il bonifico che paga quella fattura (in causale o fattura collegata)"
                autoComplete="off"
              />
            </label>
            <button type="submit" className="btn btn-primary" disabled={loading || syncBusy}>
              Cerca
            </button>
            {searchQuery.trim() ? (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loading || syncBusy}
                onClick={() => setSearchQuery('')}
              >
                Pulisci
              </button>
            ) : null}
          </div>
        </form>
        {searchStatusNote ? (
          <p className={`fatture-note${searchHitIds.size ? ' banca-mov-search-hit-note' : ''}`} style={{ marginTop: '0.75rem', marginBottom: 0 }}>
            {searchStatusNote}
          </p>
        ) : null}
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
            sheetLabel={
              searchHitIds.size
                ? `${searchHitIds.size} trovati · ${items.length} movimenti`
                : `${items.length} movimenti`
            }
            columns={BANK_MOVEMENTS_COLUMNS}
            rows={displayRows}
            cellValue={bankMovementsCellValue}
            emptyMessage={`Nessun movimento per «${viewAccountLabel}». Usa Aggiorna oppure Sincronizza in Conti correnti.`}
            gridClassName="banca-fit-grid"
            rowKey={(row) => row.id}
            getRowClassName={(row) => (searchHitIds.has(row.id) ? 'banca-mov-hit' : '')}
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
      setData({ ...res, suggestions_pending: true })
      const n = Number(res?.auto_applied) || 0
      if (auto && n > 0) {
        setSuccess(`Riconciliati automaticamente ${n} documenti.`)
      } else if (auto) {
        setSuccess('Nessun nuovo match auto.')
      }
    } catch (e) {
      setError(e?.message || 'Errore riconciliazione')
      setLoading(false)
      return
    }
    setLoading(false)
    try {
      const proposte = await fetchBancaRiconciliazioneProposte(nextCompany)
      const probable = Number(proposte?.probable_count) || 0
      setData((prev) => ({
        ...(prev || {}),
        suggestions: proposte?.suggestions || prev?.suggestions || [],
        probable_count: probable,
        unmatched_movements: proposte?.unmatched_movements ?? prev?.unmatched_movements,
        score_thresholds: proposte?.score_thresholds || prev?.score_thresholds,
        suggestions_pending: false,
      }))
      if (auto) {
        setSuccess((prev) =>
          probable
            ? `${prev} ${probable} proposte da confermare.`.replace(/\s+/g, ' ').trim()
            : prev,
        )
      }
    } catch {
      setData((prev) => (prev ? { ...prev, suggestions_pending: false } : prev))
    }
  }

  async function runAgent() {
    setAgentBusy(true)
    setError('')
    setSuccess('Agente avviato. Scarica i movimenti e aggiorna le fatture: la pagina attende da sola.')
    try {
      let status = await runBancaRiconciliazioneAgent({ force: true })
      const deadline = Date.now() + 20 * 60 * 1000
      while (status?.running && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 4000))
        status = await fetchBancaRiconciliazioneAgent()
      }
      if (status?.running) {
        setSuccess('L’agente sta ancora lavorando. Tra qualche minuto premi Aggiorna e riconcilia.')
      } else if (status && status.ok === false) {
        setError(status.message || 'Agente riconciliazione non riuscito')
        setSuccess('')
      } else {
        setSuccess(status?.message || 'Riconciliazione aggiornata.')
      }
      if (companyId) await reload(companyId, { auto: false })
    } catch (e) {
      setError(e?.message || 'Agente riconciliazione non riuscito')
      setSuccess('')
    } finally {
      setAgentBusy(false)
    }
  }

  useEffect(() => {
    // Legge lo stato già salvato. Il ricalcolo completo resta sul pulsante.
    reload(companyId, { auto: false })
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
      await reload(companyId, { auto: false })
    } catch (e) {
      setError(e?.message || 'Errore salvataggio')
    } finally {
      setBusyId(null)
    }
  }

  async function confirmAllProbable() {
    const rows = pendingSuggestions.filter(
      (s) =>
        s?.suggested_invoice?.invoice_id
        && typeof s?.movement?.id === 'number'
        && (s.match_band === 'probable' || s.status === 'difference' || (Number(s.match_score) || 0) >= 70),
    )
    if (!rows.length) {
      setSuccess('Nessuna proposta da confermare.')
      return
    }
    setBusyId('all')
    setError('')
    setSuccess('')
    let ok = 0
    let fail = 0
    try {
      for (const row of rows) {
        try {
          const status = row.status === 'difference' ? 'difference' : 'matched'
          await postBancaRiconcilia(row.movement.id, {
            invoice_id: row.suggested_invoice.invoice_id,
            status,
          })
          ok += 1
        } catch {
          fail += 1
        }
      }
      setSuccess(
        fail
          ? `Confermati ${ok} abbinamenti · ${fail} errori`
          : `Confermati ${ok} abbinamenti probabili.`,
      )
      await reload(companyId, { auto: true })
    } catch (e) {
      setError(e?.message || 'Errore conferma multipla')
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
            amount_paid: schedaRows.reduce((a, r) => a + (Number(r.amount_paid) || 0), 0),
            residuo: schedaRows.reduce((a, r) => a + (Number(r.residuo) || 0), 0),
          },
          totalsLabel: (colId, totals) => {
            if (colId === 'supplier_name') return 'TOTALI'
            if (colId === 'total') return eur(totals?.total)
            if (colId === 'amount_paid') return eur(totals?.amount_paid)
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
          if (colId === 'date') return 'TOTALI'
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

          {loading && !data ? (
            <AnalisiLoadingBar active label="Caricamento fatture" variant="subtle" />
          ) : null}

          {data ? (
            <>
              <section className="card fatture-panel banca-fit-panel">
                <h2 className="fatture-panel-title">Da pagare</h2>
                <p className="fatture-note" style={{ marginTop: 0 }}>
                  Numero fattura ed emittente non ancora collegati a un bonifico.
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
                          amount_paid: unpaidRows.reduce((a, r) => a + (Number(r.amount_paid) || 0), 0),
                          residuo: unpaidRows.reduce((a, r) => a + (Number(r.residuo) || 0), 0),
                        }
                      : null
                  }
                  totalsLabel={(colId, totals) => {
                    if (colId === 'supplier_name') return 'TOTALI'
                    if (colId === 'total') return eur(totals?.total)
                    if (colId === 'amount_paid') return eur(totals?.amount_paid)
                    if (colId === 'residuo') return eur(totals?.residuo)
                    return ''
                  }}
                />
              </section>

              <section className="card fatture-panel banca-fit-panel">
                <h2 className="fatture-panel-title">Pagate / abbinate (✔ verde)</h2>
                <p className="fatture-note" style={{ marginTop: 0 }}>
                  Numero fattura, emittente e beneficiario del bonifico coincidono.
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
                          amount_paid: paidRows.reduce((a, r) => a + (Number(r.amount_paid) || 0), 0),
                          residuo: paidRows.reduce((a, r) => a + (Number(r.residuo) || 0), 0),
                        }
                      : null
                  }
                  totalsLabel={(colId, totals) => {
                    if (colId === 'supplier_name') return 'TOTALI'
                    if (colId === 'total') return eur(totals?.total)
                    if (colId === 'amount_paid') return eur(totals?.amount_paid)
                    if (colId === 'residuo') return eur(totals?.residuo)
                    return ''
                  }}
                />
              </section>

              <section className="card fatture-panel banca-fit-panel">
                <h2 className="fatture-panel-title">Da controllare (differenze / da riconciliare)</h2>
                <p className="fatture-note" style={{ marginBottom: '0.75rem' }}>
                  Proposte score 70–79: un click conferma. I match ≥80 e i bonifici multi-fattura
                  vengono applicati da «Aggiorna e riconcilia».
                </p>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={
                      loading
                      || agentBusy
                      || busyId != null
                      || !pendingSuggestions.some(
                        (s) =>
                          s?.suggested_invoice
                          && (s.match_band === 'probable'
                            || s.status === 'difference'
                            || (Number(s.match_score) || 0) >= 70),
                      )
                    }
                    onClick={() => void confirmAllProbable()}
                  >
                    {busyId === 'all' ? 'Confermo…' : 'Conferma tutte le proposte'}
                  </button>
                </div>
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
                    if (colId === 'date') return 'TOTALI'
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
                        disabled={busyId === row.movement.id || busyId === 'all'}
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
