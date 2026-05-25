import { defineConfig, loadEnv } from 'vite'

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

  return {
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(apiBase),
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
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/ai': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  }
})
