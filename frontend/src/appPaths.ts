/** Percorsi URL app principale (React Router). */
export const APP_PATHS = {
  home: '/',
  suppliers: '/suppliers',
  'new-order': '/new-order',
  'new-delivery': '/new-delivery',
  history: '/history',
  invoices: '/invoices',
  'prima-nota': '/prima-nota',
  staff: '/staff',
  'support-tech': '/support-tech',
  vne: '/vne',
} as const

export type PageKey = keyof typeof APP_PATHS

const PATH_TO_PAGE = Object.fromEntries(
  (Object.entries(APP_PATHS) as [PageKey, string][]).map(([page, path]) => [path, page]),
) as Record<string, PageKey>

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
