import {
  ensureHttpsUrl,
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
  const deliveryBase = getOperatorDeliveryPublicUrl()
  return [
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
      id: 'delivery-new',
      section: 'Consegne',
      label: 'Nuova consegna',
      description:
        'Satellite consegne: registrazione DDT e merce in ingresso. Include schede per storico e magazzino nello stesso link base.',
      url: deliveryBase,
    },
    {
      id: 'delivery-history',
      section: 'Consegne',
      label: 'Storico consegne',
      description:
        'Apre il satellite consegne sulla scheda storico: ricerca, analisi prezzi e note consegne.',
      url: ensureHttpsUrl(`${deliveryBase}?pagina=storico`),
    },
    {
      id: 'delivery-magazzino',
      section: 'Consegne',
      label: 'Magazzino',
      description:
        'Apre il satellite consegne sul magazzino: entrata/uscita merce con operatore, firma e tracciamento sede.',
      url: ensureHttpsUrl(`${deliveryBase}?pagina=magazzino`),
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
