import { defineConfig } from 'vite'

/** Dev: il browser usa solo /api e /ai (HTTPS in produzione); proxy interno verso i backend locali. */
export default defineConfig({
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
})
