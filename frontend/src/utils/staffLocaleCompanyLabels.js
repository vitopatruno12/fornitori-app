/**
 * Etichette società/locale per Stipendi e buste paga (allineate a Personale).
 * P.IVA Tigito → locali Atlas.
 */

export const TIGITO_COMPANY_BY_VAT = {
  '04945600759': {
    id: 'mediazione',
    label: 'La Mediazione S.r.l.',
    shortLabel: 'Mediazione',
  },
  '04886500752': {
    id: 'via_lattea',
    label: "La Via Lattea Società Agricola",
    shortLabel: 'Via Lattea',
  },
  '05186540752': {
    id: 'risacca',
    label: 'Risacca',
    shortLabel: 'Risacca',
  },
  '05440050754': {
    id: 'pg',
    label: 'PG',
    shortLabel: 'PG',
  },
}

/** Prefisso file Tigito (es. PG02180000826.PDF) → società + P.IVA. */
export const TIGITO_FILE_PREFIX_COMPANY = [
  { prefix: 'PG0218', shortLabel: 'Mediazione', vat: '04945600759' },
  { prefix: 'PG0216', shortLabel: 'Via Lattea', vat: '04886500752' },
]

/**
 * Riconosce società dal nome file buste.
 * PG02180000826.PDF → Mediazione; PG02160000826.PDF → Via Lattea.
 */
export function resolveTigitoCompanyFromFilename(filename) {
  const base = String(filename || '')
    .trim()
    .split(/[/\\]/)
    .pop()
  if (!base) return null
  const up = base.toUpperCase().replace(/\s+/g, '')
  for (const row of TIGITO_FILE_PREFIX_COMPANY) {
    if (up.startsWith(row.prefix) || up.includes(row.prefix)) {
      return { ...row, filename: base, source: 'filename' }
    }
  }
  return null
}

/** Suggerimenti nome locale Personale da chiave confrontabile. */
export const LOCALE_DISPLAY_HINTS = [
  {
    match: /zanardelli/i,
    companyVat: '04945600759',
    display: 'Mediazione · Mani in Pasta Via Zanardelli 19',
  },
  {
    match: /abba|mediazione/i,
    companyVat: '04945600759',
    display: 'Mediazione · Mani in Pasta Via Abba',
  },
  {
    match: /lattea|mucche/i,
    companyVat: '04886500752',
    display: 'Via Lattea · Mucche Volanti',
  },
  {
    match: /risacca/i,
    companyVat: '05186540752',
    display: 'Risacca',
  },
]

export function formatStaffLocaleOptionLabel(localeName) {
  const name = String(localeName || '').trim()
  if (!name) return ''
  // Già etichetta lunga
  if (/mani in pasta|mucche volanti| · /i.test(name)) return name
  for (const hint of LOCALE_DISPLAY_HINTS) {
    if (hint.match.test(name)) return hint.display
  }
  return name
}

export function companyVatForLocaleName(localeName) {
  const name = String(localeName || '').trim()
  for (const hint of LOCALE_DISPLAY_HINTS) {
    if (hint.match.test(name)) return hint.companyVat
  }
  return ''
}
