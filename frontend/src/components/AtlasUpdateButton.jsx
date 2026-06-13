import React from 'react'
import { usePwaUpdate } from '../pwa/PwaUpdateContext.jsx'

/**
 * Controlla e installa aggiornamenti PWA. Badge rosso quando una nuova versione è pronta.
 */
export default function AtlasUpdateButton({ className = '', navStyle = false }) {
  const { updateReady, checking, applying, checkForUpdate, applyUpdate } = usePwaUpdate()

  async function handleClick() {
    if (applying || checking) return
    if (updateReady) {
      applyUpdate()
      return
    }
    await checkForUpdate()
  }

  const label = applying
    ? 'Aggiornamento…'
    : checking
      ? 'Controllo…'
      : updateReady
        ? 'Installa aggiornamento'
        : 'Aggiornamento'

  return (
    <button
      type="button"
      className={`atlas-update-btn${updateReady ? ' has-update' : ''}${navStyle ? ' atlas-update-btn--nav' : ''} ${className}`.trim()}
      onClick={() => void handleClick()}
      disabled={applying || checking}
      title={
        updateReady
          ? 'Nuova versione pronta: clicca per aggiornare ATLAS'
          : 'Controlla se è disponibile un aggiornamento dell’app'
      }
      aria-live="polite"
    >
      <span className="atlas-update-btn-label">{label}</span>
      {updateReady ? (
        <span className="atlas-update-badge" aria-label="Aggiornamento disponibile">
          1
        </span>
      ) : null}
    </button>
  )
}
