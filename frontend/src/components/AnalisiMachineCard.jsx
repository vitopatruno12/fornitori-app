import React from 'react'
import { Link } from 'react-router-dom'
import {
  PopularTimesChart,
  SeriesBars,
  TopSlotsColumnChart,
  eur,
} from './AnalisiShared.jsx'
import {
  GAZZA_LADRA_MODEL_ID,
  ZANARDELLI_MODEL_ID,
} from '../constants/vneMachines.js'

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

function providerForMachine(machine) {
  if (machine?.pos_provider === 'poste' || machine?.model_id === GAZZA_LADRA_MODEL_ID) {
    return 'POS Poste'
  }
  return 'EasyRetail'
}

/** Scheda locale: solo flussi agent/POS (niente VNE). */
export function PosOnlyMachineCard({ machine }) {
  const s = machine.snapshot || {}
  const split = machine.payment_split || s.payment_split || {}
  const providerLabel = providerForMachine(machine)
  const isGazza = machine.model_id === GAZZA_LADRA_MODEL_ID
  const shortName =
    machine.model_id === ZANARDELLI_MODEL_ID
      ? 'Zanardelli'
      : isGazza
        ? 'Gazza Ladra'
        : machine.model_label

  return (
    <section className="card analisi-panel analisi-machine-card">
      <h2 className="analisi-panel-title">{machine.model_label}</h2>
      <p className="analisi-machine-scope" style={{ marginTop: '-0.35rem' }}>
        {isGazza
          ? 'Scontrini POS Poste · contanti / elettronico'
          : 'Scontrini EasyRetail (agent PC cassa) · contanti / elettronico'}
      </p>
      <div className="analisi-machine-kpis">
        <div>
          <div className="dashboard-kpi-label">Incasso oggi</div>
          <div className="dashboard-kpi-value" style={{ fontSize: '1.25rem' }}>
            {eur(s.incasso_oggi)}
          </div>
          <div className="dashboard-kpi-sub">
            {machine.revenue_note || `scontrini ${providerLabel}`}
          </div>
        </div>
        <div>
          <div className="dashboard-kpi-label">Scontrini oggi</div>
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
      <PaymentSplitBlock split={split} providerLabel={providerLabel} />
      <p className="analisi-home-peak" style={{ marginTop: '0.65rem' }}>
        {s.picco_previsto?.message || 'In attesa di più scontrini per stimare i picchi.'}
      </p>
      <PopularTimesChart
        cells={machine.cells}
        hours={machine.hours}
        weekdays={machine.weekdays}
        todayHourly={machine.today_hourly}
        title={`Orari di punta · ${machine.model_label}`}
      />
      <p className="analisi-machine-scope">
        Fonte visite: <strong>scontrini {providerLabel}</strong>
        {' · oggi in tempo reale; altri giorni = media storica'}
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
          Giornaliero · {shortName}
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

export function GazzaLadraMachineCard({ machine }) {
  return <PosOnlyMachineCard machine={machine} />
}

export function AnalisiMachineCard({ machine }) {
  return <PosOnlyMachineCard machine={machine} />
}
