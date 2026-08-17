import React from 'react'
import OperatorSatelliteShell from './components/OperatorSatelliteShell.tsx'
import HomePage from './pages/HomePage.jsx'
import StaffPage from './pages/StaffPage.jsx'
import NewOrderPage from './pages/NewOrderPage.jsx'
import PrimaNotaPage from './pages/PrimaNotaPage.jsx'
import TrasportatoriPage from './pages/TrasportatoriPage.jsx'
import {
  getOperatorStationView,
  markOperatorStationEntryPoint,
  setOperatorStationLock,
  syncOperatorStationViewInUrl,
  type OperatorStationView,
} from './utils/operatorMode.ts'

const PERSONALE_VIEWS: OperatorStationView[] = ['staff', 'prima-nota', 'trasportatori']

const PERSONALE_MENU: { id: OperatorStationView; label: string; title: string }[] = [
  { id: 'staff', label: 'Dipendenti e turni', title: 'Personale' },
  { id: 'prima-nota', label: 'Prima Nota', title: 'Prima Nota di cassa' },
  { id: 'trasportatori', label: 'Trasportatori', title: 'Trasportatori' },
]

const TOP_SECTIONS: { id: OperatorStationView; label: string; title: string }[] = [
  { id: 'overview', label: 'Panoramica', title: 'Panoramica' },
  { id: 'orders', label: 'Nuovo ordine', title: 'Nuovo ordine' },
]

function resolveStationTitle(view: OperatorStationView): string {
  const hit =
    TOP_SECTIONS.find((s) => s.id === view) ||
    PERSONALE_MENU.find((s) => s.id === view)
  return hit?.title || 'Postazione operativa'
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
      id: 'personale-admin',
      label: 'Personale amministrazione',
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

  return (
    <OperatorSatelliteShell
      documentTitle={`ATLAS — ${activeTitle} (postazione)`}
      loginHint="Accesso postazione operativa — Panoramica, ordini, personale, Prima Nota e trasportatori"
      headerTitle="Postazione operativa"
      headerSubtitle={`${activeTitle} — menu Personale amministrazione con Prima Nota e Trasportatori`}
      stationOnly
      nav={nav}
    >
      {view === 'overview' ? (
        <HomePage operatorMode onOperatorNavigate={setStationView} />
      ) : view === 'staff' ? (
        <StaffPage operatorMode />
      ) : view === 'prima-nota' ? (
        <PrimaNotaPage operatorMode />
      ) : view === 'trasportatori' ? (
        <TrasportatoriPage operatorMode />
      ) : (
        <NewOrderPage operatorMode />
      )}
    </OperatorSatelliteShell>
  )
}
