import React from 'react'
import OperatorSatelliteShell from './components/OperatorSatelliteShell.tsx'
import HomePage from './pages/HomePage.jsx'
import StaffPage from './pages/StaffPage.jsx'
import NewOrderPage from './pages/NewOrderPage.jsx'
import PrimaNotaPage from './pages/PrimaNotaPage.jsx'
import {
  getOperatorStationView,
  markOperatorStationEntryPoint,
  setOperatorStationLock,
  syncOperatorStationViewInUrl,
  type OperatorStationView,
} from './utils/operatorMode.ts'

const STATION_SECTIONS: { id: OperatorStationView; label: string; title: string }[] = [
  { id: 'overview', label: 'Panoramica', title: 'Panoramica' },
  { id: 'staff', label: 'Personale', title: 'Personale' },
  { id: 'orders', label: 'Nuovo ordine', title: 'Nuovo ordine' },
  { id: 'prima-nota', label: 'Prima Nota', title: 'Prima Nota di cassa' },
]

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

  const active = STATION_SECTIONS.find((s) => s.id === view) || STATION_SECTIONS[0]

  return (
    <OperatorSatelliteShell
      documentTitle={`ATLAS — ${active.title} (postazione)`}
      loginHint="Accesso postazione operativa — Panoramica, Personale, Nuovo ordine e Prima Nota"
      headerTitle="Postazione operativa"
      headerSubtitle={`${active.title} — accesso limitato alle quattro sezioni operative`}
      stationOnly
      nav={STATION_SECTIONS.map((section) => ({
        id: section.id,
        label: section.label,
        active: view === section.id,
        onClick: () => setStationView(section.id),
      }))}
    >
      {view === 'overview' ? (
        <HomePage operatorMode onOperatorNavigate={setStationView} />
      ) : view === 'staff' ? (
        <StaffPage operatorMode />
      ) : view === 'prima-nota' ? (
        <PrimaNotaPage operatorMode />
      ) : (
        <NewOrderPage operatorMode />
      )}
    </OperatorSatelliteShell>
  )
}
