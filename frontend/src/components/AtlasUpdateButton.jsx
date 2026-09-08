import React from 'react'
import { usePwaUpdate } from '../pwa/PwaUpdateContext.jsx'

/**
 * Controlla e installa aggiornamenti PWA.
 * Badge rosso con contatore (1, 2, 3…) per i deploy non ancora installati.
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
  const label = applying ? 'Aggiornamento…' : checking ? 'Controllo…' : 'Aggiornamento'
  const showUpdateBadge = pendingCount > 0 && !applying && !checking

  const title = showUpdateBadge
    ? pendingCount === 1
      ? 'Nuova versione pronta: clicca per installare l’aggiornamento'
      : `${pendingCount} aggiornamenti pronti: clicca per installarli`
    : 'Controlla se è disponibile un aggiornamento dell’app'

  const ariaLabel = showUpdateBadge
    ? pendingCount === 1
      ? 'Installa aggiornamento'
      : `Installa ${pendingCount} aggiornamenti`
    : label

  const badgeAria =
    pendingCount === 1 ? '1 aggiornamento disponibile' : `${pendingCount} aggiornamenti disponibili`

  if (iconOnly) {
    return (
      <button
        type="button"
        className={`atlas-update-btn atlas-update-btn--fab${showUpdateBadge ? ' has-update' : ''} ${className}`.trim()}
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
      className={`atlas-update-btn${showUpdateBadge ? ' has-update' : ''}${navStyle ? ' atlas-update-btn--nav' : ''} ${className}`.trim()}
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
