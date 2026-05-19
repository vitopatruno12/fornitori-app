import OperatorSatelliteShell from './components/OperatorSatelliteShell.tsx'
import PrimaNotaPage from './pages/PrimaNotaPage.jsx'

export default function OperatorPrimaNotaApp() {
  return (
    <OperatorSatelliteShell
      documentTitle="ATLAS — Prima Nota (operatore)"
      loginHint="Accesso operatore — registrazione cassa per locale"
      headerTitle="Prima Nota di cassa"
    >
      <PrimaNotaPage operatorMode />
    </OperatorSatelliteShell>
  )
}
