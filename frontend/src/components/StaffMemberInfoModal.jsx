import React, { useEffect, useState } from 'react'

function ageFromBirthDate(isoYmd) {
  if (!isoYmd || typeof isoYmd !== 'string') return null
  const [y, m, d] = isoYmd.split('-').map(Number)
  if (!y || !m || !d) return null
  const birth = new Date(y, m - 1, d)
  const t = new Date()
  let age = t.getFullYear() - birth.getFullYear()
  const md = t.getMonth() - birth.getMonth()
  if (md < 0 || (md === 0 && t.getDate() < birth.getDate())) age -= 1
  return age >= 0 && age < 130 ? age : null
}

/**
 * @param {{ member: object | null, onClose: () => void, onSave: (id: number, payload: object) => Promise<void>, saving?: boolean }} props
 */
export default function StaffMemberInfoModal({ member, onClose, onSave, saving = false }) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [city, setCity] = useState('')
  const [birthDate, setBirthDate] = useState('')

  useEffect(() => {
    if (!member) return
    setFirstName(member.first_name || '')
    setLastName(member.last_name || '')
    setEmail(member.email || '')
    setPhone(member.phone || '')
    setCity(member.city || '')
    setBirthDate(member.birth_date ? String(member.birth_date).slice(0, 10) : '')
  }, [member])

  useEffect(() => {
    if (!member) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [member, onClose])

  if (!member) return null

  const age = ageFromBirthDate(birthDate)

  async function handleSubmit(e) {
    e.preventDefault()
    const fn = firstName.trim()
    const ln = lastName.trim()
    await onSave(member.id, {
      first_name: fn || null,
      last_name: ln || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      city: city.trim() || null,
      birth_date: birthDate.trim() || null,
    })
  }

  return (
    <div
      className="staff-report-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Scheda dipendente"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose()
      }}
    >
      <div className="staff-report-modal card" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <h2 className="page-subheader" style={{ marginTop: 0 }}>
          Anagrafica dipendente
        </h2>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginTop: '-0.25rem' }}>
          Nome usato in pianificazione e report: <strong>{member.name}</strong> (si aggiorna automaticamente da nome e cognome sotto).
        </p>
        <form onSubmit={(e) => void handleSubmit(e)} className="staff-member-info-form">
          <div className="form-group">
            <label>Nome</label>
            <input className="form-control" value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={saving} />
          </div>
          <div className="form-group">
            <label>Cognome</label>
            <input className="form-control" value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={saving} />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input type="email" className="form-control" value={email} onChange={(e) => setEmail(e.target.value)} disabled={saving} />
          </div>
          <div className="form-group">
            <label>Telefono</label>
            <input type="tel" className="form-control" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={saving} />
          </div>
          <div className="form-group">
            <label>Città</label>
            <input className="form-control" value={city} onChange={(e) => setCity(e.target.value)} disabled={saving} />
          </div>
          <div className="form-group">
            <label>Data di nascita</label>
            <input type="date" className="form-control" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} disabled={saving} />
            {age != null && <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Età: {age} anni</span>}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Salvataggio…' : 'Salva'}
            </button>
            <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>
              Chiudi
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
