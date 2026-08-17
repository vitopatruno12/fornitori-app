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
        'Link unificato PWA: dashboard semplificata con accesso a Personale, Nuovo ordine e Prima Nota. Senza menu fornitori, fatture, consegne complete.',
      url: getOperatorStationPublicUrl('overview'),
    },
    {
      id: 'station-staff',
      section: 'Postazione operativa',
      label: 'Personale',
      description:
        'Apre la postazione operativa direttamente sulla sezione dipendenti, turni e pianificazione.',
      url: getOperatorStationPublicUrl('staff'),
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
      id: 'station-prima-nota',
      section: 'Postazione operativa',
      label: 'Prima Nota',
      description:
        'Apre la postazione operativa sulla cassa: movimenti, riepilogo e report del locale attivo.',
      url: getOperatorStationPublicUrl('prima-nota'),
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
