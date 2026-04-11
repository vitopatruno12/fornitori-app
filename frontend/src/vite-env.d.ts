/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL base API (es. https://api.tuodominio.it) — senza slash finale */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
