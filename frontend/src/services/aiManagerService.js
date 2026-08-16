import { apiFetch } from './api'

const EMPTY_INSIGHTS = {
  insights: [],
  summary: { total: 0, by_severity: {}, by_category: {} },
  generated_at: null,
}

/** Insight AI Manager: in caso di 502/offline non blocca l'UI. */
export async function fetchManagerInsights() {
  try {
    return await apiFetch('/ai/manager/insights')
  } catch (err) {
    const msg = String(err?.message || err || '')
    // Proxy nginx/vite → 502 quando l'API è in restart o non raggiungibile.
    if (
      /\b502\b/.test(msg) ||
      /\b503\b/.test(msg) ||
      /\b504\b/.test(msg) ||
      /offline/i.test(msg) ||
      /Failed to fetch/i.test(msg) ||
      /NetworkError/i.test(msg)
    ) {
      return { ...EMPTY_INSIGHTS, __unavailable: true, error: msg }
    }
    throw err
  }
}
