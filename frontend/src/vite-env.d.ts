/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base API: /api in produzione, http://localhost:8000 in dev (.env.development) */
  readonly VITE_API_BASE_URL?: string
  /** Servizio AI Nest in dev; in produzione omesso → stesso base API (/api) */
  readonly VITE_AI_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
