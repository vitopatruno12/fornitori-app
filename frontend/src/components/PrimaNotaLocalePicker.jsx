import React, { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_PRIMA_NOTA_LOCALES,
  loadPrimaNotaLocales,
  localeLabel,
  persistCustomLocales,
  slugifyLocaleLabel,
} from '../constants/primaNotaLocales'

export default function PrimaNotaLocalePicker({
  locales,
  activeActivity,
  onSelect,
  onLocalesChange,
  onNotify,
}) {
  const [open, setOpen] = useState(false)
  const [newLocaleName, setNewLocaleName] = useState('')
  const rootRef = useRef(null)

  const currentLabel = localeLabel(activeActivity, locales)

  useEffect(() => {
    if (!open) return undefined
    function onDocClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  function handlePick(id) {
    onSelect(id)
    setOpen(false)
  }

  function handleReload() {
    const fresh = loadPrimaNotaLocales()
    onLocalesChange(fresh)
    onNotify?.('Elenco locali ricaricato')
  }

  function handleAddLocale(e) {
    e.preventDefault()
    const label = newLocaleName.trim()
    if (!label) {
      onNotify?.('Inserisci il nome del locale')
      return
    }
    const id = slugifyLocaleLabel(label)
    if (DEFAULT_PRIMA_NOTA_LOCALES.some((l) => l.id === id) || locales.some((l) => l.id === id)) {
      onNotify?.('Questo locale esiste già: selezionalo dall’elenco')
      handlePick(id)
      setNewLocaleName('')
      return
    }
    const next = [...locales, { id, label, builtin: false }]
    persistCustomLocales(next)
    onLocalesChange(next)
    onSelect(id)
    setNewLocaleName('')
    setOpen(false)
    onNotify?.(`Locale «${label}» salvato`)
  }

  return (
    <div ref={rootRef} className="prima-nota-locale-picker card">
      <button
        type="button"
        className="prima-nota-locale-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Locali prima nota, attivo: ${currentLabel}`}
      >
        <span className="prima-nota-locale-trigger-title">Locali prima nota</span>
        <span className="prima-nota-locale-trigger-caret" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="prima-nota-locale-panel" role="listbox" aria-label="Seleziona locale">
          <p className="prima-nota-locale-panel-hint">Scegli il locale su cui registrare la prima nota.</p>
          <ul className="prima-nota-locale-list">
            {locales.map((loc) => (
              <li key={loc.id}>
                <button
                  type="button"
                  className={`prima-nota-locale-item${activeActivity === loc.id ? ' is-active' : ''}`}
                  onClick={() => handlePick(loc.id)}
                  role="option"
                  aria-selected={activeActivity === loc.id}
                >
                  {loc.label}
                  {!loc.builtin && <span className="prima-nota-locale-custom-tag">personalizzato</span>}
                </button>
              </li>
            ))}
          </ul>

          <form className="prima-nota-locale-add" onSubmit={handleAddLocale}>
            <label htmlFor="prima-nota-new-locale">Aggiungi locale</label>
            <div className="prima-nota-locale-add-row">
              <input
                id="prima-nota-new-locale"
                type="text"
                className="form-control"
                value={newLocaleName}
                onChange={(ev) => setNewLocaleName(ev.target.value)}
                placeholder="Es. Deposito, Sede estiva…"
                maxLength={80}
              />
              <button type="submit" className="btn btn-primary btn-sm">
                Salva
              </button>
            </div>
          </form>

          <div className="prima-nota-locale-panel-actions">
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={handleReload}>
              Ricarica elenco
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
