const IT_NUM_WORDS = {
  uno: 1,
  una: 1,
  un: 1,
  due: 2,
  tre: 3,
  quattro: 4,
  cinque: 5,
  sei: 6,
  sette: 7,
  otto: 8,
  nove: 9,
  dieci: 10,
  undici: 11,
  dodici: 12,
}

function parseQuantityToken(tok) {
  const t = String(tok || '')
    .trim()
    .toLowerCase()
  if (!t) return null
  if (IT_NUM_WORDS[t] != null) return IT_NUM_WORDS[t]
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}

/** Rimuove parole unità dal nome prodotto. */
function cleanProductName(name) {
  return String(name || '')
    .replace(/\b(?:pezzi?|pz\.?|kg|chilogrammi?|di|del|della|un|una)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, '')
}

function extractPiecesFromPhrase(text) {
  let remainder = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
  const patterns = [
    /(\d+)\s*pezzi?\b/i,
    /\bpezzi?\s*(\d+)\b/i,
    /\bpezzi?\s+([a-zàèéìòù]+)\b/i,
    /\b([a-zàèéìòù]+)\s+pezzi?\b/i,
  ]
  for (const re of patterns) {
    const m = remainder.match(re)
    if (!m) continue
    const n = parseQuantityToken(m[1])
    if (n != null) {
      remainder = (remainder.slice(0, m.index) + remainder.slice(m.index + m[0].length)).trim()
      return { pieces: n, remainder }
    }
  }
  return { pieces: null, remainder }
}

function extractFromMixedPhrase(text) {
  let remainder = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
  let pieces = null
  let weight_kg = null

  const pe = extractPiecesFromPhrase(remainder)
  pieces = pe.pieces
  remainder = pe.remainder

  let m = remainder.match(/(\d+(?:[.,]\d+)?)\s*kg\b/i)
  if (m) {
    weight_kg = Number(String(m[1]).replace(',', '.'))
    remainder = (remainder.slice(0, m.index) + remainder.slice(m.index + m[0].length)).trim()
  } else {
    m = remainder.match(/\bkg\s*(\d+(?:[.,]\d+)?)\b/i)
    if (m) {
      weight_kg = Number(String(m[1]).replace(',', '.'))
      remainder = (remainder.slice(0, m.index) + remainder.slice(m.index + m[0].length)).trim()
    }
  }

  remainder = remainder.replace(/\b(?:pezzi?|pz\.?|kg)\b/gi, ' ').replace(/\s+/g, ' ').trim()

  m = remainder.match(/^(\d+)\s*[x×]\s*(.+)$/i)
  if (m) {
    pieces = pieces ?? Number(m[1])
    remainder = m[2].trim()
  } else {
    m = remainder.match(/^(\d+)\s+(.+)$/)
    if (m && !/^kg\b/i.test(m[2].trim())) {
      pieces = pieces ?? Number(m[1])
      remainder = m[2].trim()
    } else if (pieces == null) {
      m = remainder.match(/^(.+?)\s+(\d+)\s*$/)
      if (m && m[1].trim().length >= 2) {
        remainder = m[1].trim()
        pieces = Number(m[2])
      }
    }
  }

  return {
    product_description: cleanProductName(remainder),
    pieces,
    weight_kg,
    note: null,
  }
}

/** Separa pezzi, kg e nome prodotto (allineato al backend). */
export function normalizeOrderLine(line) {
  let desc = String(line?.product_description ?? '').trim()
  let pieces =
    line?.pieces != null && line.pieces !== '' && !Number.isNaN(Number(line.pieces))
      ? Math.max(0, Math.floor(Number(line.pieces)))
      : null
  if (pieces === 0) pieces = null
  let weight_kg =
    line?.weight_kg != null && line.weight_kg !== '' && !Number.isNaN(Number(line.weight_kg))
      ? Number(line.weight_kg)
      : null
  if (weight_kg != null && weight_kg <= 0) weight_kg = null
  const note = line?.note

  const combined = [desc, pieces != null ? `${pieces} pezzi` : '', weight_kg != null ? `${weight_kg} kg` : '']
    .filter(Boolean)
    .join(' ')
    .trim()

  if (combined && (!desc || /\b(?:pezzi?|kg)\b/i.test(desc) || /^\d/.test(desc))) {
    const parsed = extractFromMixedPhrase(combined)
    desc = parsed.product_description || desc
    pieces = parsed.pieces ?? pieces
    weight_kg = parsed.weight_kg ?? weight_kg
  } else {
    let m = desc.match(/^(\d+(?:[.,]\d+)?)\s*kg\s+(?:di\s+)?(.+)$/i)
    if (m) {
      weight_kg = weight_kg ?? Number(String(m[1]).replace(',', '.'))
      desc = m[2].trim()
      pieces = null
    } else {
      m = desc.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s*kg$/i)
      if (m && m[1].trim().length >= 2) {
        weight_kg = weight_kg ?? Number(String(m[2]).replace(',', '.'))
        desc = m[1].trim()
        pieces = null
      } else {
        m = desc.match(/^(.+?)\s+kg\s+(\d+(?:[.,]\d+)?)$/i)
        if (m && m[1].trim().length >= 2) {
          weight_kg = weight_kg ?? Number(String(m[2]).replace(',', '.'))
          desc = m[1].trim()
          pieces = null
        } else {
          m = desc.match(/^kg\s+(\d+(?:[.,]\d+)?)\s+(.+)$/i)
          if (m) {
            weight_kg = weight_kg ?? Number(String(m[1]).replace(',', '.'))
            desc = m[2].trim()
            pieces = null
          }
        }
      }
    }

    if (pieces != null) {
      const patterns = [
        new RegExp(`^${pieces}\\s*[x×]\\s*(.+)$`, 'i'),
        new RegExp(`^${pieces}\\s+(.+)$`, 'i'),
        new RegExp(`^(.+?)\\s+${pieces}\\s*(?:pz|pezzi|pz\\.)?$`, 'i'),
      ]
      for (const re of patterns) {
        const match = desc.match(re)
        if (match && match[1].trim().length >= 2) {
          desc = match[1].trim()
          break
        }
      }
    } else {
      let match = desc.match(/^(.+?)\s+(\d+)\s*pezzi?\b/i)
      if (match) {
        desc = match[1].trim()
        pieces = Number(match[2])
      } else {
        match = desc.match(/^(.+?)\s+pezzi?\s+(\d+)\b/i)
        if (match) {
          desc = match[1].trim()
          pieces = Number(match[2])
        } else {
          match = desc.match(/^(\d+)\s*pezzi?\s+(.+)$/i)
          if (match) {
            pieces = Number(match[1])
            desc = match[2].trim()
          } else {
            match = desc.match(/^(\d+)\s*[x×]\s*(.+)$/i)
            if (match) {
              pieces = Number(match[1])
              desc = match[2].trim()
            } else {
              match = desc.match(/^(\d+)\s+(.+)$/)
              if (match && match[2].trim().length >= 2 && !/^kg\b/i.test(match[2].trim())) {
                pieces = Number(match[1])
                desc = match[2].trim()
              } else {
                match = desc.match(/^(.+?)\s+(\d+)\s*(?:pz|pezzi|pz\.)?$/i)
                if (match && match[1].trim().length >= 2) {
                  desc = match[1].trim()
                  pieces = Number(match[2])
                }
              }
            }
          }
        }
      }
    }
  }

  if (/\bpezzi?\b|\bpz\.?\b/i.test(desc) && pieces == null) {
    const pe = extractPiecesFromPhrase(desc)
    pieces = pe.pieces
    desc = cleanProductName(pe.remainder)
  }

  desc = cleanProductName(desc)
  return { product_description: desc, pieces, weight_kg, note }
}

const PRODUCT_ENTRY_PATTERNS = [
  /\b\d+(?:[.,]\d+)?\s*kg\b/gi,
  /\b[A-Za-zÀ-ÿ]{2,}\s+kg\s+\d+(?:[.,]\d+)?\b/gi,
  /\b(?<!\d)(?<!pezzi\s)(?<!\w)\d+\s+(?!kg\b)(?=[A-Za-zÀ-ÿ])/gi,
]

function productEntryStarts(line) {
  const s = String(line || '').trim()
  const starts = new Set([0])
  for (const re of PRODUCT_ENTRY_PATTERNS) {
    const r = new RegExp(re.source, re.flags)
    let m
    while ((m = r.exec(s)) !== null) {
      starts.add(m.index)
    }
  }
  return [...starts].sort((a, b) => a - b)
}

/** Spezza una frase con più prodotti (allineato al backend). */
export function splitOrderProductChunks(text) {
  const t = String(text || '').trim()
  if (!t) return []
  const starts = productEntryStarts(t)
  const out = []
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i]
    const end = starts[i + 1] ?? t.length
    let seg = t.slice(start, end).trim().replace(/,\s*$/, '').replace(/\s+e\s*$/i, '').trim()
    if (seg.length >= 2) out.push(seg)
  }
  if (!out.length && t) return [t]
  return out
}

function lineNeedsSplit(line) {
  const desc = String(line?.product_description ?? (typeof line === 'string' ? line : '')).trim()
  if (!desc) return false
  if (desc.length > 42) return true
  if (splitOrderProductChunks(desc).length >= 2) return true
  if (/,/.test(desc) && /\d/.test(desc)) return true
  if (/\b\d+\b.*\b\d+\b/.test(desc) && /\b(?:kg|pezzi?|pz\.?)\b/i.test(desc)) return true
  return false
}

/** Espande righe AI con più prodotti in una sola descrizione. */
export function expandRawOrderLines(rawLines) {
  const out = []
  for (const item of rawLines || []) {
    const base = typeof item === 'object' && item != null ? { ...item } : { product_description: String(item || '') }
    if (lineNeedsSplit(base)) {
      const desc = String(base.product_description || '').trim()
      for (const chunk of splitOrderProductChunks(desc)) {
        out.push({
          ...base,
          product_description: chunk,
          pieces: null,
          pezzi: null,
          weight_kg: null,
          kg: null,
        })
      }
    } else {
      out.push(item)
    }
  }
  return out
}

export function mapOrderLinesToRows(lines) {
  return (lines || []).map((l) => {
    const n = normalizeOrderLine(l)
    return {
      product_description: n.product_description || '',
      pieces: n.pieces != null ? String(n.pieces) : '',
      weight_kg: n.weight_kg != null && n.weight_kg !== '' ? String(n.weight_kg) : '',
      note: n.note || '',
    }
  })
}
