import React from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import OperatorSatelliteShell from './components/OperatorSatelliteShell.tsx'
import { FattureNavBaseProvider } from './components/FattureShared.jsx'
import HomePage from './pages/HomePage.jsx'
import SuppliersPage from './pages/SuppliersPage.jsx'
import NewDeliveryPage from './pages/NewDeliveryPage.jsx'
import DeliveriesHistoryPage from './pages/DeliveriesHistoryPage.jsx'
import MagazzinoPage from './pages/MagazzinoPage.jsx'
import TrasportatoriPage from './pages/TrasportatoriPage.jsx'
import PrimaNotaPage from './pages/PrimaNotaPage.jsx'
import InvoicesPage from './pages/InvoicesPage.jsx'
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
import {
  getOperatorDeliveryRouterPath,
  getOperatorDeliveryView,
  OPERATOR_DELIVERY_FATTURE_PATH,
  type OperatorDeliveryView,
} from './utils/operatorMode.ts'
import { applyContextPwaManifest, markCarrierPwaLaunchPreferred } from './utils/pwaManifest.ts'

const DELIVERY_SUBMENU: { id: OperatorDeliveryView; label: string }[] = [
  { id: 'trasportatori', label: 'Trasportatori' },
  { id: 'magazzino', label: 'Magazzino' },
]

const ADMIN_SUBMENU: { id: OperatorDeliveryView; label: string }[] = [
  { id: 'fatturazione', label: 'Fatturazione' },
  { id: 'prima-nota', label: 'Prima Nota' },
]

const DELIVERY_MENU_VIEWS: OperatorDeliveryView[] = ['new-delivery', 'magazzino', 'trasportatori']
const ADMIN_MENU_VIEWS: OperatorDeliveryView[] = ['fatturazione', 'prima-nota']

const TITLES: Record<OperatorDeliveryView, string> = {
  overview: 'Panoramica',
  suppliers: 'Fornitori',
  'new-delivery': 'Nuova consegna',
  history: 'Storico consegne',
  magazzino: 'Magazzino',
  trasportatori: 'Trasportatori',
  fatturazione: 'Fatturazione',
  'prima-nota': 'Prima Nota',
}

function DeliveryFattureRoutes() {
  return (
    <FattureNavBaseProvider base={OPERATOR_DELIVERY_FATTURE_PATH}>
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

function DeliveryMainContent({
  view,
  onOperatorNavigate,
  setDeliveryView,
}: {
  view: OperatorDeliveryView
  onOperatorNavigate: (section: string) => void
  setDeliveryView: (next: OperatorDeliveryView) => void
}) {
  if (view === 'overview') {
    return <HomePage operatorMode onOperatorNavigate={onOperatorNavigate} />
  }
  if (view === 'suppliers') {
    return <SuppliersPage />
  }
  if (view === 'magazzino') {
    return <MagazzinoPage operatorMode onBackToDelivery={() => setDeliveryView('new-delivery')} />
  }
  if (view === 'trasportatori') {
    return <TrasportatoriPage operatorMode />
  }
  if (view === 'new-delivery') {
    return <NewDeliveryPage operatorMode />
  }
  if (view === 'prima-nota') {
    return <PrimaNotaPage operatorMode />
  }
  if (view === 'fatturazione') {
    return <Navigate to={OPERATOR_DELIVERY_FATTURE_PATH} replace />
  }
  return <DeliveriesHistoryPage operatorMode />
}

export default function OperatorDeliveryApp() {
  const location = useLocation()
  const navigate = useNavigate()
  const [view, setView] = React.useState<OperatorDeliveryView>(() => getOperatorDeliveryView())

  const onFatturePath =
    location.pathname === OPERATOR_DELIVERY_FATTURE_PATH ||
    location.pathname.startsWith(`${OPERATOR_DELIVERY_FATTURE_PATH}/`)

  React.useEffect(() => {
    markCarrierPwaLaunchPreferred()
    applyContextPwaManifest()
  }, [])

  React.useEffect(() => {
    setView(getOperatorDeliveryView())
  }, [location.pathname, location.search])

  const setDeliveryView = React.useCallback(
    (next: OperatorDeliveryView) => {
      setView(next)
      navigate(getOperatorDeliveryRouterPath(next))
    },
    [navigate],
  )

  const onOperatorNavigate = React.useCallback(
    (section: string) => {
      if (section === 'suppliers' || section === 'fornitori') {
        setDeliveryView('suppliers')
        return
      }
      if (section === 'delivery' || section === 'orders') {
        setDeliveryView('new-delivery')
        return
      }
      if (section === 'delivery-history' || section === 'history') {
        setDeliveryView('history')
        return
      }
      if (section === 'magazzino') {
        setDeliveryView('magazzino')
        return
      }
      if (section === 'trasportatori') {
        setDeliveryView('trasportatori')
        return
      }
      if (section === 'fatturazione' || section === 'fatture') {
        setDeliveryView('fatturazione')
        return
      }
      if (section === 'prima-nota') {
        setDeliveryView('prima-nota')
        return
      }
      setDeliveryView('overview')
    },
    [setDeliveryView],
  )

  const effectiveView: OperatorDeliveryView = onFatturePath ? 'fatturazione' : view
  const headerTitle = TITLES[effectiveView] || 'Postazione trasportatore'
  const deliveryMenuActive = DELIVERY_MENU_VIEWS.includes(effectiveView)
  const adminMenuActive = ADMIN_MENU_VIEWS.includes(effectiveView)

  return (
    <OperatorSatelliteShell
      authMode="carrier"
      documentTitle={`ATLAS — ${headerTitle} (trasportatore)`}
      loginHint=""
      headerTitle="Postazione trasportatore"
      headerSubtitle=""
      nav={[
        {
          id: 'overview',
          label: 'Panoramica',
          active: effectiveView === 'overview',
          onClick: () => setDeliveryView('overview'),
        },
        {
          id: 'suppliers',
          label: 'Fornitori',
          active: effectiveView === 'suppliers',
          onClick: () => setDeliveryView('suppliers'),
        },
        {
          id: 'delivery-menu',
          label: 'Nuova consegna',
          active: deliveryMenuActive,
          onClick: () => setDeliveryView('new-delivery'),
          items: DELIVERY_SUBMENU.map((item) => ({
            id: item.id,
            label: item.label,
            active: effectiveView === item.id,
            onClick: () => setDeliveryView(item.id),
          })),
        },
        {
          id: 'history',
          label: 'Storico consegne',
          active: effectiveView === 'history',
          onClick: () => setDeliveryView('history'),
        },
        {
          id: 'admin-menu',
          label: 'Amministrazione',
          active: adminMenuActive,
          onClick: () => setDeliveryView('fatturazione'),
          items: ADMIN_SUBMENU.map((item) => ({
            id: item.id,
            label: item.label,
            active: effectiveView === item.id,
            onClick: () => setDeliveryView(item.id),
          })),
        },
      ]}
    >
      <Routes>
        <Route path="fatture/*" element={<DeliveryFattureRoutes />} />
        <Route
          path="*"
          element={
            <DeliveryMainContent
              view={view}
              onOperatorNavigate={onOperatorNavigate}
              setDeliveryView={setDeliveryView}
            />
          }
        />
      </Routes>
    </OperatorSatelliteShell>
  )
}
