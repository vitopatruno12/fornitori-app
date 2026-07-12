import { ORDER_QUICK_PRODUCTS } from '../constants/orderQuickProducts.js'
import { parseMerchandiseCategoriesFromSupplier } from './supplierContactLists.js'

function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

/** Fornitore Priges: solo prodotti categoria Detersivi. */
export function isPrigesSupplier(supplier) {
  return normalizeKey(supplier?.name).includes('priges')
}

/** Detersalento S.r.l. — detergenti e consumabili pulizia. */
export function isDetersalentoSupplier(supplier) {
  const key = normalizeKey(supplier?.name)
  return key.includes('detersalento')
}

/** METRO Italia S.p.A. — assortimento grossista. */
export function isMetroSupplier(supplier) {
  const key = normalizeKey(supplier?.name)
  return key.includes('metro')
}

/** Assaggi a SudEst S.r.l. — salumi, formaggi e gastronomia pugliese. */
export function isAssaggiSudEstSupplier(supplier) {
  const key = normalizeKey(supplier?.name)
  return key.includes('assaggi') && key.includes('sudest')
}

/** Valentino Caffè S.p.A. — caffè, ginseng e accessori bar. */
export function isValentinoCaffeSupplier(supplier) {
  const key = normalizeKey(supplier?.name)
  return key.includes('valentino') && key.includes('caffe')
}

/** EuroFood FS S.r.l. — prodotti da forno e contributi trasporto. */
export function isEuroFoodFsSupplier(supplier) {
  const key = normalizeKey(supplier?.name)
  return key.includes('eurofood') && key.includes('fs')
}

/** Calabrese S.r.l. — prodotti da colazione. */
export function isCalabreseSupplier(supplier) {
  const key = normalizeKey(supplier?.name)
  return key.includes('calabrese')
}

/** Lepore S.r.l.s. — bevande, acque, vini e alcolici. */
export function isLeporeSupplier(supplier) {
  const key = normalizeKey(supplier?.name)
  return key.includes('lepore')
}

/** Terza Luna — tè, infusi e accessori caffè. */
export function isTerzaLunaSupplier(supplier) {
  const key = normalizeKey(supplier?.name)
  return key.includes('terza') && key.includes('luna')
}

/** Categorie pulsanti rapidi consentite per METRO. */
export const METRO_ALLOWED_PRODUCT_LABELS = [
  'Ortaggi',
  'Frutta',
  'Carne',
  'Salumi',
  'Pesce',
  'Pasta',
  'Cereali',
  'Legumi',
  'Latticini',
  'Formaggi',
  'Miele',
  'Patatine',
  'Bevande',
  'Lattine',
  'Succhi di frutta',
  'Acqua naturale',
  'Acqua frizzante',
  'Vini',
  'Birre',
  'Alcolici',
  'Caffè',
  'Orzo decaffeinato',
  'Ghiaccio',
  'Gelati',
  'Zucchero',
  'Sale',
]

/** Categorie pulsanti rapidi consentite per Assaggi a SudEst. */
export const ASSAGGI_SUDEST_ALLOWED_PRODUCT_LABELS = [
  'Salumi',
  'Formaggi',
  'Gastronomia',
  'Prodotti tipici pugliesi',
]

/** Categorie pulsanti rapidi consentite per Valentino Caffè. */
export const VALENTINO_CAFFE_ALLOWED_PRODUCT_LABELS = [
  'Caffè',
  'Ginseng',
  'Accessori per il bar',
]

/** Categorie pulsanti rapidi consentite per EuroFood FS. */
export const EUROFOOD_FS_ALLOWED_PRODUCT_LABELS = [
  'Prodotti da forno',
  'Contributi di trasporto',
]

/** Categorie pulsanti rapidi consentite per Calabrese. */
export const CALABRESE_ALLOWED_PRODUCT_LABELS = ['Prodotti da colazione']

/** Categorie pulsanti rapidi consentite per Lepore. */
export const LEPORE_ALLOWED_PRODUCT_LABELS = [
  'Acqua naturale',
  'Acqua frizzante',
  'Bevande',
  'Lattine',
  'Vini',
  'Alcolici',
]

/** Categorie pulsanti rapidi consentite per Terza Luna. */
export const TERZA_LUNA_ALLOWED_PRODUCT_LABELS = [
  'Tè e infusi',
  'Accessori per il bar',
]

const MERCHANDISE_CATEGORY_LABELS = {
  detersivi: ['Detersivi'],
  detersalento: ['Detersivi'],
  ortofrutta: ['Ortaggi', 'Frutta'],
  bevande: ['Bevande', 'Lattine', 'Vini', 'Birre', 'Succhi di frutta', 'Alcolici', 'Acqua naturale', 'Acqua frizzante'],
  latticini: ['Latticini', 'Formaggi', 'Miele'],
  carne: ['Carne', 'Salumi'],
  pesce: ['Pesce'],
  pasta: ['Pasta'],
  cereali: ['Cereali', 'Legumi'],
  salumi: ['Salumi'],
  miele: ['Miele'],
  metro: METRO_ALLOWED_PRODUCT_LABELS,
  gastronomia: ['Gastronomia', 'Salumi', 'Formaggi', 'Prodotti tipici pugliesi'],
  assaggi: ASSAGGI_SUDEST_ALLOWED_PRODUCT_LABELS,
  caffe: ['Caffè', 'Ginseng', 'Accessori per il bar'],
  valentino: VALENTINO_CAFFE_ALLOWED_PRODUCT_LABELS,
  forno: ['Prodotti da forno', 'Contributi di trasporto'],
  eurofood: EUROFOOD_FS_ALLOWED_PRODUCT_LABELS,
  colazione: ['Prodotti da colazione'],
  calabrese: CALABRESE_ALLOWED_PRODUCT_LABELS,
  lepore: LEPORE_ALLOWED_PRODUCT_LABELS,
  'te e infusi': ['Tè e infusi', 'Accessori per il bar'],
  terzaluna: TERZA_LUNA_ALLOWED_PRODUCT_LABELS,
}

export function getSupplierMerchandiseCategoryLabels(supplier) {
  return parseMerchandiseCategoriesFromSupplier(supplier)
}

/**
 * Etichette pulsanti rapidi consentite per il fornitore, o `null` = tutte.
 * @param {{ name?: string, merchandise_category?: string } | null | undefined} supplier
 */
export function getSupplierAllowedProductLabels(supplier) {
  if (!supplier) return null
  if (isPrigesSupplier(supplier)) return ['Detersivi']
  if (isDetersalentoSupplier(supplier)) return ['Detersivi']
  if (isMetroSupplier(supplier)) return METRO_ALLOWED_PRODUCT_LABELS
  if (isAssaggiSudEstSupplier(supplier)) return ASSAGGI_SUDEST_ALLOWED_PRODUCT_LABELS
  if (isValentinoCaffeSupplier(supplier)) return VALENTINO_CAFFE_ALLOWED_PRODUCT_LABELS
  if (isEuroFoodFsSupplier(supplier)) return EUROFOOD_FS_ALLOWED_PRODUCT_LABELS
  if (isCalabreseSupplier(supplier)) return CALABRESE_ALLOWED_PRODUCT_LABELS
  if (isLeporeSupplier(supplier)) return LEPORE_ALLOWED_PRODUCT_LABELS
  if (isTerzaLunaSupplier(supplier)) return TERZA_LUNA_ALLOWED_PRODUCT_LABELS

  const categoryLabels = getSupplierMerchandiseCategoryLabels(supplier)
  if (categoryLabels.length > 0) {
    const merged = new Set()
    for (const label of categoryLabels) {
      const key = normalizeKey(label)
      if (MERCHANDISE_CATEGORY_LABELS[key]) {
        MERCHANDISE_CATEGORY_LABELS[key].forEach((entry) => merged.add(entry))
        continue
      }
      const direct = ORDER_QUICK_PRODUCTS.find((item) => normalizeKey(item.label) === key)
      if (direct) merged.add(direct.label)
      else merged.add(label)
    }
    return merged.size ? [...merged] : null
  }

  const cat = normalizeKey(supplier.merchandise_category)
  if (!cat) return null
  if (MERCHANDISE_CATEGORY_LABELS[cat]) return MERCHANDISE_CATEGORY_LABELS[cat]

  const direct = ORDER_QUICK_PRODUCTS.find((item) => normalizeKey(item.label) === cat)
  if (direct) return [direct.label]

  return null
}

/** Categoria pulsante rapido (es. «Detersivo piatti» → «Detersivi»). */
export function resolveQuickProductCategory(productName) {
  const key = normalizeKey(productName)
  if (!key) return null
  for (const item of ORDER_QUICK_PRODUCTS) {
    if (normalizeKey(item.label) === key) return item.label
    if (item.variants?.some((variant) => normalizeKey(variant) === key)) return item.label
  }
  return null
}

export function isProductCategoryAllowedForSupplier(supplier, categoryLabel) {
  const allowed = getSupplierAllowedProductLabels(supplier)
  if (!allowed) return true
  const catKey = normalizeKey(categoryLabel)
  return allowed.some((label) => normalizeKey(label) === catKey)
}

export function isProductAllowedForSupplier(supplier, productName) {
  const allowed = getSupplierAllowedProductLabels(supplier)
  if (!allowed) return true

  const category = resolveQuickProductCategory(productName)
  if (category) return isProductCategoryAllowedForSupplier(supplier, category)

  if (isPrigesSupplier(supplier)) {
    return normalizeKey(productName).includes('detersiv')
  }
  if (isDetersalentoSupplier(supplier)) {
    const key = normalizeKey(productName)
    const detersalentoHints = [
      'detersiv',
      'detergente',
      'sgrassator',
      'disincrostant',
      'bobine',
      'carta',
      'igienica',
      'tork',
      'asciugamani',
      'sacchi',
      'biodegradab',
      'immondizia',
      'lavastoviglie',
      'pastiglie',
      'brillantante',
      'sirio',
      'wc',
      'bagno',
      'pavimenti',
      'multiuso',
      'disinfett',
      'igienizz',
      'sapone',
      'candeggin',
      'ammoniac',
      'alcool',
    ]
    return detersalentoHints.some((hint) => key.includes(hint))
  }
  if (isMetroSupplier(supplier)) {
    const key = normalizeKey(productName)
    const metroHints = [
      'macinato',
      'acciug',
      'tortilla',
      'philadelphia',
      'burro',
      'yogurt',
      'vodka',
      'miele',
      'mozzarella',
      'salum',
      'prosciutto',
      'mortadella',
      'salame',
      'kiwi',
      'noci',
      'fave',
      'pomodor',
      'ciliegino',
    ]
    return metroHints.some((hint) => key.includes(hint))
  }
  if (isAssaggiSudEstSupplier(supplier)) {
    const key = normalizeKey(productName)
    const assaggiHints = [
      'frisell',
      'tarall',
      'carpaccio',
      'finocch',
      'gastronom',
      'puglies',
      'salum',
      'prosciutto',
      'mortadella',
      'salame',
      'formagg',
      'burrata',
      'stracciatella',
      'caciocavallo',
      'orecchiette',
      'cavatelli',
      'lampascioni',
      'olive',
      'sott\'olio',
      'sottolio',
      'antipast',
      'rustico',
      'panzerott',
      'focaccia',
    ]
    return assaggiHints.some((hint) => key.includes(hint))
  }
  if (isValentinoCaffeSupplier(supplier)) {
    const key = normalizeKey(productName)
    const valentinoHints = [
      'caffe',
      'supremo',
      'decaffein',
      'ginseng',
      'orzo',
      'bicchier',
      'carta',
      'accessori',
      'bar',
      'coperch',
      'palette',
      'cannucc',
      'zuccher',
      'tovagliol',
      'decalcif',
      'filtro',
      'macchina',
      'cioccolato',
      'panna',
    ]
    return valentinoHints.some((hint) => key.includes(hint))
  }
  if (isEuroFoodFsSupplier(supplier)) {
    const key = normalizeKey(productName)
    const eurofoodHints = [
      'scrocchiarella',
      'cornetto',
      'vegano',
      'alemagna',
      'farina',
      'bustine',
      'fruttil',
      'forno',
      'brioche',
      'focaccia',
      'pane',
      'grissini',
      'biscott',
      'merendin',
      'croissant',
      'lievito',
      'trasport',
      'consegna',
      'spese',
      'contribut',
    ]
    return eurofoodHints.some((hint) => key.includes(hint))
  }
  if (isCalabreseSupplier(supplier)) {
    const key = normalizeKey(productName)
    const calabreseHints = [
      'cornett',
      'treccia',
      'brioche',
      'colazione',
      'ciambella',
      'muffin',
      'croissant',
      'saccottin',
      'danese',
      'merendin',
      'bombolon',
      'krapfen',
      'graffa',
      'sfogliatell',
      'cannoncin',
      'focaccia dolce',
    ]
    return calabreseHints.some((hint) => key.includes(hint))
  }
  if (isLeporeSupplier(supplier)) {
    const key = normalizeKey(productName)
    const leporeHints = [
      'prosecco',
      'undici',
      'acqua',
      'santo stefano',
      'cocktail',
      'pellegrino',
      'coca',
      'cola',
      'fernet',
      'vino',
      'spumante',
      'bibita',
      'lattina',
      'amaro',
      'aperol',
      'campari',
    ]
    return leporeHints.some((hint) => key.includes(hint))
  }
  if (isTerzaLunaSupplier(supplier)) {
    const key = normalizeKey(productName)
    const terzaLunaHints = [
      'frutti rossi',
      'salute',
      'te',
      'tisana',
      'infuso',
      'camomilla',
      'menta',
      'rooibos',
      'orzo',
      'french press',
      'caffettiera',
      'accessori',
      'filtro',
      'moka',
    ]
    return terzaLunaHints.some((hint) => key.includes(hint))
  }
  return false
}

export const SUPPLIER_PRODUCT_BLOCKED_MESSAGE = 'Prodotto non associato a questo fornitore.'
