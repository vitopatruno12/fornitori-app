import React, { useEffect, useMemo, useState } from 'react'
import { fetchDashboardSummary } from '../services/dashboardService'
import { useAppNavigate } from '../hooks/useAppNavigate'
import { useOffline } from '../offline/OfflineContext'
import { getCachedResponseWithMeta } from '../offline/offlineCache'
import WorkbookGrid from '../components/WorkbookGrid.jsx'
import {
  DASHBOARD_DELIVERIES_COLUMNS,
  DASHBOARD_DELIVERIES_TITLE,
  DASHBOARD_MOVEMENTS_COLUMNS,
  DASHBOARD_MOVEMENTS_TITLE,
  DASHBOARD_OVERDUE_INVOICES_COLUMNS,
  DASHBOARD_OVERDUE_INVOICES_TITLE,
  DASHBOARD_PENDING_ORDERS_COLUMNS,
  DASHBOARD_PENDING_ORDERS_TITLE,
  DASHBOARD_PRICE_INCREASE_COLUMNS,
  DASHBOARD_PRICE_INCREASE_TITLE,
  dashboardDeliveryCellValue,
  dashboardDeliveriesTotals,
  dashboardDeliveriesTotalsLabel,
  dashboardMovementCellValue,
  dashboardMovementsTotals,
  dashboardMovementsTotalsLabel,
  dashboardOverdueInvoiceCellValue,
  dashboardOverdueInvoicesTotals,
  dashboardOverdueInvoicesTotalsLabel,
  dashboardPendingOrderCellValue,
  dashboardPendingOrdersTotalsLabel,
  dashboardPriceIncreaseCellValue,
  dashboardPriceIncreaseTotalsLabel,
} from '../utils/dashboardWorkbook.js'
const DASHBOARD_CACHE_PATH = '/dashboard/summary'

function formatCachedAt(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('it-IT', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function eur(n) {
  if (n == null || n === '') return '—'
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(n))
}

function MonthlyFlowChart({ rows, onOpenPrimaNota, onOpenInvoices }) {
  if (!rows?.length) return <p className="empty-state">Nessun dato disponibile.</p>
  const max = Math.max(1, ...rows.flatMap((r) => [Number(r.entrate || 0), Number(r.uscite || 0)]))
  return (
    <div className="dash-chart-vbars">
      {rows.map((r) => {
        const e = Number(r.entrate || 0)
        const u = Number(r.uscite || 0)
        return (
          <div key={r.month_key} className="dash-chart-vbar-group">
            <div className="dash-chart-vbar-stack">
              <button
                type="button"
                className="dash-chart-vbar-btn"
                title={`Entrate ${eur(e)} — apri Prima Nota`}
                onClick={() => onOpenPrimaNota?.(r.month_key, 'entrata')}
              >
                <span className="dash-chart-vbar dash-chart-vbar--in" style={{ height: `${(e / max) * 100}%` }} />
              </button>
              <button
                type="button"
                className="dash-chart-vbar-btn"
                title={`Uscite ${eur(u)} — apri Fatture`}
                onClick={() => onOpenInvoices?.(r.month_key)}
              >
                <span className="dash-chart-vbar dash-chart-vbar--out" style={{ height: `${(u / max) * 100}%` }} />
              </button>
            </div>
            <div className="dash-chart-vbar-label">{r.month_label}</div>
          </div>
        )
      })}
    </div>
  )
}

function BreakdownBars({ rows, onSelect }) {
  if (!rows?.length) return <p className="empty-state">Nessun dato disponibile.</p>
  const max = Math.max(1, ...rows.map((r) => Number(r.amount || 0)))
  return (
    <div className="dash-hbars">
      {rows.map((r, i) => {
        const v = Number(r.amount || 0)
        return (
          <button key={`${r.label}-${i}`} type="button" className="dash-hbar-row dash-hbar-btn" onClick={() => onSelect?.(r)}>
            <div className="dash-hbar-label" title={r.label}>{r.label}</div>
            <div className="dash-hbar-track">
              <div className="dash-hbar-fill" style={{ width: `${(v / max) * 100}%` }} />
            </div>
            <div className="dash-hbar-value">{eur(v)}</div>
          </button>
        )
      })}
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="dashboard-skeleton" aria-busy="true" aria-label="Caricamento dashboard">
      <div className="dashboard-kpi-grid">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="dashboard-kpi dashboard-skeleton-block" style={{ minHeight: 118 }} />
        ))}
      </div>
      <div className="dashboard-two-col" style={{ marginTop: '1rem' }}>
        <div className="card dashboard-panel dashboard-skeleton-block" style={{ minHeight: 260 }} />
        <div className="card dashboard-panel dashboard-skeleton-block" style={{ minHeight: 260 }} />
      </div>
    </div>
  )
}

function Last6MonthsTrend({ rows, onOpenInvoices }) {
  if (!rows?.length) return <p className="empty-state">Nessun dato disponibile.</p>
  const w = 680
  const h = 220
  const padL = 42
  const padR = 20
  const padT = 16
  const padB = 40
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  const values = rows.map((r) => Number(r.amount || 0))
  const max = Math.max(1, ...values)
  const pts = rows.map((r, i) => ({
    x: rows.length <= 1 ? padL + innerW / 2 : padL + (i / (rows.length - 1)) * innerW,
    y: padT + innerH - (Number(r.amount || 0) / max) * innerH,
    label: r.label,
    monthKey: r.monthKey,
    val: Number(r.amount || 0),
  }))
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="dash-line-svg">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padT + innerH * t
          return <line key={t} x1={padL} y1={y} x2={padL + innerW} y2={y} className="dash-line-grid" />
        })}
        <path d={path} className="dash-line-path" />
        {pts.map((p, i) => (
          <g key={i} className="dash-line-node" onClick={() => onOpenInvoices?.(p.monthKey)}>
            <circle cx={p.x} cy={p.y} r="3.5" className="dash-line-point" />
            <text x={p.x} y={h - 14} textAnchor="middle" className="dash-line-label">{p.label}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}

export default function HomePage({ operatorMode = false, onOperatorNavigate }) {
  const onNavigate = useAppNavigate()
  const { online } = useOffline()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [cachedAt, setCachedAt] = useState(null)
  const [windowMonths, setWindowMonths] = useState('6')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const res = await fetchDashboardSummary()
        if (cancelled) return
        setData(res)
        if (!online) {
          const meta = await getCachedResponseWithMeta(DASHBOARD_CACHE_PATH)
          setCachedAt(meta?.updatedAt ?? null)
        } else {
          setCachedAt(null)
        }
      } catch {
        if (cancelled) return
        const meta = await getCachedResponseWithMeta(DASHBOARD_CACHE_PATH)
        if (meta?.data) {
          setData(meta.data)
          setCachedAt(meta.updatedAt ?? null)
        } else {
          setData(null)
          setCachedAt(null)
          setError(
            online
              ? 'Impossibile caricare la Panoramica. Verifica che il server sia attivo.'
              : 'Nessuna Panoramica salvata su questo dispositivo. Apri questa pagina almeno una volta con connessione internet.',
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [online])

  const monthlyRows = useMemo(() => {
    const all = data?.flussi_mensili || []
    const n = Number(windowMonths) || 6
    return all.slice(-n)
  }, [data, windowMonths])

  const spendTrendRows = useMemo(() => {
    return monthlyRows.map((r) => ({ label: r.month_label, monthKey: r.month_key, amount: r.uscite }))
  }, [monthlyRows])

  const pendingOrders = data?.ordini_consegna_in_ritardo || []
  const latestMovements = data?.ultimi_movimenti || []
  const recentDeliveries = data?.consegne_recenti || []
  const overdueInvoices = data?.fatture_scadute_elenco || []
  const priceIncreases = data?.fornitori_prezzi_in_aumento || []

  const movementsTotals = useMemo(() => dashboardMovementsTotals(latestMovements), [latestMovements])
  const deliveriesTotals = useMemo(() => dashboardDeliveriesTotals(recentDeliveries), [recentDeliveries])
  const overdueTotals = useMemo(() => dashboardOverdueInvoicesTotals(overdueInvoices), [overdueInvoices])

  const latestMonthKey = monthlyRows.length ? monthlyRows[monthlyRows.length - 1].month_key : null

  function openInvoicesWithFilter(monthKey, supplierLabel = '') {
    if (operatorMode) return
    if (!monthKey) return
    sessionStorage.setItem('dashboardInvoicesFilter', JSON.stringify({ monthKey, supplierLabel }))
    onNavigate?.('invoices')
  }

  function openInvoicesOverdue() {
    if (operatorMode) return
    onNavigate?.('invoices')
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('ai-invoices-filter', {
          detail: { dueFilter: 'overdue', message: 'Filtro: fatture scadute (non saldate)' },
        }),
      )
    }, 0)
  }

  function openPrimaNotaWithFilter(monthKey, movementKind = 'all', search = '') {
    if (!monthKey && !operatorMode) return
    if (monthKey) {
      sessionStorage.setItem('primaNotaDashboardFilter', JSON.stringify({ monthKey, movementKind, search }))
    }
    if (operatorMode) {
      onOperatorNavigate?.('prima-nota')
      return
    }
    onNavigate?.('prima-nota')
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-header staff-page-hero">
        <h1 className="page-header staff-page-title" style={{ marginBottom: '0.25rem' }}>
          Panoramica
        </h1>
        <p className="dashboard-subtitle staff-page-lead">
          Situazione al volo: cassa, banca, flussi del mese, fatture e attività recenti.
        </p>
      </header>

      {loading && <DashboardSkeleton />}
      {error && <div className="alert alert-danger">{error}</div>}
      {!loading && data && cachedAt && (
        <div className="alert alert-warning dashboard-offline-cache-note" role="status">
          {online ? (
            <>
              Panoramica non aggiornata dal server: mostro l&apos;ultima versione salvata su questo dispositivo
              {formatCachedAt(cachedAt) ? (
                <>
                  {' '}
                  (<strong>{formatCachedAt(cachedAt)}</strong>)
                </>
              ) : null}
              .
            </>
          ) : (
            <>
              Modalità offline: dati Panoramica salvati
              {formatCachedAt(cachedAt) ? (
                <>
                  {' '}
                  il <strong>{formatCachedAt(cachedAt)}</strong>
                </>
              ) : null}
              . I numeri non includono le modifiche fatte dopo quel momento.
            </>
          )}
        </div>
      )}

      {data && !loading && (
        <>
          <p className="dashboard-month-pill">Mese in corso: {data.month_label}</p>

          <section className="dashboard-kpi-grid">
            <div className="dashboard-kpi dashboard-kpi--primary">
              <div className="dashboard-kpi-label">Saldo cassa</div>
              <div className="dashboard-kpi-value">{eur(data.saldo_cassa)}</div>
              <div className="dashboard-kpi-hint">Movimenti non bancari (cassa / contanti default)</div>
            </div>
            <div className="dashboard-kpi dashboard-kpi--secondary">
              <div className="dashboard-kpi-label">Saldo banca</div>
              <div className="dashboard-kpi-value">{eur(data.saldo_banca)}</div>
              <div className="dashboard-kpi-hint">Conti con banca, bonifico, IBAN, ecc.</div>
            </div>
            <div className="dashboard-kpi">
              <div className="dashboard-kpi-label">Entrate del mese</div>
              <div className="dashboard-kpi-value dashboard-kpi-value--pos">{eur(data.entrate_mese)}</div>
            </div>
            <div className="dashboard-kpi">
              <div className="dashboard-kpi-label">Uscite del mese</div>
              <div className="dashboard-kpi-value dashboard-kpi-value--neg">{eur(data.uscite_mese)}</div>
            </div>
            <div className="dashboard-kpi dashboard-kpi--warn">
              <div className="dashboard-kpi-label">Fatture da pagare</div>
              <div className="dashboard-kpi-value">{data.fatture_da_pagare_count}</div>
              <div className="dashboard-kpi-sub">{eur(data.fatture_da_pagare_residuo)} residuo</div>
              {!operatorMode ? (
                <button type="button" className="btn btn-secondary btn-sm dashboard-kpi-link" onClick={() => onNavigate?.('invoices')}>
                  Apri fatture
                </button>
              ) : null}
            </div>
            <div className="dashboard-kpi dashboard-kpi--danger">
              <div className="dashboard-kpi-label">Fatture scadute</div>
              <div className="dashboard-kpi-value">{data.fatture_scadute_count}</div>
              <div className="dashboard-kpi-sub">{eur(data.fatture_scadute_residuo)} residuo</div>
              {!operatorMode ? (
                <button type="button" className="btn btn-secondary btn-sm dashboard-kpi-link" onClick={openInvoicesOverdue}>
                  Apri fatture scadute
                </button>
              ) : null}
            </div>
          </section>

          {(pendingOrders.length > 0) && (
            <section
              className="card dashboard-panel pagamenti-workbook-card"
              style={{ marginBottom: '1rem', borderLeft: '4px solid var(--danger, #c0392b)' }}
            >
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: '0 0 0.75rem' }}>
                Promemoria: questi ordini sono ancora &quot;in sospeso&quot; ma la data consegna indicata è nel passato.
              </p>
              <button
                type="button"
                className="btn btn-secondary btn-sm dashboard-panel-action"
                onClick={() => (operatorMode ? onOperatorNavigate?.('orders') : onNavigate?.('new-order'))}
              >
                Nuovo ordine
              </button>
              <WorkbookGrid
                title={DASHBOARD_PENDING_ORDERS_TITLE}
                sheetLabel={`${pendingOrders.length} ordini`}
                columns={DASHBOARD_PENDING_ORDERS_COLUMNS}
                rows={pendingOrders}
                cellValue={dashboardPendingOrderCellValue}
                totalsLabel={dashboardPendingOrdersTotalsLabel}
                totals={pendingOrders.length}
                gridClassName="dashboard-pending-orders-grid"
                rowKey={(row) => String(row.id)}
              />
            </section>
          )}

          <section className="card" style={{ marginBottom: '1rem' }}>
            <div className="ui-toolbar-one" style={{ marginBottom: 0 }}>
              <div className="form-group">
                <label>Periodo grafici</label>
                <select className="form-control" value={windowMonths} onChange={(e) => setWindowMonths(e.target.value)} style={{ minWidth: 140 }}>
                  <option value="3">Ultimi 3 mesi</option>
                  <option value="6">Ultimi 6 mesi</option>
                  <option value="12">Ultimi 12 mesi</option>
                </select>
              </div>
            </div>
          </section>

          <div className="dashboard-two-col">
            <section className="card dashboard-panel">
              <h2 className="page-subheader">Entrate vs uscite mese per mese</h2>
              <MonthlyFlowChart
                rows={monthlyRows}
                onOpenPrimaNota={(monthKey, kind) => openPrimaNotaWithFilter(monthKey, kind)}
                onOpenInvoices={operatorMode ? undefined : (monthKey) => openInvoicesWithFilter(monthKey)}
              />
            </section>
            <section className="card dashboard-panel">
              <h2 className="page-subheader">Andamento spese ultimi {windowMonths} mesi</h2>
              <Last6MonthsTrend rows={spendTrendRows} onOpenInvoices={operatorMode ? undefined : (monthKey) => openInvoicesWithFilter(monthKey)} />
            </section>
          </div>

          <div className="dashboard-two-col">
            <section className="card dashboard-panel">
              <h2 className="page-subheader">Costi per categoria</h2>
              <BreakdownBars
                rows={data.costi_per_categoria || []}
                onSelect={(r) => openPrimaNotaWithFilter(latestMonthKey, 'uscita', r.label)}
              />
            </section>
            <section className="card dashboard-panel">
              <h2 className="page-subheader">Costi per fornitore</h2>
              <BreakdownBars
                rows={data.costi_per_fornitore || []}
                onSelect={operatorMode ? undefined : (r) => openInvoicesWithFilter(latestMonthKey, r.label)}
              />
            </section>
          </div>

          <div className="dashboard-two-col">
            <section className="card dashboard-panel pagamenti-workbook-card">
              <button
                type="button"
                className="btn btn-secondary btn-sm dashboard-panel-action"
                onClick={() => (operatorMode ? onOperatorNavigate?.('prima-nota') : onNavigate?.('prima-nota'))}
              >
                Prima Nota
              </button>
              <WorkbookGrid
                title={DASHBOARD_MOVEMENTS_TITLE}
                sheetLabel={`${latestMovements.length} movimenti`}
                columns={DASHBOARD_MOVEMENTS_COLUMNS}
                rows={latestMovements}
                cellValue={dashboardMovementCellValue}
                totalsLabel={dashboardMovementsTotalsLabel}
                totals={movementsTotals}
                gridClassName="dashboard-movements-grid"
                emptyMessage="Nessun movimento registrato."
                rowKey={(row) => String(row.id)}
              />
            </section>

            <section className="card dashboard-panel pagamenti-workbook-card">
              {!operatorMode ? (
                <button type="button" className="btn btn-secondary btn-sm dashboard-panel-action" onClick={() => onNavigate?.('history')}>
                  Storico consegne
                </button>
              ) : null}
              <WorkbookGrid
                title={DASHBOARD_DELIVERIES_TITLE}
                sheetLabel={`${recentDeliveries.length} consegne`}
                columns={DASHBOARD_DELIVERIES_COLUMNS}
                rows={recentDeliveries}
                cellValue={dashboardDeliveryCellValue}
                totalsLabel={dashboardDeliveriesTotalsLabel}
                totals={deliveriesTotals}
                gridClassName="dashboard-deliveries-grid"
                emptyMessage="Nessuna consegna."
                rowKey={(row) => String(row.id)}
              />
            </section>
          </div>

          <div className="dashboard-two-col">
            <section className="card dashboard-panel pagamenti-workbook-card">
              {!operatorMode ? (
                <button type="button" className="btn btn-secondary btn-sm dashboard-panel-action" onClick={openInvoicesOverdue}>
                  Apri fatture scadute
                </button>
              ) : null}
              <WorkbookGrid
                title={DASHBOARD_OVERDUE_INVOICES_TITLE}
                sheetLabel={`${overdueInvoices.length} fatture`}
                columns={DASHBOARD_OVERDUE_INVOICES_COLUMNS}
                rows={overdueInvoices}
                cellValue={dashboardOverdueInvoiceCellValue}
                totalsLabel={dashboardOverdueInvoicesTotalsLabel}
                totals={overdueTotals}
                gridClassName="dashboard-overdue-invoices-grid"
                emptyMessage="Nessuna fattura scaduta (o tutto saldato)."
                rowKey={(row) => String(row.id)}
              />
            </section>

            <section className="card dashboard-panel pagamenti-workbook-card">
              <p className="dashboard-hint">
                Confronto tra le ultime due consegne dello stesso prodotto (stesso fornitore): prezzo unitario in aumento.
              </p>
              <WorkbookGrid
                title={DASHBOARD_PRICE_INCREASE_TITLE}
                sheetLabel={`${priceIncreases.length} righe`}
                columns={DASHBOARD_PRICE_INCREASE_COLUMNS}
                rows={priceIncreases}
                cellValue={dashboardPriceIncreaseCellValue}
                totalsLabel={dashboardPriceIncreaseTotalsLabel}
                totals={priceIncreases.length}
                gridClassName="dashboard-price-increase-grid"
                emptyMessage="Nessun aumento rilevato (servono almeno due consegne per prodotto)."
                rowKey={(row, rowIndex) => `${row.supplier_name}-${row.product_description}-${rowIndex}`}
              />
            </section>
          </div>
        </>
      )}
    </div>
  )
}
