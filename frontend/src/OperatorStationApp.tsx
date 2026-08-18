import React from 'react'
import OperatorSatelliteShell from './components/OperatorSatelliteShell.tsx'
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
import {
  getOperatorStationView,
  markOperatorStationEntryPoint,
  setOperatorStationLock,
  syncOperatorStationViewInUrl,
  type OperatorStationView,
} from './utils/operatorMode.ts'

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
  { id: 'prima-nota', label: 'Prima Nota', title: 'Prima Nota di cassa' },
]

const ALL_SECTIONS: StationSection[] = [
  ...TOP_SECTIONS,
  { id: 'delivery', label: 'Nuova consegna', title: 'Nuova consegna' },
  { id: 'delivery-history', label: 'Storico consegne', title: 'Storico consegne' },
  ...DELIVERY_SUBMENU,
  ...PERSONALE_MENU,
]

const DELIVERY_VIEWS: OperatorStationView[] = ['delivery', 'magazzino', 'trasportatori']
const PERSONALE_VIEWS: OperatorStationView[] = ['staff', 'staff-report', 'stipendi', 'prima-nota']

function resolveStationTitle(view: OperatorStationView): string {
  return ALL_SECTIONS.find((s) => s.id === view)?.title || 'Postazione operativa'
}

export default function OperatorStationApp() {
  const [view, setView] = React.useState<OperatorStationView>(() => getOperatorStationView())

  React.useEffect(() => {
    markOperatorStationEntryPoint()
    setOperatorStationLock(true)

    const blockFullAppNavigation = (e: Event) => {
      e.stopImmediatePropagation()
    }
    window.addEventListener('navigate-app', blockFullAppNavigation, true)
    window.addEventListener('open-prima-nota', blockFullAppNavigation, true)
    return () => {
      window.removeEventListener('navigate-app', blockFullAppNavigation, true)
      window.removeEventListener('open-prima-nota', blockFullAppNavigation, true)
    }
  }, [])

  const setStationView = React.useCallback((next: OperatorStationView) => {
    setView(next)
    syncOperatorStationViewInUrl(next)
  }, [])

  const activeTitle = resolveStationTitle(view)
  const deliveryActive = DELIVERY_VIEWS.includes(view)
  const personaleActive = PERSONALE_VIEWS.includes(view)
  const personaleMain = PERSONALE_MENU.find((s) => s.id === view) || PERSONALE_MENU[0]

  const nav = [
    ...TOP_SECTIONS.map((section) => ({
      id: section.id,
      label: section.label,
      active: view === section.id,
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
        active: view === item.id,
        onClick: () => setStationView(item.id),
      })),
    },
    {
      id: 'delivery-history',
      label: 'Storico consegne',
      active: view === 'delivery-history',
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
        active: view === item.id,
        onClick: () => setStationView(item.id),
      })),
    },
  ]

  let content: React.ReactNode
  if (view === 'overview') {
    content = <HomePage operatorMode onOperatorNavigate={setStationView} />
  } else if (view === 'staff') {
    content = <StaffPage operatorMode />
  } else if (view === 'prima-nota') {
    content = <PrimaNotaPage operatorMode />
  } else if (view === 'staff-report') {
    content = <ReportPersonalePage />
  } else if (view === 'stipendi') {
    content = <StipendiPage />
  } else if (view === 'suppliers') {
    content = <SuppliersPage />
  } else if (view === 'delivery') {
    content = <NewDeliveryPage operatorMode />
  } else if (view === 'delivery-history') {
    content = <DeliveriesHistoryPage operatorMode />
  } else if (view === 'magazzino') {
    content = <MagazzinoPage operatorMode onBackToDelivery={() => setStationView('delivery')} />
  } else if (view === 'trasportatori') {
    content = <TrasportatoriPage operatorMode />
  } else {
    content = <NewOrderPage operatorMode />
  }

  return (
    <OperatorSatelliteShell
      documentTitle={`ATLAS — ${activeTitle} (postazione)`}
      loginHint="Accesso postazione operativa — fornitori, ordini, consegne, personale (turni, report, stipendi, Prima Nota)"
      headerTitle="Postazione operativa"
      headerSubtitle=""
      stationOnly
      nav={nav}
    >
      {content}
    </OperatorSatelliteShell>
  )
}
