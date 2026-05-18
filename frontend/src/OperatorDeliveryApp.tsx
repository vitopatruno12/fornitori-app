import React from 'react'
import OperatorSatelliteShell from './components/OperatorSatelliteShell.tsx'
import NewDeliveryPage from './pages/NewDeliveryPage.jsx'
import DeliveriesHistoryPage from './pages/DeliveriesHistoryPage.jsx'
import {
  getOperatorDeliveryView,
  syncOperatorDeliveryViewInUrl,
  type OperatorDeliveryView,
} from './utils/operatorMode.ts'

export default function OperatorDeliveryApp() {
  const [view, setView] = React.useState<OperatorDeliveryView>(() => getOperatorDeliveryView())

  const setDeliveryView = React.useCallback((next: OperatorDeliveryView) => {
    setView(next)
    syncOperatorDeliveryViewInUrl(next)
  }, [])

  const headerTitle = view === 'history' ? 'Storico consegne' : 'Nuova consegna'

  return (
    <OperatorSatelliteShell
      documentTitle={`ATLAS — ${headerTitle} (operatore)`}
      loginHint="Accesso operatore — nuova consegna e storico"
      headerTitle={headerTitle}
      nav={[
        {
          id: 'new-delivery',
          label: 'Nuova consegna',
          active: view === 'new-delivery',
          onClick: () => setDeliveryView('new-delivery'),
        },
        {
          id: 'history',
          label: 'Storico consegne',
          active: view === 'history',
          onClick: () => setDeliveryView('history'),
        },
      ]}
    >
      {view === 'new-delivery' ? <NewDeliveryPage operatorMode /> : <DeliveriesHistoryPage operatorMode />}
    </OperatorSatelliteShell>
  )
}
