/**
 * Rete di sicurezza: corregge fetch verso http://atlass.it o /suppliers senza /api.
 * Il fix definitivo è Nginx (proxy /api → FastAPI). Questo script aiuta con build/cache vecchie.
 */
;(function () {
  if (typeof window === 'undefined' || !window.fetch) return
  var hosts = { 'www.atlass.it': 1, 'atlass.it': 1 }
  var apiPaths =
    /^\/(suppliers|invoices|deliveries|cash|dashboard|ai|staff|price-list|supplier-orders|aruba|support-technicians|vne|health)(\/|$)/

  function fixUrl(url) {
    try {
      var u = new URL(url, window.location.href)
      if (!hosts[u.hostname]) return url
      if (u.protocol === 'http:') u.protocol = 'https:'
      var p = u.pathname || '/'
      if (!p.startsWith('/api') && apiPaths.test(p)) {
        u.pathname = '/api' + p
      }
      return u.toString()
    } catch (e) {
      return url
    }
  }

  var nativeFetch = window.fetch.bind(window)
  window.fetch = function (input, init) {
    if (typeof input === 'string') {
      return nativeFetch(fixUrl(input), init)
    }
    if (input && typeof input === 'object' && input.url) {
      return nativeFetch(new Request(fixUrl(input.url), input), init)
    }
    return nativeFetch(input, init)
  }
})()
