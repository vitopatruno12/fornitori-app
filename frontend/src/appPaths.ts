/** Percorsi URL app principale (React Router). */
export const APP_PATHS = {
  home: '/',
  analisi: '/analisi',
  'analisi-giornaliero': '/analisi/giornaliero',
  'analisi-settimanale': '/analisi/settimanale',
  'analisi-mensile': '/analisi/mensile',
  'analisi-oraria': '/analisi/oraria',
  'analisi-pianificazione': '/analisi/pianificazione',
  suppliers: '/suppliers',
  'new-order': '/new-order',
  'new-delivery': '/new-delivery',
  history: '/history',
  amministrazione: '/amministrazione',
  'amministrazione-mastrini': '/amministrazione/mastrini',
  'amministrazione-impostazioni': '/amministrazione/impostazioni',
  banca: '/banca',
  'banca-conti': '/banca/conti',
  'banca-movimenti': '/banca/movimenti',
  'banca-riconciliazione': '/banca/riconciliazione',
  fatture: '/fatture',
  'fatture-passive': '/fatture/ricevute',
  'fatture-ricevute': '/fatture/ricevute',
  'fatture-da-registrare': '/fatture/da-registrare',
  'fatture-registrate': '/fatture/registrate',
  'fatture-scadenziario': '/fatture/scadenziario',
  'fatture-sincronizzazione': '/fatture/sincronizzazione',
  'fatture-conservazione': '/fatture/conservazione',
  'fatture-importa-xml': '/fatture/importa-xml',
  'fatture-log': '/fatture/log',
  'fatture-impostazioni': '/fatture/impostazioni',
  /** Compat deep-link Home/AI → registrate */
  invoices: '/fatture/registrate',
  pagamenti: '/pagamenti',
  'prima-nota': '/prima-nota',
  staff: '/staff',
  'staff-report': '/staff/report',
  'staff-stipendi': '/staff/stipendi',
  'staff-operator-links': '/staff/link-operatori',
  'staff-locale-codes': '/staff/link-codici',
  'support-tech': '/support-tech',
  trasportatori: '/trasportatori',
  magazzino: '/magazzino',
  'gestione-locali': '/gestione-locali',
  'gestione-locali-gazza': '/gestione-locali/gazza-ladra',
} as const

export type PageKey = keyof typeof APP_PATHS

const PATH_TO_PAGE = Object.fromEntries(
  (Object.entries(APP_PATHS) as [PageKey, string][]).map(([page, path]) => [path, page]),
) as Record<string, PageKey>

// Prefer specific fatture keys over the invoices alias for the same path.
PATH_TO_PAGE['/fatture/registrate'] = 'fatture-registrate'

/** Normalizza pathname (senza slash finale, rispetta BASE_URL). */
export function normalizeAppPathname(pathname: string): string {
  let p = pathname || '/'
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
  if (base && base !== '/' && p.startsWith(base)) {
    p = p.slice(base.length) || '/'
  }
  if (!p.startsWith('/')) p = `/${p}`
  return p.replace(/\/+$/, '') || '/'
}

export function pathnameToPage(pathname: string): PageKey {
  const p = normalizeAppPathname(pathname)
  if (PATH_TO_PAGE[p]) return PATH_TO_PAGE[p]
  return 'home'
}

export function pageToPath(page: PageKey): string {
  return APP_PATHS[page] ?? APP_PATHS.home
}

export const VALID_PAGES: PageKey[] = Object.keys(APP_PATHS) as PageKey[]
