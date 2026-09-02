/**
 * Piano conti e causali tipo Passcom per collegare Prima Nota → Mastrini contabili.
 * Ogni locale Prima Nota ha codici cassa / ricavi / costi dedicati.
 */

import { activityLabel, companyFromActivity } from '../utils/fattureCompany.js'

/** Conti Prima Nota (campo cash_entries.conto). */
export const PN_CONTO = {
  NON_FISCALE: 'NON_FISCALE',
  POS: 'POS',
  REFILL: 'REFILL',
  STACKER: 'SVUOTAMENTO_STACKER',
}

/** Causali registrazione (Passcom). */
export const MASTRINI_CAUSALI = {
  INC: 'Incasso cassa contanti',
  INS: 'Incasso POS',
  INF: 'Incasso non fiscale',
  IRF: 'Refill distributori',
  STK: 'Svuotamento stacker',
  PAG: 'Pagamento cassa',
  PFF: 'Pagamento fattura fornitore (Prima Nota)',
  FE: 'Registrazione fattura elettronica',
  BIN: 'Bonifico in entrata',
  BOU: 'Bonifico in uscita',
  COM: 'Commissioni bancarie',
}

/** Codici conto per locale Prima Nota. */
export const LOCALE_ACCOUNT_CODES = {
  risacca: { cassa: '1001', ricavi: '4101', costi: '5101' },
  via_lattea: { cassa: '1002', ricavi: '4102', costi: '5102' },
  via_abba: { cassa: '1003', ricavi: '4103', costi: '5103' },
  via_zanardelli: { cassa: '1004', ricavi: '4104', costi: '5104' },
  mediazione: { cassa: '1003', ricavi: '4103', costi: '5103' },
  pg: { cassa: '1005', ricavi: '4105', costi: '5105' },
}

/** Conti ausiliari cassa (POS, NC, refill, stacker). */
export const AUXILIARY_ACCOUNTS = {
  pos: { code: '1010', description: 'Incassi POS' },
  nonFiscale: { code: '1020', description: 'Cassa non fiscale' },
  refill: { code: '1030', description: 'Refill distributori' },
  stacker: { code: '1040', description: 'Svuotamento stacker' },
}

/** Conti patrimoniali / economici generali (fatture, banca). */
export const GENERAL_ACCOUNTS = {
  cassa: { code: '1000', description: 'Cassa generale', category: 'Patrimoniale', type: 'attivo', statementType: 'stato_patrimoniale' },
  banca: { code: '1100', description: 'Banca c/c', category: 'Patrimoniale', type: 'attivo', statementType: 'stato_patrimoniale' },
  crediti: { code: '1200', description: 'Crediti clienti', category: 'Patrimoniale', type: 'attivo', statementType: 'stato_patrimoniale' },
  debiti: { code: '2000', description: 'Debiti fornitori', category: 'Patrimoniale', type: 'passivo', statementType: 'stato_patrimoniale' },
  ricavi: { code: '4000', description: 'Ricavi vendite', category: 'Economico', type: 'ricavo', statementType: 'conto_economico' },
  costi: { code: '5000', description: 'Costi acquisti/fornitori', category: 'Economico', type: 'costo', statementType: 'conto_economico' },
  commissioni: { code: '6100', description: 'Commissioni e oneri bancari', category: 'Economico', type: 'costo', statementType: 'conto_economico' },
}

function accountMeta(code, description, category, type, statementType, extra = {}) {
  return {
    code,
    description,
    category,
    type,
    statementType,
    ...extra,
  }
}

function localeAccountDescription(kind, activity) {
  const label = activityLabel(activity)
  if (kind === 'cassa') return `Cassa — ${label}`
  if (kind === 'ricavi') return `Ricavi — ${label}`
  return `Costi — ${label}`
}

/** Piano conti completo Atlas (Passcom). */
export function buildPasscomAccountPlan() {
  const plan = [
    accountMeta(
      GENERAL_ACCOUNTS.cassa.code,
      GENERAL_ACCOUNTS.cassa.description,
      GENERAL_ACCOUNTS.cassa.category,
      GENERAL_ACCOUNTS.cassa.type,
      GENERAL_ACCOUNTS.cassa.statementType,
      { group: 'Cassa' },
    ),
  ]

  for (const [activity, codes] of Object.entries(LOCALE_ACCOUNT_CODES)) {
    if (activity === 'mediazione') continue
    plan.push(
      accountMeta(codes.cassa, localeAccountDescription('cassa', activity), 'Patrimoniale', 'attivo', 'stato_patrimoniale', {
        group: 'Cassa per locale',
        locale: activity,
        company: companyFromActivity(activity),
      }),
      accountMeta(codes.ricavi, localeAccountDescription('ricavi', activity), 'Economico', 'ricavo', 'conto_economico', {
        group: 'Ricavi per locale',
        locale: activity,
        company: companyFromActivity(activity),
      }),
      accountMeta(codes.costi, localeAccountDescription('costi', activity), 'Economico', 'costo', 'conto_economico', {
        group: 'Costi per locale',
        locale: activity,
        company: companyFromActivity(activity),
      }),
    )
  }

  plan.push(
    accountMeta(AUXILIARY_ACCOUNTS.pos.code, AUXILIARY_ACCOUNTS.pos.description, 'Patrimoniale', 'attivo', 'stato_patrimoniale', {
      group: 'Cassa ausiliaria',
    }),
    accountMeta(AUXILIARY_ACCOUNTS.nonFiscale.code, AUXILIARY_ACCOUNTS.nonFiscale.description, 'Patrimoniale', 'attivo', 'stato_patrimoniale', {
      group: 'Cassa ausiliaria',
    }),
    accountMeta(AUXILIARY_ACCOUNTS.refill.code, AUXILIARY_ACCOUNTS.refill.description, 'Patrimoniale', 'attivo', 'stato_patrimoniale', {
      group: 'Cassa ausiliaria',
    }),
    accountMeta(AUXILIARY_ACCOUNTS.stacker.code, AUXILIARY_ACCOUNTS.stacker.description, 'Patrimoniale', 'attivo', 'stato_patrimoniale', {
      group: 'Cassa ausiliaria',
    }),
    accountMeta(
      GENERAL_ACCOUNTS.banca.code,
      GENERAL_ACCOUNTS.banca.description,
      GENERAL_ACCOUNTS.banca.category,
      GENERAL_ACCOUNTS.banca.type,
      GENERAL_ACCOUNTS.banca.statementType,
      { group: 'Patrimoniale' },
    ),
    accountMeta(
      GENERAL_ACCOUNTS.crediti.code,
      GENERAL_ACCOUNTS.crediti.description,
      GENERAL_ACCOUNTS.crediti.category,
      GENERAL_ACCOUNTS.crediti.type,
      GENERAL_ACCOUNTS.crediti.statementType,
      { group: 'Patrimoniale' },
    ),
    accountMeta(
      GENERAL_ACCOUNTS.debiti.code,
      GENERAL_ACCOUNTS.debiti.description,
      GENERAL_ACCOUNTS.debiti.category,
      GENERAL_ACCOUNTS.debiti.type,
      GENERAL_ACCOUNTS.debiti.statementType,
      { group: 'Patrimoniale' },
    ),
    accountMeta(
      GENERAL_ACCOUNTS.ricavi.code,
      GENERAL_ACCOUNTS.ricavi.description,
      GENERAL_ACCOUNTS.ricavi.category,
      GENERAL_ACCOUNTS.ricavi.type,
      GENERAL_ACCOUNTS.ricavi.statementType,
      { group: 'Economico' },
    ),
    accountMeta(
      GENERAL_ACCOUNTS.costi.code,
      GENERAL_ACCOUNTS.costi.description,
      GENERAL_ACCOUNTS.costi.category,
      GENERAL_ACCOUNTS.costi.type,
      GENERAL_ACCOUNTS.costi.statementType,
      { group: 'Economico' },
    ),
    accountMeta(
      GENERAL_ACCOUNTS.commissioni.code,
      GENERAL_ACCOUNTS.commissioni.description,
      GENERAL_ACCOUNTS.commissioni.category,
      GENERAL_ACCOUNTS.commissioni.type,
      GENERAL_ACCOUNTS.commissioni.statementType,
      { group: 'Economico' },
    ),
  )

  const byCode = new Map()
  return plan.filter((row) => {
    if (byCode.has(row.code)) return false
    byCode.set(row.code, true)
    return true
  })
}

export function localeAccountCodes(activity) {
  const slug = String(activity || '').trim().toLowerCase()
  const hit = LOCALE_ACCOUNT_CODES[slug]
  if (hit) return hit
  return {
    cassa: GENERAL_ACCOUNTS.cassa.code,
    ricavi: GENERAL_ACCOUNTS.ricavi.code,
    costi: GENERAL_ACCOUNTS.costi.code,
  }
}

export function accountDescription(code, plan = null) {
  const chart = plan || buildPasscomAccountPlan()
  const hit = chart.find((row) => row.code === String(code || ''))
  return hit?.description || String(code || '')
}

export function causaleLabel(code) {
  const key = String(code || '').trim().toUpperCase()
  return MASTRINI_CAUSALI[key] || key || '—'
}

export function formatRegistrationNumber(prefix, id, year) {
  const y = year || new Date().getFullYear()
  const num = String(id || '').padStart(6, '0')
  return `${prefix}${y}/${num}`
}

/**
 * Mappa un movimento Prima Nota su conti e causale Passcom.
 * @returns {{ dare: string, avere: string, causale: string } | null}
 */
export function mapPrimaNotaToPasscomAccounts(row, { linkedInvoice = false } = {}) {
  const activity = String(row?.activity || '').trim().toLowerCase()
  const accounts = localeAccountCodes(activity)
  const conto = String(row?.conto || '').trim().toUpperCase()
  const isEntrata = String(row?.type || '').toLowerCase() === 'entrata'

  if (conto === PN_CONTO.POS) {
    if (!isEntrata) return null
    return { dare: AUXILIARY_ACCOUNTS.pos.code, avere: accounts.ricavi, causale: 'INS' }
  }
  if (conto === PN_CONTO.NON_FISCALE) {
    return isEntrata
      ? { dare: AUXILIARY_ACCOUNTS.nonFiscale.code, avere: accounts.ricavi, causale: 'INF' }
      : { dare: accounts.costi, avere: AUXILIARY_ACCOUNTS.nonFiscale.code, causale: 'PAG' }
  }
  if (conto === PN_CONTO.REFILL) {
    return isEntrata
      ? { dare: AUXILIARY_ACCOUNTS.refill.code, avere: accounts.ricavi, causale: 'IRF' }
      : { dare: accounts.costi, avere: AUXILIARY_ACCOUNTS.refill.code, causale: 'PAG' }
  }
  if (conto === PN_CONTO.STACKER) {
    return { dare: accounts.cassa, avere: AUXILIARY_ACCOUNTS.stacker.code, causale: 'STK' }
  }

  if (linkedInvoice && !isEntrata) {
    return { dare: accounts.costi, avere: accounts.cassa, causale: 'PFF' }
  }
  if (isEntrata) {
    return { dare: accounts.cassa, avere: accounts.ricavi, causale: 'INC' }
  }
  return { dare: accounts.costi, avere: accounts.cassa, causale: 'PAG' }
}

/** Conti suggeriti per la società selezionata (filtro elenco Passcom). */
export function accountCodesForCompany(companyId, plan = null) {
  const chart = plan || buildPasscomAccountPlan()
  const company = String(companyId || '').trim().toLowerCase()
  if (!company || company === 'non_classificata') {
    return new Set(chart.map((row) => row.code))
  }
  const codes = new Set(
    chart
      .filter((row) => !row.company || row.company === company)
      .map((row) => row.code),
  )
  codes.add(GENERAL_ACCOUNTS.banca.code)
  codes.add(GENERAL_ACCOUNTS.debiti.code)
  codes.add(GENERAL_ACCOUNTS.crediti.code)
  codes.add(GENERAL_ACCOUNTS.commissioni.code)
  codes.add(GENERAL_ACCOUNTS.costi.code)
  codes.add(GENERAL_ACCOUNTS.ricavi.code)
  return codes
}
