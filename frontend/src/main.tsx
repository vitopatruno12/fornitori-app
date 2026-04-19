import React from 'react'
import ReactDOM from 'react-dom/client'
import './style.css'
import HomePage from './pages/HomePage.jsx'
import SuppliersPage from './pages/SuppliersPage.jsx'
import NewDeliveryPage from './pages/NewDeliveryPage.jsx'
import NewOrderPage from './pages/NewOrderPage.jsx'
import DeliveriesHistoryPage from './pages/DeliveriesHistoryPage.jsx'
import InvoicesPage from './pages/InvoicesPage.jsx'
import PrimaNotaPage from './pages/PrimaNotaPage.jsx'
import StaffPage from './pages/StaffPage.jsx'
import SupportTechniciansPage from './pages/SupportTechniciansPage.jsx'
import { askAi, suggestInvoiceFields, suggestOrderLines, suggestPrimaNota, suggestSupplierFields } from './services/aiService'

type PageKey =
  | 'home'
  | 'suppliers'
  | 'new-order'
  | 'new-delivery'
  | 'history'
  | 'invoices'
  | 'prima-nota'
  | 'staff'
  | 'support-tech'
type AiHistoryItem = {
  id: string
  page: PageKey
  prompt: string
  title: string
  lines: string[]
  actions: string[]
  at: number
}

function App() {
  const [page, setPage] = React.useState<PageKey>('home')
  const [navOpen, setNavOpen] = React.useState(false)
  const [aiOpen, setAiOpen] = React.useState(false)
  const [aiInput, setAiInput] = React.useState('')
  const [aiLoading, setAiLoading] = React.useState(false)
  const [aiTitle, setAiTitle] = React.useState('')
  const [aiLines, setAiLines] = React.useState<string[]>([])
  const [aiActions, setAiActions] = React.useState<string[]>([])
  const [aiApplyPayload, setAiApplyPayload] = React.useState<any>(null)
  const [aiToast, setAiToast] = React.useState('')
  const [aiToastClosing, setAiToastClosing] = React.useState(false)
  const [aiHistory, setAiHistory] = React.useState<AiHistoryItem[]>([])

  const navigateTo = React.useCallback((p: PageKey) => {
    setPage(p)
    setNavOpen(false)
  }, [])

  React.useEffect(() => {
    try {
      const raw = sessionStorage.getItem('aiDrawerHistory')
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return
      const clean = parsed
        .filter((x) => x && typeof x === 'object')
        .map((x) => ({
          id: String(x.id || `${Date.now()}-${Math.random()}`),
          page: (x.page || 'home') as PageKey,
          prompt: String(x.prompt || ''),
          title: String(x.title || ''),
          lines: Array.isArray(x.lines) ? x.lines.map((v: unknown) => String(v)) : [],
          actions: Array.isArray(x.actions) ? x.actions.map((v: unknown) => String(v)) : [],
          at: Number(x.at || Date.now()),
        }))
        .slice(0, 12)
      setAiHistory(clean)
    } catch {
      // ignore corrupted storage
    }
  }, [])

  React.useEffect(() => {
    try {
      sessionStorage.setItem('aiDrawerHistory', JSON.stringify(aiHistory.slice(0, 12)))
    } catch {
      // storage quota or unavailable
    }
  }, [aiHistory])

  React.useEffect(() => {
    const goPrimaNota = () => navigateTo('prima-nota')
    window.addEventListener('open-prima-nota', goPrimaNota)
    return () => window.removeEventListener('open-prima-nota', goPrimaNota)
  }, [navigateTo])

  React.useEffect(() => {
    if (!navOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navOpen])

  React.useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const onChange = () => {
      if (mq.matches) setNavOpen(false)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  React.useEffect(() => {
    if (navOpen) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [navOpen])

  const pageLabel: Record<PageKey, string> = {
    home: 'dashboard',
    suppliers: 'fornitori',
    'new-order': 'ordini',
    'new-delivery': 'consegne',
    history: 'consegne',
    invoices: 'fatture',
    'prima-nota': 'prima-nota',
    staff: 'personale',
    'support-tech': 'assistenza-tecnici',
  }

  async function runAi(promptOverride?: string) {
    const prompt = (promptOverride ?? aiInput).trim()
    if (!prompt) return
    try {
      setAiLoading(true)
      if (promptOverride != null) setAiInput(prompt)
      setAiLines([])
      setAiActions([])
      setAiApplyPayload(null)
      if (page === 'suppliers') {
        const r = await suggestSupplierFields(prompt, {})
        const title = 'Suggerimento fornitore'
        setAiTitle(title)
        const s = r?.suggested_fields || {}
        const lines = [
          s.name ? `Ragione sociale: ${s.name}` : '',
          s.vat_number ? `P.IVA: ${s.vat_number}` : '',
          s.email ? `Email: ${s.email}` : '',
          s.phone ? `Telefono: ${s.phone}` : '',
          s.city ? `Città: ${s.city}` : '',
          s.payment_terms ? `Pagamento: ${s.payment_terms}` : '',
          s.merchandise_category ? `Categoria: ${s.merchandise_category}` : '',
          ...(r?.missing_fields?.length ? [`Mancano: ${r.missing_fields.join(', ')}`] : []),
        ].filter(Boolean)
        setAiLines(lines as string[])
        setAiApplyPayload({ kind: 'suppliers', data: s })
        setAiHistory((prev) => [{ id: `${Date.now()}-${Math.random()}`, page, prompt, title, lines: lines as string[], actions: [], at: Date.now() }, ...prev].slice(0, 12))
        return
      }
      if (page === 'invoices') {
        const r = await suggestInvoiceFields(prompt, {})
        const title = 'Suggerimento fattura'
        setAiTitle(title)
        const s = r?.suggested_fields || {}
        const lines = [
          s.imponibile_hint != null ? `Imponibile suggerito: € ${s.imponibile_hint}` : '',
          s.invoice_date_hint ? `Data documento: ${s.invoice_date_hint}` : '',
          s.due_date_hint ? `Scadenza: ${s.due_date_hint}` : '',
          s.category_hint ? `Categoria suggerita: ${s.category_hint}` : '',
          s.payment_method_hint ? `Pagamento probabile: ${s.payment_method_hint}` : '',
          ...(r?.warnings?.length ? [`Avvisi: ${r.warnings.join(' · ')}`] : []),
        ].filter(Boolean)
        setAiLines(lines as string[])
        setAiApplyPayload({ kind: 'invoices', data: s })
        setAiHistory((prev) => [{ id: `${Date.now()}-${Math.random()}`, page, prompt, title, lines: lines as string[], actions: [], at: Date.now() }, ...prev].slice(0, 12))
        return
      }
      if (page === 'new-order') {
        const r = await suggestOrderLines(prompt)
        const title = 'Suggerimento righe ordine'
        const lines = (r?.suggested_lines || []).map((l) => {
          const d = (l.product_description || '').trim()
          const pz = l.pieces != null ? ` — ${l.pieces} pz` : ''
          const kg =
            l.weight_kg != null && l.weight_kg !== ''
              ? ` — ${l.weight_kg} kg`
              : ''
          return `${d || '(senza nome)'}${pz}${kg}`
        })
        setAiTitle(title)
        setAiLines(lines.length ? lines : ['Nessuna riga ricavata'])
        setAiApplyPayload({ kind: 'new-order', data: { suggested_lines: r?.suggested_lines || [] } })
        setAiHistory((prev) =>
          [
            {
              id: `${Date.now()}-${Math.random()}`,
              page,
              prompt,
              title,
              lines: lines.length ? lines : ['Nessuna riga ricavata'],
              actions: [],
              at: Date.now(),
            },
            ...prev,
          ].slice(0, 12),
        )
        return
      }
      if (page === 'prima-nota') {
        const r = await suggestPrimaNota(prompt, {})
        const title = 'Suggerimento Prima Nota'
        setAiTitle(title)
        const s = r?.suggested_fields || {}
        const lines = [
          s.description ? `Descrizione: ${s.description}` : '',
          s.type ? `Tipo: ${s.type}` : '',
          s.amount != null ? `Importo: € ${s.amount}` : '',
          s.account_hint ? `Conto: ${s.account_hint}` : '',
          s.payment_method_hint ? `Pagamento: ${s.payment_method_hint}` : '',
          s.category_hint ? `Categoria: ${s.category_hint}` : '',
        ].filter(Boolean)
        setAiLines(lines as string[])
        setAiApplyPayload({ kind: 'prima-nota', data: s })
        setAiHistory((prev) => [{ id: `${Date.now()}-${Math.random()}`, page, prompt, title, lines: lines as string[], actions: [], at: Date.now() }, ...prev].slice(0, 12))
        return
      }
      const r = await askAi(prompt, pageLabel[page], { page })
      const title = 'Assistente operativo'
      const lines = [r?.answer || 'Nessuna risposta']
      const actions = r?.suggested_actions || []
      setAiTitle(title)
      setAiLines(lines)
      setAiActions(actions)
      setAiHistory((prev) => [{ id: `${Date.now()}-${Math.random()}`, page, prompt, title, lines, actions, at: Date.now() }, ...prev].slice(0, 12))
    } catch {
      setAiTitle('Assistente operativo')
      setAiLines(['Servizio AI non disponibile al momento'])
    } finally {
      setAiLoading(false)
    }
  }

  const proactivePrompts = React.useMemo(() => {
    const map: Record<PageKey, string[]> = {
      home: [
        'Mostrami le priorita operative di oggi',
        'Quale grafico devo controllare per capire i costi?',
      ],
      suppliers: [
        'Compila fornitore da questo testo libero',
        'Controlla campi mancanti anagrafica fornitore',
      ],
      'new-order': ['10 arance; pasta 5; latte x2', 'Compila righe ordine da questo elenco'],
      'new-delivery': [
        'Che controlli fare prima di registrare una consegna?',
        'Dammi checklist rapida nuova consegna',
      ],
      history: [
        'Come trovo consegne anomale rapidamente?',
        'Quali filtri usare per analizzare il mese?',
      ],
      invoices: [
        'Mostrami subito le fatture scadute',
        'Mostra fatture ignorate da rivedere',
      ],
      'prima-nota': [
        'Filtra solo uscite e aiutami a trovare anomalie',
        'Compila movimento da comando testuale',
      ],
      staff: ['Come organizzo i turni su più settimane?', 'Che differenza c’è tra permesso e assenza in pianificazione?'],
      'support-tech': [
        'Come registro un intervento completato assistenza?',
        'Differenza tra voce pianificata e lavoro svolto?',
      ],
    }
    return map[page] || []
  }, [page])

  function restoreHistoryItem(item: AiHistoryItem) {
    setAiInput(item.prompt)
    setAiTitle(item.title)
    setAiLines(item.lines)
    setAiActions(item.actions)
  }

  function actionLabel(a: string) {
    const labels: Record<string, string> = {
      open_dashboard: 'Apri Dashboard',
      open_invoices: 'Apri Fatture',
      open_prima_nota: 'Apri Prima Nota',
      open_suppliers: 'Apri Fornitori',
      suggest_supplier: 'Suggerisci campi fornitore',
      suggest_invoice: 'Suggerisci campi fattura',
      suggest_prima_nota: 'Suggerisci movimento',
      check_supplier_missing: 'Controlla campi mancanti fornitore',
      check_invoice_anomalies: 'Controlla anomalie fattura',
      check_cash_anomalies: 'Controlla anomalie movimento',
      filter_overdue: 'Filtra scadute',
      filter_due_soon: 'Filtra in scadenza',
      toggle_show_ignored: 'Mostra ignorate',
      filter_prima_nota_uscite: 'Filtra uscite',
      filter_prima_nota_entrate: 'Filtra entrate',
      reset_filters: 'Reset filtri',
      suggest_order_lines: 'Suggerisci righe ordine',
      check_order_anomalies: 'Controlla ordine',
      open_new_order: 'Apri Nuovo ordine',
    }
    return labels[a] || a
  }

  function handleAiAction(a: string) {
    if (a === 'open_dashboard') {
      navigateTo('home')
      setAiOpen(false)
      return
    }
    if (a.includes('prima_nota') || a.includes('prima-nota') || a === 'open_prima_nota') navigateTo('prima-nota')
    if (a.includes('invoices') || a === 'open_invoices') navigateTo('invoices')
    if (a.includes('supplier')) navigateTo('suppliers')
    if (a === 'filter_overdue') {
      navigateTo('invoices')
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('ai-invoices-filter', { detail: { dueFilter: 'overdue' } }))
      }, 0)
      setAiToast('Filtro AI applicato: fatture scadute')
      setAiOpen(false)
      return
    }
    if (a === 'filter_due_soon') {
      navigateTo('invoices')
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('ai-invoices-filter', { detail: { dueFilter: 'due_soon' } }))
      }, 0)
      setAiToast('Filtro AI applicato: fatture in scadenza')
      setAiOpen(false)
      return
    }
    if (a === 'toggle_show_ignored') {
      navigateTo('invoices')
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('ai-invoices-filter', { detail: { showIgnored: true } }))
      }, 0)
      setAiToast('Filtro AI applicato: mostro ignorate')
      setAiOpen(false)
      return
    }
    if (a === 'filter_prima_nota_uscite') {
      navigateTo('prima-nota')
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('ai-prima-nota-filter', { detail: { movementKind: 'uscita' } }))
      }, 0)
      setAiToast('Filtro AI applicato: uscite Prima Nota')
      setAiOpen(false)
      return
    }
    if (a === 'filter_prima_nota_entrate') {
      navigateTo('prima-nota')
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('ai-prima-nota-filter', { detail: { movementKind: 'entrata' } }))
      }, 0)
      setAiToast('Filtro AI applicato: entrate Prima Nota')
      setAiOpen(false)
      return
    }
    if (a === 'reset_filters') {
      window.dispatchEvent(new CustomEvent('ai-reset-filters'))
      setAiToast('Filtri resettati')
      return
    }
    if (a === 'check_supplier_missing') {
      navigateTo('suppliers')
      return
    }
    if (a === 'check_invoice_anomalies') {
      navigateTo('invoices')
      return
    }
    if (a === 'check_cash_anomalies') {
      navigateTo('prima-nota')
      return
    }
    if (a === 'open_new_order' || a === 'suggest_order_lines' || a === 'check_order_anomalies') {
      navigateTo('new-order')
      setAiOpen(false)
      return
    }
  }

  function applyAiToForm() {
    if (!aiApplyPayload) return
    if (aiApplyPayload.kind === 'suppliers') {
      window.dispatchEvent(new CustomEvent('ai-apply-supplier', { detail: aiApplyPayload.data }))
      navigateTo('suppliers')
      setAiToast('Campi fornitore applicati da AI')
    }
    if (aiApplyPayload.kind === 'invoices') {
      window.dispatchEvent(new CustomEvent('ai-apply-invoice', { detail: aiApplyPayload.data }))
      navigateTo('invoices')
      setAiToast('Campi fattura applicati da AI')
    }
    if (aiApplyPayload.kind === 'prima-nota') {
      window.dispatchEvent(new CustomEvent('ai-apply-prima-nota', { detail: aiApplyPayload.data }))
      navigateTo('prima-nota')
      setAiToast('Campi Prima Nota applicati da AI')
    }
    if (aiApplyPayload.kind === 'new-order') {
      window.dispatchEvent(new CustomEvent('ai-apply-order', { detail: aiApplyPayload.data }))
      navigateTo('new-order')
      setAiToast('Righe ordine applicate da AI')
    }
    setAiOpen(false)
  }

  React.useEffect(() => {
    if (!aiToast) return
    setAiToastClosing(false)
    const closeStart = window.setTimeout(() => setAiToastClosing(true), 2200)
    const closeEnd = window.setTimeout(() => {
      setAiToast('')
      setAiToastClosing(false)
    }, 2600)
    return () => {
      window.clearTimeout(closeStart)
      window.clearTimeout(closeEnd)
    }
  }, [aiToast])

  return (
    <div className="app-wrap">
      <nav className="app-nav" aria-label="Navigazione principale">
        <div className="app-nav-inner">
          <div className="app-nav-brand">
            <button
              type="button"
              className={`app-nav-toggle${navOpen ? ' is-open' : ''}`}
              aria-expanded={navOpen}
              aria-controls="app-nav-menu"
              onClick={() => setNavOpen((o) => !o)}
            >
              <span className="app-nav-toggle-label">Menu</span>
              <span className="app-nav-toggle-bar" aria-hidden />
              <span className="app-nav-toggle-bar" aria-hidden />
              <span className="app-nav-toggle-bar" aria-hidden />
            </button>
            <h1 className="app-nav-title">Fornitori App</h1>
          </div>
          <div id="app-nav-menu" className={`app-nav-links${navOpen ? ' is-open' : ''}`}>
            <a href="#" className={page === 'home' ? 'active' : ''} onClick={(e) => { e.preventDefault(); navigateTo('home'); }}>Home</a>
            <a href="#" className={page === 'suppliers' ? 'active' : ''} onClick={(e) => { e.preventDefault(); navigateTo('suppliers'); }}>Fornitori</a>
            <a href="#" className={page === 'new-order' ? 'active' : ''} onClick={(e) => { e.preventDefault(); navigateTo('new-order'); }}>Nuovo ordine</a>
            <a href="#" className={page === 'new-delivery' ? 'active' : ''} onClick={(e) => { e.preventDefault(); navigateTo('new-delivery'); }}>Nuova consegna</a>
            <a href="#" className={page === 'history' ? 'active' : ''} onClick={(e) => { e.preventDefault(); navigateTo('history'); }}>Storico consegne</a>
            <a href="#" className={page === 'invoices' ? 'active' : ''} onClick={(e) => { e.preventDefault(); navigateTo('invoices'); }}>Fatture fornitori</a>
            <a href="#" className={page === 'prima-nota' ? 'active' : ''} onClick={(e) => { e.preventDefault(); navigateTo('prima-nota'); }}>Prima Nota Cassa</a>
            <a href="#" className={page === 'staff' ? 'active' : ''} onClick={(e) => { e.preventDefault(); navigateTo('staff'); }}>Personale</a>
            <a href="#" className={page === 'support-tech' ? 'active' : ''} onClick={(e) => { e.preventDefault(); navigateTo('support-tech'); }}>Assistenza tecnici</a>
          </div>
        </div>
        {navOpen && (
          <div
            className="app-nav-backdrop"
            aria-hidden
            onClick={() => setNavOpen(false)}
          />
        )}
      </nav>

      <main className="app-main">
        {page === 'home' && <HomePage onNavigate={navigateTo} />}
        {page === 'suppliers' && <SuppliersPage />}
        {page === 'new-order' && <NewOrderPage onNavigate={navigateTo} />}
        {page === 'new-delivery' && <NewDeliveryPage />}
        {page === 'history' && <DeliveriesHistoryPage />}
        {page === 'invoices' && <InvoicesPage />}
        {page === 'prima-nota' && <PrimaNotaPage />}
        {page === 'staff' && <StaffPage />}
        {page === 'support-tech' && <SupportTechniciansPage />}
      </main>

      <button type="button" className="ai-global-fab" onClick={() => setAiOpen(true)} title="Apri assistente operativo AI">
        AI Assistente
      </button>
      {aiOpen && (
        <>
          <div className="ui-drawer-backdrop" onClick={() => setAiOpen(false)} aria-hidden />
          <aside className="ui-drawer" role="dialog" aria-label="Assistente AI operativo" style={{ width: 'min(460px, 100vw)' }}>
            <div className="ui-drawer-header">
              <div>
                <h2 className="ui-drawer-title">Assistente operativo AI</h2>
                <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>Modulo attivo: {page}</div>
              </div>
              <button type="button" className="ui-drawer-close" onClick={() => setAiOpen(false)} aria-label="Chiudi">×</button>
            </div>
            <div className="ui-drawer-body">
              <label style={{ fontWeight: 600, display: 'block', marginBottom: '0.4rem' }}>Cosa vuoi fare?</label>
              <textarea
                className="form-control"
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                rows={3}
                placeholder='Es. "Pagato fattura acqua aprile 240 euro con bonifico"'
                style={{ maxWidth: '100%' }}
              />
              <div className="btn-group">
                <button type="button" className="btn btn-primary" onClick={() => runAi()} disabled={aiLoading}>
                  {aiLoading ? 'Analisi...' : 'Analizza'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => { setAiInput(''); setAiLines([]); setAiActions([]) }}>Pulisci</button>
                {aiHistory.length > 0 && (
                  <button type="button" className="btn btn-secondary" onClick={() => setAiHistory([])}>Svuota storico</button>
                )}
                {aiApplyPayload && (
                  <button type="button" className="btn btn-secondary" onClick={applyAiToForm}>Applica al form</button>
                )}
              </div>
              {proactivePrompts.length > 0 && (
                <div className="ai-suggestions">
                  {proactivePrompts.map((p, i) => (
                    <button key={`${p}-${i}`} type="button" className="btn btn-secondary btn-sm" onClick={() => runAi(p)} disabled={aiLoading}>
                      {p}
                    </button>
                  ))}
                </div>
              )}
              {aiTitle && <h3 className="page-subheader" style={{ fontSize: '0.98rem' }}>{aiTitle}</h3>}
              {aiLines.length > 0 && (
                <div className="ai-result-box">
                  {aiLines.map((l, i) => <p key={i} style={{ margin: '0 0 0.35rem 0' }}>{l}</p>)}
                </div>
              )}
              {aiActions.length > 0 && (
                <div className="btn-group">
                  {aiActions.map((a, i) => (
                    <button key={`${a}-${i}`} type="button" className="btn btn-secondary btn-sm" onClick={() => handleAiAction(a)}>
                      {actionLabel(a)}
                    </button>
                  ))}
                </div>
              )}
              {aiHistory.length > 0 && (
                <div className="ai-history">
                  <h4 className="ai-history-title">Storico assistente</h4>
                  {aiHistory.slice(0, 5).map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      className="ai-history-item"
                      onClick={() => restoreHistoryItem(h)}
                    >
                      <strong>{h.title}</strong>
                      <span>{h.prompt}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </>
      )}
      {aiToast && <div className={`ai-toast ${aiToastClosing ? 'is-closing' : 'is-open'}`}>{aiToast}</div>}
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('app') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
