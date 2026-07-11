/** Tema colore pulsante prodotto rapido (ordini / magazzino). */
const QUICK_PRODUCT_COLOR_BY_LABEL = {
  Ortaggi: 'green',
  Frutta: 'lime',
  Legumi: 'green',
  Carne: 'red',
  Salumi: 'rose',
  Pesce: 'ocean',
  Pasta: 'amber',
  Cereali: 'wheat',
  'Prodotti da forno': 'amber',
  'Prodotti da colazione': 'peach',
  Latticini: 'cream',
  Formaggi: 'gold',
  Miele: 'honey',
  Gastronomia: 'olive',
  'Prodotti tipici pugliesi': 'olive',
  Zucchero: 'slate',
  Sale: 'slate',
  'Contributi di trasporto': 'slate',
  Detersivi: 'teal',
  'Acqua naturale': 'sky',
  'Acqua frizzante': 'sky',
  Ghiaccio: 'ice',
  Bevande: 'blue',
  Lattine: 'blue',
  'Succhi di frutta': 'citrus',
  Vini: 'wine',
  Birre: 'bronze',
  Alcolici: 'wine',
  Gelati: 'pink',
  Patatine: 'orange',
  Caffè: 'brown',
  Ginseng: 'brown',
  'Tè e infusi': 'brown',
  'Orzo decaffeinato': 'brown',
  'Accessori per il bar': 'indigo',
}

/**
 * @param {string | null | undefined} label
 * @returns {string | null}
 */
export function getQuickProductColorTheme(label) {
  return QUICK_PRODUCT_COLOR_BY_LABEL[label] || null
}

/**
 * @param {string} label
 * @param {{ choice?: boolean, extra?: string }} [options]
 */
export function quickProductBtnClassName(label, options = {}) {
  const { choice = false, extra = '' } = options
  const theme = getQuickProductColorTheme(label)
  return [
    'order-product-btn',
    theme ? `order-product-btn--theme-${theme}` : '',
    choice ? 'order-product-btn--choice' : '',
    extra,
  ]
    .filter(Boolean)
    .join(' ')
}
