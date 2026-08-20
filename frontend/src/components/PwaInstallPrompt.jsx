import React, { useEffect, useState } from 'react'
import { isOperatorStationMode, markOperatorStationEntryPoint } from '../utils/operatorMode.ts'
import { applyContextPwaManifest, markOperatorPwaLaunchPreferred } from '../utils/pwaManifest.ts'

/**
 * Suggerisce l'installazione PWA (schermata Home / app desktop) per usare ATLAS offline.
 */
export default function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [dismissed, setDismissed] = useState(false)
  const [installed, setInstalled] = useState(false)
  const operatorStation = isOperatorStationMode()

  useEffect(() => {
    if (operatorStation) {
      applyContextPwaManifest()
      markOperatorPwaLaunchPreferred()
    }
  }, [operatorStation])

  useEffect(() => {
    try {
      if (window.matchMedia('(display-mode: standalone)').matches) {
        setInstalled(true)
        return undefined
      }
      if (sessionStorage.getItem('atlasPwaInstallDismissed') === '1') {
        setDismissed(true)
      }
    } catch {
      // ignore
    }

    const onBeforeInstall = (e) => {
      e.preventDefault()
      if (isOperatorStationMode()) {
        applyContextPwaManifest()
        markOperatorPwaLaunchPreferred()
      }
      setDeferredPrompt(e)
    }
    const onInstalled = () => {
      setInstalled(true)
      setDeferredPrompt(null)
      if (isOperatorStationMode()) {
        markOperatorStationEntryPoint()
        markOperatorPwaLaunchPreferred()
      }
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (installed || dismissed || !deferredPrompt) return null

  async function handleInstall() {
    if (!deferredPrompt) return
    try {
      if (isOperatorStationMode()) {
        applyContextPwaManifest()
        markOperatorPwaLaunchPreferred()
      }
      await deferredPrompt.prompt()
      await deferredPrompt.userChoice
    } catch {
      // ignore
    } finally {
      setDeferredPrompt(null)
    }
  }

  function handleDismiss() {
    setDismissed(true)
    try {
      sessionStorage.setItem('atlasPwaInstallDismissed', '1')
    } catch {
      // ignore
    }
  }

  return (
    <div className="atlas-pwa-install" role="region" aria-label="Installa ATLAS">
      <div className="atlas-pwa-install-text">
        <strong>{operatorStation ? 'Installa postazione operativa' : 'Installa ATLAS'}</strong>
        <span>
          {operatorStation
            ? 'Aggiungi a Home: all’apertura userà le credenziali operatore (non quelle del gestionale grande).'
            : 'Per aprire l’app anche senza internet: aggiungi a schermata Home o «Installa app».'}
        </span>
      </div>
      <div className="atlas-pwa-install-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleInstall()}>
          Installa
        </button>
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={handleDismiss}>
          Più tardi
        </button>
      </div>
    </div>
  )
}
