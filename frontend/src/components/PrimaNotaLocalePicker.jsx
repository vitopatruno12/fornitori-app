import React, { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_PRIMA_NOTA_LOCALES,
  listCustomPrimaNotaLocales,
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
  onVerifyAndSelectLocale,
  onSaveLocaleAccessCode,
  onDeleteCustomLocale,
  protectedSlugs = [],
  unlockBusy = false,
  saveCodeBusy = false,
  deleteBusy = false,
}) {
  const [open, setOpen] = useState(false)
  const [newLocaleName, setNewLocaleName] = useState('')
  const [pendingLocaleId, setPendingLocaleId] = useState('')
  const [pendingCode, setPendingCode] = useState('')
  const [codePromptError, setCodePromptError] = useState('')
  const rootRef = useRef(null)

  const currentLabel = localeLabel(activeActivity, locales)
  const activeRequiresCode = protectedSlugs.includes(activeActivity)
  const customLocales = listCustomPrimaNotaLocales(locales)

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

  function requiresCodeBeforeOpen(id) {
    return operatorMode && protectedSlugs.includes(id)
  }

  function handlePick(id) {
    if (id === activeActivity) return
    if (requiresCodeBeforeOpen(id)) {
      setPendingLocaleId(id)
      setPendingCode('')
      setCodePromptError('')
      return
    }
    onSelect(id)
    setOpen(false)
  }

  function cancelCodePrompt() {
    setPendingLocaleId('')
    setPendingCode('')
    setCodePromptError('')
  }

  async function confirmCodePrompt(e) {
    e?.preventDefault?.()
    if (!pendingLocaleId) return
    const code = normalizeLocaleAccessCode(pendingCode)
    if (!isValidLocaleAccessCode(code)) {
      setCodePromptError('Inserisci il codice a 6 cifre del locale.')
      return
    }
    setCodePromptError('')
    const ok = await onVerifyAndSelectLocale?.(pendingLocaleId, code)
    if (!ok) {
      setCodePromptError('Codice errato: non puoi aprire questo locale.')
      return
    }
    setPendingLocaleId('')
    setPendingCode('')
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

  async function handleDeleteLocale(loc) {
    if (!loc || loc.builtin) return
    const ok = await onDeleteCustomLocale?.(loc)
    if (ok) setOpen(false)
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
            className={`prima-nota-locale-btn${activeActivity === loc.id ? ' is-active' : ''}${protectedSlugs.includes(loc.id) ? ' is-protected' : ''}`}
            onClick={() => handlePick(loc.id)}
            role="option"
            aria-selected={activeActivity === loc.id}
            title={
              protectedSlugs.includes(loc.id) && operatorMode
                ? 'Locale protetto: verrà richiesto il codice'
                : undefined
            }
          >
            {loc.label}
            {!loc.builtin && <span className="prima-nota-locale-custom-tag">personalizzato</span>}
            {protectedSlugs.includes(loc.id) ? (
              <span className="prima-nota-locale-custom-tag">codice</span>
            ) : null}
          </button>
        ))}
        {!operatorMode ? (
          <button
            type="button"
            className={`prima-nota-locale-btn prima-nota-locale-btn-manage${open ? ' is-open' : ''}`}
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="prima-nota-locale-manage-panel"
          >
            {open ? 'Chiudi gestione' : '+ Altro locale'}
          </button>
        ) : null}
      </div>

      {pendingLocaleId ? (
        <form className="prima-nota-locale-code-prompt" onSubmit={(e) => void confirmCodePrompt(e)}>
          <p className="prima-nota-locale-panel-hint">
            Apri <strong>{localeLabel(pendingLocaleId, locales)}</strong>: inserisci il codice a 6 cifre.
          </p>
          <div className="prima-nota-locale-add-row">
            <input
              type="text"
              className="form-control"
              value={pendingCode}
              onChange={(ev) => setPendingCode(ev.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              autoFocus
              aria-label="Codice locale"
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={unlockBusy}>
              {unlockBusy ? 'Verifica…' : 'Apri locale'}
            </button>
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={cancelCodePrompt} disabled={unlockBusy}>
              Annulla
            </button>
          </div>
          {codePromptError ? <p className="prima-nota-locale-code-error">{codePromptError}</p> : null}
        </form>
      ) : null}

      {open && !operatorMode ? (
        <div id="prima-nota-locale-manage-panel" className="prima-nota-locale-panel">
          <p className="prima-nota-locale-panel-hint">
            Aggiungi un locale personalizzato, imposta il codice di accesso per gli operatori o elimina un locale creato per errore.
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

          {customLocales.length > 0 ? (
            <div className="prima-nota-locale-delete-list">
              <label>Locali personalizzati</label>
              <ul className="prima-nota-locale-delete-items">
                {customLocales.map((loc) => (
                  <li key={loc.id} className="prima-nota-locale-delete-item">
                    <span>{loc.label}</span>
                    <button
                      type="button"
                      className="btn btn-outline-danger btn-sm"
                      disabled={deleteBusy}
                      onClick={() => void handleDeleteLocale(loc)}
                    >
                      Elimina
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

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
        </div>
      ) : null}
    </div>
  )
}
