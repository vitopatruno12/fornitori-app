import { useState } from 'react'

type LinkRow = {
  label: string
  url: string
}

type OperatorLinkCardProps = {
  title: string
  description: string
  links: LinkRow[]
}

export default function OperatorLinkCard({ title, description, links }: OperatorLinkCardProps) {
  const [copiedUrl, setCopiedUrl] = useState('')

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      const el = document.createElement('textarea')
      el.value = url
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setCopiedUrl(url)
    window.setTimeout(() => setCopiedUrl(''), 2500)
  }

  return (
    <section className="card operator-link-card" style={{ marginBottom: '1rem' }}>
      <h2 className="page-subheader" style={{ marginTop: 0, fontSize: '1.05rem' }}>
        {title}
      </h2>
      <p style={{ margin: '0 0 0.85rem', fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
        {description}
      </p>
      {links.map((link) => (
        <div key={link.url} className="operator-link-block">
          {links.length > 1 ? (
            <div className="operator-link-block-label">{link.label}</div>
          ) : null}
          <div className="operator-link-row">
            <input
              type="text"
              className="form-control"
              readOnly
              value={link.url}
              aria-label={link.label}
              onFocus={(e) => e.target.select()}
            />
            <button type="button" className="btn btn-primary" onClick={() => copyUrl(link.url)}>
              {copiedUrl === link.url ? 'Copiato' : 'Copia link'}
            </button>
            <a href={link.url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
              Apri
            </a>
          </div>
        </div>
      ))}
    </section>
  )
}
