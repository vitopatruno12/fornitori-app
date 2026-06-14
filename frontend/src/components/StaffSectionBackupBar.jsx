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
  formatBackupLabel = formatStaffBackupLabel,
  slotOptions = null,
  slotValue = 0,
  onSlotChange,
}) {
  const when = formatBackupLabel(lastSavedAt)

  return (
    <div className="staff-section-backup-bar" role="group" aria-label={`Backup ${sectionTitle}`}>
      <span className="staff-section-backup-title">Backup {sectionTitle}</span>
      {slotOptions?.length ? (
        <label className="staff-section-backup-slot">
          <span className="staff-section-backup-slot-label">Settimana</span>
          <select
            className="form-control staff-section-backup-slot-select"
            value={slotValue}
            disabled={disabled || busy}
            onChange={(e) => onSlotChange?.(Number(e.target.value))}
            aria-label="Seleziona settimana e slot backup"
          >
            {slotOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <span className="staff-section-backup-meta">
        {when ? <>Backup: <strong>{when}</strong></> : 'Nessun backup per questa settimana'}
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
        title={
          slotOptions?.length
            ? `Ripristina il backup della settimana selezionata (${sectionTitle})`
            : `Ripristina l'ultimo backup di ${sectionTitle}`
        }
      >
        Ripristina
      </button>
    </div>
  )
}
