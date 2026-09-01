import React from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import OperatorSatelliteShell from './components/OperatorSatelliteShell.tsx'
import { FattureNavBaseProvider } from './components/FattureShared.jsx'
import HomePage from './pages/HomePage.jsx'
import StaffPage from './pages/StaffPage.jsx'
import NewOrderPage from './pages/NewOrderPage.jsx'
import PrimaNotaPage from './pages/PrimaNotaPage.jsx'
import TrasportatoriPage from './pages/TrasportatoriPage.jsx'
import NewDeliveryPage from './pages/NewDeliveryPage.jsx'
import DeliveriesHistoryPage from './pages/DeliveriesHistoryPage.jsx'
import MagazzinoPage from './pages/MagazzinoPage.jsx'
import ReportPersonalePage from './pages/ReportPersonalePage.jsx'
import StipendiPage from './pages/StipendiPage.jsx'
import SuppliersPage from './pages/SuppliersPage.jsx'
import InvoicesPage from './pages/InvoicesPage.jsx'
import SupportTechniciansPage from './pages/SupportTechniciansPage.jsx'
import {
  FattureConservazionePage,
  FattureDaRegistrarePage,
  FattureDashboardPage,
  FattureImpostazioniPage,
  FattureImportXmlPage,
  FattureLogPage,
  FatturePassivePage,
  FattureRicevutePage,
  FattureScadenziarioPage,
  FattureSincronizzazionePage,
} from './pages/FatturePages.jsx'
import { type OperatorStationId, stationIdToAuthMode } from './utils/atlasAuth'
import {
  getOperatorStationFatturePath,
  getOperatorStationRouterPath,
  getOperatorStationView,
  markOperatorStationEntryPoint,
  setOperatorStationLock,
  type OperatorStationView,
} from './utils/operatorMode.ts'
import { applyContextPwaManifest, markOperatorPwaLaunchPreferred } from './utils/pwaManifest.ts'

type StationSection = { id: OperatorStationView; label: string; title: string }

const TOP_SECTIONS: StationSection[] = [
  { id: 'overview', label: 'Panoramica', title: 'Panoramica' },
  { id: 'suppliers', label: 'Fornitori', title: 'Fornitori' },
  { id: 'orders', label: 'Nuovo ordine', title: 'Nuovo ordine' },
]

const DELIVERY_SUBMENU: StationSection[] = [
  { id: 'trasportatori', label: 'Trasportatori', title: 'Trasportatori' },
  { id: 'magazzino', label: 'Magazzino', title: 'Magazzino' },
]

const PERSONALE_MENU: StationSection[] = [
  { id: 'staff', label: 'Dipendenti e turni', title: 'Personale' },
  { id: 'staff-report', label: 'Report personale', title: 'Report personale' },
  { id: 'stipendi', label: 'Stipendi', title: 'Stipendi' },
]

const ADMIN_MENU: StationSection[] = [
  { id: 'fatture', label: 'Fatture fornitori', title: 'Fatture fornitori' },
  { id: 'prima-nota', label: 'Prima Nota', title: 'Prima Nota di cassa' },
]

const ALL_SECTIONS: StationSection[] = [
  ...TOP_SECTIONS,
  { id: 'delivery', label: 'Nuova consegna', title: 'Nuova consegna' },
  { id: 'delivery-history', label: 'Storico consegne', title: 'Storico consegne' },
  ...DELIVERY_SUBMENU,
  ...PERSONALE_MENU,
  ...ADMIN_MENU,
  { id: 'support-tech', label: 'Assistenza tecnici', title: 'Assistenza tecnici' },
]

const DELIVERY_VIEWS: OperatorStationView[] = ['delivery', 'magazzino', 'trasportatori']
const PERSONALE_VIEWS: OperatorStationView[] = ['staff', 'staff-report', 'stipendi']
const ADMIN_VIEWS: OperatorStationView[] = ['fatture', 'prima-nota']

const STATION_LABELS: Record<OperatorStationId, string> = {
  abba: 'Abba 42',
  zanardelli: 'Zanardelli 19',
  lattea: 'Via Lattea',
}

const SECTION_ALIASES: Record<string, OperatorStationView> = {
  overview: 'overview',
  panoramica: 'overview',
  suppliers: 'suppliers',
  fornitori: 'suppliers',
  orders: 'orders',
  ordini: 'orders',
  delivery: 'delivery',
  'delivery-history': 'delivery-history',
  history: 'delivery-history',
  magazzino: 'magazzino',
  trasportatori: 'trasportatori',
  staff: 'staff',
  'staff-report': 'staff-report',
  stipendi: 'stipendi',
  'prima-nota': 'prima-nota',
  fatture: 'fatture',
  fatturazione: 'fatture',
  invoices: 'fatture',
  'support-tech': 'support-tech',
  'assistenza-tecnici': 'support-tech',
  tecnici: 'support-tech',
  assistenza: 'support-tech',
}

function resolveStationTitle(view: OperatorStationView): string {
  return ALL_SECTIONS.find((s) => s.id === view)?.title || 'Postazione operativa'
}

function StationFattureRoutes({ fattureBase }: { fattureBase: string }) {
  return (
    <FattureNavBaseProvider base={fattureBase}>
      <Routes>
        <Route index element={<FattureDashboardPage />} />
        <Route path="ricevute" element={<FattureRicevutePage />} />
        <Route path="passive" element={<FatturePassivePage />} />
        <Route path="da-registrare" element={<FattureDaRegistrarePage />} />
        <Route path="registrate" element={<InvoicesPage />} />
        <Route path="scadenziario" element={<FattureScadenziarioPage />} />
        <Route path="sincronizzazione" element={<FattureSincronizzazionePage />} />
        <Route path="conservazione" element={<FattureConservazionePage />} />
        <Route path="importa-xml" element={<FattureImportXmlPage />} />
        <Route path="log" element={<FattureLogPage />} />
        <Route path="impostazioni" element={<FattureImpostazioniPage />} />
        <Route path="*" element={<Navigate to="." replace />} />
      </Routes>
    </FattureNavBaseProvider>
  )
}

function StationMainContent({
  view,
  stationId,
  onOperatorNavigate,
  setStationView,
}: {
  view: OperatorStationView
  stationId: OperatorStationId
  onOperatorNavigate: (section: string) => void
  setStationView: (next: OperatorStationView) => void
}) {
  if (view === 'overview') {
    return <HomePage operatorMode onOperatorNavigate={onOperatorNavigate} />
  }
  if (view === 'staff') {
    return <StaffPage operatorMode stationId={stationId} />
  }
  if (view === 'prima-nota') {
    return <PrimaNotaPage operatorMode stationId={stationId} />
  }
  if (view === 'staff-report') {
    return <ReportPersonalePage operatorMode stationId={stationId} />
  }
  if (view === 'stipendi') {
    return <StipendiPage operatorMode stationId={stationId} />
  }
  if (view === 'suppliers') {
    return <SuppliersPage />
  }
  if (view === 'delivery') {
    return <NewDeliveryPage operatorMode />
  }
  if (view === 'delivery-history') {
    return <DeliveriesHistoryPage operatorMode />
  }
  if (view === 'magazzino') {
    return <MagazzinoPage operatorMode onBackToDelivery={() => setStationView('delivery')} />
  }
  if (view === 'trasportatori') {
    return <TrasportatoriPage operatorMode />
  }
  if (view === 'support-tech') {
    return <SupportTechniciansPage />
  }
  return <NewOrderPage operatorMode />
}

type OperatorStationAppProps = {
  stationId?: OperatorStationId
}

export default function OperatorStationApp({ stationId = 'abba' }: OperatorStationAppProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const fatturePath = getOperatorStationFatturePath(stationId)
  const authMode = stationIdToAuthMode(stationId)
  const sedeLabel = STATION_LABELS[stationId]

  const [view, setView] = React.useState<OperatorStationView>(() => getOperatorStationView(stationId))

  const onFatturePath = location.pathname === fatturePath || location.pathname.startsWith(`${fatturePath}/`)

  React.useEffect(() => {
    markOperatorStationEntryPoint(stationId)
    markOperatorPwaLaunchPreferred(stationId)
    applyContextPwaManifest()
    setOperatorStationLock(true, stationId)

    const blockFullAppNavigation = (e: Event) => {
      e.stopImmediatePropagation()
    }
    window.addEventListener('navigate-app', blockFullAppNavigation, true)
    window.addEventListener('open-prima-nota', blockFullAppNavigation, true)
    return () => {
      window.removeEventListener('navigate-app', blockFullAppNavigation, true)
      window.removeEventListener('open-prima-nota', blockFullAppNavigation, true)
    }
  }, [stationId])

  React.useEffect(() => {
    setView(getOperatorStationView(stationId))
  }, [location.pathname, location.search, stationId])

  const setStationView = React.useCallback(
    (next: OperatorStationView) => {
      setView(next)
      navigate(getOperatorStationRouterPath(next, stationId))
    },
    [navigate, stationId],
  )

  const onOperatorNavigate = React.useCallback(
    (section: string) => {
      const mapped = SECTION_ALIASES[String(section || '').trim().toLowerCase()]
      setStationView(mapped || 'overview')
    },
    [setStationView],
  )

  const effectiveView: OperatorStationView = onFatturePath ? 'fatture' : view
  const activeTitle = resolveStationTitle(effectiveView)
  const deliveryActive = DELIVERY_VIEWS.includes(effectiveView)
  const personaleActive = PERSONALE_VIEWS.includes(effectiveView)
  const adminActive = ADMIN_VIEWS.includes(effectiveView)
  const personaleMain = PERSONALE_MENU.find((s) => s.id === effectiveView) || PERSONALE_MENU[0]
  const adminMain = ADMIN_MENU.find((s) => s.id === effectiveView) || ADMIN_MENU[0]

  const nav = [
    ...TOP_SECTIONS.map((section) => ({
      id: section.id,
      label: section.label,
      active: effectiveView === section.id,
      onClick: () => setStationView(section.id),
    })),
    {
      id: 'delivery-menu',
      label: 'Nuova consegna',
      active: deliveryActive,
      onClick: () => setStationView('delivery'),
      items: DELIVERY_SUBMENU.map((item) => ({
        id: item.id,
        label: item.label,
        active: effectiveView === item.id,
        onClick: () => setStationView(item.id),
      })),
    },
    {
      id: 'delivery-history',
      label: 'Storico consegne',
      active: effectiveView === 'delivery-history',
      onClick: () => setStationView('delivery-history'),
    },
    {
      id: 'personale-menu',
      label: 'Personale',
      active: personaleActive,
      onClick: () => setStationView(personaleMain.id),
      items: PERSONALE_MENU.map((item) => ({
        id: item.id,
        label: item.label,
        active: effectiveView === item.id,
        onClick: () => setStationView(item.id),
      })),
    },
    {
      id: 'admin-menu',
      label: 'Amministrazione',
      active: adminActive,
      onClick: () => setStationView(adminMain.id),
      items: ADMIN_MENU.map((item) => ({
        id: item.id,
        label: item.label,
        active: effectiveView === item.id,
        onClick: () => setStationView(item.id),
      })),
    },
    {
      id: 'support-tech',
      label: 'Assistenza tecnici',
      active: effectiveView === 'support-tech',
      onClick: () => setStationView('support-tech'),
    },
  ]

  return (
    <OperatorSatelliteShell
      authMode={authMode}
      stationId={stationId}
      documentTitle={`ATLAS — ${activeTitle} (${sedeLabel})`}
      loginHint={`Accesso postazione ${sedeLabel} — fornitori, ordini, consegne, personale, amministrazione, assistenza tecnici`}
      headerTitle={`Postazione operativa · ${sedeLabel}`}
      headerSubtitle=""
      stationOnly
      nav={nav}
    >
      <Routes>
        <Route path="fatture/*" element={<StationFattureRoutes fattureBase={fatturePath} />} />
        <Route
          path="*"
          element={
            <StationMainContent
              view={onFatturePath ? 'overview' : view}
              stationId={stationId}
              onOperatorNavigate={onOperatorNavigate}
              setStationView={setStationView}
            />
          }
        />
      </Routes>
    </OperatorSatelliteShell>
  )
}
