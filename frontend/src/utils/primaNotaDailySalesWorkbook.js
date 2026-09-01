const SUMMARY_COLUMNS = [
  { id: 'label', label: 'Voce', width: 420 },
  { id: 'amount', label: 'Importo', numeric: true, width: 160 },
]

function formatAmount(value) {
  if (value == null || value === '') return ''
  return Number(value).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function amountCell(value) {
  const formatted = formatAmount(value)
  return formatted ? `€ ${formatted}` : ''
}

/**
 * @param {{ fiscale: number, nonFiscale: number, pos: number, refill: number, stackerSvuotamento: number, totale: number }} totals
 */
export function buildPrimaNotaDailySalesRows(totals) {
  return [
    { id: 'fiscale', label: 'Totale fiscale', amount: amountCell(totals.fiscale) },
    {
      id: 'non_fiscale',
      label: 'Totale NC (non contabilizzato)',
      amount: amountCell(totals.nonFiscale),
      rowClass: 'prima-nota-row-nf',
    },
    { id: 'pos', label: 'Totale POS', amount: amountCell(totals.pos) },
    { id: 'refill', label: 'Totale Refill', amount: amountCell(totals.refill) },
    { id: 'stacker_svuotamento', label: 'Totale svuotamento stacker', amount: amountCell(totals.stackerSvuotamento) },
    {
      id: 'totale',
      label: 'Totale vendita (Fiscale + NC + POS + Refill + Stacker)',
      amount: amountCell(totals.totale),
      rowClass: 'pagamenti-row-totals',
    },
  ]
}

export function buildPrimaNotaDailyCashRows({
  entrate,
  uscite,
  saldo,
  cassaIniziale,
  cassaFinale,
  scope = 'day',
}) {
  const period = scope === 'interval' ? 'periodo' : 'giorno'
  return [
    {
      id: 'entrate',
      label: `Totale entrate cassa (${period})`,
      amount: amountCell(entrate),
      rowClass: 'prima-nota-row-cash-in',
    },
    {
      id: 'uscite',
      label: `Totale uscite cassa (${period})`,
      amount: amountCell(uscite),
      rowClass: 'prima-nota-row-cash-out',
    },
    { id: 'saldo', label: scope === 'interval' ? 'Saldo netto cassa (periodo)' : 'Saldo giornaliero cassa', amount: amountCell(saldo) },
    { id: 'cassa_iniziale', label: scope === 'interval' ? 'Cassa iniziale periodo' : 'Saldo attuale cassa', amount: amountCell(cassaIniziale) },
    {
      id: 'cassa_finale',
      label: scope === 'interval' ? 'Cassa finale periodo (schema vendite)' : 'Cassa finale (schema vendite)',
      amount: amountCell(cassaFinale),
      rowClass: 'pagamenti-row-totals',
    },
  ]
}

export { SUMMARY_COLUMNS as PRIMA_NOTA_SUMMARY_COLUMNS }
