/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Base API: /api (produzione e dev con proxy Vite) */
  readonly VITE_API_BASE_URL?: string
  /** Servizio AI Nest in dev; in produzione omesso → stesso base API (/api) */
  readonly VITE_AI_API_URL?: string
  /** Origine HTTPS per link satelliti (es. https://www.atlass.it) */
  readonly VITE_PUBLIC_APP_URL?: string
  /** Username login ATLAS */
  readonly VITE_ATLAS_LOGIN_USER?: string
  /** Password login ATLAS */
  readonly VITE_ATLAS_LOGIN_PASSWORD?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Iniettato a build da section-versions.json (vite.config.ts). */
declare const __ATLAS_BUILD_ID__: string
declare const __ATLAS_SCOPE_HASHES__: Record<string, string>
