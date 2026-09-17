/**
 * Scheda contabile fornitore in stile Passcom:
 * - Fattura ricevuta (FR) → Avere
 * - Pagamento (PG) → Dare
 * - Saldo progressivo con suffisso A/D
 */
import { fetchBancaMovimenti } from './bancaService'
import { fetchInvoices, fetchIssuedInvoices } from './invoicesService'
import { companyLabel } from '../utils/fattureCompany.js'

function isoDate(value) {
  if (!value) return ''
  return String(value).slice(0, 10)
}

function toNum(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function normalizePartyName(name) {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function partyKey(name) {
  return normalizePartyName(name).toLowerCase()
}

function invoiceCompany(inv) {
  return String(inv?.company || '').trim() || 'non_classificata'
}

function invoiceNumber(inv) {
  return String(inv?.invoice_number || inv?.number || '').trim()
}

function invoiceAmount(inv) {
  const total = toNum(inv?.total ?? inv?.total_amount ?? inv?.importo)
  return Math.abs(total)
}

function paymentStatus(inv) {
  const status = String(inv?.payment_status || '').toLowerCase()
  if (status === 'paid' || status === 'unpaid' || status === 'partial') return status
  const total = invoiceAmount(inv)
  const paid = toNum(inv?.amount_paid)
  if (inv?.is_paid || (total > 0 && paid >= total - 0.009)) return 'paid'
  if (paid > 0.009) return 'partial'
  return 'unpaid'
}

function formatSaldoPasscom(value) {
  const n = toNum(value)
  const abs = Math.abs(n)
  const side = n >= 0 ? 'A' : 'D'
  return { value: n, abs, side, label: `${abs.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${side}` }
}

/**
 * Costruisce elenco fornitori + movimenti scheda (FR/PG) per società e periodo.
 */
export async function loadSchedaContabileFornitori({ company, dateFrom, dateTo } = {}) {
  const companyId = String(company || '').trim()
  if (!companyId) {
    return {
      parties: [],
      metrics: emptyMetrics(),
      company: '',
      companyLabel: '',
      warnings: ['Seleziona una società.'],
    }
  }

  const warnings = []
  const [invRes, issuedRes, bankRes] = await Promise.allSettled([
    fetchInvoices({ company: companyId, sync_from_bank: true }),
    fetchIssuedInvoices({ company: companyId }),
    fetchBancaMovimenti({}),
  ])

  const invoices = invRes.status === 'fulfilled'
    ? Array.isArray(invRes.value?.items)
      ? invRes.value.items
      : Array.isArray(invRes.value)
        ? invRes.value
        : []
    : []
  if (invRes.status === 'rejected') warnings.push('Fatture ricevute/registrate non disponibili.')

  const issued = issuedRes.status === 'fulfilled'
    ? Array.isArray(issuedRes.value?.items)
      ? issuedRes.value.items
      : Array.isArray(issuedRes.value)
        ? issuedRes.value
        : []
    : []
  if (issuedRes.status === 'rejected') warnings.push('Fatture emesse non disponibili.')

  const bankMovements = bankRes.status === 'fulfilled'
    ? Array.isArray(bankRes.value?.items)
      ? bankRes.value.items
      : Array.isArray(bankRes.value)
        ? bankRes.value
        : []
    : []
  if (bankRes.status === 'rejected') warnings.push('Movimenti banca non disponibili.')

  const built = buildSchedaContabileFornitori(invoices, issued, bankMovements, {
    company: companyId,
    dateFrom,
    dateTo,
  })

  return {
    ...built,
    company: companyId,
    companyLabel: companyId === 'non_classificata' ? 'Non classificate' : companyLabel(companyId),
    warnings,
  }
}

function emptyMetrics() {
  return {
    totalParties: 0,
    totalDare: 0,
    totalAvere: 0,
    finalBalance: 0,
    ricevuteCount: 0,
    pagateCount: 0,
    daPagareCount: 0,
    pagamentiCount: 0,
  }
}

export function buildSchedaContabileFornitori(
  receivedInvoices = [],
  issuedInvoices = [],
  bankMovements = [],
  { dateFrom, dateTo, company } = {},
) {
  const groups = new Map()

  const ensure = (name, extra = {}) => {
    const label = normalizePartyName(name) || 'Fornitore non indicato'
    const key = partyKey(label)
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name: label,
        code: extra.code || '',
        supplierId: extra.supplierId || null,
        totalDare: 0,
        totalAvere: 0,
        finalBalance: 0,
        ricevuteCount: 0,
        pagateCount: 0,
        daPagareCount: 0,
        pagamentiCount: 0,
        movements: [],
      })
    }
    const row = groups.get(key)
    if (!row.supplierId && extra.supplierId) row.supplierId = extra.supplierId
    if (!row.code && extra.code) row.code = extra.code
    return row
  }

  const inPeriod = (d) => {
    const day = String(d || '')
    if (dateFrom && day && day < dateFrom) return false
    if (dateTo && day && day > dateTo) return false
    return true
  }

  const paidInvoiceIds = new Set()

  // Pagamenti banca → Dare (PG)
  for (const row of bankMovements) {
    const movementType = String(row?.movement_type || '').toLowerCase()
    if (movementType !== 'uscita') continue
    const matched = row?.matched_invoice
    const amount = Math.abs(toNum(row?.amount))
    if (!amount) continue
    const date = isoDate(row?.movement_date)
    if (!inPeriod(date)) continue
    const name = matched?.supplier_name || row?.counterparty || ''
    if (!normalizePartyName(name)) continue
    const companyId = matched ? invoiceCompany(matched) : company || 'non_classificata'
    if (company && matched && companyId !== company) continue
    if (company && !matched) continue
    const number = matched ? invoiceNumber(matched) : ''
    const party = ensure(name, {
      supplierId: matched?.supplier_id != null ? Number(matched.supplier_id) : null,
    })
    party.totalDare += amount
    party.pagamentiCount += 1
    if (matched?.id) paidInvoiceIds.add(Number(matched.id))
    party.movements.push({
      date,
      documentDate: date,
      documento: number
        ? `PG ${row?.id || ''} ${formatDocDate(date)}`
        : `PG ${row?.id || ''} ${formatDocDate(date)}`,
      documentoTipo: 'PG',
      registrationNumber: `PG-${row?.id ?? ''}`,
      description: number ? `PAGAMENTO FR ${number}` : `PAGAMENTO ${row?.description || ''}`.trim(),
      documentLabel: number ? `FR ${number}` : `Mov. ${row?.id || ''}`,
      contropartita: 'BANCA C/C',
      counterparty: party.name,
      company: companyId,
      amount,
      dare: amount,
      avere: 0,
      source: 'pagamento_cc',
      invoiceKind: 'pagamento',
      paymentStatus: 'paid',
      linkedInvoiceId: matched?.id ? String(matched.id) : '',
    })
  }

  // Fatture ricevute (Atlas: registrate / da registrare / pagate) → Avere (FR)
  for (const inv of receivedInvoices) {
    const companyId = invoiceCompany(inv)
    if (company && companyId !== company) continue
    const amount = invoiceAmount(inv)
    if (!amount) continue
    const date = isoDate(inv?.invoice_date || inv?.issue_date || inv?.created_at || inv?.due_date)
    if (!inPeriod(date)) continue
    const name = inv?.supplier_name || (inv?.supplier_id ? `Fornitore #${inv.supplier_id}` : '')
    if (!normalizePartyName(name)) continue
    const number = invoiceNumber(inv)
    const status = paymentStatus(inv)
    const paidAmt = toNum(inv?.amount_paid)
    const party = ensure(name, {
      supplierId: inv?.supplier_id != null ? Number(inv.supplier_id) : null,
      code: inv?.supplier_id != null ? String(inv.supplier_id).padStart(5, '0') : '',
    })
    party.totalAvere += amount
    party.ricevuteCount += 1
    if (status === 'paid' || paidInvoiceIds.has(Number(inv?.id))) party.pagateCount += 1
    else party.daPagareCount += 1

    party.movements.push({
      date,
      documentDate: date,
      documento: `FR ${number || inv?.id || ''} ${formatDocDate(date)}`,
      documentoTipo: 'FR',
      registrationNumber: `FR-${inv?.id ?? ''}`,
      description: status === 'paid' ? `FATT. RICEV. (pagata)` : status === 'partial' ? `FATT. RICEV. (parziale)` : `FATT. RICEV.`,
      documentLabel: `FR ${number || inv?.id || ''}`,
      contropartita: 'COSTI / ACQUISTI',
      counterparty: party.name,
      company: companyId,
      amount,
      dare: 0,
      avere: amount,
      source: 'fatture_ricevute',
      invoiceKind: 'ricevuta',
      paymentStatus: status,
      linkedInvoiceId: inv?.id ? String(inv.id) : '',
      residuo: Math.max(0, amount - paidAmt),
    })

    // Se pagata in Atlas ma senza movimento banca matchato → PG virtuale
    if (paidAmt > 0.009 && !paidInvoiceIds.has(Number(inv?.id))) {
      const payDate = isoDate(inv?.paid_at || inv?.updated_at || date)
      if (inPeriod(payDate) || inPeriod(date)) {
        const useDate = inPeriod(payDate) ? payDate : date
        party.totalDare += paidAmt
        party.pagamentiCount += 1
        party.movements.push({
          date: useDate,
          documentDate: useDate,
          documento: `PG ${number || inv?.id || ''} ${formatDocDate(useDate)}`,
          documentoTipo: 'PG',
          registrationNumber: `PG-INV-${inv?.id ?? ''}`,
          description: `PAGAMENTO FR ${number || inv?.id || ''}`,
          documentLabel: `FR ${number || inv?.id || ''}`,
          contropartita: 'BANCA / CASSA',
          counterparty: party.name,
          company: companyId,
          amount: paidAmt,
          dare: paidAmt,
          avere: 0,
          source: 'pagamento_atlas',
          invoiceKind: 'pagamento',
          paymentStatus: 'paid',
          linkedInvoiceId: inv?.id ? String(inv.id) : '',
        })
      }
    }
  }

  // Fatture emesse verso lo stesso soggetto (cliente) — informative, lato Dare (FE)
  for (const inv of issuedInvoices) {
    const companyId = String(inv?.company || '').trim() || 'non_classificata'
    if (company && companyId !== company) continue
    const amount = invoiceAmount(inv)
    if (!amount) continue
    const date = isoDate(inv?.invoice_date || inv?.created_at)
    if (!inPeriod(date)) continue
    const name = normalizePartyName(inv?.customer_name || inv?.customer || inv?.cessionario)
    if (!name) continue
    // Solo se già presente come fornitore (stesso soggetto)
    const key = partyKey(name)
    if (!groups.has(key)) continue
    const party = groups.get(key)
    party.totalDare += amount
    party.movements.push({
      date,
      documentDate: date,
      documento: `FE ${invoiceNumber(inv) || inv?.id || ''} ${formatDocDate(date)}`,
      documentoTipo: 'FE',
      registrationNumber: `FE-${inv?.id ?? ''}`,
      description: 'FATT. EMESSA',
      documentLabel: `FE ${invoiceNumber(inv) || inv?.id || ''}`,
      contropartita: 'RICAVI',
      counterparty: party.name,
      company: companyId,
      amount,
      dare: amount,
      avere: 0,
      source: 'fatture_emesse',
      invoiceKind: 'emessa',
      paymentStatus: '',
      linkedInvoiceId: inv?.id ? String(inv.id) : '',
    })
  }

  const parties = [...groups.values()]
    .map((row) => {
      const movements = [...row.movements].sort((a, b) => {
        const da = String(a.date || '')
        const db = String(b.date || '')
        if (da !== db) return da.localeCompare(db)
        const order = { FR: 1, FE: 2, PG: 3 }
        const oa = order[a.documentoTipo] || 9
        const ob = order[b.documentoTipo] || 9
        if (oa !== ob) return oa - ob
        return String(a.registrationNumber || '').localeCompare(String(b.registrationNumber || ''))
      })
      // Passcom: saldo progressivo = Avere − Dare (positivo = Avere / debito verso fornitore)
      let progressive = 0
      const withBalance = movements.map((m) => {
        progressive += toNum(m.avere) - toNum(m.dare)
        const saldo = formatSaldoPasscom(progressive)
        return {
          ...m,
          progressiveBalance: progressive,
          progressiveLabel: saldo.label,
          progressiveSide: saldo.side,
        }
      })
      const final = formatSaldoPasscom(progressive)
      return {
        ...row,
        movements: withBalance,
        finalBalance: progressive,
        finalBalanceLabel: final.label,
        totalDare: withBalance.reduce((acc, m) => acc + toNum(m.dare), 0),
        totalAvere: withBalance.reduce((acc, m) => acc + toNum(m.avere), 0),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'it', { sensitivity: 'base' }))

  return {
    parties,
    metrics: {
      totalParties: parties.length,
      totalDare: parties.reduce((acc, p) => acc + toNum(p.totalDare), 0),
      totalAvere: parties.reduce((acc, p) => acc + toNum(p.totalAvere), 0),
      finalBalance: parties.reduce((acc, p) => acc + toNum(p.finalBalance), 0),
      ricevuteCount: parties.reduce((acc, p) => acc + toNum(p.ricevuteCount), 0),
      pagateCount: parties.reduce((acc, p) => acc + toNum(p.pagateCount), 0),
      daPagareCount: parties.reduce((acc, p) => acc + toNum(p.daPagareCount), 0),
      pagamentiCount: parties.reduce((acc, p) => acc + toNum(p.pagamentiCount), 0),
    },
  }
}

function formatDocDate(iso) {
  if (!iso || iso.length < 10) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export function printSchedaContabileFornitore({
  party,
  companyLabelText,
  dateFrom,
  dateTo,
}) {
  if (!party) return
  const movements = Array.isArray(party.movements) ? party.movements : []
  const dal = dateFrom ? formatDocDate(dateFrom) : '—'
  const al = dateTo ? formatDocDate(dateTo) : '—'
  const printDate = new Date().toLocaleDateString('it-IT')
  const contoLabel = party.code
    ? `001.${String(party.code).padStart(5, '0')} ${party.name}`
    : party.name

  const rowsHtml = [
    `<tr class="saldo-iniziale">
      <td></td>
      <td></td>
      <td><strong>SALDO INIZIALE</strong></td>
      <td></td>
      <td></td>
      <td></td>
      <td class="num">0,00 A</td>
    </tr>`,
    ...movements.map(
      (m) => `
      <tr>
        <td>${esc(formatDocDate(m.date))}</td>
        <td>${esc(m.documento || '')}</td>
        <td>${esc(m.description || '')}</td>
        <td class="num">${m.dare ? esc(eurPlain(m.dare)) : ''}</td>
        <td class="num">${m.avere ? esc(eurPlain(m.avere)) : ''}</td>
        <td>${esc(m.contropartita || '')}</td>
        <td class="num">${esc(m.progressiveLabel || '')}</td>
      </tr>`,
    ),
  ].join('')

  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <title>Scheda contabile — ${esc(party.name)}</title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    body { font-family: "Segoe UI", Arial, sans-serif; color: #111; font-size: 11px; margin: 0; }
    .head { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px 16px; margin-bottom: 10px; }
    .head .title { grid-column: 1 / -1; text-align: center; font-size: 18px; font-weight: 700; letter-spacing: 0.04em; margin: 4px 0 8px; }
    .meta strong { font-weight: 700; }
    .conto-bar {
      background: #2f6fed; color: #fff; padding: 8px 12px; font-weight: 700; font-size: 13px;
      margin: 8px 0 0;
    }
    table { width: 100%; border-collapse: collapse; margin-top: 0; }
    th {
      background: #2f6fed; color: #fff; text-align: left; padding: 6px 8px; font-size: 11px;
      border: 1px solid #1d4ed8;
    }
    td { border: 1px solid #cbd5e1; padding: 4px 6px; vertical-align: top; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    tr.saldo-iniziale td { background: #eff6ff; font-weight: 600; }
    .totali {
      background: #2f6fed; color: #fff; display: grid; grid-template-columns: 1fr auto auto auto;
      gap: 16px; padding: 8px 12px; margin-top: 0; font-weight: 700; align-items: center;
    }
    .riepilogo { margin-top: 12px; width: 420px; border-collapse: collapse; }
    .riepilogo th, .riepilogo td { border: 1px solid #94a3b8; padding: 4px 8px; }
    .riepilogo th { background: #e2e8f0; color: #0f172a; }
    .fine { margin-top: 16px; text-align: center; color: #64748b; }
    @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
  </style>
</head>
<body onload="setTimeout(function(){ try { window.focus(); window.print(); } catch(e) {} }, 250)">
  <div class="head">
    <div class="title">SCHEDA CONTABILE</div>
    <div><strong>Azienda:</strong> ${esc(companyLabelText || '—')}</div>
    <div><strong>Ordinam:</strong> Conto / Data Registrazione / Data Documento</div>
    <div><strong>Pagina:</strong> 1</div>
    <div><strong>Dal:</strong> ${esc(dal)} <strong>al</strong> ${esc(al)}</div>
    <div><strong>Data di stampa:</strong> ${esc(printDate)}</div>
    <div><strong>Modulo:</strong> SCHEDA FORNITORE ATLAS</div>
  </div>
  <div class="conto-bar">Conto: ${esc(contoLabel)}</div>
  <table>
    <thead>
      <tr>
        <th>Data reg.</th>
        <th>Documento</th>
        <th>Descrizione riga</th>
        <th class="num">Dare</th>
        <th class="num">Avere</th>
        <th>Contropartita</th>
        <th class="num">Saldo Progressivo</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div class="totali">
    <div>TOTALI</div>
    <div>Dare ${esc(eurPlain(party.totalDare))}</div>
    <div>Avere ${esc(eurPlain(party.totalAvere))}</div>
    <div>Saldo ${esc(party.finalBalanceLabel || eurPlain(party.finalBalance))}</div>
  </div>
  <table class="riepilogo">
    <tr><th></th><th>Dare</th><th>Avere</th><th>Saldo</th></tr>
    <tr>
      <td>Periodo dal ${esc(dal)} al ${esc(al)}</td>
      <td class="num">${esc(eurPlain(party.totalDare))}</td>
      <td class="num">${esc(eurPlain(party.totalAvere))}</td>
      <td class="num">${esc(party.finalBalanceLabel || '')}</td>
    </tr>
    <tr>
      <td>Saldo progressivo al ${esc(al)}</td>
      <td></td><td></td>
      <td class="num">${esc(party.finalBalanceLabel || '')}</td>
    </tr>
  </table>
  <p class="fine">— Fine Stampa —</p>
</body>
</html>`

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const w = window.open(url, '_blank')
  if (!w) {
    URL.revokeObjectURL(url)
    window.alert('Consenti i popup del browser per stampare la scheda contabile.')
    return
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function eurPlain(value) {
  return toNum(value).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
