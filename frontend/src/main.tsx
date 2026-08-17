import React from 'react'
import { createPortal } from 'react-dom'
import { validateAtlasLogin } from './utils/atlasAuth'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import './style.css'
import { pathnameToPage, pageToPath, VALID_PAGES, type PageKey } from './appPaths'
import HomePage from './pages/HomePage.jsx'
import SuppliersPage from './pages/SuppliersPage.jsx'
import NewDeliveryPage from './pages/NewDeliveryPage.jsx'
import MagazzinoPage from './pages/MagazzinoPage.jsx'
import NewOrderPage from './pages/NewOrderPage.jsx'
import DeliveriesHistoryPage from './pages/DeliveriesHistoryPage.jsx'
import InvoicesPage from './pages/InvoicesPage.jsx'
import PagamentiPage from './pages/PagamentiPage.jsx'
import PrimaNotaPage from './pages/PrimaNotaPage.jsx'
import StaffPage from './pages/StaffPage.jsx'
import ReportPersonalePage from './pages/ReportPersonalePage.jsx'
import StipendiPage from './pages/StipendiPage.jsx'
import OperatorLinksPage from './pages/OperatorLinksPage.jsx'
import LocaleCodesPage from './pages/LocaleCodesPage.jsx'
import MastriniContabiliPage from './pages/MastriniContabiliPage.jsx'
import SupportTechniciansPage from './pages/SupportTechniciansPage.jsx'
import TrasportatoriPage from './pages/TrasportatoriPage.jsx'
import VnePage from './pages/VnePage.jsx'
import {
  AnalisiDashboardPage,
  AnalisiGiornalieroPage,
  AnalisiMensilePage,
  AnalisiOrariaPage,
  AnalisiPianificazionePage,
  AnalisiSettimanalePage,
} from './pages/AnalisiPages.jsx'
import {
  AmministrazioneDashboardPage,
  AmministrazioneImpostazioniPage,
  BancaContiPage,
  BancaDashboardPage,
  BancaMovimentiPage,
  BancaRiconciliazionePage,
} from './pages/BancaPages.jsx'
import {
  FattureConservazionePage,
  FattureDaRegistrarePage,
  FattureDashboardPage,
  FattureImportXmlPage,
  FatturePassivePage,
  FattureImpostazioniPage,
  FattureLogPage,
  FattureRicevutePage,
  FattureScadenziarioPage,
  FattureSincronizzazionePage,
} from './pages/FatturePages.jsx'
import { askAi, suggestInvoiceFields, suggestOrderLines, suggestPrimaNota, suggestSupplierFields } from './services/aiService'
import AiManagerPopups from './components/AiManagerPopups.jsx'
import OfflineBanner from './components/OfflineBanner.jsx'
import PwaInstallPrompt from './components/PwaInstallPrompt.jsx'
import AtlasUpdateButton from './components/AtlasUpdateButton.jsx'
import AppNavDropdown from './components/AppNavDropdown.tsx'
import { OfflineProvider, useOffline } from './offline/OfflineContext.jsx'
import { PwaUpdateProvider } from './pwa/PwaUpdateContext.jsx'
import OperatorOrderApp from './OperatorOrderApp.tsx'
import OperatorDeliveryApp from './OperatorDeliveryApp.tsx'
import OperatorPrimaNotaApp from './OperatorPrimaNotaApp.tsx'
import OperatorStationApp from './OperatorStationApp.tsx'
import {
  OPERATOR_DELIVERY_PATH,
  OPERATOR_ORDER_PATH,
  OPERATOR_PRIMA_NOTA_PATH,
  OPERATOR_STATION_PATH,
  getOperatorStationPublicUrl,
  getOperatorStationView,
  isOperatorStationLocked,
  setOperatorStationLock,
  shouldOpenOperatorStation,
} from './utils/operatorMode.ts'

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
  const { online } = useOffline()
  const location = useLocation()
  const navigate = useNavigate()
  const [isAuthenticated, setIsAuthenticated] = React.useState(() => {
    try {
      return sessionStorage.getItem('atlasAuth') === '1'
    } catch {
      return false
    }
  })
  const [loginUsername, setLoginUsername] = React.useState('')
  const [loginPassword, setLoginPassword] = React.useState('')
  const [loginError, setLoginError] = React.useState('')
  const [showPassword, setShowPassword] = React.useState(false)
  const [isLoggingIn, setIsLoggingIn] = React.useState(false)
  const page = pathnameToPage(location.pathname)
  const [navOpen, setNavOpen] = React.useState(false)
  const [navActionsOpen, setNavActionsOpen] = React.useState(false)
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

  const navigateTo = React.useCallback(
    (p: PageKey) => {
      navigate(pageToPath(p))
      setNavOpen(false)
    },
    [navigate],
  )

  React.useEffect(() => {
    setNavOpen(false)
    setNavActionsOpen(false)
  }, [location.pathname])

  React.useEffect(() => {
    try {
      sessionStorage.setItem('atlasAuth', isAuthenticated ? '1' : '0')
    } catch {
      // ignore storage errors
    }
  }, [isAuthenticated])

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
  }, [navigate])

  React.useEffect(() => {
    const onNavigate = (e: Event) => {
      const detail = (e as CustomEvent).detail
      const target = detail?.page as PageKey | undefined
      if (!target) return
      if (VALID_PAGES.includes(target)) navigate(pageToPath(target))
    }
    window.addEventListener('navigate-app', onNavigate as EventListener)
    return () => window.removeEventListener('navigate-app', onNavigate as EventListener)
  }, [navigate])

  React.useEffect(() => {
    if (!navOpen && !navActionsOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNavOpen(false)
        setNavActionsOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navOpen, navActionsOpen])

  React.useEffect(() => {
    const mq = window.matchMedia('(min-width: 1200px)')
    const onChange = () => {
      if (mq.matches) {
        setNavOpen(false)
        setNavActionsOpen(false)
      }
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  React.useEffect(() => {
    if (!navActionsOpen) return
    const onPointerDown = (e: MouseEvent) => {
      const root = document.getElementById('app-nav-actions-root')
      const menu = document.getElementById('app-nav-actions-dropdown')
      const target = e.target as Node
      if (root?.contains(target) || menu?.contains(target)) return
      setNavActionsOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [navActionsOpen])

  React.useEffect(() => {
    if (navOpen) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [navOpen])

  const pageLabel: Record<PageKey, string> = {
    home: 'dashboard',
    analisi: 'analisi',
    'analisi-giornaliero': 'analisi giornaliero',
    'analisi-settimanale': 'analisi settimanale',
    'analisi-mensile': 'analisi mensile',
    'analisi-oraria': 'analisi oraria',
    'analisi-pianificazione': 'pianificazione personale',
    suppliers: 'fornitori',
    'new-order': 'ordini',
    'new-delivery': 'consegne',
    magazzino: 'magazzino',
    history: 'consegne',
    amministrazione: 'amministrazione',
    'amministrazione-mastrini': 'mastrini contabili',
    'amministrazione-impostazioni': 'impostazioni amministrazione',
    banca: 'banca',
    'banca-conti': 'conti correnti',
    'banca-movimenti': 'movimenti bancari',
    'banca-riconciliazione': 'riconciliazione bancaria',
    fatture: 'fatture dashboard',
    'fatture-passive': 'fatture ricevute',
    'fatture-ricevute': 'fatture ricevute',
    'fatture-da-registrare': 'fatture da registrare',
    'fatture-registrate': 'fatture registrate',
    'fatture-scadenziario': 'scadenziario fatture',
    'fatture-sincronizzazione': 'sincronizzazione fatture',
    'fatture-conservazione': 'conservazione fatture',
    'fatture-importa-xml': 'importa xml fatture',
    'fatture-log': 'log sincronizzazioni fatture',
    'fatture-impostazioni': 'impostazioni fatture',
    invoices: 'fatture',
    pagamenti: 'pagamenti',
    'prima-nota': 'prima-nota',
    staff: 'personale',
    'staff-report': 'report personale',
    'staff-stipendi': 'stipendi',
    'staff-operator-links': 'link operatori',
    'staff-locale-codes': 'link codici',
    'support-tech': 'assistenza-tecnici',
    trasportatori: 'trasportatori',
  }

  async function runAi(promptOverride?: string) {
    const prompt = (promptOverride ?? aiInput).trim()
    if (!prompt) return
    if (!online) {
      setAiTitle('Assistente operativo')
      setAiLines(['Gemini e AI vocale sono in pausa finché non torna la connessione internet.'])
      return
    }
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
      if (page === 'invoices' || page === 'fatture-registrate') {
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
      analisi: [
        'Qual è il picco orario previsto per oggi?',
        'Quanti operatori servono nelle fasce di punta?',
      ],
      'analisi-giornaliero': [
        'Quali giorni della settimana incassano di più?',
        'C’è un giorno anomalo negli ultimi 30 giorni?',
      ],
      'analisi-settimanale': [
        'Confronta le ultime settimane di incasso',
        'Quale settimana è stata la più debole?',
      ],
      'analisi-mensile': [
        'Come sta andando l’incasso mensile?',
        'Quali mesi sono i più forti?',
      ],
      'analisi-oraria': [
        'Quali fasce orarie hanno più traffico?',
        'Dove posso ridurre il personale senza rischi?',
      ],
      'analisi-pianificazione': [
        'Dammi un piano operatori per venerdì',
        'Quanti operatori in fascia pranzo?',
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
      magazzino: [
        'Come registro un prelievo merce dal magazzino?',
        'Quali campi servono per entrata e uscita magazzino?',
      ],
      history: [
        'Come trovo consegne anomale rapidamente?',
        'Quali filtri usare per analizzare il mese?',
      ],
      invoices: [
        'Mostrami subito le fatture scadute',
        'Mostra fatture ignorate da rivedere',
      ],
      fatture: [
        'Riassumimi i KPI fatture del mese',
        'Quante fatture ho da registrare?',
      ],
      amministrazione: [
        'Cosa trovo in Amministrazione?',
        'Apri la dashboard banca',
      ],
      'amministrazione-mastrini': [
        'Mostra i conti con saldo anomalo',
        'Apri il dettaglio mastro banca',
      ],
      'amministrazione-impostazioni': ['Quali moduli amministrazione sono attivi?'],
      banca: [
        'Qual è il saldo banca attuale?',
        'Quante entrate e uscite ho oggi?',
      ],
      'banca-conti': ['Come collego un conto corrente?', 'Come sincronizzo i movimenti?'],
      'banca-movimenti': ['Filtra i movimenti bancari del mese'],
      'banca-riconciliazione': ['Ci sono differenze da riconciliare?'],
      'fatture-passive': [
        'Come aggiorno l’inbox fatture SDI?',
        'Come assegno una fattura a Via Abba?',
      ],
      'fatture-ricevute': [
        'Come aggiorno l’inbox fatture SDI?',
        'Come assegno una fattura a Via Abba?',
      ],
      'fatture-da-registrare': [
        'Come collego una fattura alla Prima Nota?',
        'Quali fatture mancano di movimento cassa?',
      ],
      'fatture-registrate': [
        'Mostrami subito le fatture scadute',
        'Mostra fatture ignorate da rivedere',
      ],
      'fatture-scadenziario': [
        'Quali scadenze ho nei prossimi 7 giorni?',
        'Come ignoro una fattura scaduta?',
      ],
      'fatture-sincronizzazione': [
        'Come funziona la sync Agenzia Entrate / SDI?',
        'Dove importo gli XML da Fatture e Corrispettivi?',
      ],
      'fatture-conservazione': ['Quando arriva la conservazione a norma?'],
      'fatture-importa-xml': ['Come importo un XML FatturaPA?'],
      'fatture-log': ['Dove trovo lo storico sync di questa sessione?'],
      'fatture-impostazioni': ['Quali variabili SDI / AdE sono configurate?'],
      pagamenti: [
        'Come leggo il foglio pagamenti fornitori?',
        'Dove trovo i totali mensili da pagare?',
      ],
      'prima-nota': [
        'Filtra solo uscite e aiutami a trovare anomalie',
        'Compila movimento da comando testuale',
      ],
      staff: ['Come organizzo i turni su più settimane?', 'Che differenza c’è tra permesso e assenza in pianificazione?'],
      'staff-report': [
        'Come stampo il report personale del mese?',
        'Dove trovo il riepilogo ore per dipendente?',
      ],
      'staff-stipendi': [
        'Come salvo il foglio stipendi di gennaio?',
        'Dove inserisco Busta, Acconto TFR e Fuori?',
      ],
      'staff-operator-links': [
        'Quale link devo dare all’operatore per gli ordini?',
        'Differenza tra postazione operativa e solo Prima Nota',
      ],
      'staff-locale-codes': [
        'Come recupero il codice di Bar-momento?',
        'Che codice ha il registro Risacca?',
      ],
      'support-tech': [
        'Come registro un intervento completato assistenza?',
        'Differenza tra voce pianificata e lavoro svolto?',
      ],
      trasportatori: [
        'Quali trasportatori sono in servizio oggi?',
        'Come segno un furgone in riposo?',
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

  function handleLoginSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (isLoggingIn) return
    const u = loginUsername.trim()
    const p = loginPassword.trim()
    if (!u || !p) {
      setLoginError('Inserisci username e password')
      return
    }
    if (!validateAtlasLogin(u, p)) {
      setLoginError('Username o password non corretti')
      return
    }
    setLoginError('')
    setIsLoggingIn(true)
    window.setTimeout(() => {
      setOperatorStationLock(false)
      setIsAuthenticated(true)
      setLoginPassword('')
      setIsLoggingIn(false)
    }, 260)
  }

  function handleLogout() {
    setAiOpen(false)
    setNavOpen(false)
    setNavActionsOpen(false)
    setIsAuthenticated(false)
    setLoginPassword('')
    navigate('/')
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

  if (!isAuthenticated) {
    return (
      <div className={`atlas-login-page${isLoggingIn ? ' is-entering' : ''}`}>
        <div className="atlas-login-overlay" />
        <div className="atlas-login-shell">
          <img src="/atlas-login-bg.png" alt="ATLAS" className="atlas-login-hero" />
          <form className="atlas-login-form" onSubmit={handleLoginSubmit}>
            <input
              type="text"
              className="form-control atlas-login-input"
              value={loginUsername}
              onChange={(e) => setLoginUsername(e.target.value)}
              placeholder="Username"
              autoComplete="username"
            />
            <div className="atlas-password-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                className="form-control atlas-login-input atlas-password-input"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Password"
                autoComplete="current-password"
              />
              <button
                type="button"
                className="atlas-password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Nascondi password' : 'Mostra password'}
              >
                {showPassword ? 'Nascondi' : 'Mostra'}
              </button>
            </div>
            {loginError ? <p className="atlas-login-error">{loginError}</p> : null}
            <button type="submit" className="btn btn-primary atlas-login-submit" disabled={isLoggingIn}>
              {isLoggingIn ? 'Accesso...' : 'Accedi'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="app-wrap">
      <OfflineBanner />
      <PwaInstallPrompt />
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
            <Link to="/" className="app-nav-title app-nav-title--atlas" title="ATLAS" onClick={() => setNavOpen(false)}>
              <img src="/atlas-logo.svg" alt="ATLAS Software Gestionale" className="atlas-nav-logo" />
            </Link>
          </div>
          <div id="app-nav-menu" className={`app-nav-links${navOpen ? ' is-open' : ''}`}>
            <AppNavDropdown
              label="Home"
              to="/"
              items={[
                { to: '/analisi', label: 'Analisi' },
                { to: '/analisi/giornaliero', label: 'Giornaliero' },
                { to: '/analisi/settimanale', label: 'Settimanale' },
                { to: '/analisi/mensile', label: 'Mensile' },
                { to: '/analisi/oraria', label: 'Analisi oraria' },
                { to: '/analisi/pianificazione', label: 'Pianificazione personale' },
              ]}
              onNavigate={() => setNavOpen(false)}
            />
            <NavLink to="/suppliers" className={({ isActive }) => (isActive ? 'active' : '')} onClick={() => setNavOpen(false)}>Fornitori</NavLink>
            <NavLink to="/new-order" className={({ isActive }) => (isActive ? 'active' : '')} onClick={() => setNavOpen(false)}>Nuovo ordine</NavLink>
            <AppNavDropdown
              label="Nuova consegna"
              to="/new-delivery"
              items={[
                { to: '/trasportatori', label: 'Trasportatori' },
                { to: '/magazzino', label: 'Magazzino' },
              ]}
              onNavigate={() => setNavOpen(false)}
            />
            <NavLink to="/history" className={({ isActive }) => (isActive ? 'active' : '')} onClick={() => setNavOpen(false)}>Storico consegne</NavLink>
            <AppNavDropdown
              label="Amministrazione"
              to="/amministrazione"
              items={[
                { to: '/amministrazione', label: 'Dashboard' },
                { to: '/amministrazione/mastrini', label: 'Mastrini contabili' },
                { to: '/banca', label: 'Banca' },
                { to: '/fatture', label: 'Fatture Fornitori' },
                { to: '/amministrazione/impostazioni', label: 'Impostazioni' },
              ]}
              onNavigate={() => setNavOpen(false)}
            />
            <AppNavDropdown
              label="Personale amministrazione"
              to="/staff"
              items={[
                { to: '/staff', label: 'Dipendenti e turni' },
                { to: '/prima-nota', label: 'Prima Nota' },
                { to: '/trasportatori', label: 'Trasportatori' },
                { to: '/staff/report', label: 'Report personale' },
                { to: '/staff/stipendi', label: 'Stipendi' },
                { to: '/staff/link-operatori', label: 'Link operatori' },
                { to: '/staff/link-codici', label: 'Link codici' },
              ]}
              onNavigate={() => setNavOpen(false)}
            />
            <NavLink to="/support-tech" className={({ isActive }) => (isActive ? 'active' : '')} onClick={() => setNavOpen(false)}>Assistenza tecnici</NavLink>
            <NavLink to="/vne" className={({ isActive }) => (isActive ? 'active' : '')} onClick={() => setNavOpen(false)}>VNE</NavLink>
          </div>
          <div className="app-nav-actions">
            <div className="app-nav-actions-menu" id="app-nav-actions-root">
              <button
                type="button"
                className={`app-nav-actions-toggle${navActionsOpen ? ' is-open' : ''}`}
                aria-expanded={navActionsOpen}
                aria-controls="app-nav-actions-dropdown"
                aria-label="Menu account e aggiornamento"
                onClick={() => setNavActionsOpen((o) => !o)}
              >
                <span className="app-nav-toggle-bar" aria-hidden />
                <span className="app-nav-toggle-bar" aria-hidden />
                <span className="app-nav-toggle-bar" aria-hidden />
              </button>
            </div>
            <div className="app-nav-actions-inline">
              <AtlasUpdateButton navStyle />
              <button type="button" className="app-nav-logout" onClick={handleLogout}>
                Logout
              </button>
            </div>
          </div>
        </div>
        {navActionsOpen &&
          createPortal(
            <div
              id="app-nav-actions-dropdown"
              className="app-nav-actions-dropdown app-nav-actions-dropdown--fixed is-open"
              role="menu"
            >
              <AtlasUpdateButton navStyle onDone={() => setNavActionsOpen(false)} />
              <button type="button" className="app-nav-logout" onClick={handleLogout}>
                Logout
              </button>
            </div>,
            document.body,
          )}
        {navOpen && (
          <div
            className="app-nav-backdrop"
            aria-hidden
            onClick={() => setNavOpen(false)}
          />
        )}
      </nav>
      <div className="app-version-strip" aria-label="Versione software">Versione 1.0</div>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/analisi" element={<AnalisiDashboardPage />} />
          <Route path="/analisi/giornaliero" element={<AnalisiGiornalieroPage />} />
          <Route path="/analisi/settimanale" element={<AnalisiSettimanalePage />} />
          <Route path="/analisi/mensile" element={<AnalisiMensilePage />} />
          <Route path="/analisi/oraria" element={<AnalisiOrariaPage />} />
          <Route path="/analisi/pianificazione" element={<AnalisiPianificazionePage />} />
          <Route path="/suppliers" element={<SuppliersPage />} />
          <Route path="/new-order" element={<NewOrderPage />} />
          <Route path="/new-delivery" element={<NewDeliveryPage />} />
          <Route path="/trasportatori" element={<TrasportatoriPage />} />
          <Route path="/magazzino" element={<MagazzinoPage />} />
          <Route path="/history" element={<DeliveriesHistoryPage />} />
          <Route path="/amministrazione" element={<AmministrazioneDashboardPage />} />
          <Route path="/amministrazione/mastrini" element={<MastriniContabiliPage />} />
          <Route path="/amministrazione/impostazioni" element={<AmministrazioneImpostazioniPage />} />
          <Route path="/banca" element={<BancaDashboardPage />} />
          <Route path="/banca/conti" element={<BancaContiPage />} />
          <Route path="/banca/movimenti" element={<BancaMovimentiPage />} />
          <Route path="/banca/riconciliazione" element={<BancaRiconciliazionePage />} />
          <Route path="/fatture" element={<FattureDashboardPage />} />
          <Route path="/fatture/passive" element={<FatturePassivePage />} />
          <Route path="/fatture/ricevute" element={<FattureRicevutePage />} />
          <Route path="/fatture/da-registrare" element={<FattureDaRegistrarePage />} />
          <Route path="/fatture/registrate" element={<InvoicesPage />} />
          <Route path="/fatture/scadenziario" element={<FattureScadenziarioPage />} />
          <Route path="/fatture/sincronizzazione" element={<FattureSincronizzazionePage />} />
          <Route path="/fatture/conservazione" element={<FattureConservazionePage />} />
          <Route path="/fatture/importa-xml" element={<FattureImportXmlPage />} />
          <Route path="/fatture/log" element={<FattureLogPage />} />
          <Route path="/fatture/impostazioni" element={<FattureImpostazioniPage />} />
          <Route path="/invoices" element={<Navigate to="/fatture/registrate" replace />} />
          <Route path="/pagamenti" element={<PagamentiPage />} />
          <Route path="/prima-nota" element={<PrimaNotaPage />} />
          <Route path="/staff/report" element={<ReportPersonalePage />} />
          <Route path="/staff/stipendi" element={<StipendiPage />} />
          <Route path="/staff/link-operatori" element={<OperatorLinksPage />} />
          <Route path="/staff/link-codici" element={<LocaleCodesPage />} />
          <Route path="/staff" element={<StaffPage />} />
          <Route path="/support-tech" element={<SupportTechniciansPage />} />
          <Route path="/vne" element={<VnePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <button
        type="button"
        className="ai-global-fab"
        onClick={() => setAiOpen(true)}
        disabled={!online}
        title={online ? 'Apri assistente operativo AI' : 'Gemini e AI vocale in pausa (offline)'}
      >
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
      <AiManagerPopups enabled={isAuthenticated} />
    </div>
  )
}

function MainAppGate() {
  const location = useLocation()
  const isStandalone =
    typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches

  if (isOperatorStationLocked()) {
    return <Navigate to={getOperatorStationPublicUrl(getOperatorStationView())} replace />
  }

  if (
    shouldOpenOperatorStation() &&
    isStandalone &&
    (location.pathname === '/' || location.pathname === '')
  ) {
    return <Navigate to={getOperatorStationPublicUrl(getOperatorStationView())} replace />
  }

  return <App />
}

function RootRouter() {
  return (
    <OfflineProvider>
      <PwaUpdateProvider>
        <BrowserRouter>
          <Routes>
            <Route path={OPERATOR_ORDER_PATH} element={<OperatorOrderApp />} />
            <Route path={`${OPERATOR_DELIVERY_PATH}/*`} element={<OperatorDeliveryApp />} />
            <Route path={OPERATOR_PRIMA_NOTA_PATH} element={<OperatorPrimaNotaApp />} />
            <Route path={OPERATOR_STATION_PATH} element={<OperatorStationApp />} />
            <Route path="/*" element={<MainAppGate />} />
          </Routes>
        </BrowserRouter>
      </PwaUpdateProvider>
    </OfflineProvider>
  )
}

ReactDOM.createRoot(document.getElementById('app') as HTMLElement).render(
  <React.StrictMode>
    <RootRouter />
  </React.StrictMode>,
)
