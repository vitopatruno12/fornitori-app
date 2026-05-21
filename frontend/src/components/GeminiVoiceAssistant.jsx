import React, { useEffect, useRef, useState } from 'react'

const SpeechRecognition =
  typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)

/**
 * Microfono → testo → callback (tipicamente Gemini).
 * Nessun parser vocale locale: solo trascrizione browser + testo modificabile.
 */
export default function GeminiVoiceAssistant({
  label = 'Comando vocale (Gemini)',
  hint = 'Parla: il testo viene inviato a Gemini che compila i campi. Puoi correggere il testo prima di inviare.',
  text = '',
  onTextChange,
  onCompile,
  compiling = false,
  disabled = false,
  compileLabel = 'Compila con Gemini',
  clearLabel = 'Cancella istruzione',
  onClear,
}) {
  const [listening, setListening] = useState(false)
  const [sttError, setSttError] = useState('')
  const recRef = useRef(null)

  useEffect(() => {
    return () => {
      try {
        recRef.current?.stop?.()
      } catch {
        // ignore
      }
    }
  }, [])

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
    if (listening || compiling || disabled) return
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
    rec.interimResults = true
    let finalBuffer = String(text || '').trim()
    const interimParts = []

    rec.onresult = (event) => {
      interimParts.length = 0
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const chunk = event.results[i][0]?.transcript || ''
        if (event.results[i].isFinal) {
          finalBuffer = `${finalBuffer} ${chunk}`.trim()
        } else {
          interimParts.push(chunk)
        }
      }
      const preview = [finalBuffer, interimParts.join(' ')].filter(Boolean).join(' ').trim()
      onTextChange?.(preview)
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
      if (spoken && onCompile) onCompile(spoken)
    }

    recRef.current = rec
    setListening(true)
    rec.start()
  }

  function handleCompileClick() {
    const t = String(text || '').trim()
    if (!t) {
      setSttError('Parla o scrivi un comando prima di inviare a Gemini')
      return
    }
    setSttError('')
    onCompile?.(t)
  }

  function handleClearClick() {
    if (listening) stopListening()
    setSttError('')
    onTextChange?.('')
    onClear?.()
  }

  return (
    <div className="gemini-voice-assistant card" style={{ padding: '0.85rem 1rem', marginBottom: '1rem', background: 'linear-gradient(180deg, #f0fdfa 0%, #fff 100%)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
        <strong style={{ color: '#0d9488' }}>{label}</strong>
        {!SpeechRecognition && (
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Solo testo (microfono non disponibile)</span>
        )}
      </div>
      {hint ? <p style={{ margin: '0 0 0.65rem', fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>{hint}</p> : null}
      <textarea
        className="form-control"
        rows={2}
        value={text}
        onChange={(e) => onTextChange?.(e.target.value)}
        placeholder='Es. "Marianna lunedì 8-16 turno" oppure "10 arance 5 kg pasta per Rossi domani"'
        disabled={disabled || compiling}
        style={{ marginBottom: '0.5rem', maxWidth: '100%' }}
      />
      <div className="btn-group" style={{ flexWrap: 'wrap' }}>
        {SpeechRecognition && (
          <button
            type="button"
            className={`btn ${listening ? 'btn-outline-danger' : 'btn-primary'}`}
            onClick={listening ? stopListening : startListening}
            disabled={disabled || compiling}
          >
            {listening ? '⏹ Ferma e invia a Gemini' : '🎤 Parla'}
          </button>
        )}
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleCompileClick}
          disabled={disabled || compiling || listening}
        >
          {compiling ? 'Gemini in corso…' : compileLabel}
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={handleClearClick}
          disabled={disabled || compiling || listening || !String(text || '').trim()}
          title="Svuota il testo del comando"
        >
          {clearLabel}
        </button>
      </div>
      {sttError ? <div className="alert alert-warning" style={{ marginTop: '0.5rem', marginBottom: 0 }}>{sttError}</div> : null}
    </div>
  )
}
