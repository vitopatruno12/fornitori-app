import { getOperatorDeliveryPublicUrl, getOperatorStationPublicUrl } from './operatorMode.ts'

export const OPERATOR_LINKS_WORKBOOK_TITLE = 'Link operatori'

/**
 * Link PWA unificati da condividere con operatori e trasportatore.
 * @returns {Array<{ id: string, section: string, label: string, description: string, url: string }>}
 */
export function buildOperatorLinksCatalog() {
  return [
    {
      id: 'station-overview',
      section: 'Postazione operativa',
      label: 'Link unificato PWA',
      description:
        'Postazione operativa per capi area e operatori: Panoramica, Fornitori, Nuovo ordine, Nuova consegna (Magazzino, Trasportatori), Storico consegne e menu Personale (turni, report, stipendi, Prima Nota).',
      url: getOperatorStationPublicUrl('overview'),
    },
    {
      id: 'carrier-station',
      section: 'Postazione trasportatore',
      label: 'Link unificato PWA',
      description:
        'Postazione trasportatore: Panoramica, Fornitori, Nuova consegna ▾ (Trasportatori, Magazzino), Storico e Amministrazione ▾ (Fatturazione, Prima Nota).',
      url: getOperatorDeliveryPublicUrl('overview'),
    },
  ]
}
