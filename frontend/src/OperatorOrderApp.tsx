import OperatorSatelliteShell from './components/OperatorSatelliteShell.tsx'
import NewOrderPage from './pages/NewOrderPage.jsx'

export default function OperatorOrderApp() {
  return (
    <OperatorSatelliteShell
      documentTitle="ATLAS — Ordini operatore"
      loginHint="Accesso operatore — solo inserimento ordini"
      headerTitle="Nuovo ordine"
    >
      <NewOrderPage operatorMode />
    </OperatorSatelliteShell>
  )
}
