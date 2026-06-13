import React, { useEffect, useRef, useState } from 'react'
import { useOffline } from '../offline/OfflineContext'
import { OFFLINE_AI_MSG } from '../offline/offlineGuards'

const SpeechRecognition =
  typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)

/**
 * Microfono → testo → callback (Atlas AI / Gemini).
 * Dopo Compila (o fine microfono) il testo si cancella per evitare confusione.
 */
export default function GeminiVoiceAssistant({
  label = 'Comando vocale (Gemini)',
  hint = 'Parla: il testo viene analizzato e compila i campi. Puoi correggere il testo prima di Compila.',
  text = '',
  onTextChange,
  onCompile,
  compiling = false,
  disabled = false,
  compileLabel = 'Compila con Gemini',
  clearLabel = 'Cancella istruzione',
  onClear,
  /** false = meno aggiornamenti in tempo reale, compilazione più rapida dopo il microfono */
  showInterimResults = false,
  /** true = alla fine del microfono avvia subito Compila */
  autoCompileOnMicStop = true,
  /** true = svuota il campo dopo Compila (successo o errore) */
  clearAfterCompile = true,
}) {
  const { online } = useOffline()
  const offlinePaused = !online
  const blocked = disabled || offlinePaused
  const [listening, setListening] = useState(false)
  const [sttError, setSttError] = useState('')
  const recRef = useRef(null)
  const onCompileRef = useRef(onCompile)
  onCompileRef.current = onCompile

  useEffect(() => {
    return () => {
      try {
        recRef.current?.stop?.()
      } catch {
        // ignore
      }
    }
  }, [])

  const clearInstruction = React.useCallback(() => {
    onTextChange?.('')
    onClear?.()
  }, [onTextChange, onClear])

  const runCompile = React.useCallback(
    async (spokenText) => {
      const t = String(spokenText ?? text ?? '').trim()
      if (!t) {
        setSttError('Parla o scrivi un comando prima di Compila')
        return
      }
      if (!onCompileRef.current) return
      setSttError('')
      try {
        const ret = onCompileRef.current(t)
        if (ret && typeof ret.then === 'function') {
          await ret
        }
      } catch (e) {
        setSttError(e?.message || 'Compilazione non riuscita')
      } finally {
        if (clearAfterCompile) {
          clearInstruction()
        }
      }
    },
    [text, clearAfterCompile, clearInstruction],
  )

  function stopListening() {
    try {
      recRef.current?.stop?.()
    } catch {
      // ignore
    }
    recRef.current = null
    setListening(false)
  }

  function startListening() {
    if (!SpeechRecognition) {
      setSttError('Microfono non supportato in questo browser (usa Chrome o Edge).')
      return
    }
    if (listening || compiling || blocked) return
    setSttError('')
    let rec
    try {
      rec = new SpeechRecognition()
    } catch {
      setSttError('Riconoscimento vocale non disponibile')
      return
    }
    rec.lang = 'it-IT'
    rec.continuous = true
    rec.interimResults = Boolean(showInterimResults)
    let finalBuffer = String(text || '').trim()

    rec.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const chunk = event.results[i][0]?.transcript || ''
        if (event.results[i].isFinal) {
          finalBuffer = `${finalBuffer} ${chunk}`.trim()
        } else if (showInterimResults) {
          finalBuffer = `${finalBuffer} ${chunk}`.trim()
        }
      }
      if (showInterimResults || event.results[event.results.length - 1]?.isFinal) {
        onTextChange?.(finalBuffer)
      }
    }

    rec.onerror = () => {
      setSttError('Errore microfono o permesso negato')
      stopListening()
    }

    rec.onend = () => {
      setListening(false)
      recRef.current = null
      const spoken = finalBuffer.trim()
      if (spoken) onTextChange?.(spoken)
      if (spoken && autoCompileOnMicStop) {
        runCompile(spoken)
      }
    }

    recRef.current = rec
    setListening(true)
    rec.start()
  }

  function handleCompileClick() {
    runCompile(text)
  }

  function handleClearClick() {
    if (listening) stopListening()
    setSttError('')
    clearInstruction()
  }

  return (
    <div
      className="gemini-voice-assistant card"
      style={{
        padding: '0.85rem 1rem',
        marginBottom: '1rem',
        background: 'linear-gradient(180deg, #f0fdfa 0%, #fff 100%)',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
        <strong style={{ color: '#0d9488' }}>{label}</strong>
        {!SpeechRecognition && (
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Solo testo (microfono non disponibile)</span>
        )}
      </div>
      {hint ? (
        <p style={{ margin: '0 0 0.65rem', fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
          {hint}
        </p>
      ) : null}
      {offlinePaused ? (
        <p className="alert alert-warning" style={{ margin: '0 0 0.65rem', padding: '0.45rem 0.65rem', fontSize: '0.85rem' }}>
          {OFFLINE_AI_MSG}
        </p>
      ) : null}
      <textarea
        className="form-control"
        rows={2}
        value={text}
        onChange={(e) => onTextChange?.(e.target.value)}
        placeholder='Es. "Bar Roma P.IVA 12345678901 email info@bar.it tel 0801234567" oppure "10 arance 5 kg pasta ordine a Rossi"'
        disabled={blocked || compiling}
        style={{ marginBottom: '0.5rem', maxWidth: '100%' }}
      />
      <div className="btn-group" style={{ flexWrap: 'wrap' }}>
        {SpeechRecognition && (
          <button
            type="button"
            className={`btn ${listening ? 'btn-outline-danger' : 'btn-primary'}`}
            onClick={listening ? stopListening : startListening}
            disabled={blocked || compiling}
          >
            {listening ? '⏹ Ferma e compila' : '🎤 Parla'}
          </button>
        )}
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleCompileClick}
          disabled={blocked || compiling || listening}
        >
          {compiling ? 'Compilazione…' : compileLabel}
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={handleClearClick}
          disabled={blocked || compiling || listening || !String(text || '').trim()}
          title="Svuota il testo del comando"
        >
          {clearLabel}
        </button>
      </div>
      {sttError ? (
        <div className="alert alert-warning" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
          {sttError}
        </div>
      ) : null}
    </div>
  )
}
