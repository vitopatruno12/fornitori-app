import React from 'react'
import { usePwaUpdate } from '../pwa/PwaUpdateContext.jsx'

/**
 * Controlla e installa aggiornamenti PWA.
 * Se ci sono più deploy in coda, un solo click installa il pacchetto cumulativo (tutti).
 */
export default function AtlasUpdateButton({ className = '', navStyle = false, iconOnly = false, onDone }) {
  const { updateReady, updateCount, checking, applying, checkForUpdate, applyUpdate } = usePwaUpdate()

  async function handleClick() {
    if (applying || checking) return
    try {
      if (updateReady) {
        await applyUpdate()
      } else {
        await checkForUpdate()
      }
    } finally {
      onDone?.()
    }
  }

  const pendingCount = updateReady ? Math.max(1, Number(updateCount) || 1) : 0
  const packageMode = pendingCount > 1
  const label = applying
    ? packageMode
      ? 'Installazione pacchetto…'
      : 'Aggiornamento…'
    : checking
      ? 'Controllo…'
      : packageMode
        ? `Installa pacchetto (${pendingCount})`
        : 'Aggiornamento'
  const showUpdateBadge = pendingCount > 0 && !applying && !checking

  const title = showUpdateBadge
    ? packageMode
      ? `${pendingCount} aggiornamenti in coda: un click installa il pacchetto completo`
      : 'Nuova versione pronta: clicca per installare l’aggiornamento'
    : 'Controlla se è disponibile un aggiornamento dell’app'

  const ariaLabel = showUpdateBadge
    ? packageMode
      ? `Installa pacchetto con ${pendingCount} aggiornamenti`
      : 'Installa aggiornamento'
    : label

  const badgeAria = packageMode
    ? `Pacchetto con ${pendingCount} aggiornamenti`
    : pendingCount === 1
      ? '1 aggiornamento disponibile'
      : `${pendingCount} aggiornamenti disponibili`

  if (iconOnly) {
    return (
      <button
        type="button"
        className={`atlas-update-btn atlas-update-btn--fab${showUpdateBadge ? ' has-update' : ''}${packageMode ? ' atlas-update-btn--package' : ''} ${className}`.trim()}
        onClick={() => void handleClick()}
        disabled={applying || checking}
        title={title}
        aria-label={ariaLabel}
        aria-live="polite"
      >
        <span className="atlas-update-btn-icon" aria-hidden>
          ↻
        </span>
        {showUpdateBadge ? (
          <span className="atlas-update-badge" aria-label={badgeAria}>
            {pendingCount}
          </span>
        ) : null}
      </button>
    )
  }

  return (
    <button
      type="button"
      className={`atlas-update-btn${showUpdateBadge ? ' has-update' : ''}${packageMode ? ' atlas-update-btn--package' : ''}${navStyle ? ' atlas-update-btn--nav' : ''} ${className}`.trim()}
      onClick={() => void handleClick()}
      disabled={applying || checking}
      title={title}
      aria-label={ariaLabel}
      aria-live="polite"
    >
      <span className="atlas-update-btn-label">{label}</span>
      {showUpdateBadge ? (
        <span className="atlas-update-badge" aria-label={badgeAria}>
          {pendingCount}
        </span>
      ) : null}
    </button>
  )
}
