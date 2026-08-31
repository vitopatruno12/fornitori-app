import React from 'react'
import { Link } from 'react-router-dom'
import {
  PopularTimesChart,
  SeriesBars,
  TopSlotsColumnChart,
  eur,
} from './AnalisiShared.jsx'
import {
  MANI_PASTA_MODEL_ID,
  MANI_PASTA_VIEW_OPTIONS,
  readStoredManiPastaView,
  writeStoredManiPastaView,
} from '../constants/maniPastaLocations.js'
import { GAZZA_LADRA_MODEL_ID } from '../constants/vneMachines.js'

function resolveManiPastaView(machine, viewId) {
  if (!machine || machine.model_id !== MANI_PASTA_MODEL_ID || viewId === 'combined') {
    return { data: machine, subtitle: null, revenueNote: null }
  }
  const loc = (Array.isArray(machine.locations) ? machine.locations : []).find(
    (item) => item.location_id === viewId,
  )
  if (!loc) {
    return { data: machine, subtitle: null, revenueNote: null }
  }
  return {
    data: {
      ...machine,
      model_label: `${machine.model_label} — ${loc.location_label}`,
      revenue_source: loc.revenue_source,
      snapshot: loc.snapshot,
      weekly: loc.weekly,
      top_slots: loc.top_slots,
      hours: loc.hours,
      weekdays: loc.weekdays,
      cells: loc.cells,
      visits_source: loc.visits_source,
    },
    subtitle: loc.location_label,
    revenueNote: loc.revenue_note,
  }
}

function incassoHint(data, revenueNote) {
  const s = data?.snapshot || {}
  const source = data?.revenue_source || s.revenue_source
  if (revenueNote) return revenueNote
  if (source === 'vne+pos') {
    return `VNE ${eur(s.incasso_vne)} + scontrini ${eur(s.incasso_pos)}`
  }
  if (source === 'pos') return 'Incasso da scontrini EasyRetail'
  return 'Chiusura giornata VNE'
}

function PaymentSplitBlock({ split, providerLabel }) {
  const cash = Number(split?.cash_eur || 0) || 0
  const card = Number(split?.card_eur || 0) || 0
  const receipts = Number(split?.receipts || 0) || 0
  if (cash <= 0 && card <= 0 && receipts <= 0) {
    return (
      <p className="analisi-machine-scope" style={{ marginTop: '0.55rem' }}>
        Contanti / elettronico: in attesa di scontrini{providerLabel ? ` (${providerLabel})` : ''}.
      </p>
    )
  }
  return (
    <div className="analisi-machine-kpis" style={{ marginTop: '0.65rem' }}>
      <div>
        <div className="dashboard-kpi-label">Contanti</div>
        <div className="dashboard-kpi-value" style={{ fontSize: '1.1rem' }}>
          {eur(cash)}
        </div>
        <div className="dashboard-kpi-sub">dicitura scontrino</div>
      </div>
      <div>
        <div className="dashboard-kpi-label">Elettronico / POS</div>
        <div className="dashboard-kpi-value" style={{ fontSize: '1.1rem' }}>
          {eur(card)}
        </div>
        <div className="dashboard-kpi-sub">carta / bancomat</div>
      </div>
      <div>
        <div className="dashboard-kpi-label">Scontrini</div>
        <div className="dashboard-kpi-value" style={{ fontSize: '1.1rem' }}>
          {receipts}
        </div>
        <div className="dashboard-kpi-sub">nel periodo caricato</div>
      </div>
    </div>
  )
}

export function ManiPastaMachineCard({ machine }) {
  const [viewId, setViewId] = React.useState(() => readStoredManiPastaView())
  const { data: active, subtitle, revenueNote } = resolveManiPastaView(machine, viewId)
  const s = active?.snapshot || {}
  const visitsSource =
    active?.visits_source === 'vne+pos'
      ? 'operazioni VNE + scontrini EasyRetail'
      : active?.visits_source === 'pos'
        ? 'scontrini EasyRetail'
        : 'operazioni VNE (stima)'

  const onViewChange = (next) => {
    setViewId(next)
    writeStoredManiPastaView(next)
  }

  return (
    <section className="card analisi-panel analisi-machine-card">
      <div className="analisi-machine-card-head">
        <h2 className="analisi-panel-title">{machine.model_label}</h2>
        <div className="analisi-mani-location-filter">
          <label htmlFor={`mani-view-${machine.model_id}`}>Mostra</label>
          <select
            id={`mani-view-${machine.model_id}`}
            className="form-control analisi-machine-filter-select"
            value={viewId}
            onChange={(e) => onViewChange(e.target.value)}
          >
            {MANI_PASTA_VIEW_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {subtitle ? (
        <p className="analisi-machine-scope" style={{ marginTop: '-0.35rem' }}>
          Scheda sede: <strong>{subtitle}</strong>
        </p>
      ) : (
        <p className="analisi-machine-scope" style={{ marginTop: '-0.35rem' }}>
          Totale Via Zanardelli (VNE) + Via Abba (scontrini)
        </p>
      )}
      <div className="analisi-machine-kpis">
        <div>
          <div className="dashboard-kpi-label">Incasso oggi</div>
          <div className="dashboard-kpi-value" style={{ fontSize: '1.25rem' }}>
            {eur(s.incasso_oggi)}
          </div>
          <div className="dashboard-kpi-sub">{incassoHint(active, revenueNote)}</div>
        </div>
        <div>
          <div className="dashboard-kpi-label">Operazioni</div>
          <div className="dashboard-kpi-value" style={{ fontSize: '1.25rem' }}>
            {s.movimenti_oggi ?? 0}
          </div>
        </div>
        <div>
          <div className="dashboard-kpi-label">Picco</div>
          <div className="dashboard-kpi-value" style={{ fontSize: '1rem' }}>
            {s.picco_previsto?.slot_label || '—'}
          </div>
          <div className="dashboard-kpi-sub">
            {s.picco_previsto?.operatori_consigliati || 1} op. consigliati
          </div>
        </div>
      </div>
      <p className="analisi-home-peak" style={{ marginTop: '0.65rem' }}>
        {s.picco_previsto?.message || 'Nessun picco storico disponibile.'}
      </p>
      <PopularTimesChart
        cells={active.cells}
        hours={active.hours}
        weekdays={active.weekdays}
        title={`Orari di punta · ${active.model_label}`}
      />
      <p className="analisi-machine-scope">
        Fonte visite: <strong>{visitsSource}</strong>
      </p>
      <h3 className="analisi-machine-subtitle">Fasce consigliate</h3>
      <TopSlotsColumnChart suggestions={active.top_slots} emptyText="Pochi dati per questa sede." />
      <h3 className="analisi-machine-subtitle">Andamento settimanale</h3>
      <SeriesBars rows={(active.weekly?.rows || []).map((r) => ({ ...r, label: r.label }))} labelKey="label" />
      <div className="analisi-panel-actions">
        <Link className="btn btn-secondary btn-sm" to="/analisi/oraria">
          Heatmap · {active.model_label}
        </Link>
        {viewId === 'via_abba' ? null : (
          <Link className="btn btn-secondary btn-sm" to="/vne">
            Apri VNE
          </Link>
        )}
      </div>
    </section>
  )
}

export function GazzaLadraMachineCard({ machine }) {
  const s = machine.snapshot || {}
  const split = machine.payment_split || s.payment_split || {}

  return (
    <section className="card analisi-panel analisi-machine-card">
      <h2 className="analisi-panel-title">{machine.model_label}</h2>
      <p className="analisi-machine-scope" style={{ marginTop: '-0.35rem' }}>
        Locale senza VNE · POS Poste (API in arrivo) · flussi da scontrini (contanti / elettronico)
      </p>
      <div className="analisi-machine-kpis">
        <div>
          <div className="dashboard-kpi-label">Incasso oggi</div>
          <div className="dashboard-kpi-value" style={{ fontSize: '1.25rem' }}>
            {eur(s.incasso_oggi)}
          </div>
          <div className="dashboard-kpi-sub">
            {machine.revenue_note || 'scontrini POS Poste'}
          </div>
        </div>
        <div>
          <div className="dashboard-kpi-label">Visite / scontrini</div>
          <div className="dashboard-kpi-value" style={{ fontSize: '1.25rem' }}>
            {s.movimenti_oggi ?? 0}
          </div>
        </div>
        <div>
          <div className="dashboard-kpi-label">Picco</div>
          <div className="dashboard-kpi-value" style={{ fontSize: '1rem' }}>
            {s.picco_previsto?.slot_label || '—'}
          </div>
          <div className="dashboard-kpi-sub">
            {s.picco_previsto?.operatori_consigliati || 1} op. consigliati
          </div>
        </div>
      </div>
      <PaymentSplitBlock split={split} providerLabel="POS Poste" />
      <p className="analisi-home-peak" style={{ marginTop: '0.65rem' }}>
        {s.picco_previsto?.message ||
          'Struttura pronta: collega API / import scontrini Poste per popolare i flussi.'}
      </p>
      <PopularTimesChart
        cells={machine.cells}
        hours={machine.hours}
        weekdays={machine.weekdays}
        title={`Orari di punta · ${machine.model_label}`}
      />
      <p className="analisi-machine-scope">
        Fonte visite: <strong>scontrini POS Poste</strong>
      </p>
      <h3 className="analisi-machine-subtitle">Fasce consigliate</h3>
      <TopSlotsColumnChart
        suggestions={machine.top_slots}
        emptyText="In attesa di scontrini per stimare gli operatori necessari."
      />
      <h3 className="analisi-machine-subtitle">Andamento settimanale</h3>
      <SeriesBars rows={(machine.weekly?.rows || []).map((r) => ({ ...r, label: r.label }))} labelKey="label" />
      <div className="analisi-panel-actions">
        <Link className="btn btn-secondary btn-sm" to="/analisi/giornaliero">
          Giornaliero · Gazza Ladra
        </Link>
        <Link className="btn btn-secondary btn-sm" to="/analisi/settimanale">
          Settimanale
        </Link>
        <Link className="btn btn-secondary btn-sm" to="/analisi/mensile">
          Mensile
        </Link>
      </div>
    </section>
  )
}

export function AnalisiMachineCard({ machine }) {
  if (machine?.model_id === MANI_PASTA_MODEL_ID) {
    return <ManiPastaMachineCard machine={machine} />
  }
  if (machine?.model_id === GAZZA_LADRA_MODEL_ID) {
    return <GazzaLadraMachineCard machine={machine} />
  }

  const s = machine.snapshot || {}
  const isHybrid = machine.revenue_source === 'vne+pos' || s.revenue_source === 'vne+pos'
  const isPos = machine.revenue_source === 'pos' || s.revenue_source === 'pos'

  return (
    <section className="card analisi-panel analisi-machine-card">
      <h2 className="analisi-panel-title">{machine.model_label}</h2>
      <div className="analisi-machine-kpis">
        <div>
          <div className="dashboard-kpi-label">Incasso oggi</div>
          <div className="dashboard-kpi-value" style={{ fontSize: '1.25rem' }}>
            {eur(s.incasso_oggi)}
          </div>
          <div className="dashboard-kpi-sub">
            {isHybrid
              ? `VNE ${eur(s.incasso_vne)} + scontrini ${eur(s.incasso_pos)}`
              : isPos
                ? 'scontrini POS'
                : 'chiusura giornata VNE'}
          </div>
        </div>
        <div>
          <div className="dashboard-kpi-label">Operazioni</div>
          <div className="dashboard-kpi-value" style={{ fontSize: '1.25rem' }}>
            {s.movimenti_oggi ?? 0}
          </div>
        </div>
        <div>
          <div className="dashboard-kpi-label">Picco</div>
          <div className="dashboard-kpi-value" style={{ fontSize: '1rem' }}>
            {s.picco_previsto?.slot_label || '—'}
          </div>
          <div className="dashboard-kpi-sub">
            {s.picco_previsto?.operatori_consigliati || 1} op. consigliati
          </div>
        </div>
      </div>
      <p className="analisi-home-peak" style={{ marginTop: '0.65rem' }}>
        {s.picco_previsto?.message || 'Nessun picco storico disponibile.'}
      </p>
      <PopularTimesChart
        cells={machine.cells}
        hours={machine.hours}
        weekdays={machine.weekdays}
        title={`Orari di punta · ${machine.model_label}`}
      />
      <p className="analisi-machine-scope">
        Fonte visite:{' '}
        <strong>
          {machine.visits_source === 'vne+pos'
            ? 'operazioni VNE + scontrini EasyRetail'
            : machine.visits_source === 'pos'
              ? 'scontrini EasyRetail'
              : 'operazioni VNE (stima)'}
        </strong>
      </p>
      <h3 className="analisi-machine-subtitle">Fasce consigliate</h3>
      <TopSlotsColumnChart
        suggestions={machine.top_slots}
        emptyText="Pochi dati operazioni per questa macchina."
      />
      <h3 className="analisi-machine-subtitle">Andamento settimanale</h3>
      <SeriesBars rows={(machine.weekly?.rows || []).map((r) => ({ ...r, label: r.label }))} labelKey="label" />
      <div className="analisi-panel-actions">
        <Link className="btn btn-secondary btn-sm" to="/analisi/oraria">
          Heatmap · {machine.model_label}
        </Link>
        <Link className="btn btn-secondary btn-sm" to="/vne">
          Apri VNE
        </Link>
      </div>
    </section>
  )
}
