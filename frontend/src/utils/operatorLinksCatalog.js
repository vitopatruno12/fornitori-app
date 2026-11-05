import {
  getGazzaSalaPalmarePublicUrl,
  getOperatorDeliveryPublicUrl,
  getOperatorStationPublicUrl,
} from './operatorMode.ts'

export const OPERATOR_LINKS_WORKBOOK_TITLE = 'Link operatori'

const STATION_DESCRIPTION =
  'Postazione operativa PWA: Panoramica, Fornitori, Nuovo ordine, Nuova consegna (Magazzino, Trasportatori), Storico consegne, Personale (turni, report, stipendi), Amministrazione ▾ (Fatture fornitori, Prima Nota) e Assistenza tecnici.'

const GAZZA_DESCRIPTION =
  'Postazione operativa PWA di PG S.r.l. · La Gazza Ladra: solo i dati di questa società. Panoramica, Gestione sala, Fornitori, Nuovo ordine, Nuova consegna (Magazzino, senza trasportatori), Storico consegne, Personale, Amministrazione (Fatture fornitori, Prima Nota) e Assistenza tecnici.'

const GAZZA_PALMARE_DESCRIPTION =
  'Sala camerieri sul telefono: stessi 15 tavoli di Gestione sala. Accesso con la postazione Gazza. Quello che si inserisce sul palmare arriva in Gestione sala.'

const CARRIER_DESCRIPTION =
  'Postazione trasportatore PWA: Panoramica, Fornitori, Nuova consegna ▾ (Trasportatori, Magazzino), Storico e Amministrazione ▾ (Fatture fornitori, Prima Nota, Banca).'

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
      url: getOperatorStationPublicUrl('overview', 'abba'),
    },
    {
      id: 'station-zanardelli19',
      role: 'Postazione operativa',
      sede: 'Mediaz/via Zanardelli 19',
      description: STATION_DESCRIPTION,
      url: getOperatorStationPublicUrl('overview', 'zanardelli'),
    },
    {
      id: 'station-lattea44',
      role: 'Postazione operativa',
      sede: 'Via Lattea/abba 44',
      description: STATION_DESCRIPTION,
      url: getOperatorStationPublicUrl('overview', 'lattea'),
    },
    {
      id: 'station-gazza-pg',
      role: 'Postazione operativa',
      sede: 'PG S.r.l. · La Gazza Ladra',
      description: GAZZA_DESCRIPTION,
      url: getOperatorStationPublicUrl('overview', 'gazza'),
    },
    {
      id: 'gazza-sala-palmare',
      role: 'Palmare sala',
      sede: 'PG S.r.l. · La Gazza Ladra',
      description: GAZZA_PALMARE_DESCRIPTION,
      url: getGazzaSalaPalmarePublicUrl(),
    },
    {
      id: 'carrier-guidatore',
      role: 'Postazione trasportatore',
      sede: 'guidatore',
      description: CARRIER_DESCRIPTION,
      url: getOperatorDeliveryPublicUrl('overview'),
    },
  ]
}
