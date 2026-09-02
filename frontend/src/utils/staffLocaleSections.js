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

/** Vecchia sezione “Bar” (reparto) → Forno. Non tocca i nomi locale tipo Bar-momento. */
export function canonicalSectionName(value) {
  const name = normalizeSectionName(value)
  if (sectionCompareKey(name) === 'bar') return 'Forno'
  return name
}

/** Default sezioni in base al nome locale (Abba / Zanardelli / altro). */
export function defaultSectionsForLocale(localeName) {
  const key = String(localeName || '')
    .trim()
    .toLocaleLowerCase('it')
    .replace(/[\s_\-]+/g, '')
  if (!key) return ['Generale']
  if (key.includes('zanardelli')) {
    return ['Mediazione', 'Banco', 'Cucina', 'Forno', 'Pulizie']
  }
  if (key.includes('abba')) {
    return ['Mediazione', 'Banco', 'Cucina', 'Forno', 'Pulizie']
  }
  return ['Banco', 'Cucina', 'Forno', 'Pulizie']
}

/** Piani sempre disponibili nella pianificazione turni. */
export const CORE_PLANNING_SECTIONS = ['Banco', 'Cucina', 'Forno', 'Pulizie']

/**
 * Unisce sezioni salvate, sezioni presenti sui dipendenti e default del locale.
 * Banco / Cucina / Forno restano sempre presenti (anche se non ancora usati in anagrafica).
 * @param {{ localeName?: string, savedSections?: string[], members?: Array<{ section?: string|null }> }} opts
 */
export function resolveLocaleSections({ localeName = '', savedSections = [], members = [] } = {}) {
  const out = []
  const seen = new Set()
  const push = (raw) => {
    const name = canonicalSectionName(raw)
    if (!name) return
    const key = sectionCompareKey(name)
    if (seen.has(key)) return
    seen.add(key)
    out.push(name)
  }
  for (const s of Array.isArray(savedSections) ? savedSections : []) push(s)
  for (const m of Array.isArray(members) ? members : []) push(m?.section)
  for (const s of defaultSectionsForLocale(localeName)) push(s)
  for (const s of CORE_PLANNING_SECTIONS) push(s)
  if (!out.length) push('Generale')
  return out
}

export function memberMatchesSection(member, sectionName, sectionsList = []) {
  const target = sectionCompareKey(canonicalSectionName(sectionName))
  if (!target) return true
  const current = sectionCompareKey(canonicalSectionName(member?.section))
  if (current) return current === target
  const first = sectionCompareKey(canonicalSectionName(Array.isArray(sectionsList) ? sectionsList[0] : ''))
  return first ? first === target : true
}

/** Unisce elenchi di sezioni nascoste in pianificazione (senza duplicati). */
export function mergeHiddenPlanningSections(...lists) {
  const out = []
  const seen = new Set()
  for (const list of lists) {
    for (const raw of Array.isArray(list) ? list : []) {
      const name = normalizeSectionName(raw)
      if (!name) continue
      const key = sectionCompareKey(name)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(name)
    }
  }
  return out
}

/** True se la sezione non va mostrata nella griglia pianificazione turni. */
export function isPlanningSectionHidden(section, hiddenSections = [], staticHidden = []) {
  const key = sectionCompareKey(section)
  if (!key) return false
  const hidden = mergeHiddenPlanningSections(staticHidden, hiddenSections)
  return hidden.some((name) => sectionCompareKey(name) === key)
}
