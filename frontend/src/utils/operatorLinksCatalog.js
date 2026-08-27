import { getOperatorDeliveryPublicUrl, getOperatorStationPublicUrl } from './operatorMode.ts'

export const OPERATOR_LINKS_WORKBOOK_TITLE = 'Link operatori'

const STATION_PWA_URL = getOperatorStationPublicUrl('overview')
const CARRIER_PWA_URL = getOperatorDeliveryPublicUrl('overview')

const STATION_DESCRIPTION =
  'Postazione operativa PWA: Panoramica, Fornitori, Nuovo ordine, Nuova consegna (Magazzino, Trasportatori), Storico consegne e menu Personale (turni, report, stipendi, Prima Nota).'

const CARRIER_DESCRIPTION =
  'Postazione trasportatore PWA: Panoramica, Fornitori, Nuova consegna ▾ (Trasportatori, Magazzino), Storico e Amministrazione ▾ (Fatturazione, Prima Nota).'

/**
 * Link PWA unificati per sede (operatori) e guidatore (trasportatore).
 * @returns {Array<{ id: string, role: string, sede: string, description: string, url: string }>}
 */
export function buildOperatorLinksCatalog() {
  return [
    {
      id: 'station-abba42',
      role: 'Postazione operativa',
      sede: 'Mediaz./via abba 42',
      description: STATION_DESCRIPTION,
      url: STATION_PWA_URL,
    },
    {
      id: 'station-zanardelli19',
      role: 'Postazione operativa',
      sede: 'Mediaz/via Zanardelli 19',
      description: STATION_DESCRIPTION,
      url: STATION_PWA_URL,
    },
    {
      id: 'station-lattea44',
      role: 'Postazione operativa',
      sede: 'Via Lattea/abba 44',
      description: STATION_DESCRIPTION,
      url: STATION_PWA_URL,
    },
    {
      id: 'carrier-guidatore',
      role: 'Postazione trasportatore',
      sede: 'guidatore',
      description: CARRIER_DESCRIPTION,
      url: CARRIER_PWA_URL,
    },
  ]
}
