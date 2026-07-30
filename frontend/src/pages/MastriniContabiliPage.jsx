import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AmministrazionePageShell, eur, formatDate } from '../components/BancaShared.jsx'
import WorkbookGrid from '../components/WorkbookGrid.jsx'
import { fetchMastriniData } from '../services/mastriniService'

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

function exportMastroCsv(account, periodLabel) {
  const rows = [
    ['Mastro', account.description],
    ['Codice conto', account.code],
    ['Periodo', periodLabel],
    ['Saldo iniziale', account.openingBalance],
    ['Totale Dare', account.totalDare],
    ['Totale Avere', account.totalAvere],
    ['Saldo finale', account.finalBalance],
    [],
    ['Data', 'Numero registrazione', 'Descrizione', 'Documento', 'Dare', 'Avere', 'Saldo progressivo', 'Centro costo'],
    ...account.movements.map((m) => [
      m.date || '',
      m.registrationNumber || '',
      m.description || '',
      m.documentLabel || '',
      m.dare || 0,
      m.avere || 0,
      m.progressiveBalance || 0,
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
  const path = mv.documentPath || ''
  if (!path) return <span>{mv.documentLabel || '—'}</span>
  return (
    <Link to={path} style={{ textDecoration: 'underline' }}>
      {mv.documentLabel || path}
    </Link>
  )
}

const MASTRINI_COLUMNS = [
  { id: 'code', label: 'Codice conto', width: 120, mono: true, sticky: 'left' },
  { id: 'description', label: 'Descrizione', width: 300 },
  { id: 'category', label: 'Categoria', width: 140 },
  { id: 'dare', label: 'Dare', width: 130, numeric: true },
  { id: 'avere', label: 'Avere', width: 130, numeric: true },
  { id: 'saldo', label: 'Saldo', width: 130, numeric: true },
  { id: 'stato', label: 'Stato', width: 110 },
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
  { id: 'name', label: 'Soggetto', width: 280, sticky: 'left' },
  { id: 'type', label: 'Tipo', width: 120 },
  { id: 'dare', label: 'Dare', width: 130, numeric: true },
  { id: 'avere', label: 'Avere', width: 130, numeric: true },
  { id: 'saldo', label: 'Saldo', width: 130, numeric: true },
  { id: 'movements', label: 'Movimenti', width: 110, numeric: true },
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
  { id: 'description', label: 'Descrizione', width: 280 },
  { id: 'documentLabel', label: 'Documento collegato', width: 220 },
  { id: 'dare', label: 'Dare', width: 130, numeric: true },
  { id: 'avere', label: 'Avere', width: 130, numeric: true },
  { id: 'progressiveBalance', label: 'Saldo progressivo', width: 150, numeric: true },
]

function partitarioDetailCellValue(row, col) {
  if (!row) return ''
  if (col.id === 'date') return formatDate(row.date)
  if (col.id === 'registrationNumber') return row.registrationNumber || '—'
  if (col.id === 'description') return row.description || '—'
  if (col.id === 'documentLabel') return row.documentLabel || '—'
  if (col.id === 'dare') return row.dare ? eur(row.dare) : '—'
  if (col.id === 'avere') return row.avere ? eur(row.avere) : '—'
  if (col.id === 'progressiveBalance') return eur(row.progressiveBalance)
  return ''
}

const MASTRO_DETAIL_COLUMNS = [
  { id: 'date', label: 'Data', width: 120 },
  { id: 'registrationNumber', label: 'N. registrazione', width: 150, mono: true },
  { id: 'description', label: 'Descrizione', width: 280 },
  { id: 'documentLabel', label: 'Documento collegato', width: 220 },
  { id: 'dare', label: 'Dare', width: 130, numeric: true },
  { id: 'avere', label: 'Avere', width: 130, numeric: true },
  { id: 'progressiveBalance', label: 'Saldo progressivo', width: 150, numeric: true },
]

function mastroDetailCellValue(row, col) {
  if (!row) return ''
  if (col.id === 'date') return formatDate(row.date)
  if (col.id === 'registrationNumber') return row.registrationNumber || '—'
  if (col.id === 'description') return row.description || '—'
  if (col.id === 'documentLabel') return row.documentLabel || '—'
  if (col.id === 'dare') return row.dare ? eur(row.dare) : '—'
  if (col.id === 'avere') return row.avere ? eur(row.avere) : '—'
  if (col.id === 'progressiveBalance') return eur(row.progressiveBalance)
  return ''
}

export default function MastriniContabiliPage() {
  const [viewMode, setViewMode] = useState('mastrini')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [category, setCategory] = useState('')
  const [statementType, setStatementType] = useState('')
  const [center, setCenter] = useState('')
  const [advancedSearch, setAdvancedSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState([])
  const [data, setData] = useState(null)
  const [selectedCode, setSelectedCode] = useState('')
  const [selectedPartyKey, setSelectedPartyKey] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await fetchMastriniData({
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      })
      setData(res)
      setWarnings(Array.isArray(res?.warnings) ? res.warnings : [])
      if (!selectedCode && res?.accounts?.[0]) setSelectedCode(res.accounts[0].code)
      if (!selectedPartyKey && res?.partitario?.parties?.[0]) setSelectedPartyKey(res.partitario.parties[0].key)
    } catch (e) {
      setError(e?.message || 'Errore caricamento mastrini contabili')
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const periodLabel = useMemo(() => {
    if (!dateFrom && !dateTo) return 'Tutto'
    if (dateFrom && dateTo) return `${dateFrom} - ${dateTo}`
    return dateFrom || dateTo
  }, [dateFrom, dateTo])

  const filteredAccounts = useMemo(() => {
    const rows = Array.isArray(data?.accounts) ? data.accounts : []
    const q = String(advancedSearch || '').trim().toLowerCase()
    return rows.filter((r) => {
      if (category && r.category !== category) return false
      if (statementType && r.statementType !== statementType) return false
      if (center) {
        const hasCenter = r.movements.some((m) => String(m.center || '').toLowerCase().includes(center.toLowerCase()))
        if (!hasCenter) return false
      }
      if (!q) return true
      const blob = [
        r.code,
        r.description,
        r.category,
        ...r.movements.map((m) =>
          [m.description, m.documentLabel, m.counterparty, m.supplier, m.customer, m.registrationNumber].join(' '),
        ),
      ]
        .join(' ')
        .toLowerCase()
      return blob.includes(q)
    })
  }, [data, category, statementType, center, advancedSearch])

  const selected = useMemo(() => filteredAccounts.find((r) => r.code === selectedCode) || filteredAccounts[0], [filteredAccounts, selectedCode])

  const advancedRows = useMemo(() => {
    if (!selected) return []
    const q = String(advancedSearch || '').trim().toLowerCase()
    if (!q) return selected.movements
    return selected.movements.filter((m) => {
      const blob = [
        selected.code,
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

  function exportListExcel() {
    const rows = [
      ['Codice', 'Descrizione', 'Categoria', 'Dare', 'Avere', 'Saldo', 'Stato'],
      ...filteredAccounts.map((r) => [r.code, r.description, r.category, r.totalDare, r.totalAvere, r.finalBalance, r.status]),
    ]
    downloadFile('mastrini_elenco.csv', toCsv(rows), 'text/csv;charset=utf-8')
  }

  return (
    <AmministrazionePageShell
      title="Mastrini contabili"
      lead="Dashboard, elenco conti, dettaglio mastro, collegamenti automatici e stampe."
      actions={
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
            {loading ? 'Aggiorno…' : 'Aggiorna'}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={exportListExcel} disabled={!filteredAccounts.length}>
            Mastro Excel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => selected && printMastro(selected, periodLabel)}
            disabled={!selected}
          >
            Mastro PDF
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
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`btn btn-sm ${viewMode === 'mastrini' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setViewMode('mastrini')}
          >
            Vista mastrini
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

      <section className="card fatture-panel">
        <h2 className="fatture-panel-title">Ricerca avanzata e filtri</h2>
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
            Piano dei conti
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
          <label>
            Centro di costo
            <input className="form-control" value={center} onChange={(e) => setCenter(e.target.value)} placeholder="Es. risacca" />
          </label>
          <label style={{ minWidth: 220 }}>
            Ricerca avanzata
            <input
              className="form-control"
              value={advancedSearch}
              onChange={(e) => setAdvancedSearch(e.target.value)}
              placeholder="Conto, cliente, fornitore, documento, importo…"
            />
          </label>
          <button type="submit" className="btn btn-primary">
            Applica
          </button>
        </form>
      </section>

      {viewMode === 'mastrini' ? (
      <section className="card fatture-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
          <h2 className="fatture-panel-title" style={{ margin: 0 }}>
            Elenco mastrini
          </h2>
          {selected ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => exportMastroCsv(selected, periodLabel)}>
              Estratto conto del conto
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
          rowKey={(row) => row.code}
          onRowClick={(row) => setSelectedCode(row.code)}
          getRowClassName={(row) => (selected?.code === row.code ? 'workbook-row-selected' : '')}
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
      ) : (
        <>
          <section className="card fatture-panel">
            <h2 className="fatture-panel-title">Partitario per soggetto</h2>
            <div className="ui-kpi-row">
              <div className="ui-kpi-card">
                <div className="ui-kpi-card-label">Soggetti totali</div>
                <div className="ui-kpi-card-value">{data?.partitario?.metrics?.totalParties ?? '—'}</div>
              </div>
              <div className="ui-kpi-card">
                <div className="ui-kpi-card-label">Totale Dare partitario</div>
                <div className="ui-kpi-card-value">{eur(data?.partitario?.metrics?.totalDare)}</div>
              </div>
              <div className="ui-kpi-card">
                <div className="ui-kpi-card-label">Totale Avere partitario</div>
                <div className="ui-kpi-card-value">{eur(data?.partitario?.metrics?.totalAvere)}</div>
              </div>
              <div className="ui-kpi-card">
                <div className="ui-kpi-card-label">Saldo complessivo</div>
                <div className="ui-kpi-card-value">{eur(data?.partitario?.metrics?.finalBalance)}</div>
              </div>
            </div>
            <WorkbookGrid
              title="Partitario clienti/fornitori"
              sheetLabel={`${parties.length} soggetti`}
              columns={PARTITARIO_COLUMNS}
              rows={parties}
              cellValue={partitarioCellValue}
              emptyMessage="Nessun soggetto nel partitario per i filtri attivi."
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
      )}

      {viewMode === 'mastrini' && selected ? (
        <section className="card fatture-panel">
          <h2 className="fatture-panel-title">Dettaglio mastro {selected.code}</h2>
          <div className="ui-kpi-row">
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Descrizione</div>
              <div className="ui-kpi-card-value" style={{ fontSize: '1.05rem' }}>
                {selected.description}
              </div>
            </div>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Tipo conto</div>
              <div className="ui-kpi-card-value" style={{ fontSize: '1.05rem' }}>
                {selected.type}
              </div>
            </div>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Saldo iniziale</div>
              <div className="ui-kpi-card-value">{eur(selected.openingBalance)}</div>
            </div>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Totale Dare / Avere</div>
              <div className="ui-kpi-card-value">{`${eur(selected.totalDare)} / ${eur(selected.totalAvere)}`}</div>
            </div>
            <div className="ui-kpi-card">
              <div className="ui-kpi-card-label">Saldo finale</div>
              <div className="ui-kpi-card-value">{eur(selected.finalBalance)}</div>
            </div>
          </div>

          <WorkbookGrid
            title={`Dettaglio mastro ${selected.code}`}
            sheetLabel={`${advancedRows.length} movimenti`}
            columns={MASTRO_DETAIL_COLUMNS}
            rows={advancedRows}
            cellValue={mastroDetailCellValue}
            emptyMessage="Nessun movimento per questo mastro."
            rowKey={(row, idx) => `${selected.code}-${row.registrationNumber || 'reg'}-${idx}`}
            actionsHeader="Documento"
            renderActions={(row) => documentoLink(row)}
            totals={{
              dare: advancedRows.reduce((acc, m) => acc + (Number(m.dare) || 0), 0),
              avere: advancedRows.reduce((acc, m) => acc + (Number(m.avere) || 0), 0),
              progressiveBalance:
                advancedRows.length > 0
                  ? Number(advancedRows[advancedRows.length - 1].progressiveBalance) || 0
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
          <p className="fatture-note" style={{ marginTop: '0.75rem' }}>
            Collegamenti automatici attivi: Prima Nota, fatture fornitori/clienti, movimenti bancari, incassi e pagamenti.
            Ogni riga apre la sezione origine del documento.
          </p>
        </section>
      ) : null}

      <section className="card fatture-panel">
        <h2 className="fatture-panel-title">Automazioni</h2>
        <ul className="fatture-suggestions">
          <li>Registrazione fattura → aggiorna debiti fornitori e costi.</li>
          <li>Movimento Prima Nota → aggiorna cassa e ricavi/costi.</li>
          <li>Movimento bancario riconciliato → aggiorna banca e conto collegato.</li>
          <li>Incassi/Pagamenti → aggiornano crediti/debiti e banca.</li>
        </ul>
      </section>
    </AmministrazionePageShell>
  )
}
