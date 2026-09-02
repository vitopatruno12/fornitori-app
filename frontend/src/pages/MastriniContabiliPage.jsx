import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AmministrazionePageShell, eur, formatDate } from '../components/BancaShared.jsx'
import FattureCompanySelect from '../components/FattureCompanySelect.jsx'
import WorkbookGrid from '../components/WorkbookGrid.jsx'
import { useFattureCompany } from '../hooks/useFattureCompany.js'
import { ACCOUNT_PLAN, fetchMastriniData } from '../services/mastriniService'
import { accountCodesForCompany } from '../constants/mastriniPasscom.js'
import { companyLabel } from '../utils/fattureCompany.js'

function statusBadge(status) {
  if (status === 'pareggio') return <span style={{ color: '#0f766e', fontWeight: 700 }}>Pareggio</span>
  if (status === 'attivo') return <span style={{ color: '#166534', fontWeight: 700 }}>Attivo</span>
  return <span style={{ color: '#b91c1c', fontWeight: 700 }}>Passivo</span>
}

function toCsv(rows) {
  const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`
  return rows.map((row) => row.map(esc).join(';')).join('\n')
}

function downloadFile(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function exportMastroCsv(account, periodLabel, companyName = '') {
  const rows = [
    ['Mastro', account.description],
    ['Codice conto', account.code],
    ['Società', companyName || ''],
    ['Periodo', periodLabel],
    ['Saldo iniziale', account.openingBalance],
    ['Totale Dare', account.totalDare],
    ['Totale Avere', account.totalAvere],
    ['Saldo finale', account.finalBalance],
    [],
    [
      'Data',
      'Numero registrazione',
      'Descrizione',
      'Documento',
      'Dare',
      'Avere',
      'Saldo progressivo',
      'Codice conto',
      'Conto controparte',
      'Causale',
      'Descrizione causale',
      'Centro costo',
    ],
    ...account.movements.map((m) => [
      m.date || '',
      m.registrationNumber || '',
      m.description || '',
      m.documentLabel || '',
      m.dare || 0,
      m.avere || 0,
      m.progressiveBalance || 0,
      m.accountCode || account.code || '',
      m.counterAccountCode || '',
      m.causale || '',
      m.causaleLabel || '',
      m.center || '',
    ]),
  ]
  downloadFile(`mastro_${account.code}.csv`, toCsv(rows), 'text/csv;charset=utf-8')
}

function printMastro(account, periodLabel) {
  const w = window.open('', '_blank', 'noopener,noreferrer,width=1100,height=700')
  if (!w) return
  const html = `
    <html>
      <head>
        <title>Mastro ${account.code}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 16px; color: #111827; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          th, td { border: 1px solid #d1d5db; padding: 6px 8px; font-size: 12px; text-align: left; }
          th { background: #f3f4f6; }
          h1, h2 { margin: 0 0 8px; }
        </style>
      </head>
      <body>
        <h1>Mastro contabile</h1>
        <h2>${account.code} - ${account.description}</h2>
        <p>Periodo: ${periodLabel}</p>
        <p>Saldo iniziale: ${eur(account.openingBalance)} · Dare: ${eur(account.totalDare)} · Avere: ${eur(
    account.totalAvere,
  )} · Saldo finale: ${eur(account.finalBalance)}</p>
        <table>
          <thead>
            <tr>
              <th>Data</th><th>N. registrazione</th><th>Descrizione</th><th>Documento</th><th>Dare</th><th>Avere</th><th>Saldo</th>
            </tr>
          </thead>
          <tbody>
            ${account.movements
              .map(
                (m) => `
                  <tr>
                    <td>${m.date || ''}</td>
                    <td>${m.registrationNumber || ''}</td>
                    <td>${m.description || ''}</td>
                    <td>${m.documentLabel || ''}</td>
                    <td>${eur(m.dare)}</td>
                    <td>${eur(m.avere)}</td>
                    <td>${eur(m.progressiveBalance)}</td>
                  </tr>
                `,
              )
              .join('')}
          </tbody>
        </table>
      </body>
    </html>
  `
  w.document.write(html)
  w.document.close()
  w.focus()
  w.print()
}

function documentoLink(mv) {
  if (mv.linkedInvoiceId && mv.linkedBankMovementId) {
    return (
      <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '0.35rem' }}>
        <Link to="/fatture/registrate" style={{ textDecoration: 'underline' }}>
          Fattura {mv.documentLabel?.split(' · ')[0]?.replace('Fattura ', '') || mv.linkedInvoiceId}
        </Link>
        <span aria-hidden>↔</span>
        <Link to="/banca/movimenti" style={{ textDecoration: 'underline' }}>
          BA-{mv.linkedBankMovementId}
        </Link>
      </span>
    )
  }
  if (mv.linkedInvoiceId && mv.linkedCashEntryId) {
    return (
      <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '0.35rem' }}>
        <Link to="/fatture/registrate" style={{ textDecoration: 'underline' }}>
          {mv.documentLabel || `Fattura ${mv.linkedInvoiceId}`}
        </Link>
        <span aria-hidden>↔</span>
        <Link to="/prima-nota" style={{ textDecoration: 'underline' }}>
          PN-{mv.linkedCashEntryId}
        </Link>
      </span>
    )
  }
  const path = mv.documentPath || ''
  if (!path) return <span>{mv.documentLabel || '—'}</span>
  return (
    <Link to={path} style={{ textDecoration: 'underline' }}>
      {mv.documentLabel || path}
    </Link>
  )
}

const MASTRINI_COLUMNS = [
  { id: 'code', label: 'Codice conto', width: 12, fluid: true, mono: true },
  { id: 'description', label: 'Descrizione', width: 32, fluid: true, emphasis: true },
  { id: 'category', label: 'Categoria', width: 14, fluid: true },
  { id: 'dare', label: 'Dare', width: 12, fluid: true, numeric: true },
  { id: 'avere', label: 'Avere', width: 12, fluid: true, numeric: true },
  { id: 'saldo', label: 'Saldo', width: 12, fluid: true, numeric: true },
  { id: 'stato', label: 'Stato', width: 6, fluid: true },
]

function mastroCellValue(row, col) {
  if (!row) return ''
  if (col.id === 'code') return row.code || ''
  if (col.id === 'description') return row.description || ''
  if (col.id === 'category') return row.category || ''
  if (col.id === 'dare') return eur(row.totalDare)
  if (col.id === 'avere') return eur(row.totalAvere)
  if (col.id === 'saldo') return eur(row.finalBalance)
  if (col.id === 'stato') return String(row.status || '').toUpperCase()
  return ''
}

const PARTITARIO_COLUMNS = [
  { id: 'name', label: 'Soggetto', width: 36, fluid: true, emphasis: true },
  { id: 'type', label: 'Tipo', width: 14, fluid: true },
  { id: 'dare', label: 'Dare', width: 14, fluid: true, numeric: true },
  { id: 'avere', label: 'Avere', width: 14, fluid: true, numeric: true },
  { id: 'saldo', label: 'Saldo', width: 14, fluid: true, numeric: true },
  { id: 'movements', label: 'Movimenti', width: 8, fluid: true, numeric: true },
]

function partitarioCellValue(row, col) {
  if (!row) return ''
  if (col.id === 'name') return row.name || ''
  if (col.id === 'type') return String(row.type || '').toUpperCase()
  if (col.id === 'dare') return eur(row.totalDare)
  if (col.id === 'avere') return eur(row.totalAvere)
  if (col.id === 'saldo') return eur(row.finalBalance)
  if (col.id === 'movements') return String(row.movements?.length || 0)
  return ''
}

const PARTITARIO_DETAIL_COLUMNS = [
  { id: 'date', label: 'Data', width: 120 },
  { id: 'registrationNumber', label: 'N. registrazione', width: 150, mono: true },
  { id: 'description', label: 'Descrizione', width: 240 },
  { id: 'documentLabel', label: 'Documento collegato', width: 200 },
  { id: 'companyLabel', label: 'Società', width: 120 },
  { id: 'localeLabel', label: 'Locale', width: 120 },
  { id: 'dare', label: 'Dare', width: 120, numeric: true },
  { id: 'avere', label: 'Avere', width: 120, numeric: true },
  { id: 'progressiveBalance', label: 'Saldo progressivo', width: 140, numeric: true },
]

function partitarioDetailCellValue(row, col) {
  if (!row) return ''
  if (col.id === 'date') return formatDate(row.date)
  if (col.id === 'registrationNumber') return row.registrationNumber || '—'
  if (col.id === 'description') return row.description || '—'
  if (col.id === 'documentLabel') return row.documentLabel || '—'
  if (col.id === 'companyLabel') return row.companyLabel || companyLabel(row.company) || '—'
  if (col.id === 'localeLabel') return row.localeLabel || row.locale || row.center || '—'
  if (col.id === 'dare') return row.dare ? eur(row.dare) : '—'
  if (col.id === 'avere') return row.avere ? eur(row.avere) : '—'
  if (col.id === 'progressiveBalance') return eur(row.progressiveBalance)
  return ''
}

const MASTRO_DETAIL_COLUMNS = [
  { id: 'date', label: 'Data registrazione', width: 8, fluid: true },
  { id: 'causale', label: 'Causale', width: 7, fluid: true, mono: true },
  { id: 'registrationNumber', label: 'Numero', width: 9, fluid: true, mono: true },
  { id: 'counterAccountCode', label: 'Contropartita', width: 8, fluid: true, mono: true },
  { id: 'description', label: 'Descrizione operazione', width: 16, fluid: true, emphasis: true },
  { id: 'counterparty', label: 'Soggetto', width: 11, fluid: true },
  { id: 'localeLabel', label: 'Locale PN', width: 9, fluid: true },
  { id: 'dare', label: 'Dare', width: 8, fluid: true, numeric: true },
  { id: 'avere', label: 'Avere', width: 8, fluid: true, numeric: true },
  { id: 'progressiveBalance', label: 'Saldo progressivo', width: 10, fluid: true, numeric: true },
]

function mastroDetailCellValue(row, col) {
  if (!row) return ''
  if (col.id === 'date') return formatDate(row.date)
  if (col.id === 'documentDate') return formatDate(row.documentDate || row.date)
  if (col.id === 'causale') {
    const code = row.causale || ''
    const label = row.causaleLabel || ''
    return label ? `${code} — ${label}` : code || '—'
  }
  if (col.id === 'registrationNumber') return row.registrationNumber || '—'
  if (col.id === 'description') return row.description || '—'
  if (col.id === 'counterparty') return row.counterparty || row.supplier || row.customer || '—'
  if (col.id === 'documentLabel') return row.documentLabel || '—'
  if (col.id === 'counterAccountCode') {
    const code = row.counterAccountCode || ''
    const label = row.counterAccountDescription || ''
    return code ? (label ? `${code} ${label}` : code) : '—'
  }
  if (col.id === 'companyLabel') return row.companyLabel || companyLabel(row.company) || '—'
  if (col.id === 'localeLabel') return row.localeLabel || row.locale || row.center || '—'
  if (col.id === 'dare') return row.dare ? eur(row.dare) : '—'
  if (col.id === 'avere') return row.avere ? eur(row.avere) : '—'
  if (col.id === 'progressiveBalance') return eur(row.progressiveBalance)
  return ''
}

function filterMovementsBySourceRows(rows = [], sourceFilter = 'all') {
  if (sourceFilter === 'all') return rows
  return rows.filter((m) => String(m.source || '') === sourceFilter)
}

function accountTotalsFromMovements(account, movements = []) {
  const totalDare = movements.reduce((acc, m) => acc + (Number(m.dare) || 0), 0)
  const totalAvere = movements.reduce((acc, m) => acc + (Number(m.avere) || 0), 0)
  const finalBalance =
    account?.type === 'attivo' || account?.type === 'costo' ? totalDare - totalAvere : totalAvere - totalDare
  return { totalDare, totalAvere, finalBalance }
}

function sortMovementsNewestFirst(movements = []) {
  return [...movements].sort((a, b) => {
    const da = String(a.date || '')
    const db = String(b.date || '')
    if (da !== db) return db.localeCompare(da)
    return String(b.registrationNumber || '').localeCompare(String(a.registrationNumber || ''))
  })
}

export default function MastriniContabiliPage() {
  const year = new Date().getFullYear()
  const { companies, companyId, setCompanyId, loadingCompanies } = useFattureCompany(true)
  const [viewMode, setViewMode] = useState('selezione')
  const [dateFrom, setDateFrom] = useState(`${year}-01-01`)
  const [dateTo, setDateTo] = useState(`${year}-12-31`)
  const [category, setCategory] = useState('')
  const [statementType, setStatementType] = useState('')
  const [center, setCenter] = useState('')
  const [advancedSearch, setAdvancedSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState('prima_nota')
  const [accountCode, setAccountCode] = useState('1001')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState([])
  const [data, setData] = useState(null)
  const [selectedCode, setSelectedCode] = useState('')
  const [selectedPartyKey, setSelectedPartyKey] = useState('')

  const selectedCompanyLabel =
    companyId === 'non_classificata' ? 'Non classificate' : companyLabel(companyId)

  async function load(opts = {}) {
    const nextCompany = opts.company ?? companyId
    if (!nextCompany) {
      setData(null)
      setWarnings([])
      setLoading(false)
      return null
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetchMastriniData({
        dateFrom: (opts.dateFrom ?? dateFrom) || undefined,
        dateTo: (opts.dateTo ?? dateTo) || undefined,
        company: nextCompany,
      })
      setData(res)
      setWarnings(Array.isArray(res?.warnings) ? res.warnings : [])
      const firstCode = res?.accounts?.[0]?.code
      if (!selectedCode && firstCode) setSelectedCode(firstCode)
      if (!selectedPartyKey && res?.partitario?.parties?.[0]) setSelectedPartyKey(res.partitario.parties[0].key)
      return res
    } catch (e) {
      setError(e?.message || 'Errore caricamento mastrini contabili')
      return null
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  const periodLabel = useMemo(() => {
    const companyPart = selectedCompanyLabel ? `${selectedCompanyLabel} · ` : ''
    if (!dateFrom && !dateTo) return `${companyPart}Esercizio corrente`
    if (dateFrom && dateTo) return `${companyPart}${dateFrom} → ${dateTo}`
    return `${companyPart}${dateFrom || dateTo}`
  }, [dateFrom, dateTo, selectedCompanyLabel])

  const companyAccountCodes = useMemo(() => accountCodesForCompany(companyId, data?.accountPlan || ACCOUNT_PLAN), [companyId, data])

  const accountOptions = useMemo(() => {
    const plan = data?.accountPlan || ACCOUNT_PLAN
    return plan.filter((row) => companyAccountCodes.has(row.code))
  }, [data, companyAccountCodes])

  const accountOptionsByGroup = useMemo(() => {
    const groups = new Map()
    for (const row of accountOptions) {
      const key = row.group || row.category || 'Altri'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(row)
    }
    return [...groups.entries()]
  }, [accountOptions])

  React.useEffect(() => {
    if (!companyId || !accountOptions.length) return
    const preferred = accountOptions.find((row) => row.code?.startsWith('100')) || accountOptions[0]
    if (preferred?.code) {
      setAccountCode(preferred.code)
      setSelectedCode(preferred.code)
    }
  }, [companyId, accountOptions])

  function filterMovementsBySource(rows = []) {
    return filterMovementsBySourceRows(rows, sourceFilter)
  }

  const filteredAccounts = useMemo(() => {
    const rows = Array.isArray(data?.accounts) ? data.accounts : []
    const q = String(advancedSearch || '').trim().toLowerCase()
    return rows.filter((r) => {
      if (!companyAccountCodes.has(r.code)) return false
      const movements = filterMovementsBySource(r.movements || [])
      if (sourceFilter !== 'all' && movements.length === 0) return false
      if (category && r.category !== category) return false
      if (statementType && r.statementType !== statementType) return false
      if (center) {
        const hasCenter = movements.some((m) => String(m.center || '').toLowerCase().includes(center.toLowerCase()))
        if (!hasCenter) return false
      }
      if (!q) return true
      const blob = [
        r.code,
        r.description,
        r.category,
        ...movements.map((m) =>
          [
            m.description,
            m.documentLabel,
            m.counterparty,
            m.supplier,
            m.customer,
            m.registrationNumber,
            m.causale,
            m.causaleLabel,
            m.counterAccountCode,
            m.companyLabel,
            m.localeLabel,
            m.locale,
            m.center,
          ].join(' '),
        ),
      ]
        .join(' ')
        .toLowerCase()
      return blob.includes(q)
    }).map((r) => {
      const movements = filterMovementsBySourceRows(r.movements || [], sourceFilter)
      const totals = accountTotalsFromMovements(r, movements)
      return {
        ...r,
        movements,
        ...totals,
        status: Math.abs(totals.finalBalance) < 0.005 ? 'pareggio' : totals.finalBalance > 0 ? 'attivo' : 'passivo',
      }
    })
  }, [data, category, statementType, center, advancedSearch, sourceFilter, companyAccountCodes])

  const selected = useMemo(
    () => filteredAccounts.find((r) => r.code === selectedCode) || filteredAccounts[0],
    [filteredAccounts, selectedCode],
  )

  const schedaAccount = useMemo(() => {
    const rows = Array.isArray(data?.accounts) ? data.accounts : []
    const hit = rows.find((r) => r.code === (selectedCode || accountCode))
    if (!hit) return null
    const movements = filterMovementsBySourceRows(hit.movements || [], sourceFilter)
    const totals = accountTotalsFromMovements(hit, movements)
    return {
      ...hit,
      movements,
      ...totals,
      status: Math.abs(totals.finalBalance) < 0.005 ? 'pareggio' : totals.finalBalance > 0 ? 'attivo' : 'passivo',
    }
  }, [data, selectedCode, accountCode, sourceFilter])

  const schedaRows = useMemo(() => {
    if (!schedaAccount) return []
    const q = String(advancedSearch || '').trim().toLowerCase()
    let rows = sortMovementsNewestFirst(schedaAccount.movements || [])
    if (center) {
      rows = rows.filter((m) => String(m.center || '').toLowerCase().includes(center.toLowerCase()))
    }
    if (!q) return rows
    return rows.filter((m) => {
      const blob = [
        schedaAccount.code,
        m.causale,
        m.description,
        m.documentLabel,
        m.counterparty,
        m.supplier,
        m.customer,
        m.registrationNumber,
        m.amount,
        m.center,
      ]
        .join(' ')
        .toLowerCase()
      return blob.includes(q)
    })
  }, [schedaAccount, advancedSearch, center])

  const advancedRows = useMemo(() => {
    if (!selected) return []
    const q = String(advancedSearch || '').trim().toLowerCase()
    const rows = sortMovementsNewestFirst(selected.movements || [])
    if (!q) return rows
    return rows.filter((m) => {
      const blob = [
        selected.code,
        m.causale,
        m.description,
        m.documentLabel,
        m.counterparty,
        m.supplier,
        m.customer,
        m.registrationNumber,
        m.amount,
        m.center,
      ]
        .join(' ')
        .toLowerCase()
      return blob.includes(q)
    })
  }, [selected, advancedSearch])

  const parties = useMemo(() => {
    const rows = Array.isArray(data?.partitario?.parties) ? data.partitario.parties : []
    const q = String(advancedSearch || '').trim().toLowerCase()
    return rows.filter((p) => {
      if (center) {
        const hasCenter = p.movements.some((m) => String(m.center || '').toLowerCase().includes(center.toLowerCase()))
        if (!hasCenter) return false
      }
      if (!q) return true
      const blob = [
        p.name,
        p.type,
        ...p.movements.map((m) =>
          [m.description, m.documentLabel, m.registrationNumber, m.counterparty, m.supplier, m.customer].join(' '),
        ),
      ]
        .join(' ')
        .toLowerCase()
      return blob.includes(q)
    })
  }, [data, advancedSearch, center])

  const selectedParty = useMemo(
    () => parties.find((p) => p.key === selectedPartyKey) || parties[0],
    [parties, selectedPartyKey],
  )

  const accountOptionsForSelect = accountOptions.length ? accountOptions : ACCOUNT_PLAN

  async function openScheda(e) {
    e?.preventDefault?.()
    if (!companyId) {
      setError('Seleziona una società dal menu nel banner verde.')
      return
    }
    if (!accountCode) {
      setError('Seleziona un codice conto (obbligatorio, come in Passcom).')
      return
    }
    const res = await load()
    const found = (res?.accounts || []).find((a) => a.code === accountCode)
    if (!found && res) {
      setError(`Conto ${accountCode} non trovato nel piano Atlas.`)
      return
    }
    setSelectedCode(accountCode)
    setViewMode('scheda')
  }

  function exportListExcel() {
    const rows = [
      ['Codice', 'Descrizione', 'Categoria', 'Dare', 'Avere', 'Saldo', 'Stato'],
      ...filteredAccounts.map((r) => [r.code, r.description, r.category, r.totalDare, r.totalAvere, r.finalBalance, r.status]),
    ]
    downloadFile('mastrini_elenco.csv', toCsv(rows), 'text/csv;charset=utf-8')
  }

  return (
    <AmministrazionePageShell
      title="Schede contabili / Mastrini"
      lead={
        companyId
          ? `Mastrini ${selectedCompanyLabel}: Prima Nota collegata ai conti Passcom (cassa/ricavi/costi per locale).`
          : 'Scegli la società dal menu per vedere i mastrini del registro corretto (come fatture e scadenziario).'
      }
      actions={
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <FattureCompanySelect
            companies={[...companies, { id: 'non_classificata', label: 'Non classificate' }]}
            value={companyId}
            onChange={setCompanyId}
            loading={loadingCompanies}
          />
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => load()} disabled={loading || !companyId}>
            {loading ? 'Aggiorno…' : 'Aggiorna'}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={exportListExcel}
            disabled={!filteredAccounts.length || !companyId}
          >
            Elenco Excel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => schedaAccount && printMastro(schedaAccount, periodLabel)}
            disabled={!schedaAccount || viewMode === 'selezione' || !companyId}
          >
            Stampa scheda
          </button>
        </div>
      }
    >
      {error && <div className="alert alert-danger">{error}</div>}
      {warnings.map((w) => (
        <div key={w} className="alert alert-warning">
          {w}
        </div>
      ))}

      {!companyId ? (
        <p className="fatture-note">
          Seleziona una società dal menu nel banner verde per vedere i mastrini contabili di quel registro.
        </p>
      ) : null}

      {companyId ? (
      <section className="card fatture-panel">
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`btn btn-sm ${viewMode === 'selezione' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setViewMode('selezione')}
          >
            Selezione scheda
          </button>
          <button
            type="button"
            className={`btn btn-sm ${viewMode === 'scheda' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setViewMode('scheda')}
            disabled={!schedaAccount && !selected}
          >
            Scheda contabile
          </button>
          <button
            type="button"
            className={`btn btn-sm ${viewMode === 'elenco' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setViewMode('elenco')}
          >
            Piano dei conti
          </button>
          <button
            type="button"
            className={`btn btn-sm ${viewMode === 'partitario' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setViewMode('partitario')}
          >
            Partitario clienti/fornitori
          </button>
        </div>
      </section>
      ) : null}

      {companyId && viewMode === 'selezione' ? (
        <section className="card fatture-panel">
          <h2 className="fatture-panel-title">Selezione scheda contabile</h2>
          <p className="fatture-note" style={{ marginTop: 0 }}>
            Come in Passcom: ogni locale Prima Nota ha codici conto dedicati (es. 1003 Cassa Via Abba, 4103 Ricavi).
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <button
              type="button"
              className={`btn btn-sm ${sourceFilter === 'prima_nota' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setSourceFilter('prima_nota')}
            >
              Solo Prima Nota
            </button>
            <button
              type="button"
              className={`btn btn-sm ${sourceFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setSourceFilter('all')}
            >
              Tutte le fonti
            </button>
          </div>
          <form
            onSubmit={openScheda}
            style={{ display: 'grid', gap: '0.75rem', maxWidth: 560 }}
          >
            <label>
              Codice conto <span style={{ color: '#b91c1c' }}>*</span>
              <select
                className="form-control"
                value={accountCode}
                onChange={(e) => setAccountCode(e.target.value)}
                required
              >
                {accountOptionsByGroup.length
                  ? accountOptionsByGroup.map(([group, rows]) => (
                      <optgroup key={group} label={group}>
                        {rows.map((a) => (
                          <option key={a.code} value={a.code}>
                            {a.code} — {a.description}
                          </option>
                        ))}
                      </optgroup>
                    ))
                  : accountOptionsForSelect.map((a) => (
                      <option key={a.code} value={a.code}>
                        {a.code} — {a.description}
                      </option>
                    ))}
              </select>
            </label>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <label style={{ flex: '1 1 180px' }}>
                Da data
                <input className="form-control" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </label>
              <label style={{ flex: '1 1 180px' }}>
                A data
                <input className="form-control" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </label>
            </div>
            <label>
              Centro di costo / ricavo (opzionale)
              <input
                className="form-control"
                value={center}
                onChange={(e) => setCenter(e.target.value)}
                placeholder="Es. risacca, abba…"
              />
            </label>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                OK — Apri scheda
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setDateFrom(`${year}-01-01`)
                  setDateTo(`${year}-12-31`)
                  setCenter('')
                  setAdvancedSearch('')
                }}
              >
                Reset esercizio
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {companyId && viewMode === 'scheda' && schedaAccount ? (
        <section className="card fatture-panel mastrini-fit-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'start' }}>
            <div>
              <h2 className="fatture-panel-title" style={{ margin: 0 }}>
                Scheda contabile {schedaAccount.code} — {schedaAccount.description}
              </h2>
              <p className="fatture-note" style={{ margin: '0.35rem 0 0' }}>
                Periodo: {periodLabel} · Ordinamento: data registrazione (più recente in alto)
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setViewMode('selezione')}>
                Selezioni scheda
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => exportMastroCsv(schedaAccount, periodLabel, selectedCompanyLabel)}
              >
                Estratto CSV
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => printMastro(schedaAccount, periodLabel)}
              >
                Stampa scheda
              </button>
            </div>
          </div>

          <div className="ui-kpi-row" style={{ marginTop: '0.75rem' }}>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Saldo iniziale</div>
              <div className="ui-kpi-card-value">{eur(schedaAccount.openingBalance)}</div>
            </div>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Totale Dare</div>
              <div className="ui-kpi-card-value">{eur(schedaAccount.totalDare)}</div>
            </div>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Totale Avere</div>
              <div className="ui-kpi-card-value">{eur(schedaAccount.totalAvere)}</div>
            </div>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Saldo progressivo</div>
              <div className="ui-kpi-card-value">{eur(schedaAccount.finalBalance)}</div>
            </div>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Stato</div>
              <div className="ui-kpi-card-value" style={{ fontSize: '1.05rem' }}>
                {statusBadge(schedaAccount.status)}
              </div>
            </div>
          </div>

          <label style={{ display: 'block', margin: '0.75rem 0', maxWidth: 420 }}>
            Ricerca in scheda
            <input
              className="form-control"
              value={advancedSearch}
              onChange={(e) => setAdvancedSearch(e.target.value)}
              placeholder="Causale, descrizione, contropartita, documento…"
            />
          </label>

          <WorkbookGrid
            title={`Scheda ${schedaAccount.code}`}
            sheetLabel={`${schedaRows.length} registrazioni`}
            columns={MASTRO_DETAIL_COLUMNS}
            rows={schedaRows}
            cellValue={mastroDetailCellValue}
            emptyMessage="Nessuna registrazione nel periodo per questo conto."
            gridClassName="mastrini-fit-grid"
            rowKey={(row, idx) => `${schedaAccount.code}-${row.registrationNumber || 'reg'}-${idx}`}
            actionsHeader="Documento"
            renderActions={(row) => documentoLink(row)}
            totals={{
              dare: schedaRows.reduce((acc, m) => acc + (Number(m.dare) || 0), 0),
              avere: schedaRows.reduce((acc, m) => acc + (Number(m.avere) || 0), 0),
              progressiveBalance: schedaAccount.finalBalance,
            }}
            totalsLabel={(colId, totals) => {
              if (colId === 'description') return 'TOTALI'
              if (colId === 'dare') return eur(totals?.dare)
              if (colId === 'avere') return eur(totals?.avere)
              if (colId === 'progressiveBalance') return eur(totals?.progressiveBalance)
              return ''
            }}
            getCellTitle={(row, col) =>
              col.id === 'description'
                ? String(row?.description || '')
                : col.id === 'counterparty'
                  ? String(row?.counterparty || row?.supplier || '')
                  : ''
            }
          />
          <p className="fatture-note" style={{ marginTop: '0.75rem' }}>
            Fonti: Prima Nota con codici Passcom per locale (100x cassa, 410x ricavi, 510x costi). Fatture e banca restano disponibili con «Tutte le fonti».
            Colonne Causale e Contropartita seguono il modello scheda contabile Passcom.
          </p>
        </section>
      ) : null}

      {companyId && viewMode === 'scheda' && !schedaAccount ? (
        <section className="card fatture-panel">
          <p className="fatture-note">Nessuna scheda aperta. Torna a Selezione scheda e conferma un conto.</p>
          <button type="button" className="btn btn-primary" onClick={() => setViewMode('selezione')}>
            Vai alla selezione
          </button>
        </section>
      ) : null}

      {companyId && (viewMode === 'elenco' || viewMode === 'partitario') ? (
        <>
          <div className="ui-kpi-row">
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Numero totale mastrini</div>
              <div className="ui-kpi-card-value">{data?.metrics?.totalAccounts ?? '—'}</div>
            </div>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Saldo Dare</div>
              <div className="ui-kpi-card-value">{eur(data?.metrics?.totalDare)}</div>
            </div>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Saldo Avere</div>
              <div className="ui-kpi-card-value">{eur(data?.metrics?.totalAvere)}</div>
            </div>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Saldo finale</div>
              <div className="ui-kpi-card-value">{eur(data?.metrics?.finalBalance)}</div>
            </div>
          </div>

          <section className="card fatture-panel">
            <h2 className="fatture-panel-title">Filtri elenco</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                load()
              }}
              style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'end' }}
            >
              <label>
                Periodo da
                <input className="form-control" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </label>
              <label>
                a
                <input className="form-control" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </label>
              <label>
                Piano
                <select className="form-control" value={statementType} onChange={(e) => setStatementType(e.target.value)}>
                  <option value="">Tutti</option>
                  <option value="stato_patrimoniale">Stato patrimoniale</option>
                  <option value="conto_economico">Conto economico</option>
                </select>
              </label>
              <label>
                Categoria
                <select className="form-control" value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">Tutte</option>
                  <option value="Patrimoniale">Patrimoniale</option>
                  <option value="Economico">Economico</option>
                </select>
              </label>
              <label style={{ minWidth: 220 }}>
                Ricerca
                <input
                  className="form-control"
                  value={advancedSearch}
                  onChange={(e) => setAdvancedSearch(e.target.value)}
                  placeholder="Conto, cliente, fornitore…"
                />
              </label>
              <button type="submit" className="btn btn-primary">
                Applica
              </button>
            </form>
          </section>
        </>
      ) : null}

      {companyId && viewMode === 'elenco' ? (
      <section className="card fatture-panel mastrini-fit-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
          <h2 className="fatture-panel-title" style={{ margin: 0 }}>
            Piano dei conti (mastrini Atlas)
          </h2>
          {selected ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setAccountCode(selected.code)
                setSelectedCode(selected.code)
                setViewMode('scheda')
              }}
            >
              Apri scheda {selected.code}
            </button>
          ) : null}
        </div>
        <WorkbookGrid
          title="Elenco mastrini"
          sheetLabel={`${filteredAccounts.length} conti`}
          columns={MASTRINI_COLUMNS}
          rows={filteredAccounts}
          cellValue={mastroCellValue}
          emptyMessage="Nessun mastro nel filtro."
          gridClassName="mastrini-fit-grid"
          rowKey={(row) => row.code}
          onRowClick={(row) => {
            setSelectedCode(row.code)
            setAccountCode(row.code)
            setViewMode('scheda')
          }}
          getRowClassName={(row) => (selected?.code === row.code ? 'workbook-row-selected' : '')}
          rowClickTitle="Apri scheda contabile"
          totals={{
            dare: filteredAccounts.reduce((acc, r) => acc + (Number(r.totalDare) || 0), 0),
            avere: filteredAccounts.reduce((acc, r) => acc + (Number(r.totalAvere) || 0), 0),
            saldo: filteredAccounts.reduce((acc, r) => acc + (Number(r.finalBalance) || 0), 0),
          }}
          totalsLabel={(colId, totals) => {
            if (colId === 'code') return 'TOTALI'
            if (colId === 'dare') return eur(totals?.dare)
            if (colId === 'avere') return eur(totals?.avere)
            if (colId === 'saldo') return eur(totals?.saldo)
            return ''
          }}
          getCellTitle={(row, col) =>
            col.id === 'description' ? String(row?.description || '') : col.id === 'stato' ? String(row?.status || '') : ''
          }
        />
      </section>
      ) : null}

      {companyId && viewMode === 'partitario' ? (
        <>
          <section className="card fatture-panel mastrini-fit-panel">
            <h2 className="fatture-panel-title">Partitario per soggetto</h2>
            <WorkbookGrid
              title="Partitario clienti/fornitori"
              sheetLabel={`${parties.length} soggetti`}
              columns={PARTITARIO_COLUMNS}
              rows={parties}
              cellValue={partitarioCellValue}
              emptyMessage="Nessun soggetto nel partitario per i filtri attivi."
              gridClassName="mastrini-fit-grid"
              rowKey={(row) => row.key}
              onRowClick={(row) => setSelectedPartyKey(row.key)}
              getRowClassName={(row) => (selectedParty?.key === row.key ? 'workbook-row-selected' : '')}
              totals={{
                dare: parties.reduce((acc, p) => acc + (Number(p.totalDare) || 0), 0),
                avere: parties.reduce((acc, p) => acc + (Number(p.totalAvere) || 0), 0),
                saldo: parties.reduce((acc, p) => acc + (Number(p.finalBalance) || 0), 0),
                movements: parties.reduce((acc, p) => acc + (Number(p.movements?.length) || 0), 0),
              }}
              totalsLabel={(colId, totals) => {
                if (colId === 'name') return 'TOTALI'
                if (colId === 'dare') return eur(totals?.dare)
                if (colId === 'avere') return eur(totals?.avere)
                if (colId === 'saldo') return eur(totals?.saldo)
                if (colId === 'movements') return String(totals?.movements || 0)
                return ''
              }}
              getCellTitle={(row, col) =>
                col.id === 'name' ? String(row?.name || '') : col.id === 'type' ? String(row?.type || '') : ''
              }
            />
          </section>

          {selectedParty ? (
            <section className="card fatture-panel">
              <h2 className="fatture-panel-title">Dettaglio partitario — {selectedParty.name}</h2>
              <WorkbookGrid
                title={`Dettaglio partitario · ${selectedParty.name}`}
                sheetLabel={`${selectedParty.movements.length} movimenti`}
                columns={PARTITARIO_DETAIL_COLUMNS}
                rows={selectedParty.movements}
                cellValue={partitarioDetailCellValue}
                emptyMessage="Nessun movimento per questo soggetto."
                rowKey={(row, idx) => `${selectedParty.key}-${row.registrationNumber || 'reg'}-${idx}`}
                actionsHeader="Documento"
                renderActions={(row) => documentoLink(row)}
                totals={{
                  dare: selectedParty.movements.reduce((acc, m) => acc + (Number(m.dare) || 0), 0),
                  avere: selectedParty.movements.reduce((acc, m) => acc + (Number(m.avere) || 0), 0),
                  progressiveBalance:
                    selectedParty.movements.length > 0
                      ? Number(selectedParty.movements[selectedParty.movements.length - 1].progressiveBalance) || 0
                      : 0,
                }}
                totalsLabel={(colId, totals) => {
                  if (colId === 'description') return 'TOTALI'
                  if (colId === 'dare') return eur(totals?.dare)
                  if (colId === 'avere') return eur(totals?.avere)
                  if (colId === 'progressiveBalance') return eur(totals?.progressiveBalance)
                  return ''
                }}
                getCellTitle={(row, col) =>
                  col.id === 'description'
                    ? String(row?.description || '')
                    : col.id === 'documentLabel'
                      ? String(row?.documentLabel || '')
                      : ''
                }
              />
            </section>
          ) : null}
        </>
      ) : null}

      {companyId && viewMode === 'elenco' && selected ? (
        <section className="card fatture-panel mastrini-fit-panel">
          <h2 className="fatture-panel-title">Anteprima mastro {selected.code}</h2>
          <WorkbookGrid
            title={`Dettaglio mastro ${selected.code}`}
            sheetLabel={`${advancedRows.length} movimenti`}
            columns={MASTRO_DETAIL_COLUMNS}
            rows={advancedRows}
            cellValue={mastroDetailCellValue}
            emptyMessage="Nessun movimento per questo mastro."
            gridClassName="mastrini-fit-grid"
            rowKey={(row, idx) => `${selected.code}-${row.registrationNumber || 'reg'}-${idx}`}
            actionsHeader="Documento"
            renderActions={(row) => documentoLink(row)}
            totals={{
              dare: advancedRows.reduce((acc, m) => acc + (Number(m.dare) || 0), 0),
              avere: advancedRows.reduce((acc, m) => acc + (Number(m.avere) || 0), 0),
              progressiveBalance: selected.finalBalance,
            }}
            totalsLabel={(colId, totals) => {
              if (colId === 'description') return 'TOTALI'
              if (colId === 'dare') return eur(totals?.dare)
              if (colId === 'avere') return eur(totals?.avere)
              if (colId === 'progressiveBalance') return eur(totals?.progressiveBalance)
              return ''
            }}
          />
        </section>
      ) : null}
    </AmministrazionePageShell>
  )
}

