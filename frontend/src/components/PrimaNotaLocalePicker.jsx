import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_PRIMA_NOTA_LOCALES,
  listCustomPrimaNotaLocales,
  loadPrimaNotaLocales,
  localeLabel,
  persistCustomLocales,
  restoreHiddenLocaleById,
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
  onCloseLocaleAccess,
  localeRegisterOpen = false,
  onSaveLocaleAccessCode,
  onDeleteCustomLocale,
  protectedSlugs = [],
  unlockedSlugs = [],
  staffLocaleHintFor,
  activeUsesStaffCode = false,
  activeStaffLocaleHint = '',
  unlockBusy = false,
  saveCodeBusy = false,
  deleteBusy = false,
  autoPromptLocaleId = '',
}) {
  const [open, setOpen] = useState(false)
  const [newLocaleName, setNewLocaleName] = useState('')
  const [pendingLocaleId, setPendingLocaleId] = useState('')
  const [pendingCode, setPendingCode] = useState('')
  const [codePromptError, setCodePromptError] = useState('')
  const rootRef = useRef(null)

  const currentLabel = localeLabel(activeActivity, locales)
  const protectedSet = useMemo(
    () => new Set((protectedSlugs || []).map((s) => String(s || '').trim().toLowerCase()).filter(Boolean)),
    [protectedSlugs],
  )
  const unlockedSet = useMemo(
    () => new Set((unlockedSlugs || []).map((s) => String(s || '').trim().toLowerCase()).filter(Boolean)),
    [unlockedSlugs],
  )
  const activeId = String(activeActivity || '').trim().toLowerCase()
  const activeRequiresCode = protectedSet.has(activeId)
  const customLocales = listCustomPrimaNotaLocales(locales)

  function isProtectedLocale(id) {
    return protectedSet.has(String(id || '').trim().toLowerCase())
  }

  function isUnlockedLocale(id) {
    return unlockedSet.has(String(id || '').trim().toLowerCase())
  }

  function isActiveLocale(id) {
    return activeId === String(id || '').trim().toLowerCase()
  }

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
    return isProtectedLocale(id) && !isUnlockedLocale(id)
  }

  useEffect(() => {
    const id = String(autoPromptLocaleId || '').trim()
    if (!id || !requiresCodeBeforeOpen(id)) return
    setPendingLocaleId(id)
    setPendingCode('')
    setCodePromptError('')
  }, [autoPromptLocaleId, protectedSlugs, unlockedSlugs])

  function handlePick(id) {
    // Seleziona subito (verde), poi chiedi il codice se il registro è ancora chiuso.
    if (!isActiveLocale(id)) onSelect(id)
    if (requiresCodeBeforeOpen(id)) {
      setPendingLocaleId(id)
      setPendingCode('')
      setCodePromptError('')
      return
    }
    setPendingLocaleId('')
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
    onNotify?.('Elenco registri ricaricato')
  }

  function handleGenerateCode() {
    const current = normalizeLocaleAccessCode(localeAccessCode)
    const alreadyHasCode = isValidLocaleAccessCode(current) || isProtectedLocale(activeActivity)
    if (alreadyHasCode) {
      const ok = window.confirm(
        `Per il registro «${currentLabel}» esiste già un codice.\n\nSei sicuro di voler cambiare codice?`,
      )
      if (!ok) return
    }
    onLocaleAccessCodeChange?.(generateLocaleAccessCode())
  }

  function handleAddLocale(e) {
    e.preventDefault()
    const label = newLocaleName.trim()
    if (!label) {
      onNotify?.('Inserisci il nome del registro')
      return
    }
    const id = slugifyLocaleLabel(label)
    if (locales.some((l) => l.id === id)) {
      onNotify?.('Questo registro esiste già: selezionalo dall’elenco')
      handlePick(id)
      setNewLocaleName('')
      return
    }
    const hiddenBuiltin = DEFAULT_PRIMA_NOTA_LOCALES.find((l) => l.id === id)
    if (hiddenBuiltin) {
      const next = restoreHiddenLocaleById(id)
      onLocalesChange(next)
      onSelect(id)
      setNewLocaleName('')
      setOpen(false)
      onNotify?.(`Registro «${hiddenBuiltin.label}» ripristinato`)
      return
    }
    const next = [...locales, { id, label, builtin: false }]
    persistCustomLocales(next)
    onLocalesChange(next)
    onSelect(id)
    setNewLocaleName('')
    setOpen(false)
    onNotify?.(`Registro «${label}» salvato`)
  }

  async function handleDeleteLocale(loc) {
    if (!loc?.id) {
      onNotify?.('Seleziona un registro da eliminare.')
      return
    }
    const ok = await onDeleteCustomLocale?.(loc)
    if (ok) setOpen(false)
  }

  async function handleDeleteActiveRegister() {
    const active = locales.find((loc) => isActiveLocale(loc.id))
    if (!active) {
      onNotify?.('Seleziona un registro da eliminare.')
      return
    }
    await handleDeleteLocale(active)
  }

  const canDeleteActiveRegister = Boolean(locales.find((loc) => isActiveLocale(loc.id)))

  return (
    <div ref={rootRef} className="prima-nota-locale-picker card">
      <div className="prima-nota-locale-header">
        <span className="prima-nota-locale-trigger-title">Registri prima nota</span>
        <span className="prima-nota-locale-active-label">
          Registro attivo: <strong>{currentLabel}</strong>
          {activeRequiresCode ? <span className="prima-nota-locale-custom-tag"> protetto</span> : null}
        </span>
      </div>

      <div className="prima-nota-locale-buttons" role="listbox" aria-label="Seleziona registro">
        {locales.map((loc) => {
          const active = isActiveLocale(loc.id)
          const protectedLocale = isProtectedLocale(loc.id)
          const locked = protectedLocale && !isUnlockedLocale(loc.id)
          const pending = String(pendingLocaleId || '').trim().toLowerCase() === String(loc.id || '').trim().toLowerCase()
          // Risacca: contorno unito come i registri normali (niente tratteggio).
          const solidOutline = String(loc.id || '').trim().toLowerCase() === 'risacca'
          const showProtectedStyle = protectedLocale && !solidOutline
          return (
          <button
            key={loc.id}
            type="button"
            className={[
              'prima-nota-locale-btn',
              active ? 'is-active' : '',
              showProtectedStyle ? 'is-protected' : '',
              showProtectedStyle && locked ? 'is-locked' : '',
              pending && !solidOutline ? 'is-pending' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => handlePick(loc.id)}
            role="option"
            aria-selected={active}
            title={
              protectedLocale
                ? locked
                  ? 'Registro protetto: inserisci il codice a 6 cifre per aprire il registro'
                  : 'Registro protetto (registro aperto)'
                : undefined
            }
          >
            {loc.label}
            {!loc.builtin && <span className="prima-nota-locale-custom-tag">personalizzato</span>}
            {protectedLocale && !solidOutline ? (
              <span className="prima-nota-locale-custom-tag">{locked ? 'codice' : 'aperto'}</span>
            ) : null}
          </button>
          )
        })}
        {!operatorMode ? (
          <>
            <button
              type="button"
              className={`prima-nota-locale-btn prima-nota-locale-btn-manage${open ? ' is-open' : ''}`}
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="prima-nota-locale-manage-panel"
            >
              {open ? 'Chiudi' : 'Aggiungi registro'}
            </button>
            <button
              type="button"
              className="prima-nota-locale-btn prima-nota-locale-btn-delete"
              onClick={() => void handleDeleteActiveRegister()}
              disabled={deleteBusy || !canDeleteActiveRegister}
              title={
                canDeleteActiveRegister
                  ? `Elimina il registro selezionato «${currentLabel}»`
                  : 'Seleziona un registro da eliminare'
              }
            >
              {deleteBusy ? 'Elimino…' : 'Elimina registro'}
            </button>
          </>
        ) : null}
      </div>

      {!operatorMode && !pendingLocaleId ? (
        <div className="prima-nota-locale-code-setup">
          <label htmlFor="prima-nota-zone-code">Codice accesso per «{currentLabel}»</label>
          {activeUsesStaffCode && activeStaffLocaleHint ? (
            <p className="prima-nota-locale-panel-hint">
              Se in <strong>Personale</strong> esiste il locale «{activeStaffLocaleHint}» con codice, vale quello.
              Altrimenti genera e salva qui il codice Prima Nota per questo locale.
            </p>
          ) : (
            <p className="prima-nota-locale-panel-hint">
              Genera un codice a 6 cifre e salvalo: chi apre questo locale dovrà inserirlo e cliccare <strong>Accedi</strong> prima di vedere il registro.
            </p>
          )}
          <div className="prima-nota-locale-add-row">
            <input
              id="prima-nota-zone-code"
              type="text"
              className="form-control"
              value={localeAccessCode}
              onChange={(ev) => onLocaleAccessCodeChange?.(ev.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(ev) => {
                if (ev.key !== 'Enter') return
                const code = normalizeLocaleAccessCode(localeAccessCode)
                if (!isValidLocaleAccessCode(code) || unlockBusy) return
                ev.preventDefault()
                void onVerifyAndSelectLocale?.(activeActivity, code)
              }}
              placeholder="123456"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
            />
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={handleGenerateCode}
              title="Genera un nuovo codice a 6 cifre"
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
            <button
              type="button"
              className="btn btn-success btn-sm"
              disabled={unlockBusy || localeRegisterOpen || !isValidLocaleAccessCode(normalizeLocaleAccessCode(localeAccessCode))}
              onClick={() => void onVerifyAndSelectLocale?.(activeActivity, normalizeLocaleAccessCode(localeAccessCode))}
            >
              {unlockBusy ? 'Accesso…' : 'Accedi'}
            </button>
            <button
              type="button"
              className="btn btn-outline-danger btn-sm"
              disabled={!localeRegisterOpen}
              onClick={() => onCloseLocaleAccess?.()}
              title="Chiude il registro di questo locale: servirà di nuovo il codice per Accedi."
            >
              Chiudi
            </button>
          </div>
        </div>
      ) : null}

      {operatorMode && activeRequiresCode && localeRegisterOpen && !pendingLocaleId ? (
        <div className="prima-nota-locale-code-setup">
          <p className="prima-nota-locale-panel-hint" style={{ marginBottom: '0.5rem' }}>
            Registro <strong>{currentLabel}</strong> aperto.
          </p>
          <div className="prima-nota-locale-add-row">
            <button
              type="button"
              className="btn btn-outline-danger btn-sm"
              onClick={() => onCloseLocaleAccess?.()}
            >
              Chiudi registro
            </button>
          </div>
        </div>
      ) : null}

      {pendingLocaleId ? (
        <form className="prima-nota-locale-code-prompt" onSubmit={(e) => void confirmCodePrompt(e)}>
          <p className="prima-nota-locale-panel-hint">
            Per aprire il registro di <strong>{localeLabel(pendingLocaleId, locales)}</strong>
            {staffLocaleHintFor?.(pendingLocaleId) ? (
              <>
                {' '}
                inserisci il codice del locale <strong>Personale «{staffLocaleHintFor(pendingLocaleId)}»</strong> o il
                codice Prima Nota salvato per questo locale.
              </>
            ) : (
              ' inserisci il codice a 6 cifre.'
            )}
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
            <button type="submit" className="btn btn-success btn-sm" disabled={unlockBusy}>
              {unlockBusy ? 'Accesso…' : 'Accedi'}
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
            Aggiungi un registro. Per eliminarne uno esistente (anche predefinito), selezionalo nell’elenco e usa{' '}
            <strong>Elimina registro</strong>.
          </p>

          <form className="prima-nota-locale-add" onSubmit={handleAddLocale}>
            <label htmlFor="prima-nota-new-locale">Nome nuovo registro</label>
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
              <label>Registri personalizzati</label>
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
