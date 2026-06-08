/**
 * Compilazione immediata lato browser (senza attendere Ollama).
 */

function digitsOnly(s) {
  return String(s || '').replace(/\D/g, '')
}

const IT_SPOKEN_DIGITS = {
  zero: '0',
  zeri: '0',
  uno: '1',
  una: '1',
  un: '1',
  due: '2',
  tre: '3',
  quattro: '4',
  cinque: '5',
  sei: '6',
  sette: '7',
  otto: '8',
  nove: '9',
}

const FIELD_BOUNDARY =
  /\s+(?=(?:citt[aà]|city|categoria(?:\s+merceologica)?|listino(?:\s+associato)?|note(?:\s+interne)?|condizioni(?:\s+di)?\s+pagamento|pagament[oi]|email|e-?mail|pec|telefono|tel\.?|cell|cellulare|iban|partit[a]?\s*iva|piva|codice\s*fiscale|cod\.?\s*fisc|referente|contatto|responsabile|nome|indirizzo|via\b|piazza\b|viale\b|corso\b)\b)/i

const CATEGORY_KEYWORDS = [
  ['bevande', ['bevande', 'acqua', 'vino', 'birra', 'bibita']],
  ['ortofrutta', ['ortofrutta', 'frutta', 'verdura', 'ortaggi']],
  ['carne', ['carne', 'macelleria', 'salumi', 'salumeria']],
  ['pesce', ['pesce', 'pescheria', 'ittico']],
  ['panificio', ['panificio', 'pane', 'panetteria', 'pasticceria', 'dolci']],
  ['utenze', ['luce', 'gas', 'acquedotto', 'energia', 'utenze']],
  ['manutenzione', ['manutenzione']],
]

function normalizeLo(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function trimAtNextField(val) {
  const s = String(val || '').trim()
  if (!s) return ''
  const m = FIELD_BOUNDARY.exec(s)
  const cut = m ? s.slice(0, m.index).trim() : s
  return cut.replace(/[,;.\s-]+$/, '')
}

const CATEGORY_STOP =
  /(?=\s+(?:listino(?:\s+associato)?|note(?:\s+interne)?|condizioni(?:\s+di)?\s+pagamento|pagament[oi]|email|telefono|iban|citt[aà])\b|\s*$)/i

function cleanMerchandiseCategory(val) {
  let s = trimAtNextField(val)
  s = s.split(/\s+listino(?:\s+associato)?\b/i)[0].trim()
  s = s.split(/\s+note(?:\s+interne)?\b/i)[0].trim()
  const words = s.split(/\s+/).filter(
    (w) => !['listino', 'associato', 'merceologica', 'categoria'].includes(w.toLowerCase()),
  )
  if (!words.length) return ''
  const lo = words.join(' ').toLowerCase()
  for (const [label, keys] of CATEGORY_KEYWORDS) {
    if (lo.split(/\s+/).some((w) => keys.includes(w)) || keys.includes(lo)) return label
  }
  return words.slice(0, 3).join(' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function cleanSupplierName(val) {
  let s = String(val || '').trim()
  s = s
    .replace(/^(?:ragione\s+sociale|denominazione|nome(?:\s+fornitore)?|fornitore|ditta)\s*[:\s]*/i, '')
    .trim()
  s = trimAtNextField(s)
  s = s
    .split(
      /\s+(?:partit[a]?\s*iva|partiva\s*iva|p\.?\s*iva|piva|codice\s*fiscale|cod\.?\s*fisc|email|e-?mail|pec|telefono|tel\.?|cell|iban|categoria|listino|note|condizioni|pagament|referente|contatto|responsabile|citt[aà]|city)\b/i,
    )[0]
    .trim()
  s = s.replace(/\s+\d{11}\b.*$/, '').trim()
  s = s.replace(/\s+IT\s*\d{11}\b.*$/i, '').trim()
  s = s.replace(/\s+[a-z0-9._%+-]+@[^\s,;]+.*$/i, '').trim()
  s = s.replace(/\s+(?:\+?39\s?)?0[0-9](?:[\s./-]*\d){6,}.*$/, '').trim()
  s = s.replace(/[,;.\s-]+$/, '')
  return s.length >= 2 ? s.slice(0, 80) : ''
}

function extractSupplierName(t) {
  const s = String(t || '').trim()
  if (!s) return ''
  const mFor = s.match(
    /(?:fornitore|ditta)\s+(.+?)(?=\s+(?:nome|referente|contatto|partita|partiva|p\.?\s*iva|piva|codice|email|telefono|tel|citt[aà]|city|listino|note|condizioni|pagament)\b|$)/i,
  )
  if (mFor) {
    const n = cleanSupplierName(mFor[1])
    if (n) return n
  }
  const mRs = s.match(
    /(?:ragione\s+sociale|denominazione|nome\s+fornitore|ditta)\s*[:\s]+([A-Za-zÀ-ÿ0-9' .&\-]{2,80}?)(?=\s+(?:partit[a]?\s*iva|partiva\s*iva|p\.?\s*iva|piva|codice\s*fiscale|cod\.?\s*fisc|email|e-?mail|pec|telefono|tel\.?|cell|cellulare|iban|categoria|listino|note|condizioni|pagament|referente|contatto|citt[aà]|city)\b|\s*$)/i,
  )
  if (mRs) {
    const n = cleanSupplierName(mRs[1])
    if (n) return n
  }
  const seg = s.split(/[,;\n]/)[0].trim()
  return cleanSupplierName(seg)
}

function cleanPriceListLabel(val) {
  let s = trimAtNextField(val).trim()
  s = s.replace(/^listino\s+associato\s+/i, '').trim()
  s = s.replace(/^associato\s+/i, '').trim()
  s = s.split(/\s+note(?:\s+interne)?\b/i)[0].trim()
  return s.length >= 2 ? s.slice(0, 80) : ''
}

function spokenItalianDigits(s) {
  const lo = normalizeLo(s)
  const out = []
  for (const raw of lo.split(/\s+/)) {
    const w = raw.replace(/[^a-z0-9]/g, '')
    if (!w) continue
    if (/^\d+$/.test(w)) {
      out.push(w)
      continue
    }
    const d = IT_SPOKEN_DIGITS[w]
    if (d != null && d.length === 1) out.push(d)
  }
  return out.join('')
}

function vatLabelPattern() {
  return /(?:partit[a]?\s*iva|partitaiva|partiva\s*iva|parita\s*iva|p\.?\s*i\.?\s*v\.?a?\.?|piva|pi\s+va|\biva\b)(?:\s*(?:numero|n\.?|°|e|è))?/i
}

function vatChunkAfterLabel(t, end) {
  const rest = t.slice(end, end + 120)
  return rest.split(
    /\s+(?=codice\s+fiscale|cod\.?\s*fisc|email|e-?mail|telefono|tel\.?|cell|iban|categoria|nome|referente|partita|piva)\b/i,
  )[0]
}

function digitsFromVatChunk(chunk) {
  const d = digitsOnly(chunk)
  if (d.length >= 11) return d.slice(-11)
  const spoken = spokenItalianDigits(chunk)
  if (spoken.length >= 11) return spoken.slice(-11)
  return ''
}

function extractVatNumber(t) {
  const vatHead = vatLabelPattern()
  const mHead = t.match(vatHead)
  if (mHead) {
    const d = digitsFromVatChunk(vatChunkAfterLabel(t, mHead.index + mHead[0].length))
    if (d) return d
  }
  const vatLabel =
    /(?:partit[a]?\s*iva|partitaiva|partiva\s*iva|parita\s*iva|p\.?\s*i\.?\s*v\.?a?\.?|piva|pi\s+va|\biva\b)(?:\s*(?:numero|n\.?|°|e|è))?\s*[:\s]*(?:it\s*)?([\d][\d\s./-]{9,28})/i
  const m = t.match(vatLabel)
  if (m) {
    const d = digitsFromVatChunk(m[1])
    if (d) return d
  }
  const mIt = t.match(/\bIT\s*(\d[\d\s./-]{9,18})\b/i)
  if (mIt) {
    const d = digitsOnly(mIt[1])
    if (d.length >= 11) return d.slice(-11)
  }
  const lo = normalizeLo(t)
  if (/partit|partitaiva|piva|parita\s*iva|\biva\b/.test(lo)) {
    const m11 = t.match(/\b(\d{11})\b/)
    if (m11) return m11[1]
  }
  const chunks = t.matchAll(/\b(\d[\d\s./-]{9,18}\d)\b/g)
  for (const c of chunks) {
    const d = digitsOnly(c[1])
    if (d.length === 11 && !d.startsWith('0')) return d
  }
  const m11 = t.match(/\b(\d{11})\b/)
  if (m11 && !m11[1].startsWith('0')) return m11[1]
  return ''
}

function extractFiscalCode(t) {
  const cfHead = /(?:codice\s*fiscale|cod\.?\s*fisc\.?|c\.?\s*f\.?)\s*[:\s]*(?:è\s+)?/i
  const mHead = t.match(cfHead)
  if (mHead) {
    const rest = t.slice(mHead.index + mHead[0].length, mHead.index + mHead[0].length + 64)
    const chunk = rest.split(
      /\s+(?=partit[a]?\s*iva|p\.?\s*iva|piva|email|e-?mail|telefono|tel\.?|cell|iban|categoria|nome|referente)\b/i,
    )[0]
    const cf = chunk.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
    if (cf.length >= 11) return cf.slice(0, 16)
  }
  const m = t.match(
    /(?:codice\s*fiscale|cod\.?\s*fisc\.?|c\.?\s*f\.?)\s*[:\s]*([A-Za-z0-9][A-Za-z0-9\s]{10,22})/i,
  )
  if (m) {
    const cf = m[1].replace(/\s+/g, '').toUpperCase()
    if (cf.length >= 11) return cf.slice(0, 16)
  }
  const m2 = t.match(/\b([A-Za-z]{6}\d{2}[A-Za-z]\d{2}[A-Za-z]\d{3}[A-Za-z])\b/i)
  if (m2) return m2[1].toUpperCase()
  return ''
}

function extractContactPerson(t) {
  const m = t.match(
    /\b(?:nome|referente|contatto|responsabile|persona)\s+(?:del\s+referente\s+)?(?:è\s+)?([A-Za-zÀ-ÿ' .\-]{2,60})/i,
  )
  if (!m) return ''
  const ref = trimAtNextField(m[1].split(/[,;\n]/)[0].trim())
  return ref.length >= 2 && ref.length <= 60 ? ref : ''
}

function extractCity(t) {
  const m = t.match(/(?:citt[aà]|city)\s*[:\s]+([A-Za-zÀ-ÿ' .\-]{2,50})/i)
  if (!m) return ''
  const city = trimAtNextField(m[1].trim())
  return city.length >= 2 ? city.slice(0, 50) : ''
}

function extractMerchandiseCategory(t) {
  const m = t.match(
    /categoria\s*(?:merceologica)?\s*[:\s]+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s\-]*?)(?=\s+(?:listino(?:\s+associato)?|note(?:\s+interne)?|condizioni(?:\s+di)?\s+pagamento|pagament[oi]|email|telefono|iban|citt[aà])\b|\s*$)/i,
  )
  if (m) return cleanMerchandiseCategory(m[1])
  const lo = normalizeLo(t)
  if (/\bcategoria\b/.test(lo)) return ''
  for (const [label, keys] of CATEGORY_KEYWORDS) {
    for (const k of keys) {
      if (new RegExp(`\\b${k}\\b`, 'i').test(lo)) return label
    }
  }
  return ''
}

function extractPriceListLabel(t) {
  const m = t.match(/listino(?:\s+associato)?(?:\s*\([^)]*\))?\s*(?:è\s+)?(?:[:\s]+)?/i)
  if (!m) return ''
  return cleanPriceListLabel(t.slice(m.index + m[0].length))
}

function extractSupplierNotes(t) {
  const m = t.match(
    /\bnote(?:\s+interne)?\s*[:\s]+(.+?)(?=\s+(?:condizioni(?:\s+di)?\s+pagamento|pagament[oi]|listino|categoria|email|telefono|iban|citt[aà])\b|\s*$)/is,
  )
  if (!m) return ''
  const notes = trimAtNextField(m[1].trim())
  return notes.length >= 2 ? notes.slice(0, 500) : ''
}

function extractPaymentTerms(t) {
  const m = t.match(
    /(?:condizioni\s+(?:di\s+)?pagamento|pagament[oi])\s*[:\s]+(.+?)(?=\s+(?:listino|note(?:\s+interne)?|categoria|email|telefono|iban|citt[aà]|referente)\b|\s*$)/is,
  )
  if (m) {
    const val = trimAtNextField(m[1].trim())
    if (val) return val.slice(0, 80)
  }
  const mB = t.match(/\bbonifico\s+(\d+\s*(?:gg|giorni)(?:\s+fine\s+mese)?)\b/i)
  if (mB) return `Bonifico ${mB[1].trim()}`
  const lo = normalizeLo(t)
  if (/\bbonifico\b/.test(lo)) return 'Bonifico'
  if (/\brid\b/.test(lo)) return 'RID'
  if (lo.includes('ricevuta bancaria') || lo.includes('ri.ba')) return 'Ricevuta bancaria'
  if (/\bcontanti?\b/.test(lo)) return 'Contanti'
  return ''
}

function enrichSupplierFields(text, suggested = {}) {
  const out = { ...(suggested || {}) }
  const nm = extractSupplierName(text)
  if (nm) out.name = nm
  else if (out.name) {
    const cleaned = cleanSupplierName(String(out.name))
    if (cleaned) out.name = cleaned
    else delete out.name
  }
  const v = extractVatNumber(text)
  if (v && !String(out.vat_number || '').trim()) out.vat_number = v
  const cf = extractFiscalCode(text)
  if (cf && !String(out.fiscal_code || '').trim()) out.fiscal_code = cf
  const ref = extractContactPerson(text)
  if (ref && !String(out.contact_person || '').trim()) out.contact_person = ref
  const city = extractCity(text)
  if (city && !String(out.city || '').trim()) out.city = city
  const cat = extractMerchandiseCategory(text)
  if (cat) out.merchandise_category = cat
  else if (out.merchandise_category) {
    const cleaned = cleanMerchandiseCategory(String(out.merchandise_category))
    if (cleaned) out.merchandise_category = cleaned
    else delete out.merchandise_category
  }
  const plist = extractPriceListLabel(text)
  if (plist) out.price_list_label = plist
  else if (out.price_list_label) {
    const cleaned = cleanPriceListLabel(String(out.price_list_label))
    if (cleaned) out.price_list_label = cleaned
    else delete out.price_list_label
  }
  const notes = extractSupplierNotes(text)
  if (notes && !String(out.notes || '').trim()) out.notes = notes
  const pay = extractPaymentTerms(text)
  if (pay && !String(out.payment_terms || '').trim()) out.payment_terms = pay
  return out
}

function mergeSupplierFields(text, base, remote) {
  const out = enrichSupplierFields(text, { ...(base || {}) })
  for (const [k, v] of Object.entries(remote || {})) {
    if (v != null && String(v).trim()) out[k] = v
  }
  return enrichSupplierFields(text, out)
}

function parseSupplierVoiceLocal(text) {
  const t = String(text || '').trim()
  if (!t) return { suggested_fields: {}, completeEnough: false }

  const sf = {}
  const lo = t.toLowerCase()

  const ref = extractContactPerson(t)
  if (ref) sf.contact_person = ref

  Object.assign(sf, enrichSupplierFields(t, sf))

  const mEmail = t.match(/([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i)
  if (mEmail) sf.email = mEmail[1]

  const mPhone = t.match(/(?:telefono|tel\.?|cell\.?)\s*[:\s]*([0-9+][0-9+\s\-/.]{6,20})/i)
  if (mPhone) sf.phone = mPhone[1].replace(/[^\d+]/g, '').slice(0, 15)
  else {
    const mPh2 = t.match(/\b((?:\+?39\s?)?0[0-9](?:[\s.\-]?\d){7,10})\b/)
    if (mPh2) sf.phone = mPh2[1].replace(/[^\d+]/g, '').slice(0, 15)
  }

  const mIban = t.match(/\b([A-Z]{2}\d{2}[A-Z0-9]{10,30})\b/i)
  if (mIban) sf.iban = mIban[1].toUpperCase()

  const coreKeys = [
    'name',
    'vat_number',
    'fiscal_code',
    'email',
    'phone',
    'contact_person',
    'city',
    'iban',
    'merchandise_category',
    'payment_terms',
    'notes',
    'price_list_label',
  ]
  const completeEnough = coreKeys.some((k) => String(sf[k] || '').trim().length > 0)

  return { suggested_fields: sf, completeEnough }
}

export {
  parseSupplierVoiceLocal,
  extractVatNumber,
  extractFiscalCode,
  enrichSupplierFields,
  mergeSupplierFields,
}
