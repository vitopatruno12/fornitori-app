import { fetchBancaMovimenti } from './bancaService'
import { fetchEntries } from './cashService'
import { fetchInvoices } from './invoicesService'

const ACCOUNT_PLAN = [
  {
    code: '1000',
    description: 'Cassa',
    category: 'Patrimoniale',
    type: 'attivo',
    statementType: 'stato_patrimoniale',
  },
  {
    code: '1100',
    description: 'Banca c/c',
    category: 'Patrimoniale',
    type: 'attivo',
    statementType: 'stato_patrimoniale',
  },
  {
    code: '1200',
    description: 'Crediti clienti',
    category: 'Patrimoniale',
    type: 'attivo',
    statementType: 'stato_patrimoniale',
  },
  {
    code: '2000',
    description: 'Debiti fornitori',
    category: 'Patrimoniale',
    type: 'passivo',
    statementType: 'stato_patrimoniale',
  },
  {
    code: '4000',
    description: 'Ricavi vendite',
    category: 'Economico',
    type: 'ricavo',
    statementType: 'conto_economico',
  },
  {
    code: '5000',
    description: 'Costi acquisti/fornitori',
    category: 'Economico',
    type: 'costo',
    statementType: 'conto_economico',
  },
  {
    code: '6100',
    description: 'Commissioni e oneri bancari',
    category: 'Economico',
    type: 'costo',
    statementType: 'conto_economico',
  },
]

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

function pushMovement(list, accountCode, raw, amount, side) {
  const val = Math.abs(toNum(amount))
  if (val <= 0) return
  list.push({
    accountCode,
    date: raw.date || '',
    registrationNumber: raw.registrationNumber || '',
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
    center: raw.center || '',
    source: raw.source || '',
  })
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

function mapCashEntries(entries = [], invoicesById = new Map()) {
  const out = []
  for (const row of entries) {
    const amount = Math.abs(toNum(row?.amount))
    if (!amount) continue
    const linkedInv = row?.invoice_id ? invoicesById.get(Number(row.invoice_id)) : null
    const invNum = linkedInv ? invoiceNumber(linkedInv) : ''
    const meta = {
      date: isoDate(row?.entry_date),
      registrationNumber: `PN-${row?.id ?? ''}`,
      description: linkedInv
        ? `Prima Nota pagamento fattura ${invNum} — ${row?.description || 'Movimento'}`.trim()
        : row?.description || 'Movimento Prima Nota',
      documentLabel: linkedInv ? `Fattura ${invNum} · PN-${row?.id ?? ''}` : 'Prima Nota',
      documentType: linkedInv ? 'pagamento_fattura_prima_nota' : 'prima_nota',
      documentId: linkedInv ? String(linkedInv.id) : row?.id ? String(row.id) : '',
      documentPath: linkedInv ? '/fatture/registrate' : '/prima-nota',
      linkedInvoiceId: linkedInv ? String(linkedInv.id) : '',
      linkedCashEntryId: row?.id ? String(row.id) : '',
      relatedDocumentPath: linkedInv ? '/prima-nota' : '',
      relatedDocumentLabel: linkedInv ? `Prima Nota PN-${row?.id ?? ''}` : '',
      center: row?.activity || '',
      supplier: linkedInv?.supplier_name || (row?.supplier_id ? `Supplier #${row.supplier_id}` : ''),
      customer: row?.customer_id ? `Cliente #${row.customer_id}` : '',
      source: 'prima_nota',
    }
    if (row?.type === 'entrata') {
      pushMovement(out, '1000', meta, amount, 'dare')
      pushMovement(out, '4000', meta, amount, 'avere')
    } else {
      pushMovement(out, '5000', meta, amount, 'dare')
      pushMovement(out, '1000', meta, amount, 'avere')
    }
  }
  return out
}

function invoiceAmount(inv) {
  return Math.abs(
    toNum(inv?.total_amount) ||
      toNum(inv?.amount_total) ||
      toNum(inv?.amount) ||
      toNum(inv?.totale) ||
      toNum(inv?.residuo),
  )
}

function mapInvoices(invoices = [], bankMatchedInvoiceIds = new Set(), cashLinkedInvoiceIds = new Set()) {
  const out = []
  for (const inv of invoices) {
    const amount = invoiceAmount(inv)
    if (!amount) continue
    const number = invoiceNumber(inv)
    const invId = Number(inv?.id)
    const base = {
      date: isoDate(inv?.created_at || inv?.issue_date || inv?.invoice_date || inv?.due_date),
      registrationNumber: `FA-${inv?.id ?? ''}`,
      description: `Registrazione fattura ${number}`.trim(),
      documentLabel: `Fattura ${number}`.trim(),
      documentType: 'fattura_fornitore',
      documentId: inv?.id ? String(inv.id) : '',
      documentPath: '/fatture/registrate',
      counterparty: inv?.supplier_name || '',
      supplier: inv?.supplier_name || '',
      center: inv?.section || '',
      source: 'fatture_fornitori',
    }
    pushMovement(out, '5000', base, amount, 'dare')
    pushMovement(out, '2000', base, amount, 'avere')

    const paid = String(inv?.payment_status || '').toLowerCase() === 'paid'
    const hasBankLink = bankMatchedInvoiceIds.has(invId)
    const hasCashLink = cashLinkedInvoiceIds.has(invId)
    if (paid && !hasBankLink && !hasCashLink) {
      const pay = {
        ...base,
        description: `Pagamento fattura ${number} (senza movimento bancario collegato)`.trim(),
        documentLabel: `Pagamento ${number}`.trim(),
        documentType: 'pagamento_fornitore',
        documentPath: '/pagamenti',
        source: 'pagamenti',
      }
      pushMovement(out, '2000', pay, amount, 'dare')
      pushMovement(out, '1100', pay, amount, 'avere')
    }
  }
  return out
}

function mapBankMovements(items = [], invoicesById = new Map()) {
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
    const base = {
      date: isoDate(row?.movement_date),
      registrationNumber: `BA-${row?.id ?? ''}`,
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
      counterparty: supplierName,
      supplier: supplierName,
      source: matchedInv ? 'pagamento_fattura_banca' : movementType === 'entrata' ? 'incasso' : 'pagamento',
    }
    if (movementType === 'entrata') {
      pushMovement(out, '1100', base, amount, 'dare')
      pushMovement(out, '1200', base, amount, 'avere')
    } else if (isCommission) {
      pushMovement(out, '6100', base, amount, 'dare')
      pushMovement(out, '1100', base, amount, 'avere')
    } else {
      pushMovement(out, '2000', base, amount, 'dare')
      pushMovement(out, '1100', base, amount, 'avere')
    }
  }
  return out
}

function buildLedger(movements) {
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

  const rows = [...byAccount.values()].map((row) => ({
    ...row,
    status: Math.abs(row.finalBalance) < 0.005 ? 'pareggio' : row.finalBalance > 0 ? 'attivo' : 'passivo',
  }))

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

export async function fetchMastriniData({ dateFrom, dateTo } = {}) {
  const [cashRes, invoiceRes, bankRes] = await Promise.allSettled([
    fetchEntries({
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }),
    fetchInvoices(),
    fetchBancaMovimenti({
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }),
  ])

  const warnings = []
  const cashEntries = cashRes.status === 'fulfilled' && Array.isArray(cashRes.value) ? cashRes.value : []
  if (cashRes.status === 'rejected') warnings.push('Prima Nota non disponibile o protetta da codice.')

  const invoices = invoiceRes.status === 'fulfilled' && Array.isArray(invoiceRes.value) ? invoiceRes.value : []
  if (invoiceRes.status === 'rejected') warnings.push('Fatture non disponibili.')

  const bankMovements =
    bankRes.status === 'fulfilled' && Array.isArray(bankRes.value?.items) ? bankRes.value.items : []
  if (bankRes.status === 'rejected') warnings.push('Movimenti bancari non disponibili.')

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
    ...mapBankMovements(bankMovements, invoicesById),
  ]
  const ledger = buildLedger(movements)
  const partitario = buildPartitario(movements)
  return {
    ...ledger,
    partitario,
    warnings,
  }
}
