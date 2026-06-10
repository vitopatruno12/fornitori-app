import React from 'react'
import { formatStaffBackupLabel } from '../utils/staffLocalBackup'

/**
 * Backup locale (browser) per una sezione Personale: crea snapshot e ripristino.
 */
export default function StaffSectionBackupBar({
  sectionTitle,
  lastSavedAt,
  onBackup,
  onRestore,
  disabled = false,
  busy = false,
}) {
  const when = formatStaffBackupLabel(lastSavedAt)

  return (
    <div className="staff-section-backup-bar" role="group" aria-label={`Backup ${sectionTitle}`}>
      <span className="staff-section-backup-title">Backup {sectionTitle}</span>
      <span className="staff-section-backup-meta">
        {when ? <>Ultimo: <strong>{when}</strong></> : 'Nessun backup salvato'}
      </span>
      <button
        type="button"
        className="btn btn-outline-secondary btn-sm"
        disabled={disabled || busy}
        onClick={() => void onBackup?.()}
        title={`Salva uno snapshot locale di ${sectionTitle} (max 5, solo su questo browser)`}
      >
        {busy ? '…' : 'Crea backup'}
      </button>
      <button
        type="button"
        className="btn btn-outline-primary btn-sm"
        disabled={disabled || busy || !when}
        onClick={() => void onRestore?.()}
        title={`Ripristina l'ultimo backup di ${sectionTitle}`}
      >
        Ripristina
      </button>
    </div>
  )
}
