import React from 'react'
import { usePwaUpdate } from '../pwa/PwaUpdateContext.jsx'

/**
 * Controlla e installa aggiornamenti PWA. Badge rosso quando una nuova versione è pronta.
 */
export default function AtlasUpdateButton({ className = '', navStyle = false, iconOnly = false }) {
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

  const title = updateReady
    ? 'Nuova versione pronta: clicca per aggiornare ATLAS'
    : 'Controlla se è disponibile un aggiornamento dell’app'

  if (iconOnly) {
    return (
      <button
        type="button"
        className={`atlas-update-btn atlas-update-btn--fab${updateReady ? ' has-update' : ''} ${className}`.trim()}
        onClick={() => void handleClick()}
        disabled={applying || checking}
        title={title}
        aria-label={label}
        aria-live="polite"
      >
        <span className="atlas-update-btn-icon" aria-hidden>
          ↻
        </span>
        {updateReady ? (
          <span className="atlas-update-badge" aria-label="Aggiornamento disponibile">
            1
          </span>
        ) : null}
      </button>
    )
  }

  return (
    <button
      type="button"
      className={`atlas-update-btn${updateReady ? ' has-update' : ''}${navStyle ? ' atlas-update-btn--nav' : ''} ${className}`.trim()}
      onClick={() => void handleClick()}
      disabled={applying || checking}
      title={title}
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
