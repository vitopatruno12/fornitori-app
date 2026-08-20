import {
  getOperatorDeliveryPublicUrl,
  getOperatorOrderPublicUrl,
  getOperatorPrimaNotaPublicUrl,
  getOperatorStationPublicUrl,
} from './operatorMode.ts'

export const OPERATOR_LINKS_WORKBOOK_TITLE = 'Link operatori'

/**
 * Elenco centralizzato dei link pubblici per le postazioni operative.
 * @returns {Array<{ id: string, section: string, label: string, description: string, url: string }>}
 */
export function buildOperatorLinksCatalog() {
  const deliveryBase = getOperatorDeliveryPublicUrl('overview')
  return [
    {
      id: 'carrier-station',
      section: 'Postazione trasportatore',
      label: 'Panoramica trasportatore',
      description:
        'Link ATLAS per il trasportatore: Panoramica, Fornitori, Nuova consegna ▾ (Trasportatori, Magazzino) e Storico consegne.',
      url: deliveryBase,
    },
    {
      id: 'carrier-delivery',
      section: 'Postazione trasportatore',
      label: 'Nuova consegna',
      description: 'Apre la postazione trasportatore direttamente su Nuova consegna (menu a tendina Magazzino/Trasportatori).',
      url: getOperatorDeliveryPublicUrl('new-delivery'),
    },
    {
      id: 'carrier-history',
      section: 'Postazione trasportatore',
      label: 'Storico consegne',
      description: 'Apre lo storico consegne nella postazione trasportatore.',
      url: getOperatorDeliveryPublicUrl('history'),
    },
    {
      id: 'station-overview',
      section: 'Postazione operativa',
      label: 'Panoramica',
      description:
        'Link unificato PWA: Panoramica, Fornitori, Nuovo ordine, Nuova consegna (Magazzino, Trasportatori), Storico consegne e menu Personale (turni, report, stipendi, Prima Nota).',
      url: getOperatorStationPublicUrl('overview'),
    },
    {
      id: 'station-staff',
      section: 'Postazione operativa',
      label: 'Personale — dipendenti',
      description:
        'Apre la postazione operativa su dipendenti, turni e pianificazione (voce del menu Personale).',
      url: getOperatorStationPublicUrl('staff'),
    },
    {
      id: 'station-suppliers',
      section: 'Postazione operativa',
      label: 'Fornitori',
      description:
        'Apre l’anagrafica fornitori dalla postazione operativa (come nel gestionale).',
      url: getOperatorStationPublicUrl('suppliers'),
    },
    {
      id: 'station-orders',
      section: 'Postazione operativa',
      label: 'Nuovo ordine',
      description:
        'Apre la postazione operativa sulla compilazione ordini fornitore, con storico del fornitore selezionato.',
      url: getOperatorStationPublicUrl('orders'),
    },
    {
      id: 'station-delivery',
      section: 'Postazione operativa',
      label: 'Nuova consegna',
      description:
        'Apre la postazione operativa sulla registrazione DDT e merce in ingresso (menu Nuova consegna).',
      url: getOperatorStationPublicUrl('delivery'),
    },
    {
      id: 'station-delivery-history',
      section: 'Postazione operativa',
      label: 'Storico consegne',
      description: 'Apre lo storico consegne nella postazione operativa unificata.',
      url: getOperatorStationPublicUrl('delivery-history'),
    },
    {
      id: 'station-magazzino',
      section: 'Postazione operativa',
      label: 'Consegne — Magazzino',
      description: 'Apre il magazzino dalla postazione operativa (sotto menu Nuova consegna).',
      url: getOperatorStationPublicUrl('magazzino'),
    },
    {
      id: 'station-staff-report',
      section: 'Postazione operativa',
      label: 'Personale — Report',
      description: 'Apre il report personale (menu Personale, come nel gestionale).',
      url: getOperatorStationPublicUrl('staff-report'),
    },
    {
      id: 'station-stipendi',
      section: 'Postazione operativa',
      label: 'Personale — Stipendi',
      description: 'Apre gli stipendi (menu Personale, come nel gestionale).',
      url: getOperatorStationPublicUrl('stipendi'),
    },
    {
      id: 'station-prima-nota',
      section: 'Postazione operativa',
      label: 'Personale — Prima Nota',
      description:
        'Apre la postazione operativa sulla cassa: movimenti, riepilogo e report del locale attivo (menu Personale).',
      url: getOperatorStationPublicUrl('prima-nota'),
    },
    {
      id: 'station-trasportatori',
      section: 'Postazione operativa',
      label: 'Consegne — Trasportatori',
      description:
        'Apre anagrafica trasportatori dalla postazione operativa (sotto menu Nuova consegna).',
      url: getOperatorStationPublicUrl('trasportatori'),
    },
    {
      id: 'order-only',
      section: 'Ordini',
      label: 'Solo nuovo ordine',
      description:
        'Pagina dedicata solo agli ordini fornitore: stessa schermata Nuovo ordine, senza il resto del gestionale.',
      url: getOperatorOrderPublicUrl(),
    },
    {
      id: 'prima-nota-only',
      section: 'Prima Nota',
      label: 'Solo Prima Nota di cassa',
      description:
        'Pagina dedicata solo alla cassa del locale: movimenti, saldi e report, senza menu Home o altre sezioni.',
      url: getOperatorPrimaNotaPublicUrl(),
    },
  ]
}
