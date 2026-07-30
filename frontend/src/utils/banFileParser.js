/** Parser file BAN / CBI / testo bancario: IBAN, nome banca e movimenti. */

const ABI_BANK_NAMES = {
  '01000': 'Banca d’Italia',
  '01005': 'Banca Nazionale del Lavoro',
  '01010': 'Banca Popolare di Sondrio',
  '01015': 'Banco BPM',
  '01025': 'Intesa Sanpaolo',
  '01030': 'Banca Monte dei Paschi di Siena',
  '02008': 'UniCredit',
  '03032': 'Credito Emiliano (Credem)',
  '03069': 'Intesa Sanpaolo',
  '03111': 'UniCredit',
  '03124': 'Banca Mediolanum',
  '03268': 'Banca Sella',
  '03353': 'FinecoBank',
  '05034': 'Banco BPM',
  '05387': 'BPER Banca',
  '05428': 'Credito Emiliano (Credem)',
  '06040': 'Banca Popolare di Bari',
  '06160': 'Cassa di Risparmio di Asti',
  '06230': 'Cassa di Risparmio di Cento',
  '06300': 'Cassa di Risparmio di Fermo',
  '08327': 'Banca di Credito Cooperativo',
  '08445': "BCC Terra d'Otranto",
  '08899': 'Postepay / BancoPosta',
  '36081': 'ING Bank',
  '50115': 'Crédit Agricole Italia',
}

const BANK_NAME_HINTS = [
  [/intesasanpaolo|intesa\s*san\s*paolo|sanpaolo/i, 'Intesa Sanpaolo'],
  [/unicredit/i, 'UniCredit'],
  [/banco\s*bpm|banca\s*popolare\s*di\s*milano|bpm/i, 'Banco BPM'],
  [/monte\s*dei\s*paschi|mps\b/i, 'Banca Monte dei Paschi di Siena'],
  [/bper\b/i, 'BPER Banca'],
  [/credem|credito\s*emiliano/i, 'Credito Emiliano (Credem)'],
  [/fineco/i, 'FinecoBank'],
  [/mediolanum/i, 'Banca Mediolanum'],
  [/sella/i, 'Banca Sella'],
  [/postepay|bancoposta|poste\s*italiane/i, 'Postepay / BancoPosta'],
  [/ing\s*bank|\bing\b/i, 'ING Bank'],
  [/cr[eé]dit\s*agricole|credit\s*agricole/i, 'Crédit Agricole Italia'],
  [/bcc\s*terra\s*d['’]?\s*otranto|terra\s*d['’]?\s*otranto/i, "BCC Terra d'Otranto"],
  [/bnl\b|lavoro/i, 'Banca Nazionale del Lavoro'],
  [/popolare\s*di\s*sondrio/i, 'Banca Popolare di Sondrio'],
]

function normalizeIban(raw) {
  if (!raw) return ''
  return String(raw)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

function findIbans(text) {
  const out = []
  const spaced = text.match(/\bIT\s*\d{2}(?:\s*[A-Z0-9]){23}\b/gi) || []
  for (const m of spaced) {
    const n = normalizeIban(m)
    if (n.length === 27 && !out.includes(n)) out.push(n)
  }
  const compact = text.match(/\bIT\d{2}[A-Z0-9]{23}\b/gi) || []
  for (const m of compact) {
    const n = normalizeIban(m)
    if (n.length === 27 && !out.includes(n)) out.push(n)
  }
  return out
}

function abiFromIban(iban) {
  const n = normalizeIban(iban)
  if (!n.startsWith('IT') || n.length < 10) return ''
  return n.slice(5, 10)
}

function bankNameFromAbi(abi) {
  if (!abi) return ''
  return ABI_BANK_NAMES[String(abi).padStart(5, '0')] || ''
}

function bankNameFromText(text) {
  for (const [re, name] of BANK_NAME_HINTS) {
    if (re.test(text)) return name
  }
  return ''
}

function parseItalianAmount(raw) {
  if (raw == null) return null
  let s = String(raw).trim()
  if (!s) return null
  s = s.replace(/\s/g, '')
  // 1.234,56 or 1234,56
  if (/^-?\d{1,3}(\.\d{3})*,\d{2}$/.test(s) || /^-?\d+,\d{2}$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (/^-?\d{1,3}(,\d{3})*\.\d{2}$/.test(s)) {
    s = s.replace(/,/g, '')
  } else {
    s = s.replace(',', '.')
  }
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) / 100 : null
}

function parseCbiDate6(raw) {
  const s = String(raw || '').replace(/\D/g, '')
  if (s.length !== 6) return null
  const dd = Number(s.slice(0, 2))
  const mm = Number(s.slice(2, 4))
  let yy = Number(s.slice(4, 6))
  if (!dd || !mm || mm > 12 || dd > 31) return null
  yy = yy >= 70 ? 1900 + yy : 2000 + yy
  const iso = `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  return iso
}

function parseLooseDate(raw) {
  const s = String(raw || '').trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/)
  if (m) {
    const dd = Number(m[1])
    const mm = Number(m[2])
    let yy = Number(m[3])
    if (yy < 100) yy = yy >= 70 ? 1900 + yy : 2000 + yy
    if (!dd || !mm || mm > 12 || dd > 31) return null
    return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
  }
  m = s.match(/^(\d{8})$/)
  if (m) {
    // yyyymmdd or ddmmyyyy
    const a = m[1]
    const y1 = Number(a.slice(0, 4))
    if (y1 >= 1990 && y1 <= 2100) {
      return `${a.slice(0, 4)}-${a.slice(4, 6)}-${a.slice(6, 8)}`
    }
    return parseCbiDate6(`${a.slice(0, 2)}${a.slice(2, 4)}${a.slice(6, 8)}`)
  }
  return null
}

function movementKey(mov) {
  return [mov.movement_date, mov.movement_type, Number(mov.amount).toFixed(2), (mov.description || '').slice(0, 80)].join('|')
}

function parseCbi61Line(line) {
  const raw = String(line || '')
  if (!/^61/.test(raw) || raw.length < 35) return null
  const dateIso = parseCbiDate6(raw.slice(7, 13)) || parseCbiDate6(raw.slice(13, 19))
  if (!dateIso) return null
  const signChar = (raw[19] || '').toUpperCase()
  const amountRaw = raw.slice(20, 35).replace(/\D/g, '')
  if (!amountRaw) return null
  const amount = Math.round(Number(amountRaw)) / 100
  if (!Number.isFinite(amount) || amount <= 0) return null
  const causale = raw.slice(35, 37).trim()
  const isCredit = signChar === 'C' || signChar === '+'
  const isDebit = signChar === 'D' || signChar === '-'
  if (!isCredit && !isDebit) return null
  return {
    movement_date: dateIso,
    description: 'Movimento BAN',
    causale: causale || null,
    movement_type: isCredit ? 'entrata' : 'uscita',
    amount,
    counterparty: null,
  }
}

function parseCsvLikeLine(line) {
  const raw = String(line || '').trim()
  if (!raw || raw.startsWith('#')) return null
  const parts = raw.includes(';')
    ? raw.split(';')
    : raw.includes('\t')
      ? raw.split('\t')
      : raw.includes(',') && /\d[.,]\d{2}/.test(raw)
        ? raw.split(',')
        : null
  if (!parts || parts.length < 2) return null

  let dateIso = null
  let amount = null
  let signHint = null
  const textBits = []
  for (const part of parts) {
    const p = String(part || '').trim()
    if (!p) continue
    if (!dateIso) {
      const d = parseLooseDate(p)
      if (d) {
        dateIso = d
        continue
      }
    }
    const lower = p.toLowerCase()
    if (/^(entrata|credito|c|\+)$/.test(lower)) {
      signHint = 'entrata'
      continue
    }
    if (/^(uscita|debito|d|-)$/.test(lower)) {
      signHint = 'uscita'
      continue
    }
    const amt = parseItalianAmount(p.replace(/^[€\s]+/, ''))
    if (amt != null && amount == null && /[0-9]/.test(p)) {
      amount = amt
      if (p.trim().startsWith('-')) signHint = signHint || 'uscita'
      if (p.trim().startsWith('+')) signHint = signHint || 'entrata'
      continue
    }
    textBits.push(p)
  }
  if (!dateIso || amount == null || amount <= 0) return null
  return {
    movement_date: dateIso,
    description: textBits.join(' ').trim() || 'Movimento BAN',
    causale: null,
    movement_type: signHint || 'uscita',
    amount,
    counterparty: null,
  }
}

function parseLooseMovementLine(line) {
  const raw = String(line || '').trim()
  if (!raw) return null
  const dateMatch = raw.match(/(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})/)
  const amountMatch = raw.match(/([+-]?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|[+-]?\d+[.,]\d{2})/)
  if (!dateMatch || !amountMatch) return null
  const dateIso = parseLooseDate(dateMatch[1])
  const amount = parseItalianAmount(amountMatch[1])
  if (!dateIso || amount == null || amount <= 0) return null
  let movementType = 'uscita'
  if (/[+]/.test(amountMatch[1]) || /\b(accredito|entrata|bonifico\s+in)/i.test(raw)) movementType = 'entrata'
  if (/-/.test(amountMatch[1]) || /\b(addebito|uscita|pagamento)/i.test(raw)) movementType = 'uscita'
  const description = raw
    .replace(dateMatch[0], ' ')
    .replace(amountMatch[0], ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return {
    movement_date: dateIso,
    description: description || 'Movimento BAN',
    causale: null,
    movement_type: movementType,
    amount,
    counterparty: null,
  }
}

function extractMovements(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const movements = []
  let current = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (/^62/.test(trimmed) && current) {
      const extra = trimmed.slice(2).replace(/^\d+/, '').trim()
      if (extra) {
        current.description =
          current.description && current.description !== 'Movimento BAN'
            ? `${current.description} ${extra}`.trim()
            : extra
      }
      continue
    }

    const cbi = parseCbi61Line(trimmed)
    if (cbi) {
      if (current) movements.push(current)
      current = cbi
      continue
    }

    const csv = parseCsvLikeLine(trimmed)
    if (csv) {
      if (current) movements.push(current)
      current = csv
      continue
    }

    const loose = parseLooseMovementLine(trimmed)
    if (loose) {
      if (current) movements.push(current)
      current = loose
    }
  }
  if (current) movements.push(current)

  const seen = new Set()
  const unique = []
  for (const mov of movements) {
    const key = movementKey(mov)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(mov)
  }
  return unique
}

/**
 * @param {string} text
 * @param {string} [fileName]
 */
export function parseBanFileContent(text, fileName = '') {
  const warnings = []
  const blob = `${fileName || ''}\n${text || ''}`
  const ibans = findIbans(blob)
  const iban = ibans[0] || ''
  if (!iban) warnings.push('IBAN non trovato nel file BAN')

  const abi = abiFromIban(iban)
  let bankName = bankNameFromText(blob) || bankNameFromAbi(abi)
  if (!bankName && abi) {
    bankName = `Banca ABI ${abi}`
    warnings.push(`Nome banca non riconosciuto (ABI ${abi}): impostato un nome generico`)
  }
  if (!bankName) warnings.push('Nome banca non rilevato')

  const movements = extractMovements(text)
  if (!movements.length) warnings.push('Nessun movimento rilevato nel file BAN')

  return {
    iban,
    bankName,
    abi,
    movements,
    warnings,
  }
}

export async function parseBanFile(file) {
  const text = await file.text()
  return parseBanFileContent(text, file?.name || '')
}
