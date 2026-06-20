import React, { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_PRIMA_NOTA_LOCALES,
  loadPrimaNotaLocales,
  localeLabel,
  persistCustomLocales,
  slugifyLocaleLabel,
} from '../constants/primaNotaLocales'
import {
  generateLocaleAccessCode,
  isValidLocaleAccessCode,
  normalizeLocaleAccessCode,
} from '../utils/staffLocaleAccessCode.js'

export default function PrimaNotaLocalePicker({
  locales,
  activeActivity,
  onSelect,
  onLocalesChange,
  onNotify,
  operatorMode = false,
  localeAccessCode = '',
  onLocaleAccessCodeChange,
  onUnlockProtectedLocale,
  onSaveLocaleAccessCode,
  protectedSlugs = [],
  unlockBusy = false,
  saveCodeBusy = false,
}) {
  const [open, setOpen] = useState(false)
  const [newLocaleName, setNewLocaleName] = useState('')
  const [unlockSlug, setUnlockSlug] = useState('')
  const rootRef = useRef(null)

  const currentLabel = localeLabel(activeActivity, locales)
  const activeRequiresCode = protectedSlugs.includes(activeActivity)

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

  async function handleUnlock(e) {
    e.preventDefault()
    if (!unlockSlug) {
      onNotify?.('Seleziona il locale protetto da aprire')
      return
    }
    await onUnlockProtectedLocale?.(unlockSlug, localeAccessCode)
  }

  return (
    <div ref={rootRef} className="prima-nota-locale-picker card">
      <div className="prima-nota-locale-header">
        <span className="prima-nota-locale-trigger-title">Locali prima nota</span>
        <span className="prima-nota-locale-active-label">
          Locale attivo: <strong>{currentLabel}</strong>
          {activeRequiresCode ? <span className="prima-nota-locale-custom-tag"> protetto</span> : null}
        </span>
      </div>

      <div className="prima-nota-locale-buttons" role="listbox" aria-label="Seleziona locale">
        {locales.map((loc) => (
          <button
            key={loc.id}
            type="button"
            className={`prima-nota-locale-btn${activeActivity === loc.id ? ' is-active' : ''}`}
            onClick={() => handlePick(loc.id)}
            role="option"
            aria-selected={activeActivity === loc.id}
          >
            {loc.label}
            {!loc.builtin && <span className="prima-nota-locale-custom-tag">personalizzato</span>}
            {protectedSlugs.includes(loc.id) ? (
              <span className="prima-nota-locale-custom-tag">codice</span>
            ) : null}
          </button>
        ))}
        {operatorMode ? (
          <button
            type="button"
            className={`prima-nota-locale-btn prima-nota-locale-btn-manage${open ? ' is-open' : ''}`}
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="prima-nota-locale-manage-panel"
          >
            {open ? 'Chiudi accesso' : 'Apri locale protetto'}
          </button>
        ) : (
          <button
            type="button"
            className={`prima-nota-locale-btn prima-nota-locale-btn-manage${open ? ' is-open' : ''}`}
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="prima-nota-locale-manage-panel"
          >
            {open ? 'Chiudi gestione' : '+ Altro locale'}
          </button>
        )}
      </div>

      {open && (
        <div id="prima-nota-locale-manage-panel" className="prima-nota-locale-panel">
          {operatorMode ? (
            <>
              <p className="prima-nota-locale-panel-hint">
                I locali protetti non compaiono finché non inserisci il codice a 6 cifre assegnato a quel locale.
              </p>
              <form className="prima-nota-locale-add" onSubmit={(e) => void handleUnlock(e)}>
                <label htmlFor="prima-nota-unlock-locale">Locale protetto</label>
                <div className="prima-nota-locale-add-row">
                  <select
                    id="prima-nota-unlock-locale"
                    className="form-control"
                    value={unlockSlug}
                    onChange={(ev) => setUnlockSlug(ev.target.value)}
                  >
                    <option value="">Seleziona locale…</option>
                    {protectedSlugs
                      .filter((slug) => !locales.some((l) => l.id === slug))
                      .map((slug) => (
                        <option key={slug} value={slug}>
                          {localeLabel(slug, loadPrimaNotaLocales())}
                        </option>
                      ))}
                  </select>
                </div>
                <label htmlFor="prima-nota-unlock-code" style={{ marginTop: '0.5rem' }}>
                  Codice zona (6 cifre)
                </label>
                <div className="prima-nota-locale-add-row">
                  <input
                    id="prima-nota-unlock-code"
                    type="text"
                    className="form-control"
                    value={localeAccessCode}
                    onChange={(ev) => onLocaleAccessCodeChange?.(ev.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={6}
                  />
                  <button type="submit" className="btn btn-primary btn-sm" disabled={unlockBusy}>
                    {unlockBusy ? 'Verifica…' : 'Apri locale'}
                  </button>
                </div>
              </form>
            </>
          ) : (
            <>
              <p className="prima-nota-locale-panel-hint">
                Aggiungi un locale personalizzato, imposta il codice di accesso per gli operatori o ricarica l’elenco.
              </p>

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

              <div className="prima-nota-locale-panel-actions" style={{ marginTop: '0.75rem' }}>
                <label htmlFor="prima-nota-zone-code">Codice zona per «{currentLabel}»</label>
                <div className="prima-nota-locale-add-row">
                  <input
                    id="prima-nota-zone-code"
                    type="text"
                    className="form-control"
                    value={localeAccessCode}
                    onChange={(ev) => onLocaleAccessCodeChange?.(ev.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={6}
                  />
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={() => onLocaleAccessCodeChange?.(generateLocaleAccessCode())}
                  >
                    Genera
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={saveCodeBusy || !isValidLocaleAccessCode(normalizeLocaleAccessCode(localeAccessCode))}
                    onClick={() => void onSaveLocaleAccessCode?.()}
                  >
                    {saveCodeBusy ? 'Salvo…' : 'Salva codice'}
                  </button>
                </div>
                <p className="prima-nota-locale-panel-hint" style={{ marginTop: '0.35rem' }}>
                  Solo chi conosce il codice può aprire questo locale dalla postazione operativa.
                </p>
              </div>

              <div className="prima-nota-locale-panel-actions">
                <button type="button" className="btn btn-outline-secondary btn-sm" onClick={handleReload}>
                  Ricarica elenco
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
