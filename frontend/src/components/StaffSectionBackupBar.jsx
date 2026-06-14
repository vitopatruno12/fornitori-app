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
  const hasSlots = Boolean(slotOptions?.length)

  return (
    <div
      className={`staff-section-backup-bar${hasSlots ? ' staff-section-backup-bar--planning' : ''}`}
      role="group"
      aria-label={`Backup ${sectionTitle}`}
    >
      <div className="staff-section-backup-bar-main">
        <span className="staff-section-backup-title">Backup {sectionTitle}</span>

        {hasSlots ? (
          <label className="staff-section-backup-slot">
            <span className="staff-section-backup-slot-label">Settimana</span>
            <span className="staff-section-backup-slot-field">
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
            </span>
          </label>
        ) : null}

        <span className="staff-section-backup-meta">
          {when ? (
            <>
              <span className="staff-section-backup-meta-label">Backup:</span>{' '}
              <strong className="staff-section-backup-meta-when">{when}</strong>
            </>
          ) : (
            'Nessun backup per questa settimana'
          )}
        </span>
      </div>

      <div className="staff-section-backup-actions">
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          disabled={disabled || busy}
          onClick={() => void onBackup?.()}
          title={`Salva uno snapshot locale di ${sectionTitle} (solo su questo browser)`}
        >
          {busy ? '…' : 'Crea backup'}
        </button>
        <button
          type="button"
          className="btn btn-outline-primary btn-sm"
          disabled={disabled || busy || !when}
          onClick={() => void onRestore?.()}
          title={
            hasSlots
              ? `Ripristina il backup della settimana selezionata (${sectionTitle})`
              : `Ripristina l'ultimo backup di ${sectionTitle}`
          }
        >
          Ripristina
        </button>
      </div>
    </div>
  )
}
