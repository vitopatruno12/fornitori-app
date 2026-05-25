/**
 * Compilazione immediata lato browser (senza attendere Ollama).
 */

function digitsOnly(s) {
  return String(s || '').replace(/\D/g, '')
}

function extractVatNumber(t) {
  const vatHead =
    /(?:partit[a]?\s*iva|partiva\s*iva|p\.?\s*i\.?\s*v\.?a?\.?|piva|pi\s+va)(?:\s*(?:numero|n\.?|°))?\s*[:\s]*(?:it\s*)?/i
  const mHead = t.match(vatHead)
  if (mHead) {
    const rest = t.slice(mHead.index + mHead[0].length, mHead.index + mHead[0].length + 48)
    const chunk = rest.split(
      /\s+(?=codice\s+fiscale|cod\.?\s*fisc|email|e-?mail|telefono|tel\.?|cell|iban|categoria|nome|referente|partita|piva)\b/i,
    )[0]
    const d = digitsOnly(chunk)
    if (d.length >= 11) return d.slice(-11)
  }
  const vatLabel =
    /(?:partit[a]?\s*iva|partiva\s*iva|p\.?\s*i\.?\s*v\.?a?\.?|piva|pi\s+va)(?:\s*(?:numero|n\.?|°))?\s*[:\s]*(?:it\s*)?([\d][\d\s./-]{9,28})/i
  const m = t.match(vatLabel)
  if (m) {
    const d = digitsOnly(m[1])
    if (d.length >= 11) return d.slice(-11)
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

function parseSupplierVoiceLocal(text) {
  const t = String(text || '').trim()
  if (!t) return { suggested_fields: {}, completeEnough: false }

  const sf = {}
  const lo = t.toLowerCase()

  const mFor = t.match(
    /(?:fornitore|ditta)\s+(.+?)(?=\s+(?:nome|referente|contatto|partita|partiva|p\.?\s*iva|piva|codice|email|telefono|tel)\b|$)/i,
  )
  if (mFor) {
    sf.name = mFor[1].trim().replace(/[,;.\s]+$/, '').slice(0, 80)
  }

  const mNome = t.match(/\b(?:nome|referente|contatto|responsabile)\s+(?:è\s+)?([A-Za-zÀ-ÿ' .]{2,60})/i)
  if (mNome) sf.contact_person = mNome[1].trim().split(/[,;]/)[0]

  if (!sf.name) {
    let seg = t.split(/[,;\n]/)[0].trim()
    seg = seg.replace(/^fornitore\s+/i, '').trim()
    const cut = seg.search(
      /\s+(?=(?:partita|partiva|p\.?\s*iva|piva|codice|email|telefono|tel\.?|nome|referente)\b)/i,
    )
    if (cut > 0) seg = seg.slice(0, cut).trim()
    if (seg.length >= 2 && seg.length <= 80) sf.name = seg
  }

  const vat = extractVatNumber(t)
  if (vat) sf.vat_number = vat

  const cf = extractFiscalCode(t)
  if (cf) sf.fiscal_code = cf

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

  if (/bonifico|rid|contanti|assegno/i.test(lo)) {
    const mPay = t.match(/(?:pagament[oi]|bonifico)\s*([^,;\n]{2,60})/i)
    sf.payment_terms = mPay ? mPay[1].trim() : 'bonifico'
  }

  const coreKeys = ['name', 'vat_number', 'fiscal_code', 'email', 'phone', 'contact_person', 'iban']
  const completeEnough = coreKeys.some((k) => String(sf[k] || '').trim().length > 0)

  return { suggested_fields: sf, completeEnough }
}

export { parseSupplierVoiceLocal, extractVatNumber, extractFiscalCode }
