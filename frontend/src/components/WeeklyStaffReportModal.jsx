import React, { useEffect, useMemo } from 'react'

async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fallback */
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  document.body.appendChild(ta)
  ta.focus()
  ta.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(ta)
  }
}

/**
 * @param {{ open: boolean, onClose: () => void, pdfBlob: Blob | null, filename: string, whatsappText: string, periodLabel: string, modalTitle?: string, onNotify?: (msg: string) => void }} props
 */
export default function WeeklyStaffReportModal({
  open,
  onClose,
  pdfBlob,
  filename,
  whatsappText,
  periodLabel,
  modalTitle = 'Report personale (PDF)',
  onNotify,
}) {
  const url = useMemo(() => (pdfBlob ? URL.createObjectURL(pdfBlob) : null), [pdfBlob])

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [url])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !url) return null

  const handlePrint = () => {
    const w = window.open(url, '_blank', 'noopener,noreferrer')
    if (w) {
      w.addEventListener('load', () => {
        setTimeout(() => {
          try {
            w.print()
          } catch {
            /* utente può stampare dal viewer */
          }
        }, 400)
      })
    }
  }

  const handleDownload = () => {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const handleWhatsApp = async () => {
    if (pdfBlob) {
      try {
        const file = new File([pdfBlob], filename, { type: 'application/pdf' })
        if (navigator.share && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: 'Report personale',
            text: `Report settimanale ${periodLabel}`,
          })
          return
        }
      } catch {
        /* prova testo / link */
      }
    }
    const text = whatsappText || ''
    const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`
    if (waUrl.length <= 7200) {
      window.open(waUrl, '_blank', 'noopener,noreferrer')
      return
    }
    const ok = await copyTextToClipboard(text)
    if (ok) onNotify?.('Riepilogo copiato negli appunti. Si apre WhatsApp: incolla il messaggio; per il PDF usa «Scarica PDF» e allega il file.')
    else onNotify?.('Messaggio troppo lungo: usa «Scarica PDF» e allega il file in WhatsApp.')
    window.open('https://wa.me/', '_blank', 'noopener,noreferrer')
  }

  return (
    <div
      className="staff-report-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Report settimanale PDF"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="staff-report-modal card" onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.65rem',
            marginBottom: '0.35rem',
          }}
        >
          <h2 className="page-subheader" style={{ margin: 0 }}>
            {modalTitle}
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={handlePrint}>
              Stampa
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleDownload}>
              Scarica PDF
            </button>
            <button type="button" className="btn btn-whatsapp btn-sm" onClick={() => void handleWhatsApp()}>
              WhatsApp
            </button>
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onClose}>
              Chiudi
            </button>
          </div>
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
          <strong>{periodLabel}</strong> — Su mobile/tablet puoi condividere il PDF con WhatsApp se il sistema lo permette; altrimenti si apre
          WhatsApp con il riepilogo testuale: per il file allega il PDF scaricato.
        </p>
        <iframe
          title="Anteprima report PDF"
          src={url}
          style={{
            width: '100%',
            height: 'min(62vh, 640px)',
            border: '1px solid var(--border, #e5e7eb)',
            borderRadius: 6,
            marginTop: '0.75rem',
            background: '#525659',
          }}
        />
      </div>
    </div>
  )
}
