import { Link } from 'react-router-dom'

const LOCALI = [
  {
    id: 'gazza_ladra',
    label: 'Gazza Ladra',
    kind: 'Ristorante',
    note: 'Gestione sala e coperti (senza VNE · POS Poste in arrivo)',
    to: '/gestione-locali/gazza-ladra',
    cta: 'Gestisci sala',
    ready: true,
  },
  {
    id: 'risacca',
    label: 'La Risacca',
    kind: 'Bar / locale',
    note: 'Collegato a VNE e Analisi — gestione sala non ancora attiva',
    to: null,
    cta: 'Presto',
    ready: false,
  },
  {
    id: 'mani_pasta',
    label: 'Mani in Pasta',
    kind: 'Due sedi (Abba + Zanardelli)',
    note: 'Operatività già su postazioni e Analisi — sala dedicata in seguito',
    to: null,
    cta: 'Presto',
    ready: false,
  },
  {
    id: 'mucche',
    label: 'Le Mucche Volanti',
    kind: 'Locale',
    note: 'Collegato a VNE e Analisi — gestione sala non ancora attiva',
    to: null,
    cta: 'Presto',
    ready: false,
  },
]

export default function GestioneLocaliPage() {
  return (
    <div className="page">
      <header className="page-header-block" style={{ marginBottom: '1rem' }}>
        <h1 className="page-header staff-page-title">Gestione locali</h1>
        <p className="page-lead" style={{ maxWidth: '42rem' }}>
          Hub operativo per le sedi: sala, coperti e strumenti di gestione. Gli incassi e le
          statistiche restano in <Link to="/analisi">Analisi</Link>.
        </p>
      </header>

      <div className="analisi-machine-grid">
        {LOCALI.map((locale) => (
          <section key={locale.id} className="card analisi-panel analisi-machine-card">
            <h2 className="analisi-panel-title">{locale.label}</h2>
            <p className="analisi-machine-scope" style={{ marginTop: '-0.25rem' }}>
              {locale.kind}
            </p>
            <p className="analisi-note" style={{ marginBottom: '0.85rem' }}>
              {locale.note}
            </p>
            <div className="analisi-panel-actions">
              {locale.ready && locale.to ? (
                <Link className="btn btn-primary btn-sm" to={locale.to}>
                  {locale.cta}
                </Link>
              ) : (
                <button type="button" className="btn btn-secondary btn-sm" disabled>
                  {locale.cta}
                </button>
              )}
              {locale.id === 'gazza_ladra' ? (
                <Link className="btn btn-secondary btn-sm" to="/analisi">
                  Vai ad Analisi
                </Link>
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

export { GazzaLadraSalaPage } from './GazzaLadraSalaPage.jsx'
