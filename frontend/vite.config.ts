import { defineConfig, loadEnv } from 'vite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { VitePWA } from 'vite-plugin-pwa'

function loadAtlasSectionVersions(): { build: string; scopes: Record<string, string> } {
  try {
    const raw = readFileSync(join(process.cwd(), 'public', 'section-versions.json'), 'utf8')
    const parsed = JSON.parse(raw) as { build?: string; scopes?: Record<string, string> }
    return {
      build: String(parsed?.build || ''),
      scopes: parsed?.scopes && typeof parsed.scopes === 'object' ? parsed.scopes : {},
    }
  } catch {
    return { build: '', scopes: {} }
  }
}

/** Dev: il browser usa solo /api e /ai (HTTPS in produzione); proxy interno verso i backend locali. */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  let apiBase = (env.VITE_API_BASE_URL || '/api').trim()
  if (mode === 'production') {
    if (!apiBase || apiBase === '/' || /^https?:\/\/(www\.)?atlass\.it\/?$/i.test(apiBase)) {
      apiBase = '/api'
    }
    if (/^http:\/\//i.test(apiBase) && !/localhost|127\.0\.0\.1/i.test(apiBase)) {
      apiBase = '/api'
    }
  }

  const atlasVersions = mode === 'production' ? loadAtlasSectionVersions() : { build: 'dev', scopes: {} }

  return {
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(apiBase),
    __ATLAS_BUILD_ID__: JSON.stringify(atlasVersions.build),
    __ATLAS_SCOPE_HASHES__: JSON.stringify(atlasVersions.scopes),
  },
  plugins: [
    {
      name: 'atlas-csp-dev',
      transformIndexHtml(html) {
        if (mode === 'production') return html
        return html.replace(
          /<meta\s+http-equiv="Content-Security-Policy"\s+content="upgrade-insecure-requests"\s*\/?>\s*/i,
          '',
        )
      },
    },
    VitePWA({
      registerType: 'prompt',
        includeAssets: [
        'pwa-icon.svg',
        'atlas-logo.svg',
        'atlas-login-bg.png',
        'atlas-api-fetch-fix.js',
        'favicon.svg',
      ],
      manifest: {
        name: 'ATLAS — Gestionale',
        short_name: 'ATLAS',
        description: 'Gestionale fornitori, ordini, Prima Nota e Personale. Funziona anche offline dopo l\'installazione.',
        theme_color: '#0f4c5c',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'any',
        scope: '/',
        start_url: '/',
        lang: 'it',
        icons: [
          {
            src: 'pwa-icon.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'pwa-icon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'pwa-icon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,woff,webmanifest}'],
        globIgnores: ['**/section-versions.json'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/ai/, /^\/uploads/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith('section-versions.json'),
            handler: 'NetworkOnly',
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api') || url.pathname.startsWith('/ai'),
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8004',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/ai': {
        target: 'http://127.0.0.1:8004',
        changeOrigin: true,
      },
    },
  },
  }
})
