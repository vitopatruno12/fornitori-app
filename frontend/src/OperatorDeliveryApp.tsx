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
import ReportPersonalePage from './pages/ReportPersonalePage.jsx'
import StipendiPage from './pages/StipendiPage.jsx'
import {
  AnalisiGiornalieroPage,
  AnalisiMensilePage,
  AnalisiSettimanalePage,
} from './pages/AnalisiPages.jsx'
import {
  FattureConservazionePage,
  FattureDaRegistrarePage,
  FatturePagatePage,
  FattureDashboardPage,
  FattureEmessePage,
  FattureImpostazioniPage,
  FattureImportXmlPage,
  FattureLogPage,
  FatturePassivePage,
  FattureRicevutePage,
  FattureScadenziarioPage,
  FattureSincronizzazionePage,
} from './pages/FatturePages.jsx'
import { SchedaContabileFornitorePage } from './pages/SchedaContabileFornitorePage.jsx'
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

const PANORAMICA_SUBMENU: { id: OperatorDeliveryView; label: string }[] = [
  { id: 'overview', label: 'Panoramica' },
  { id: 'analisi-giornaliero', label: 'Analisi giornaliero' },
  { id: 'analisi-settimanale', label: 'Analisi settimanale' },
  { id: 'analisi-mensile', label: 'Analisi mensile' },
]

const PERSONALE_SUBMENU: { id: OperatorDeliveryView; label: string }[] = [
  { id: 'staff-report', label: 'Report personale' },
  { id: 'stipendi', label: 'Stipendi' },
]

const ADMIN_SUBMENU: { id: OperatorDeliveryView; label: string }[] = [
  { id: 'fatturazione', label: 'Fatture fornitori' },
  { id: 'prima-nota', label: 'Prima Nota' },
]

const DELIVERY_MENU_VIEWS: OperatorDeliveryView[] = ['new-delivery', 'magazzino', 'trasportatori']
const PANORAMICA_MENU_VIEWS: OperatorDeliveryView[] = [
  'overview',
  'analisi-giornaliero',
  'analisi-settimanale',
  'analisi-mensile',
]
const PERSONALE_MENU_VIEWS: OperatorDeliveryView[] = ['staff-report', 'stipendi']
const ADMIN_MENU_VIEWS: OperatorDeliveryView[] = ['fatturazione', 'prima-nota']

const TITLES: Record<OperatorDeliveryView, string> = {
  overview: 'Panoramica',
  'analisi-giornaliero': 'Analisi giornaliero',
  'analisi-settimanale': 'Analisi settimanale',
  'analisi-mensile': 'Analisi mensile',
  suppliers: 'Fornitori',
  'new-delivery': 'Nuova consegna',
  history: 'Storico consegne',
  magazzino: 'Magazzino',
  trasportatori: 'Trasportatori',
  'staff-report': 'Report personale',
  stipendi: 'Stipendi',
  fatturazione: 'Fatture fornitori',
  'prima-nota': 'Prima Nota',
}

function DeliveryFattureRoutes() {
  return (
    <FattureNavBaseProvider base={OPERATOR_DELIVERY_FATTURE_PATH}>
      <Routes>
        <Route index element={<FattureDashboardPage />} />
        <Route path="ricevute" element={<FattureRicevutePage />} />
        <Route path="emesse" element={<FattureEmessePage />} />
        <Route path="passive" element={<FatturePassivePage />} />
        <Route path="da-registrare" element={<FattureDaRegistrarePage />} />
        <Route path="pagate" element={<FatturePagatePage />} />
        <Route
          path="scheda-contabile"
          element={<SchedaContabileFornitorePage fattureBase={OPERATOR_DELIVERY_FATTURE_PATH} shell="fatture" />}
        />
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
  const [keepPrimaNotaMounted, setKeepPrimaNotaMounted] = React.useState(view === 'prima-nota')

  React.useEffect(() => {
    if (view === 'prima-nota') setKeepPrimaNotaMounted(true)
  }, [view])

  const primaNotaLayer =
    keepPrimaNotaMounted ? (
      <div style={{ display: view === 'prima-nota' ? 'block' : 'none' }} aria-hidden={view !== 'prima-nota'}>
        <PrimaNotaPage operatorMode stationId="carrier" />
      </div>
    ) : null

  if (view === 'overview') {
    return (
      <>
        {primaNotaLayer}
        <HomePage operatorMode onOperatorNavigate={onOperatorNavigate} />
      </>
    )
  }
  if (view === 'analisi-giornaliero') {
    return (
      <>
        {primaNotaLayer}
        <AnalisiGiornalieroPage />
      </>
    )
  }
  if (view === 'analisi-settimanale') {
    return (
      <>
        {primaNotaLayer}
        <AnalisiSettimanalePage />
      </>
    )
  }
  if (view === 'analisi-mensile') {
    return (
      <>
        {primaNotaLayer}
        <AnalisiMensilePage />
      </>
    )
  }
  if (view === 'suppliers') {
    return (
      <>
        {primaNotaLayer}
        <SuppliersPage />
      </>
    )
  }
  if (view === 'magazzino') {
    return (
      <>
        {primaNotaLayer}
        <MagazzinoPage operatorMode onBackToDelivery={() => setDeliveryView('new-delivery')} />
      </>
    )
  }
  if (view === 'trasportatori') {
    return (
      <>
        {primaNotaLayer}
        <TrasportatoriPage operatorMode />
      </>
    )
  }
  if (view === 'new-delivery') {
    return (
      <>
        {primaNotaLayer}
        <NewDeliveryPage operatorMode />
      </>
    )
  }
  if (view === 'staff-report') {
    return (
      <>
        {primaNotaLayer}
        <ReportPersonalePage />
      </>
    )
  }
  if (view === 'stipendi') {
    return (
      <>
        {primaNotaLayer}
        <StipendiPage />
      </>
    )
  }
  if (view === 'prima-nota') {
    return primaNotaLayer
  }
  if (view === 'fatturazione') {
    return (
      <>
        {primaNotaLayer}
        <Navigate to={OPERATOR_DELIVERY_FATTURE_PATH} replace />
      </>
    )
  }
  return (
    <>
      {primaNotaLayer}
      <DeliveriesHistoryPage operatorMode />
    </>
  )
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
      const key = String(section || '')
        .trim()
        .toLowerCase()
      if (key === 'suppliers' || key === 'fornitori') {
        setDeliveryView('suppliers')
        return
      }
      if (key === 'delivery' || key === 'orders') {
        setDeliveryView('new-delivery')
        return
      }
      if (key === 'delivery-history' || key === 'history') {
        setDeliveryView('history')
        return
      }
      if (key === 'magazzino') {
        setDeliveryView('magazzino')
        return
      }
      if (key === 'trasportatori') {
        setDeliveryView('trasportatori')
        return
      }
      if (key === 'fatturazione' || key === 'fatture') {
        setDeliveryView('fatturazione')
        return
      }
      if (key === 'prima-nota') {
        setDeliveryView('prima-nota')
        return
      }
      if (key === 'staff-report' || key === 'report' || key === 'report-personale' || key === 'personale') {
        setDeliveryView('staff-report')
        return
      }
      if (key === 'stipendi') {
        setDeliveryView('stipendi')
        return
      }
      if (key === 'analisi-giornaliero' || key === 'giornaliero') {
        setDeliveryView('analisi-giornaliero')
        return
      }
      if (key === 'analisi-settimanale' || key === 'settimanale') {
        setDeliveryView('analisi-settimanale')
        return
      }
      if (key === 'analisi-mensile' || key === 'mensile') {
        setDeliveryView('analisi-mensile')
        return
      }
      setDeliveryView('overview')
    },
    [setDeliveryView],
  )

  const effectiveView: OperatorDeliveryView = onFatturePath ? 'fatturazione' : view
  const headerTitle = TITLES[effectiveView] || 'Postazione trasportatore'
  const deliveryMenuActive = DELIVERY_MENU_VIEWS.includes(effectiveView)
  const panoramicaMenuActive = PANORAMICA_MENU_VIEWS.includes(effectiveView)
  const personaleMenuActive = PERSONALE_MENU_VIEWS.includes(effectiveView)
  const adminMenuActive = ADMIN_MENU_VIEWS.includes(effectiveView)
  const panoramicaMain =
    PANORAMICA_SUBMENU.find((item) => item.id === effectiveView) || PANORAMICA_SUBMENU[0]
  const personaleMain =
    PERSONALE_SUBMENU.find((item) => item.id === effectiveView) || PERSONALE_SUBMENU[0]

  return (
    <OperatorSatelliteShell
      authMode="carrier"
      documentTitle={`ATLAS — ${headerTitle} (trasportatore)`}
      loginHint=""
      headerTitle="Postazione trasportatore"
      headerSubtitle=""
      nav={[
        {
          id: 'panoramica-menu',
          label: 'Panoramica',
          active: panoramicaMenuActive,
          onClick: () => setDeliveryView(panoramicaMain.id),
          items: PANORAMICA_SUBMENU.map((item) => ({
            id: item.id,
            label: item.label,
            active: effectiveView === item.id,
            onClick: () => setDeliveryView(item.id),
          })),
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
          id: 'personale-menu',
          label: 'Personale',
          active: personaleMenuActive,
          onClick: () => setDeliveryView(personaleMain.id),
          items: PERSONALE_SUBMENU.map((item) => ({
            id: item.id,
            label: item.label,
            active: effectiveView === item.id,
            onClick: () => setDeliveryView(item.id),
          })),
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
