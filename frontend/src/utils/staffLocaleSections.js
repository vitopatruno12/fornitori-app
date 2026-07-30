/**
 * Sezioni operative per locale (Banco, Cucina, Forno, Mediazione…).
 */

export function normalizeSectionName(value) {
  const name = String(value || '').trim()
  return name ? name.slice(0, 120) : ''
}

export function sectionCompareKey(value) {
  return normalizeSectionName(value).toLocaleLowerCase('it')
}

/** Default sezioni in base al nome locale (Abba / Zanardelli / altro). */
export function defaultSectionsForLocale(localeName) {
  const key = String(localeName || '')
    .trim()
    .toLocaleLowerCase('it')
    .replace(/[\s_\-]+/g, '')
  if (!key) return ['Generale']
  if (key.includes('zanardelli')) {
    return ['Mediazione', 'Banco', 'Cucina']
  }
  if (key.includes('abba')) {
    return ['Mediazione', 'Banco', 'Cucina', 'Forno']
  }
  return ['Generale']
}

/**
 * Unisce sezioni salvate, sezioni presenti sui dipendenti e default del locale.
 * @param {{ localeName?: string, savedSections?: string[], members?: Array<{ section?: string|null }> }} opts
 */
export function resolveLocaleSections({ localeName = '', savedSections = [], members = [] } = {}) {
  const out = []
  const seen = new Set()
  const push = (raw) => {
    const name = normalizeSectionName(raw)
    if (!name) return
    const key = sectionCompareKey(name)
    if (seen.has(key)) return
    seen.add(key)
    out.push(name)
  }
  for (const s of Array.isArray(savedSections) ? savedSections : []) push(s)
  for (const m of Array.isArray(members) ? members : []) push(m?.section)
  if (!out.length) {
    for (const s of defaultSectionsForLocale(localeName)) push(s)
  }
  return out
}

export function memberMatchesSection(member, sectionName, sectionsList = []) {
  const target = sectionCompareKey(sectionName)
  if (!target) return true
  const current = sectionCompareKey(member?.section)
  if (current) return current === target
  const first = sectionCompareKey(Array.isArray(sectionsList) ? sectionsList[0] : '')
  return first ? first === target : true
}
