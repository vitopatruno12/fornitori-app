import { fetchBancaAccountsForCompany, fetchBancaMovimenti } from './bancaService'
import { fetchEntries } from './cashService'
import { fetchInvoices, fetchIssuedInvoices } from './invoicesService'
import {
  accountDescription,
  buildPasscomAccountPlan,
  causaleLabel,
  formatRegistrationNumber,
  GENERAL_ACCOUNTS,
  mapPrimaNotaToPasscomAccounts,
} from '../constants/mastriniPasscom.js'
import {
  activitiesForCompany,
  activityLabel,
  companyFromActivity,
  companyLabel,
} from '../utils/fattureCompany.js'
import { readStoredPrimaNotaAccessCode } from '../utils/primaNotaLocaleAccess.js'

const ACCOUNT_PLAN = buildPasscomAccountPlan()

function isoDate(value) {
  if (!value) return ''
  return String(value).slice(0, 10)
}

function toNum(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function signByType(accountType, dare, avere) {
  const d = toNum(dare)
  const a = toNum(avere)
  if (accountType === 'attivo' || accountType === 'costo') return d - a
  return a - d
}

function resolveCompanyMeta(companyId, locale = '') {
  const company = String(companyId || '').trim() || 'non_classificata'
  const localeId = String(locale || '').trim().toLowerCase()
  return {
    company,
    companyLabel: company === 'non_classificata' ? 'Non classificate' : companyLabel(company),
    locale: localeId,
    localeLabel: localeId ? activityLabel(localeId) : '',
  }
}

function pushMovement(list, accountCode, raw, amount, side, counterAccountCode = '') {
  const val = Math.abs(toNum(amount))
  if (val <= 0) return
  const companyMeta = resolveCompanyMeta(raw.company, raw.locale || raw.center)
  const code = String(accountCode || '')
  const counterCode = String(counterAccountCode || raw.counterAccountCode || '')
  list.push({
    accountCode: code,
    accountDescription: accountDescription(code, ACCOUNT_PLAN),
    counterAccountCode: counterCode,
    counterAccountDescription: counterCode ? accountDescription(counterCode, ACCOUNT_PLAN) : '',
    date: raw.date || '',
    documentDate: raw.documentDate || raw.date || '',
    registrationNumber: raw.registrationNumber || '',
    causale: raw.causale || '',
    causaleLabel: raw.causaleLabel || causaleLabel(raw.causale),
    description: raw.description || '',
    documentLabel: raw.documentLabel || '',
    documentType: raw.documentType || '',
    documentId: raw.documentId || '',
    documentPath: raw.documentPath || '',
    counterparty: raw.counterparty || '',
    supplier: raw.supplier || '',
    customer: raw.customer || '',
    amount: val,
    dare: side === 'dare' ? val : 0,
    avere: side === 'avere' ? val : 0,
    center: raw.center || companyMeta.locale || '',
    company: companyMeta.company,
    companyLabel: companyMeta.companyLabel,
    locale: companyMeta.locale,
    localeLabel: companyMeta.localeLabel,
    source: raw.source || '',
    linkedInvoiceId: raw.linkedInvoiceId || '',
    linkedCashEntryId: raw.linkedCashEntryId || '',
    linkedBankMovementId: raw.linkedBankMovementId || '',
    relatedDocumentPath: raw.relatedDocumentPath || '',
    relatedDocumentLabel: raw.relatedDocumentLabel || '',
  })
}

function pushDoubleEntry(list, dareCode, avereCode, raw, amount) {
  pushMovement(list, dareCode, raw, amount, 'dare', avereCode)
  pushMovement(list, avereCode, raw, amount, 'avere', dareCode)
}

function buildInvoiceIndex(invoices = []) {
  const byId = new Map()
  for (const inv of invoices) {
    if (inv?.id != null) byId.set(Number(inv.id), inv)
  }
  return byId
}

function invoiceNumber(inv) {
  return inv?.invoice_number || inv?.number || inv?.id || ''
}

function invoiceCompany(inv) {
  const fromField = String(inv?.company || '').trim()
  if (fromField) return fromField
  return companyFromActivity(inv?.activity || inv?.section) || 'non_classificata'
}

function mapCashEntries(entries = [], invoicesById = new Map()) {
  const out = []
  for (const row of entries) {
    const amount = Math.abs(toNum(row?.amount))
    if (!amount) continue
    const linkedInv = row?.invoice_id ? invoicesById.get(Number(row.invoice_id)) : null
    const invNum = linkedInv ? invoiceNumber(linkedInv) : ''
    const activity = String(row?.activity || '').trim().toLowerCase()
    const company =
      (linkedInv ? invoiceCompany(linkedInv) : '') ||
      companyFromActivity(activity) ||
      'non_classificata'
    const entryDate = isoDate(row?.entry_date)
    const entryYear = entryDate ? Number(entryDate.slice(0, 4)) : new Date().getFullYear()
    const mapping = mapPrimaNotaToPasscomAccounts(row, { linkedInvoice: Boolean(linkedInv) })
    if (!mapping) continue
    const meta = {
      date: entryDate,
      documentDate: entryDate,
      registrationNumber: formatRegistrationNumber('PN/', row?.id ?? '', entryYear),
      causale: mapping.causale,
      causaleLabel: causaleLabel(mapping.causale),
      description: linkedInv
        ? `Prima Nota pagamento fattura ${invNum} — ${row?.description || 'Movimento'}`.trim()
        : row?.description || `Movimento Prima Nota — ${activityLabel(activity)}`,
      documentLabel: linkedInv ? `Fattura ${invNum} · PN-${row?.id ?? ''}` : `Prima Nota PN-${row?.id ?? ''}`,
      documentType: linkedInv ? 'pagamento_fattura_prima_nota' : 'prima_nota',
      documentId: linkedInv ? String(linkedInv.id) : row?.id ? String(row.id) : '',
      documentPath: linkedInv ? '/fatture/registrate' : '/prima-nota',
      linkedInvoiceId: linkedInv ? String(linkedInv.id) : '',
      linkedCashEntryId: row?.id ? String(row.id) : '',
      relatedDocumentPath: linkedInv ? '/prima-nota' : '',
      relatedDocumentLabel: linkedInv ? `Prima Nota PN-${row?.id ?? ''}` : '',
      center: activity,
      locale: activity,
      company,
      counterparty:
        linkedInv?.supplier_name ||
        (row?.supplier_id ? `Supplier #${row.supplier_id}` : '') ||
        (row?.customer_id ? `Cliente #${row.customer_id}` : ''),
      supplier: linkedInv?.supplier_name || (row?.supplier_id ? `Supplier #${row.supplier_id}` : ''),
      customer: row?.customer_id ? `Cliente #${row.customer_id}` : '',
      source: 'prima_nota',
    }
    pushDoubleEntry(out, mapping.dare, mapping.avere, meta, amount)
  }
  return out
}

function invoiceAmount(inv) {
  return Math.abs(
    toNum(inv?.total) ||
      toNum(inv?.total_amount) ||
      toNum(inv?.amount_total) ||
      toNum(inv?.amount) ||
      toNum(inv?.totale) ||
      toNum(inv?.residuo),
  )
}

function normalizePartyName(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function partyKey(name) {
  return normalizePartyName(name).toLowerCase()
}

function mapInvoices(invoices = [], bankMatchedInvoiceIds = new Set(), cashLinkedInvoiceIds = new Set()) {
  const out = []
  for (const inv of invoices) {
    const amount = invoiceAmount(inv)
    if (!amount) continue
    const number = invoiceNumber(inv)
    const invId = Number(inv?.id)
    const company = invoiceCompany(inv)
    const locale = String(inv?.activity || inv?.section || '').trim().toLowerCase()
    const base = {
      date: isoDate(inv?.created_at || inv?.issue_date || inv?.invoice_date || inv?.due_date),
      documentDate: isoDate(inv?.issue_date || inv?.invoice_date || inv?.created_at || inv?.due_date),
      registrationNumber: `FA-${inv?.id ?? ''}`,
      causale: 'FE',
      description: `Registrazione fattura ${number}`.trim(),
      documentLabel: `Fattura ${number}`.trim(),
      documentType: 'fattura_fornitore',
      documentId: inv?.id ? String(inv.id) : '',
      documentPath: '/fatture/registrate',
      counterparty: inv?.supplier_name || '',
      supplier: inv?.supplier_name || '',
      center: locale || company,
      locale,
      company,
      source: 'fatture_fornitori',
      linkedInvoiceId: inv?.id ? String(inv.id) : '',
    }
    pushDoubleEntry(out, GENERAL_ACCOUNTS.costi.code, GENERAL_ACCOUNTS.debiti.code, base, amount)

    const paid = String(inv?.payment_status || '').toLowerCase() === 'paid'
    const hasBankLink = bankMatchedInvoiceIds.has(invId)
    const hasCashLink = cashLinkedInvoiceIds.has(invId)
    if (paid && !hasBankLink && !hasCashLink) {
      const pay = {
        ...base,
        causale: 'BOU',
        description: `Pagamento fattura ${number} (senza movimento bancario collegato)`.trim(),
        documentLabel: `Pagamento ${number}`.trim(),
        documentType: 'pagamento_fornitore',
        documentPath: '/pagamenti',
        source: 'pagamenti',
      }
      pushDoubleEntry(out, GENERAL_ACCOUNTS.debiti.code, GENERAL_ACCOUNTS.banca.code, pay, amount)
    }
  }
  return out
}

/** Mastrino soggetto: fatture ricevute → Dare, fatture emesse → Avere, pagamenti c/c → Avere. */
function buildFornitoriMastrini(
  receivedInvoices = [],
  issuedInvoices = [],
  bankMovements = [],
  { dateFrom, dateTo, company } = {},
) {
  const groups = new Map()

  const ensure = (name, extra = {}) => {
    const label = normalizePartyName(name) || 'Soggetto non indicato'
    const key = partyKey(label)
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name: label,
        type: 'fornitore',
        supplierId: extra.supplierId || null,
        totalDare: 0,
        totalAvere: 0,
        finalBalance: 0,
        ricevuteCount: 0,
        emesseCount: 0,
        pagamentiCount: 0,
        movements: [],
      })
    }
    const row = groups.get(key)
    if (!row.supplierId && extra.supplierId) row.supplierId = extra.supplierId
    return row
  }

  const inPeriod = (d) => {
    const day = String(d || '')
    if (dateFrom && day && day < dateFrom) return false
    if (dateTo && day && day > dateTo) return false
    return true
  }

  for (const inv of receivedInvoices) {
    const companyId = invoiceCompany(inv)
    if (company && companyId !== company) continue
    const amount = invoiceAmount(inv)
    if (!amount) continue
    const date = isoDate(inv?.invoice_date || inv?.issue_date || inv?.created_at || inv?.due_date)
    if (!inPeriod(date)) continue
    const name = inv?.supplier_name || (inv?.supplier_id ? `Fornitore #${inv.supplier_id}` : '')
    if (!normalizePartyName(name)) continue
    const number = invoiceNumber(inv)
    const party = ensure(name, { supplierId: inv?.supplier_id != null ? Number(inv.supplier_id) : null })
    party.totalDare += amount
    party.ricevuteCount += 1
    party.finalBalance = party.totalDare - party.totalAvere
    party.movements.push({
      date,
      documentDate: date,
      registrationNumber: `FR-${inv?.id ?? ''}`,
      causale: 'FR',
      causaleLabel: 'Fattura ricevuta',
      description: `Fattura ricevuta n. ${number}`.trim(),
      documentLabel: `Ricevuta ${number}`.trim(),
      documentType: 'fattura_ricevuta',
      documentId: inv?.id ? String(inv.id) : '',
      documentPath: '/fatture/registrate',
      linkedInvoiceId: inv?.id ? String(inv.id) : '',
      supplierId: inv?.supplier_id != null ? Number(inv.supplier_id) : null,
      counterparty: party.name,
      supplier: party.name,
      customer: '',
      company: companyId,
      companyLabel: companyId === 'non_classificata' ? 'Non classificate' : companyLabel(companyId),
      locale: String(inv?.activity || inv?.section || '').trim().toLowerCase(),
      amount,
      dare: amount,
      avere: 0,
      source: 'fatture_ricevute',
      invoiceKind: 'ricevuta',
    })
  }

  for (const inv of issuedInvoices) {
    const companyId = String(inv?.company || '').trim() || 'non_classificata'
    if (company && companyId !== company) continue
    const amount = invoiceAmount(inv)
    if (!amount) continue
    const date = isoDate(inv?.invoice_date || inv?.created_at)
    if (!inPeriod(date)) continue
    const name =
      normalizePartyName(inv?.customer_name || inv?.customer || inv?.cessionario) ||
      'Cliente non indicato'
    const number = invoiceNumber(inv) || inv?.id || ''
    const party = ensure(name)
    // Conto cliente: fattura emessa = credito (Dare); saldo Dare − Avere positivo = ti devono
    party.totalDare += amount
    party.emesseCount += 1
    party.finalBalance = party.totalDare - party.totalAvere
    party.movements.push({
      date,
      documentDate: date,
      registrationNumber: `FE-${inv?.id ?? ''}`,
      causale: 'FE',
      causaleLabel: 'Fattura emessa',
      description: `Fattura emessa n. ${number}`.trim(),
      documentLabel: `Emessa ${number}`.trim(),
      documentType: 'fattura_emessa',
      documentId: inv?.id ? String(inv.id) : '',
      documentPath: '/fatture/emesse',
      linkedInvoiceId: inv?.id ? String(inv.id) : '',
      counterparty: party.name,
      supplier: '',
      customer: party.name,
      company: companyId,
      companyLabel: companyId === 'non_classificata' ? 'Non classificate' : companyLabel(companyId),
      locale: String(inv?.activity || '').trim().toLowerCase(),
      amount,
      dare: amount,
      avere: 0,
      source: 'fatture_emesse',
      invoiceKind: 'emessa',
    })
  }

  for (const row of bankMovements) {
    const movementType = String(row?.movement_type || '').toLowerCase()
    if (movementType !== 'uscita') continue
    const matched = row?.matched_invoice
    const amount = Math.abs(toNum(row?.amount))
    if (!amount) continue
    const date = isoDate(row?.movement_date)
    if (!inPeriod(date)) continue
    const name =
      matched?.supplier_name ||
      row?.counterparty ||
      ''
    if (!normalizePartyName(name)) continue
    const companyId = matched ? invoiceCompany(matched) : company || 'non_classificata'
    if (company && companyId !== company && matched) continue
    const number = matched ? invoiceNumber(matched) : ''
    const party = ensure(name, {
      supplierId: matched?.supplier_id != null ? Number(matched.supplier_id) : null,
    })
    party.totalAvere += amount
    party.pagamentiCount += 1
    party.finalBalance = party.totalDare - party.totalAvere
    party.movements.push({
      date,
      documentDate: date,
      registrationNumber: `BA-${row?.id ?? ''}`,
      causale: 'BOU',
      causaleLabel: 'Pagamento c/c',
      description: number
        ? `Pagamento c/c fattura ${number} — ${row?.description || ''}`.trim()
        : `Pagamento c/c — ${row?.description || row?.account_label || ''}`.trim(),
      documentLabel: number ? `Pagamento ${number}` : `Mov. BA-${row?.id ?? ''}`,
      documentType: 'pagamento_fattura_banca',
      documentId: matched?.id ? String(matched.id) : row?.id ? String(row.id) : '',
      documentPath: matched ? '/fatture/registrate' : '/banca/movimenti',
      linkedInvoiceId: matched?.id ? String(matched.id) : '',
      linkedBankMovementId: row?.id ? String(row.id) : '',
      counterparty: party.name,
      supplier: party.name,
      customer: '',
      company: companyId,
      companyLabel: companyId === 'non_classificata' ? 'Non classificate' : companyLabel(companyId),
      locale: '',
      amount,
      dare: 0,
      avere: amount,
      source: 'pagamento_cc',
      invoiceKind: 'pagamento',
      bankAccountId: row?.bank_account_id || '',
      ledgerCode: row?.ledger_code || GENERAL_ACCOUNTS.banca.code,
    })
  }

  const parties = [...groups.values()]
    .map((row) => {
      const movements = [...row.movements].sort((a, b) => {
        const da = String(a.date || '')
        const db = String(b.date || '')
        if (da !== db) return da.localeCompare(db)
        return String(a.registrationNumber || '').localeCompare(String(b.registrationNumber || ''))
      })
      let progressive = 0
      const withBalance = movements.map((m) => {
        progressive += toNum(m.dare) - toNum(m.avere)
        return { ...m, progressiveBalance: progressive }
      })
      return {
        ...row,
        movements: withBalance,
        finalBalance: progressive,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'it', { sensitivity: 'base' }))

  return {
    parties,
    metrics: {
      totalParties: parties.length,
      totalDare: parties.reduce((acc, p) => acc + toNum(p.totalDare), 0),
      totalAvere: parties.reduce((acc, p) => acc + toNum(p.totalAvere), 0),
      finalBalance: parties.reduce((acc, p) => acc + toNum(p.finalBalance), 0),
      ricevuteCount: parties.reduce((acc, p) => acc + toNum(p.ricevuteCount), 0),
      emesseCount: parties.reduce((acc, p) => acc + toNum(p.emesseCount), 0),
      pagamentiCount: parties.reduce((acc, p) => acc + toNum(p.pagamentiCount), 0),
    },
  }
}

/** Separa clienti (solo emesse) e fornitori (ricevute + pagamenti) da un mastrino misto. */
function splitSoggettiMastrini(mixed) {
  const parties = Array.isArray(mixed?.parties) ? mixed.parties : []

  const project = (party, kinds, type) => {
    const movements = (party.movements || []).filter((m) => kinds.has(String(m.invoiceKind || '')))
    if (!movements.length) return null
    let progressive = 0
    let totalDare = 0
    let totalAvere = 0
    const withBalance = movements.map((m) => {
      totalDare += toNum(m.dare)
      totalAvere += toNum(m.avere)
      progressive += toNum(m.dare) - toNum(m.avere)
      return { ...m, progressiveBalance: progressive }
    })
    return {
      ...party,
      type,
      movements: withBalance,
      totalDare,
      totalAvere,
      finalBalance: progressive,
      ricevuteCount: movements.filter((m) => m.invoiceKind === 'ricevuta').length,
      emesseCount: movements.filter((m) => m.invoiceKind === 'emessa').length,
      pagamentiCount: movements.filter((m) => m.invoiceKind === 'pagamento').length,
    }
  }

  const metricsOf = (list) => ({
    totalParties: list.length,
    totalDare: list.reduce((acc, p) => acc + toNum(p.totalDare), 0),
    totalAvere: list.reduce((acc, p) => acc + toNum(p.totalAvere), 0),
    finalBalance: list.reduce((acc, p) => acc + toNum(p.finalBalance), 0),
    ricevuteCount: list.reduce((acc, p) => acc + toNum(p.ricevuteCount), 0),
    emesseCount: list.reduce((acc, p) => acc + toNum(p.emesseCount), 0),
    pagamentiCount: list.reduce((acc, p) => acc + toNum(p.pagamentiCount), 0),
  })

  const clientiParties = parties
    .map((p) => project(p, new Set(['emessa']), 'cliente'))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, 'it', { sensitivity: 'base' }))

  const fornitoriParties = parties
    .map((p) => project(p, new Set(['ricevuta', 'pagamento']), 'fornitore'))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, 'it', { sensitivity: 'base' }))

  return {
    clienti: { parties: clientiParties, metrics: metricsOf(clientiParties) },
    fornitori: { parties: fornitoriParties, metrics: metricsOf(fornitoriParties) },
  }
}

function mapBankMovements(items = [], invoicesById = new Map(), ledgerByAccountId = new Map()) {
  const out = []
  for (const row of items) {
    const amount = Math.abs(toNum(row?.amount))
    if (!amount) continue
    const movementType = String(row?.movement_type || '').toLowerCase()
    const desc = row?.description || row?.causale || 'Movimento bancario'
    const cat = String(row?.category || '').toLowerCase()
    const isCommission =
      cat.includes('commission') ||
      desc.toLowerCase().includes('commission') ||
      desc.toLowerCase().includes('spese')
    const matchedInv =
      row?.matched_invoice ||
      (row?.matched_invoice_id ? invoicesById.get(Number(row.matched_invoice_id)) : null)
    const matchedNum = matchedInv ? invoiceNumber(matchedInv) : ''
    const supplierName = matchedInv?.supplier_name || row?.matched_invoice?.supplier_name || row?.counterparty || ''
    const company = matchedInv ? invoiceCompany(matchedInv) : 'non_classificata'
    const accountId = Number(row?.bank_account_id)
    const bancaCode =
      row?.ledger_code ||
      ledgerByAccountId.get(accountId) ||
      GENERAL_ACCOUNTS.banca.code
    const base = {
      date: isoDate(row?.movement_date),
      documentDate: isoDate(row?.movement_date),
      registrationNumber: `BA-${row?.id ?? ''}`,
      causale: movementType === 'entrata' ? 'BIN' : isCommission ? 'COM' : 'BOU',
      description: matchedInv
        ? `Pagamento bancario fattura ${matchedNum} — ${desc}`.trim()
        : desc,
      documentLabel: matchedInv
        ? `Fattura ${matchedNum} · Mov. BA-${row?.id ?? ''}`
        : row?.account_label
          ? `Banca ${row.account_label}`
          : 'Movimento bancario',
      documentType: matchedInv ? 'pagamento_fattura_banca' : 'movimento_bancario',
      documentId: matchedInv ? String(matchedInv.id || row.matched_invoice_id) : row?.id ? String(row.id) : '',
      documentPath: matchedInv ? '/fatture/registrate' : '/banca/movimenti',
      linkedInvoiceId: matchedInv ? String(matchedInv.id || row.matched_invoice_id) : '',
      linkedBankMovementId: row?.id ? String(row.id) : '',
      relatedDocumentPath: matchedInv ? '/banca/movimenti' : '',
      relatedDocumentLabel: matchedInv ? `Movimento BA-${row?.id ?? ''}` : '',
      center: row?.account_label || '',
      company,
      counterparty: supplierName,
      supplier: supplierName,
      source: matchedInv ? 'pagamento_fattura_banca' : movementType === 'entrata' ? 'incasso' : 'pagamento',
      bankAccountId: accountId || '',
      ledgerCode: bancaCode,
    }
    if (movementType === 'entrata') {
      pushDoubleEntry(out, bancaCode, GENERAL_ACCOUNTS.crediti.code, base, amount)
    } else if (isCommission) {
      pushDoubleEntry(out, GENERAL_ACCOUNTS.commissioni.code, bancaCode, base, amount)
    } else {
      pushDoubleEntry(out, GENERAL_ACCOUNTS.debiti.code, bancaCode, base, amount)
    }
  }
  return out
}

function buildLedger(movements, extraAccounts = []) {
  const byAccount = new Map()
  for (const account of ACCOUNT_PLAN) {
    byAccount.set(account.code, {
      ...account,
      openingBalance: 0,
      totalDare: 0,
      totalAvere: 0,
      finalBalance: 0,
      movements: [],
      status: 'attivo',
    })
  }
  for (const acc of extraAccounts) {
    const code = String(acc?.code || '').trim()
    if (!code) continue
    if (byAccount.has(code)) {
      const existing = byAccount.get(code)
      if (acc.description) existing.description = acc.description
      if (acc.bankAccountId != null) existing.bankAccountId = acc.bankAccountId
      existing.keepEmpty = true
      continue
    }
    byAccount.set(code, {
      code,
      description: acc.description || `Banca c/c ${code}`,
      category: 'Patrimoniale',
      type: 'attivo',
      statementType: 'stato_patrimoniale',
      group: 'Banca',
      bankAccountId: acc.bankAccountId,
      keepEmpty: true,
      openingBalance: 0,
      totalDare: 0,
      totalAvere: 0,
      finalBalance: 0,
      movements: [],
      status: 'attivo',
    })
  }

  const sorted = [...movements].sort((a, b) => {
    const da = String(a.date || '')
    const db = String(b.date || '')
    if (da !== db) return da.localeCompare(db)
    return String(a.registrationNumber || '').localeCompare(String(b.registrationNumber || ''))
  })

  for (const mv of sorted) {
    const account = byAccount.get(mv.accountCode)
    if (!account) continue
    account.totalDare += toNum(mv.dare)
    account.totalAvere += toNum(mv.avere)
    account.finalBalance = signByType(account.type, account.totalDare, account.totalAvere)
    account.movements.push({
      ...mv,
      progressiveBalance: account.finalBalance,
    })
  }

  const rows = [...byAccount.values()]
    .filter((row) => row.movements.length > 0 || row.keepEmpty)
    .map((row) => {
      const { keepEmpty, ...rest } = row
      return {
        ...rest,
        status: Math.abs(row.finalBalance) < 0.005 ? 'pareggio' : row.finalBalance > 0 ? 'attivo' : 'passivo',
      }
    })

  const totalDare = rows.reduce((acc, r) => acc + toNum(r.totalDare), 0)
  const totalAvere = rows.reduce((acc, r) => acc + toNum(r.totalAvere), 0)

  return {
    accounts: rows,
    movements: sorted,
    metrics: {
      totalAccounts: rows.length,
      totalDare,
      totalAvere,
      finalBalance: totalDare - totalAvere,
      recentMovements: sorted.slice(-8).reverse(),
    },
  }
}

function buildPartitario(movements) {
  const groups = new Map()
  const sorted = [...movements].sort((a, b) => {
    const da = String(a.date || '')
    const db = String(b.date || '')
    if (da !== db) return da.localeCompare(db)
    return String(a.registrationNumber || '').localeCompare(String(b.registrationNumber || ''))
  })

  for (const mv of sorted) {
    const label = String(mv.supplier || mv.customer || mv.counterparty || '').trim()
    if (!label) continue
    const type = mv.supplier ? 'fornitore' : mv.customer ? 'cliente' : 'soggetto'
    const key = `${type}:${label.toLowerCase()}`
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        type,
        name: label,
        totalDare: 0,
        totalAvere: 0,
        finalBalance: 0,
        movements: [],
      })
    }
    const row = groups.get(key)
    row.totalDare += toNum(mv.dare)
    row.totalAvere += toNum(mv.avere)
    row.finalBalance = row.totalDare - row.totalAvere
    row.movements.push({
      ...mv,
      progressiveBalance: row.finalBalance,
    })
  }

  const parties = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'it', { sensitivity: 'base' }))
  return {
    parties,
    metrics: {
      totalParties: parties.length,
      totalDare: parties.reduce((acc, p) => acc + toNum(p.totalDare), 0),
      totalAvere: parties.reduce((acc, p) => acc + toNum(p.totalAvere), 0),
      finalBalance: parties.reduce((acc, p) => acc + toNum(p.finalBalance), 0),
    },
  }
}

async function fetchCashEntriesForCompany({ dateFrom, dateTo, company }) {
  const activities = activitiesForCompany(company)
  if (!activities.length) {
    if (!company) {
      try {
        const rows = await fetchEntries({
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
        })
        return { entries: Array.isArray(rows) ? rows : [], lockedLocales: [] }
      } catch {
        return { entries: [], lockedLocales: [] }
      }
    }
    return { entries: [], lockedLocales: [] }
  }

  const lockedLocales = []
  const results = await Promise.allSettled(
    activities.map(async (activity) => {
      const accessCode = readStoredPrimaNotaAccessCode(activity)
      try {
        const rows = await fetchEntries({
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          activity,
          access_code: accessCode || undefined,
        })
        return { activity, rows: Array.isArray(rows) ? rows : [] }
      } catch {
        lockedLocales.push(activityLabel(activity))
        return { activity, rows: [] }
      }
    }),
  )

  const byId = new Map()
  for (const res of results) {
    if (res.status !== 'fulfilled') continue
    for (const row of res.value.rows) {
      if (row?.id != null) byId.set(Number(row.id), row)
      else byId.set(`${row?.entry_date}-${row?.amount}-${row?.description}`, row)
    }
  }
  return { entries: [...byId.values()], lockedLocales }
}

export async function fetchMastriniData({ dateFrom, dateTo, company } = {}) {
  const companyId = String(company || '').trim()
  const [cashRes, invoiceRes, issuedRes, bankRes, accountsRes] = await Promise.allSettled([
    fetchCashEntriesForCompany({ dateFrom, dateTo, company: companyId }),
    fetchInvoices(companyId ? { company: companyId } : {}),
    fetchIssuedInvoices({ company: companyId || undefined, limit: 500 }),
    fetchBancaMovimenti({
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }),
    fetchBancaAccountsForCompany(companyId || undefined),
  ])

  const warnings = []
  const cashPayload = cashRes.status === 'fulfilled' ? cashRes.value : { entries: [], lockedLocales: [] }
  const cashEntries = Array.isArray(cashPayload?.entries) ? cashPayload.entries : []
  if (cashRes.status === 'rejected') warnings.push('Prima Nota non disponibile o protetta da codice.')
  if (Array.isArray(cashPayload?.lockedLocales) && cashPayload.lockedLocales.length) {
    warnings.push(
      `Prima Nota non accessibile per: ${cashPayload.lockedLocales.join(', ')}. Apri il locale in Prima Nota con il codice, poi ricarica i mastrini.`,
    )
  }

  const invoices = invoiceRes.status === 'fulfilled' && Array.isArray(invoiceRes.value) ? invoiceRes.value : []
  if (invoiceRes.status === 'rejected') warnings.push('Fatture ricevute non disponibili.')

  const issuedPayload = issuedRes.status === 'fulfilled' ? issuedRes.value : null
  const issuedInvoices = Array.isArray(issuedPayload?.items)
    ? issuedPayload.items
    : Array.isArray(issuedPayload)
      ? issuedPayload
      : []
  if (issuedRes.status === 'rejected') warnings.push('Fatture emesse non disponibili.')

  const bankAccounts =
    accountsRes.status === 'fulfilled' && Array.isArray(accountsRes.value?.items)
      ? accountsRes.value.items
      : []
  if (accountsRes.status === 'rejected') warnings.push('Conti correnti banca non disponibili.')

  const ledgerByAccountId = new Map()
  const linkedAccountIds = new Set()
  const extraLedgerAccounts = []
  for (const acc of bankAccounts) {
    const id = Number(acc?.id)
    const code = String(acc?.ledger_code || GENERAL_ACCOUNTS.banca.code).trim() || GENERAL_ACCOUNTS.banca.code
    if (Number.isFinite(id) && id > 0) {
      linkedAccountIds.add(id)
      ledgerByAccountId.set(id, code)
    }
    const bankLabel = [acc.bank_name, acc.account_name].filter(Boolean).join(' · ') || 'Banca c/c'
    extraLedgerAccounts.push({
      code,
      description: `${bankLabel} (mastro ${code})`,
      bankAccountId: Number.isFinite(id) ? id : undefined,
    })
  }
  if (companyId && linkedAccountIds.size === 0) {
    warnings.push(
      'Nessun conto corrente associato a questa società (né condiviso). Collega la Popolare Puglia in Banca → Conti.',
    )
  } else if (companyId && bankAccounts.some((a) => !(a.company || '').trim())) {
    warnings.push(
      'Mastrini usano i c/c condivisi (es. Popolare Puglia e Basilicata). Quando colleghi Otranto/Sanpaolo, assegna ogni banca alla società.',
    )
  }

  let bankMovements =
    bankRes.status === 'fulfilled' && Array.isArray(bankRes.value?.items) ? bankRes.value.items : []
  if (bankRes.status === 'rejected') warnings.push('Movimenti bancari non disponibili.')

  // Solo movimenti dei c/c associati (o condivisi) alla società
  if (linkedAccountIds.size > 0) {
    bankMovements = bankMovements.filter((m) => linkedAccountIds.has(Number(m?.bank_account_id)))
  }

  // Per società: movimenti banca non riconciliati restano; quelli con fattura devono essere della stessa società.
  if (companyId) {
    const invoiceIds = new Set(invoices.map((inv) => Number(inv.id)).filter((id) => Number.isFinite(id)))
    bankMovements = bankMovements.filter((m) => {
      const mid = Number(m?.matched_invoice_id)
      if (!Number.isFinite(mid) || mid <= 0) return true
      return invoiceIds.has(mid)
    })
  }

  const invoicesById = buildInvoiceIndex(invoices)
  const bankMatchedInvoiceIds = new Set(
    bankMovements.filter((m) => m?.matched_invoice_id).map((m) => Number(m.matched_invoice_id)),
  )
  const cashLinkedInvoiceIds = new Set(
    cashEntries.filter((e) => e?.invoice_id).map((e) => Number(e.invoice_id)),
  )

  const movements = [
    ...mapCashEntries(cashEntries, invoicesById),
    ...mapInvoices(invoices, bankMatchedInvoiceIds, cashLinkedInvoiceIds),
    ...mapBankMovements(bankMovements, invoicesById, ledgerByAccountId),
  ].filter((m) => {
    const d = String(m.date || '')
    if (dateFrom && d && d < dateFrom) return false
    if (dateTo && d && d > dateTo) return false
    // Movimenti banca: company può essere non_classificata se non riconciliati — già filtrati per account
    if (m.source === 'pagamento' || m.source === 'incasso' || m.source === 'pagamento_fattura_banca') {
      return true
    }
    if (companyId && String(m.company || '') !== companyId) return false
    return true
  })
  const ledger = buildLedger(movements, extraLedgerAccounts)
  const partitario = buildPartitario(movements)
  const soggettiMist = buildFornitoriMastrini(invoices, issuedInvoices, bankMovements, {
    dateFrom,
    dateTo,
    company: companyId || undefined,
  })
  const { clienti, fornitori } = splitSoggettiMastrini(soggettiMist)
  return {
    ...ledger,
    accountPlan: ACCOUNT_PLAN,
    partitario,
    clienti,
    fornitori,
    bankAccounts,
    company: companyId || '',
    companyLabel: companyId
      ? companyId === 'non_classificata'
        ? 'Non classificate'
        : companyLabel(companyId)
      : '',
    warnings,
  }
}

export { ACCOUNT_PLAN }
