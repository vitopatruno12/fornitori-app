import React from 'react'
import { useOffline } from '../offline/OfflineContext'

export default function OfflineBanner() {
  const { online, queueCount, syncing, syncNow } = useOffline()

  if (online && queueCount === 0 && !syncing) return null

  return (
    <div
      className={`atlas-offline-banner${online ? ' atlas-offline-banner--sync' : ''}`}
      role="status"
      aria-live="polite"
    >
      {!online ? (
        <>
          <strong>Modalità offline</strong>
          <span>
            Puoi continuare a lavorare: ordini, Prima Nota e Personale vengono salvati sul dispositivo.
            {queueCount > 0 ? ` ${queueCount} in attesa di sync.` : ''}
          </span>
          <span className="atlas-offline-banner-note">
            Panoramica mostra l&apos;ultimo snapshot salvato su questo dispositivo. Gemini, AI vocale e upload file sono in pausa.
          </span>
        </>
      ) : syncing || queueCount > 0 ? (
        <>
          <strong>{syncing ? 'Sincronizzazione…' : 'In attesa di sync'}</strong>
          <span>
            {queueCount > 0
              ? `${queueCount} operazion${queueCount === 1 ? 'e' : 'i'} da inviare al server.`
              : 'Aggiornamento dati sul server…'}
          </span>
          {!syncing && queueCount > 0 ? (
            <button type="button" className="btn btn-sm btn-outline-light" onClick={() => void syncNow()}>
              Sincronizza ora
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
