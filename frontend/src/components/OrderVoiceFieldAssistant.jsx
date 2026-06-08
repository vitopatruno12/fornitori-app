import React, { useCallback, useRef, useState } from 'react'
import {
  applyOrderVoiceField,
  getOrderFieldLabel,
  parseOrderVoiceUtterance,
} from '../utils/orderVoiceFieldMode.js'

const SpeechRecognition =
  typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)

/**
 * Compilazione ordine campo per campo: dici l’attributo (es. «prodotto»), poi il valore;
 * al cambio attributo scrive nel nuovo campo.
 */
export default function OrderVoiceFieldAssistant({
  text = '',
  onTextChange,
  disabled = false,
  compiling = false,
  applyContext,
  onFullCompile,
  fullCompileLabel = 'Compila ordine completo (AI)',
}) {
  const [listening, setListening] = useState(false)
  const [sttError, setSttError] = useState('')
  const [activeFieldId, setActiveFieldId] = useState(null)
  const [lastFeedback, setLastFeedback] = useState('')
  const activeFieldRef = useRef(activeFieldId)
  activeFieldRef.current = activeFieldId
  const recRef = useRef(null)

  const processUtterance = useCallback(
    async (spokenText) => {
      const t = String(spokenText ?? text ?? '').trim()
      if (!t) {
        setSttError('Parla o scrivi qualcosa')
        return
      }
      setSttError('')
      const parsed = parseOrderVoiceUtterance(t, activeFieldRef.current)

      if (parsed.needsFullParse && onFullCompile) {
        await onFullCompile(t)
        return
      }

      const result = applyOrderVoiceField(parsed, applyContext)
      if (result.fieldId) {
        setActiveFieldId(result.fieldId)
      }
      if (result.ok) {
        setLastFeedback(result.message)
        if (result.focusId) {
          window.setTimeout(() => {
            const el = document.getElementById(result.focusId)
            el?.focus?.()
            el?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
          }, 80)
        }
      } else {
        setSttError(result.message || 'Non compreso')
      }
    },
    [text, applyContext, onFullCompile],
  )

  const runApply = useCallback(
    async (spokenText) => {
      try {
        await processUtterance(spokenText)
      } catch (e) {
        setSttError(e?.message || 'Errore compilazione')
      } finally {
        onTextChange?.('')
      }
    },
    [processUtterance, onTextChange],
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
      setSttError('Microfono non supportato (usa Chrome o Edge).')
      return
    }
    if (listening || disabled || compiling) return
    setSttError('')
    let rec
    try {
      rec = new SpeechRecognition()
    } catch {
      setSttError('Riconoscimento vocale non disponibile')
      return
    }
    rec.lang = 'it-IT'
    rec.continuous = false
    rec.interimResults = false
    let finalBuffer = String(text || '').trim()

    rec.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (event.results[i].isFinal) {
          finalBuffer = `${finalBuffer} ${event.results[i][0]?.transcript || ''}`.trim()
        }
      }
      onTextChange?.(finalBuffer)
    }

    rec.onerror = () => {
      setSttError('Errore microfono o permesso negato')
      stopListening()
    }

    rec.onend = () => {
      setListening(false)
      recRef.current = null
      const spoken = finalBuffer.trim()
      if (spoken) runApply(spoken)
    }

    recRef.current = rec
    setListening(true)
    rec.start()
  }

  const activeLabel = activeFieldId ? getOrderFieldLabel(activeFieldId) : null

  return (
    <div
      className="order-voice-field-assistant card"
      style={{
        padding: '0.85rem 1rem',
        marginBottom: '1rem',
        background: 'linear-gradient(180deg, #eff6ff 0%, #fff 100%)',
      }}
    >
      <strong style={{ color: '#1d4ed8' }}>Ordine a voce — campo per campo</strong>
      <p style={{ margin: '0.5rem 0 0.65rem', fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
        <strong>1)</strong> Dì il campo: «prodotto», «pezzi», «fornitore», «consegna», … —{' '}
        <strong>2)</strong> Poi il valore: «arance», «10», «Rossi». Oppure in una frase: «prodotto arance».
        Cambi campo → il microfono scrive nel nuovo attributo.
      </p>
      {activeLabel ? (
        <div
          className="alert alert-info"
          style={{ marginBottom: '0.5rem', padding: '0.4rem 0.65rem', fontSize: '0.9rem' }}
        >
          Campo attivo: <strong>{activeLabel}</strong> — puoi dire solo il valore.
        </div>
      ) : (
        <div style={{ marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Nessun campo selezionato: inizia con «prodotto», «fornitore», …
        </div>
      )}
      {lastFeedback ? (
        <div className="alert alert-success" style={{ marginBottom: '0.5rem', padding: '0.35rem 0.6rem', fontSize: '0.88rem' }}>
          {lastFeedback}
        </div>
      ) : null}
      <textarea
        className="form-control"
        rows={2}
        value={text}
        onChange={(e) => onTextChange?.(e.target.value)}
        placeholder='Es. «prodotto» poi «arance»; oppure «pezzi 10»; «fornitore Rossi»'
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
            {listening ? '⏹ Ferma' : '🎤 Parla'}
          </button>
        )}
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => runApply(text)}
          disabled={disabled || compiling || listening || !String(text || '').trim()}
        >
          Applica
        </button>
        {onFullCompile ? (
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={() => onFullCompile(text)}
            disabled={disabled || compiling || listening}
            title="Analizza tutto il comando con Atlas AI (più righe / fornitore insieme)"
          >
            {compiling ? 'Compilazione…' : fullCompileLabel}
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={() => {
            onTextChange?.('')
            setSttError('')
            setLastFeedback('')
          }}
          disabled={!String(text || '').trim() && !lastFeedback}
        >
          Cancella
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
