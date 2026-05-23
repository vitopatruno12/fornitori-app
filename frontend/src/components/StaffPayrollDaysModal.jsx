import React, { useEffect } from 'react'

function fmtTime(t) {
  if (!t) return '—'
  const s = String(t).slice(0, 8)
  const [h, min] = s.split(':')
  if (h == null) return ''
  return `${parseInt(h, 10)}:${(min || '00').padStart(2, '0')}`
}

function formatHoursIt(h) {
  if (!h || !Number.isFinite(h) || h <= 0) return '—'
  return `${h.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} h`
}

function formatWorkDateIt(ymd) {
  const d = new Date(`${ymd}T12:00:00`)
  if (Number.isNaN(d.getTime())) return ymd
  return d.toLocaleDateString('it-IT', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * @param {{
 *   open: boolean,
 *   memberName: string,
 *   periodFrom: string,
 *   periodTo: string,
 *   days: Array<{ workDate: string, hours: number, entries: Array<{ timeStart: string, timeEnd: string, hours: number, notes: string }> }>,
 *   totalHours: number,
 *   giorniLavorati: number,
 *   onClose: () => void,
 * }} props
 */
export default function StaffPayrollDaysModal({
  open,
  memberName,
  periodFrom,
  periodTo,
  days,
  totalHours,
  giorniLavorati,
  onClose,
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="staff-report-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Giorni lavorati"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="staff-report-modal card" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <h2 className="page-subheader" style={{ marginTop: 0 }}>
          Giorni lavorati
        </h2>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginTop: '-0.25rem' }}>
          <strong>{memberName}</strong>
          <br />
          Periodo: <strong>{periodFrom}</strong> → <strong>{periodTo}</strong>
          <br />
          Dati dai turni registrati in pianificazione (come nel report PDF).
        </p>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '1rem',
            marginBottom: '0.85rem',
            fontSize: '0.9rem',
          }}
        >
          <span>
            <strong>{giorniLavorati}</strong> {giorniLavorati === 1 ? 'giorno' : 'giorni'} con turno
          </span>
          <span>
            Totale ore: <strong>{formatHoursIt(totalHours)}</strong>
          </span>
        </div>

        {days.length === 0 ? (
          <p className="empty-state" style={{ margin: '0.5rem 0 1rem' }}>
            Nessun turno nel periodo selezionato.
          </p>
        ) : (
          <div className="table-wrap" style={{ maxHeight: '50vh', overflow: 'auto' }}>
            <table className="app-table app-table--compact">
              <thead>
                <tr>
                  <th>Giorno</th>
                  <th>Orario</th>
                  <th className="text-end">Ore</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {days.map((day) =>
                  day.entries.map((entry, idx) => (
                    <tr key={`${day.workDate}-${idx}`}>
                      <td style={{ fontWeight: idx === 0 ? 600 : 400, whiteSpace: 'nowrap' }}>
                        {idx === 0 ? formatWorkDateIt(day.workDate) : ''}
                      </td>
                      <td>
                        {fmtTime(entry.timeStart)} – {fmtTime(entry.timeEnd)}
                      </td>
                      <td className="text-end">{formatHoursIt(entry.hours)}</td>
                      <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        {entry.notes || '—'}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} className="text-end" style={{ fontWeight: 600 }}>
                    Totale periodo
                  </td>
                  <td className="text-end" style={{ fontWeight: 700 }}>
                    {formatHoursIt(totalHours)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div style={{ marginTop: '1rem' }}>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
            Chiudi
          </button>
        </div>
      </div>
    </div>
  )
}
