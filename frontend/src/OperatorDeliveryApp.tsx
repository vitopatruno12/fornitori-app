import React from 'react'
import OperatorSatelliteShell from './components/OperatorSatelliteShell.tsx'
import HomePage from './pages/HomePage.jsx'
import SuppliersPage from './pages/SuppliersPage.jsx'
import NewDeliveryPage from './pages/NewDeliveryPage.jsx'
import DeliveriesHistoryPage from './pages/DeliveriesHistoryPage.jsx'
import MagazzinoPage from './pages/MagazzinoPage.jsx'
import TrasportatoriPage from './pages/TrasportatoriPage.jsx'
import {
  getOperatorDeliveryView,
  syncOperatorDeliveryViewInUrl,
  type OperatorDeliveryView,
} from './utils/operatorMode.ts'

const DELIVERY_SUBMENU: { id: OperatorDeliveryView; label: string }[] = [
  { id: 'trasportatori', label: 'Trasportatori' },
  { id: 'magazzino', label: 'Magazzino' },
]

const DELIVERY_MENU_VIEWS: OperatorDeliveryView[] = ['new-delivery', 'magazzino', 'trasportatori']

const TITLES: Record<OperatorDeliveryView, string> = {
  overview: 'Panoramica',
  suppliers: 'Fornitori',
  'new-delivery': 'Nuova consegna',
  history: 'Storico consegne',
  magazzino: 'Magazzino',
  trasportatori: 'Trasportatori',
}

export default function OperatorDeliveryApp() {
  const [view, setView] = React.useState<OperatorDeliveryView>(() => getOperatorDeliveryView())

  const setDeliveryView = React.useCallback((next: OperatorDeliveryView) => {
    setView(next)
    syncOperatorDeliveryViewInUrl(next)
  }, [])

  /** Home panoramica può chiedere sezioni della postazione piena: mappiamo alle voci disponibili qui. */
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
      setDeliveryView('overview')
    },
    [setDeliveryView],
  )

  const headerTitle = TITLES[view] || 'Postazione trasportatore'
  const deliveryMenuActive = DELIVERY_MENU_VIEWS.includes(view)

  let content: React.ReactNode
  if (view === 'overview') {
    content = <HomePage operatorMode onOperatorNavigate={onOperatorNavigate} />
  } else if (view === 'suppliers') {
    content = <SuppliersPage />
  } else if (view === 'magazzino') {
    content = <MagazzinoPage operatorMode onBackToDelivery={() => setDeliveryView('new-delivery')} />
  } else if (view === 'trasportatori') {
    content = <TrasportatoriPage operatorMode />
  } else if (view === 'new-delivery') {
    content = <NewDeliveryPage operatorMode />
  } else {
    content = <DeliveriesHistoryPage operatorMode />
  }

  return (
    <OperatorSatelliteShell
      documentTitle={`ATLAS — ${headerTitle} (trasportatore)`}
      loginHint="Accesso postazione trasportatore — panoramica, fornitori, nuova consegna e storico"
      headerTitle="Postazione trasportatore"
      headerSubtitle=""
      nav={[
        {
          id: 'overview',
          label: 'Panoramica',
          active: view === 'overview',
          onClick: () => setDeliveryView('overview'),
        },
        {
          id: 'suppliers',
          label: 'Fornitori',
          active: view === 'suppliers',
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
            active: view === item.id,
            onClick: () => setDeliveryView(item.id),
          })),
        },
        {
          id: 'history',
          label: 'Storico consegne',
          active: view === 'history',
          onClick: () => setDeliveryView('history'),
        },
      ]}
    >
      {content}
    </OperatorSatelliteShell>
  )
}
