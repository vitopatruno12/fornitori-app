import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchStaffMembers,
  fetchStaffShifts,
  createStaffMember,
  updateStaffMember,
  deleteStaffMember,
  deleteAllStaffMembers,
  createStaffShift,
  updateStaffShift,
  deleteStaffShift,
  deleteStaffShiftsBulk,
} from '../services/staffService'
import WeeklyStaffReportModal from '../components/WeeklyStaffReportModal.jsx'
import StaffMemberInfoModal from '../components/StaffMemberInfoModal.jsx'

const DAY_HEADERS = ['DOMENICA', 'LUNEDÌ', 'MARTEDÌ', 'MERCOLEDÌ', 'GIOVEDÌ', 'VENERDÌ', 'SABATO']

const SpeechRecognition =
  typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)

const VOICE_ITALIAN_MONTHS = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6,
  luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
}
const VOICE_ITALIAN_DAYS = {
  lunedi: 1, lunedì: 1, martedi: 2, martedì: 2, mercoledi: 3, mercoledì: 3,
  giovedi: 4, giovedì: 4, venerdi: 5, venerdì: 5, sabato: 6, domenica: 0,
}

/** Ore in parole (riconoscimento vocale IT). Chiavi senza accenti. */
const VOICE_ITALIAN_HOUR_WORDS = {
  zero: 0,
  mezzanotte: 0,
  uno: 1, un: 1, una: 1,
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
  mezzogiorno: 12,
  tredici: 13,
  quattordici: 14,
  quindici: 15,
  sedici: 16,
  diciassette: 17,
  diciotto: 18,
  diciannove: 19,
  venti: 20,
  ventuno: 21,
  ventidue: 22,
  ventitre: 23,
  ventitré: 23,
  ventiquattro: 24,
}

function voiceStripAccents(s) {
  return (s || '').normalize('NFD').replace(/\p{M}/gu, '')
}

function voiceNormalizeTimePhrase(text) {
  return voiceStripAccents((text || '').toLowerCase())
    .replace(/[^\p{L}\p{N}\s:.,\-–h]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function voicePadHour(h) {
  return String(Math.min(23, Math.max(0, h))).padStart(2, '0')
}

function voicePadMinutes(m) {
  return String(Math.min(59, Math.max(0, m))).padStart(2, '0')
}

/** Da token (parola o cifra) a ora 0–23, oppure null. */
function voiceTokenToHour(token) {
  const t = voiceStripAccents((token || '').trim().toLowerCase())
  if (!t) return null
  if (/^\d{1,2}$/.test(t)) {
    const n = Number(t)
    if (n >= 0 && n <= 24) return n === 24 ? 0 : n
    return null
  }
  if (Object.prototype.hasOwnProperty.call(VOICE_ITALIAN_HOUR_WORDS, t)) {
    return VOICE_ITALIAN_HOUR_WORDS[t]
  }
  return null
}

/**
 * Un solo orario HH:MM da frase vocale: "otto", "otto e mezza", "8:30", "alle 16", "sedici e mezza".
 */
function voiceParseSingleTime(text) {
  const t = voiceNormalizeTimePhrase(text)
  if (!t) return null

  let m = t.match(
    /(?:^|\b)(?:ore?\s+|alle?\s+)?(\d{1,2})\s*[:.,h]\s*(\d{1,2})(?:\b|$)/,
  )
  if (!m) {
    m = t.match(/(?:^|\b)(?:ore?\s+|alle?\s+)?(\d{1,2})\s+(\d{2})(?:\b|$)/)
  }
  if (m) {
    const h = Number(m[1])
    const min = Number(m[2])
    if (h >= 0 && h <= 24 && min >= 0 && min <= 59) {
      return `${voicePadHour(h === 24 ? 0 : h)}:${voicePadMinutes(min)}`
    }
  }

  m = t.match(
    /(?:^|\b)(?:ore?\s+|alle?\s+)?(\d{1,2})\s+e\s+(mezza|un\s+quarto|trenta|(\d{1,2}))(?:\b|$)/,
  )
  if (m) {
    const h = Number(m[1])
    let min = 0
    if (m[2] === 'mezza' || m[2] === 'trenta') min = 30
    else if (/quarto/.test(m[2])) min = 15
    else if (m[3]) min = Number(m[3])
    if (h >= 0 && h <= 24) return `${voicePadHour(h === 24 ? 0 : h)}:${voicePadMinutes(min)}`
  }

  m = t.match(/(?:^|\b)(?:ore?\s+|alle?\s+)?(\d{1,2})(?:\b|$)/)
  if (m) {
    const h = Number(m[1])
    if (h >= 0 && h <= 24) return `${voicePadHour(h === 24 ? 0 : h)}:00`
  }

  const wordHourRe =
    /\b(?:ore?\s+|alle?\s+)?(zero|mezzanotte|uno|un|una|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|undici|dodici|mezzogiorno|tredici|quattordici|quindici|sedici|diciassette|diciotto|diciannove|venti|ventuno|ventidue|ventitre|ventiquattro)(?:\s+e\s+(mezza|un\s+quarto|trenta|(\d{1,2})))?\b/
  m = t.match(wordHourRe)
  if (m) {
    const h = voiceTokenToHour(m[1])
    if (h == null) return null
    let min = 0
    if (m[2] === 'mezza' || m[2] === 'trenta') min = 30
    else if (m[2] && /quarto/.test(m[2])) min = 15
    else if (m[3]) min = Number(m[3])
    return `${voicePadHour(h)}:${voicePadMinutes(min)}`
  }

  return null
}

function voiceParseDateIso(text) {
  const t = (text || '').toLowerCase().trim()
  if (!t) return ''
  const today = new Date()
  if (t === 'oggi' || /^stesso giorno/.test(t)) {
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  }
  if (t === 'domani') {
    const d = new Date(today.getTime() + 86400000)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  if (t === 'dopodomani') {
    const d = new Date(today.getTime() + 2 * 86400000)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  for (const [name, dow] of Object.entries(VOICE_ITALIAN_DAYS)) {
    if (t.includes(name)) {
      const cur = today.getDay()
      let delta = (dow - cur + 7) % 7
      if (delta === 0) delta = 7
      const d = new Date(today.getTime() + delta * 86400000)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
  }
  let m = t.match(/(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+(\d{2,4}))?/)
  if (m) {
    const dd = Number(m[1])
    const mm = VOICE_ITALIAN_MONTHS[m[2]]
    let yy = m[3] ? Number(m[3]) : today.getFullYear()
    if (yy < 100) yy += 2000
    if (dd >= 1 && dd <= 31 && mm) {
      return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
    }
  }
  m = t.match(/(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?/)
  if (m) {
    const dd = Number(m[1])
    const mm = Number(m[2])
    let yy = m[3] ? Number(m[3]) : today.getFullYear()
    if (yy < 100) yy += 2000
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
    }
  }
  return ''
}

/** Estrae un orario ignorando parole come inizio, fine, turno. */
function voiceExtractTimeFromPhrase(text) {
  const t = voiceNormalizeTimePhrase(text)
  if (!t) return null
  const cleaned = t
    .replace(
      /\b(inizio|inizia|comincia|partenza|apertura|fine|finisce|termine|chiusura|uscita|del|della|di|il|la|lo|turno|turni|orario|lavoro|ore?|alle?|dalle?|a|da|fino|sino|e|il|un|una)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim()
  return voiceParseSingleTime(cleaned) || voiceParseSingleTime(t)
}

const VOICE_START_KW_RX = /\b(inizio|inizia|comincia|partenza|apertura)\b/
const VOICE_END_KW_RX = /\b(fine|finisce|termine|chiusura|uscita)\b/

/** Estrae orario dopo parola-chiave inizio/fine (es. "inizio turno 9" → 09:00). */
function voiceParseLabeledShiftTime(text, role) {
  const t = voiceNormalizeTimePhrase(text)
  if (!t) return null
  if (role === 'start') {
    if (!VOICE_START_KW_RX.test(t)) return null
    const m = t.match(
      /\b(?:inizio|inizia|comincia|partenza|apertura)(?:\s+(?:del|di|il|la|lo))?\s*(?:turno|orario)?\s*(.+?)(?=\s*\.?\s*\b(?:fine|finisce|termine|chiusura|uscita)\b|$)/,
    )
    return m ? voiceExtractTimeFromPhrase(m[1]) : voiceExtractTimeFromPhrase(t)
  }
  if (!VOICE_END_KW_RX.test(t)) return null
  const m = t.match(
    /\b(?:fine|finisce|termine|chiusura|uscita)(?:\s+(?:del|di|il|la|lo))?\s*(?:turno|orario)?\s*(.+?)$/,
  )
  return m ? voiceExtractTimeFromPhrase(m[1]) : voiceExtractTimeFromPhrase(t)
}

/**
 * Orari turno con ruolo esplicito: "inizio turno 9", "fine turno 17",
 * oppure intervallo "dalle 8 alle 16". Evita di scambiare inizio/fine.
 */
function voiceParseShiftTimesWithRoles(text) {
  const raw = (text || '').trim()
  if (!raw) return null
  const t = voiceNormalizeTimePhrase(raw)
  const hasStartKw = VOICE_START_KW_RX.test(t)
  const hasEndKw = VOICE_END_KW_RX.test(t)

  if (hasStartKw || hasEndKw) {
    const start = hasStartKw ? voiceParseLabeledShiftTime(raw, 'start') : null
    const end = hasEndKw ? voiceParseLabeledShiftTime(raw, 'end') : null
    if (start || end) return { start, end }
  }

  const range = voiceParseShiftTimesRange(raw)
  if (range?.start && range?.end) return range
  if (range?.start || range?.end) return range

  if (hasStartKw || hasEndKw) return null

  const single = voiceExtractTimeFromPhrase(t)
  if (single) return { start: single, end: null }

  return null
}

/** Intervalli espliciti (dalle/alle, 8-16) senza spezzare frasi con inizio/fine. */
function voiceParseShiftTimesRange(text) {
  const raw = (text || '').trim()
  if (!raw) return null
  const t = voiceNormalizeTimePhrase(raw)
  if (VOICE_START_KW_RX.test(t) && VOICE_END_KW_RX.test(t)) return null

  let m = t.match(
    /(?:dalle?|da)\s+(.+?)\s+(?:alle?|fino\s+alle?|sino\s+alle?|a)\s+(.+)/,
  )
  if (m) {
    const start = voiceParseSingleTime(m[1])
    const end = voiceParseSingleTime(m[2])
    if (start && end) return { start, end }
  }

  m = t.match(/(\d{1,2})[:.,h]\s*(\d{1,2})\s*[-–]\s*(\d{1,2})[:.,h]\s*(\d{1,2})/)
  if (m) {
    return {
      start: `${voicePadHour(Number(m[1]))}:${voicePadMinutes(Number(m[2]))}`,
      end: `${voicePadHour(Number(m[3]))}:${voicePadMinutes(Number(m[4]))}`,
    }
  }

  m = t.match(/\b(\d{1,2})\s*[-–]\s*(\d{1,2})\b/)
  if (m) {
    return {
      start: `${voicePadHour(Number(m[1]))}:00`,
      end: `${voicePadHour(Number(m[2]))}:00`,
    }
  }

  const parts = t.split(/\s+/).filter(Boolean)
  if (parts.length === 2) {
    const h1 = voiceTokenToHour(parts[0])
    const h2 = voiceTokenToHour(parts[1])
    if (h1 != null && h2 != null) {
      return { start: `${voicePadHour(h1)}:00`, end: `${voicePadHour(h2)}:00` }
    }
  }

  return null
}

function voiceParseShiftTimes(text) {
  const raw = (text || '').trim()
  if (!raw) return null
  const withRoles = voiceParseShiftTimesWithRoles(raw)
  if (withRoles) return withRoles
  return voiceParseShiftTimesRange(raw)
}

/** Nel dettato libero: ogni frase aggiorna solo il campo giusto (inizio/fine). */
function voiceMergeTimesFromPhrases(phrases) {
  let start = null
  let end = null
  for (const phrase of phrases || []) {
    const p = (phrase || '').trim()
    if (!p) continue
    const labeled = voiceParseShiftTimesWithRoles(p)
    if (labeled?.start) start = labeled.start
    if (labeled?.end) end = labeled.end
  }
  if (start || end) return { start, end }
  const merged = (phrases || []).join('. ').trim()
  return merged ? voiceParseShiftTimesWithRoles(merged) || voiceParseShiftTimesRange(merged) : null
}

/** Applica orario/i turno al form (inizio/fine). */
function voiceApplyShiftTimesToForm(times, setters) {
  if (!times) return false
  let ok = false
  if (times.start) {
    setters.setFormStart(times.start)
    ok = true
  }
  if (times.end) {
    setters.setFormEnd(times.end)
    ok = true
  }
  return ok
}

/** Risposta vocale sufficiente per passare allo step orario successivo. */
function voiceTimeStepLooksComplete(stepKey, phrase) {
  const p = (phrase || '').trim()
  if (!p || /^(passa|salta|skip)\b/i.test(p)) return true
  if (stepKey === 'time_range') {
    const r = voiceParseShiftTimesWithRoles(p)
    return !!(r?.start && r?.end)
  }
  if (stepKey === 'time_start') return !!voiceParseSingleTime(p)
  if (stepKey === 'time_end') return !!voiceParseSingleTime(p)
  return false
}

function voiceParseEntryKind(text) {
  const lo = (text || '').toLowerCase()
  if (/\b(malatti[ae]|malat[oa])\b/.test(lo)) return 'sick'
  if (/\b(permess[oi])\b/.test(lo)) return 'permission'
  if (/\b(assenz[ae]|assente|assenti)\b/.test(lo)) return 'absence'
  if (/\b(turno|turni)\b/.test(lo)) return 'shift'
  return null
}

function voiceMatchMember(text, members) {
  if (!text || !members || !members.length) return null
  const norm = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').trim()
  const ttext = norm(text)
  if (!ttext) return null
  let found = members.find((m) => norm(m.name) === ttext)
  if (found) return found
  found = members.find((m) => ttext && norm(m.name).includes(ttext))
  if (found) return found
  found = members.find((m) => norm(m.name) && ttext.includes(norm(m.name)))
  return found || null
}

function voiceParseShift(text, members) {
  const out = {}
  if (!text) return out
  const member = voiceMatchMember(text, members)
  if (member) out.staff_member_id = String(member.id)
  const iso = voiceParseDateIso(text)
  if (iso) out.work_date = iso
  const kind = voiceParseEntryKind(text)
  if (kind) out.entry_kind = kind
  const times = voiceParseShiftTimesWithRoles(text) || voiceParseShiftTimesRange(text)
  if (times) {
    if (times.start) out.time_start = times.start
    if (times.end) out.time_end = times.end
  }
  const noteM = text.match(/\b(?:note?|nota)\s*[:\s]*(.{2,200})/i)
  if (noteM) out.notes = noteM[1].trim()
  return out
}

const KIND_LABELS = {
  shift: 'Turno',
  permission: 'Permesso',
  absence: 'Assenza',
  sick: 'Malattia',
}

/** Lunedi come primo giorno della settimana (indice getDay: dom=0 ... sab=6). */
function startOfWeekMonday(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dow = x.getDay()
  const delta = dow === 0 ? -6 : 1 - dow
  x.setDate(x.getDate() + delta)
  return x
}

function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
  return x
}

function toYMD(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseYMD(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function fmtTime(t) {
  if (!t) return ''
  const s = String(t).slice(0, 8)
  const [h, min] = s.split(':')
  if (h == null) return ''
  return `${parseInt(h, 10)}:${(min || '00').padStart(2, '0')}`
}

function timeInputValue(t) {
  if (!t) return ''
  return String(t).slice(0, 5)
}

function todayDate() {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate())
}

function scrollToShiftForm() {
  const el = document.getElementById('staff-shift-form-card')
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/** Giorni inclusivi tra due date (ordine qualsiasi). */
function daysInclusiveCount(a, b) {
  const fa = toYMD(a)
  const fb = toYMD(b)
  const [x, y] = fa <= fb ? [fa, fb] : [fb, fa]
  const d0 = parseYMD(x)
  const d1 = parseYMD(y)
  return Math.round((d1.getTime() - d0.getTime()) / 86400000) + 1
}

/** Elenco Date (mezzanotte locale) da start a end inclusi. */
function enumerateDayCells(start, end) {
  const fa = toYMD(start)
  const fb = toYMD(end)
  const [firstStr, lastStr] = fa <= fb ? [fa, fb] : [fb, fa]
  const cells = []
  let cur = parseYMD(firstStr)
  const last = parseYMD(lastStr)
  while (cur <= last) {
    cells.push(new Date(cur.getFullYear(), cur.getMonth(), cur.getDate()))
    cur = addDays(cur, 1)
  }
  return cells
}

const MAX_PLANNING_PERIOD_DAYS = 93
/** Limite prudente per `https://wa.me/?text=…` (query troppo lunghe = link rotto o bloccato dal browser). */
const WA_ME_URL_MAX_LEN = 7200
const STAFF_MEMBERS_BY_LOCALE_STORAGE_KEY = 'staffMembersByLocale'

async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fallback sotto */
  }
  return copyTextToClipboardFallback(text)
}

function copyTextToClipboardFallback(text) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  ta.style.top = '0'
  document.body.appendChild(ta)
  ta.focus()
  ta.select()
  try {
    const ok = document.execCommand('copy')
    return ok
  } catch {
    return false
  } finally {
    document.body.removeChild(ta)
  }
}

function buildWhatsAppPlanningBody(shifts, displayDayCells, shiftLineFn) {
  const byDate = new Map()
  for (const s of shifts) {
    const k = s.work_date
    if (!byDate.has(k)) byDate.set(k, [])
    byDate.get(k).push(s)
  }
  const lines = []
  for (const d of displayDayCells) {
    const ymd = toYMD(d)
    const label = DAY_HEADERS[d.getDay()]
    const dayNum = d.getDate()
    const monthBit = d.toLocaleDateString('it-IT', { month: 'short' })
    lines.push(`${label} ${dayNum} ${monthBit}`)
    const list = (byDate.get(ymd) || []).slice().sort((a, b) => (a.staff_member_name || '').localeCompare(b.staff_member_name || '', 'it'))
    if (list.length === 0) lines.push('  (nessuna voce)')
    else for (const s of list) lines.push(`  ${shiftLineFn(s)}`)
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

/**
 * Esempio tratto dalla pianificazione reale (mar–apr 2026).
 * Chiavi = data ISO; valori = [nome, HH:MM, HH:MM]
 */
const DEMO_WEEK_BLOCKS = {
  '2026-03-29': [
    ['Marianna', '08:00', '16:00'],
    ['Emy', '08:00', '16:00'],
    ['Roberto', '11:00', '19:00'],
    ['Maria', '09:00', '17:00'],
    ['Marta', '08:00', '16:00'],
    ['Marilú', '08:00', '16:00'],
    ['Nino', '11:00', '19:00'],
  ],
  '2026-03-30': [
    ['Marianna', '08:00', '16:00'],
    ['Emy', '08:00', '14:00'],
    ['Roberto', '10:30', '18:30'],
    ['Maria', '14:00', '18:30'],
    ['Nino', '08:00', '16:00'],
  ],
  '2026-03-31': [
    ['Marianna', '08:00', '16:00'],
    ['Emy', '08:00', '14:00'],
    ['Roberto', '10:30', '18:30'],
    ['Maria', '14:00', '18:30'],
    ['Marta', '08:00', '16:00'],
    ['Nino', '08:00', '16:00'],
  ],
  '2026-04-01': [
    ['Marianna', '08:00', '16:00'],
    ['Emy', '08:00', '14:00'],
    ['Roberto', '10:30', '18:30'],
    ['Maria', '14:00', '18:30'],
    ['Marta', '08:00', '16:00'],
    ['Nino', '08:00', '16:00'],
  ],
  '2026-04-02': [
    ['Marianna', '08:00', '16:00'],
    ['Emy', '08:00', '14:00'],
    ['Roberto', '10:30', '18:30'],
    ['Maria', '14:30', '18:00'],
    ['Marta', '08:00', '16:00'],
    ['Nino', '08:00', '16:00'],
  ],
  '2026-04-03': [
    ['Marianna', '08:00', '16:00'],
    ['Emy', '08:00', '12:00'],
    ['Roberto', '10:30', '18:30'],
    ['Maria', '10:30', '18:30'],
    ['Marta', '08:00', '16:00'],
    ['Nino', '08:00', '16:00'],
  ],
  '2026-04-04': [
    ['Marianna', '08:00', '16:00'],
    ['Emy', '08:00', '12:00'],
    ['Roberto', '10:30', '18:30'],
    ['Maria', '10:30', '18:30'],
    ['Marta', '08:00', '16:00'],
    ['Nino', '08:00', '16:00'],
  ],
  '2026-04-05': [
    ['Marianna', '08:00', '16:00'],
    ['Emy', '08:00', '12:00'],
    ['Roberto', '10:00', '18:00'],
    ['Maria', '12:00', '20:00'],
    ['Jevelin', '12:00', '20:00'],
    ['Marta', '09:00', '17:00'],
    ['Nino', '08:00', '16:00'],
  ],
}

function expandDemoRows() {
  const out = []
  for (const [date, rows] of Object.entries(DEMO_WEEK_BLOCKS)) {
    for (const [name, a, b] of rows) {
      out.push({
        work_date: date,
        name,
        time_start: `${a}:00`,
        time_end: `${b}:00`,
        entry_kind: 'shift',
      })
    }
  }
  return out
}

export default function StaffPage() {
  const [members, setMembers] = useState([])
  const [shifts, setShifts] = useState([])
  /** True dopo «Carica piano» (o demo) finché non cambi date/vista. */
  const [planningLoaded, setPlanningLoaded] = useState(false)
  const [weekAnchor, setWeekAnchor] = useState(() => startOfWeekMonday(new Date()))
  /** Vista: settimana | singolo giorno | intervallo date libero (dal / al). */
  const [planView, setPlanView] = useState('week')
  const [dayFocus, setDayFocus] = useState(todayDate)
  const [periodFrom, setPeriodFrom] = useState(() => {
    const w = startOfWeekMonday(new Date())
    return new Date(w.getFullYear(), w.getMonth(), w.getDate())
  })
  const [periodTo, setPeriodTo] = useState(() => addDays(startOfWeekMonday(new Date()), 6))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [newMemberFirstName, setNewMemberFirstName] = useState('')
  const [newMemberLastName, setNewMemberLastName] = useState('')
  const [newMemberEmail, setNewMemberEmail] = useState('')
  const [newMemberPhone, setNewMemberPhone] = useState('')
  const [newMemberCity, setNewMemberCity] = useState('')
  const [newMemberBirthDate, setNewMemberBirthDate] = useState('')
  const [memberInfoId, setMemberInfoId] = useState(null)
  const [memberInfoSaving, setMemberInfoSaving] = useState(false)
  const [demoLoading, setDemoLoading] = useState(false)
  const [reportModalOpen, setReportModalOpen] = useState(false)
  const [reportPdfBlob, setReportPdfBlob] = useState(null)
  const [reportFilename, setReportFilename] = useState('report.pdf')
  const [reportWaText, setReportWaText] = useState('')
  const [reportPeriodLabel, setReportPeriodLabel] = useState('')
  const [reportModalTitle, setReportModalTitle] = useState('Report personale (PDF)')
  const [reportLoading, setReportLoading] = useState(false)
  const [localeStaffName, setLocaleStaffName] = useState('')
  const [savedLocaleNames, setSavedLocaleNames] = useState([])

  const [formMemberId, setFormMemberId] = useState('')
  const [formDate, setFormDate] = useState(() => toYMD(new Date()))
  const [formStart, setFormStart] = useState('08:00')
  const [formEnd, setFormEnd] = useState('16:00')
  const [formKind, setFormKind] = useState('shift')
  const [formNotes, setFormNotes] = useState('')
  const [editingShiftId, setEditingShiftId] = useState(null)
  /** Evita richieste duplicate (doppio clic / Invio mentre parte un’altra azione). */
  const [shiftBusy, setShiftBusy] = useState(false)

  const [voiceListening, setVoiceListening] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const [voiceGuideActive, setVoiceGuideActive] = useState(false)
  const [voiceGuideStep, setVoiceGuideStep] = useState(0)
  const [voiceGuidePrompt, setVoiceGuidePrompt] = useState('')
  const [voiceGuideHeard, setVoiceGuideHeard] = useState('')
  const [assistantActive, setAssistantActive] = useState(false)
  const [assistantTranscript, setAssistantTranscript] = useState('')
  const [voiceGuideInfoOpen, setVoiceGuideInfoOpen] = useState(false)
  const assistantRecognitionRef = useRef(null)
  const [assistantPhrases, setAssistantPhrases] = useState([])
  const assistantCancelledRef = useRef(false)
  const assistantConfirmRef = useRef(null)
  const voiceSubmitBtnRef = useRef(null)
  const voiceShiftFormRef = useRef(null)

  function stopVoiceShiftConfirmListen() {
    try {
      assistantConfirmRef.current?.stop()
    } catch {
      /* noop */
    }
    assistantConfirmRef.current = null
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel()
      } catch {
        /* noop */
      }
    }
    setVoiceListening(false)
  }

  function dismissVoiceShiftSessionPrompt() {
    stopVoiceShiftConfirmListen()
    setVoiceGuidePrompt('')
  }

  const weekEnd = useMemo(() => addDays(weekAnchor, 6), [weekAnchor])
  const fromStr = useMemo(() => toYMD(weekAnchor), [weekAnchor])
  const toStr = useMemo(() => toYMD(weekEnd), [weekEnd])
  const dayStr = useMemo(() => toYMD(dayFocus), [dayFocus])
  const periodFromStr = useMemo(() => toYMD(periodFrom), [periodFrom])
  const periodToStr = useMemo(() => toYMD(periodTo), [periodTo])
  const periodLoStr = periodFromStr <= periodToStr ? periodFromStr : periodToStr
  const periodHiStr = periodFromStr <= periodToStr ? periodToStr : periodFromStr
  const rangeFromStr = planView === 'week' ? fromStr : planView === 'day' ? dayStr : periodLoStr
  const rangeToStr = planView === 'week' ? toStr : planView === 'day' ? dayStr : periodHiStr
  const dayLongLabel = useMemo(
    () =>
      dayFocus.toLocaleDateString('it-IT', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    [dayFocus],
  )

  const dayCells = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekAnchor, i))
  }, [weekAnchor])

  const displayDayCells = useMemo(() => {
    if (planView === 'week') return dayCells
    if (planView === 'day') return [dayFocus]
    const n = daysInclusiveCount(periodFrom, periodTo)
    if (n > MAX_PLANNING_PERIOD_DAYS) return []
    return enumerateDayCells(periodFrom, periodTo)
  }, [planView, dayCells, dayFocus, periodFrom, periodTo])

  /** Intervallo date per il report PDF in base alla vista: settimana lun–dom, singolo giorno, o Dal–Al. */
  const reportPdfRange = useMemo(() => {
    if (planView === 'week') {
      const fromD = weekAnchor
      const toD = addDays(weekAnchor, 6)
      return { ok: true, from: fromD, to: toD, kind: 'week', dayCount: 7 }
    }
    if (planView === 'day') {
      return { ok: true, from: dayFocus, to: dayFocus, kind: 'day', dayCount: 1 }
    }
    const n = daysInclusiveCount(periodFrom, periodTo)
    if (n > MAX_PLANNING_PERIOD_DAYS) {
      return { ok: false, reason: 'too_long', days: n }
    }
    const fa = toYMD(periodFrom)
    const fb = toYMD(periodTo)
    const fromD = fa <= fb ? periodFrom : periodTo
    const toD = fa <= fb ? periodTo : periodFrom
    return { ok: true, from: fromD, to: toD, kind: 'period', dayCount: n }
  }, [planView, weekAnchor, dayFocus, periodFrom, periodTo])

  const shiftsByDate = useMemo(() => {
    const m = new Map()
    for (const s of shifts) {
      const key = s.work_date
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(s)
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => (a.staff_member_name || '').localeCompare(b.staff_member_name || '', 'it'))
    }
    return m
  }, [shifts])

  const loadForRange = useCallback(async (startDate, endDate) => {
    const from = toYMD(startDate)
    const to = toYMD(endDate)
    const sh = await fetchStaffShifts(from, to)
    setShifts(sh || [])
  }, [])

  const refreshMembers = useCallback(async () => {
    try {
      const mem = await fetchStaffMembers()
      setMembers(mem || [])
    } catch (e) {
      setError(e?.message || 'Errore caricamento dipendenti')
    }
  }, [])

  useEffect(() => {
    refreshMembers()
  }, [refreshMembers])

  const markPlanningStale = useCallback(() => {
    setShifts([])
    setPlanningLoaded(false)
  }, [])

  const reloadPlanning = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      if (planView === 'week') {
        await loadForRange(weekAnchor, addDays(weekAnchor, 6))
      } else if (planView === 'day') {
        await loadForRange(dayFocus, dayFocus)
      } else {
        const n = daysInclusiveCount(periodFrom, periodTo)
        if (n > MAX_PLANNING_PERIOD_DAYS) {
          setError(`Intervallo troppo lungo (${n} giorni). Massimo ${MAX_PLANNING_PERIOD_DAYS} giorni: restringi «Dal» / «Al».`)
          setShifts([])
          setPlanningLoaded(false)
          return
        }
        const fa = toYMD(periodFrom)
        const fb = toYMD(periodTo)
        const start = fa <= fb ? periodFrom : periodTo
        const end = fa <= fb ? periodTo : periodFrom
        await loadForRange(start, end)
      }
      setPlanningLoaded(true)
    } catch (e) {
      setError(e?.message || 'Errore caricamento personale')
      setPlanningLoaded(false)
    } finally {
      setLoading(false)
    }
  }, [planView, weekAnchor, dayFocus, periodFrom, periodTo, loadForRange])

  /** Ricarica i turni includendo sempre `ymd` (stessa logica di reloadPlanning ma range calcolato sulla data salvata, evita closure stale dopo setState). */
  async function reloadPlanningForWorkDate(ymd) {
    if (!ymd || typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      await reloadPlanning()
      return
    }
    setLoading(true)
    setError('')
    try {
      if (planView === 'week') {
        const anchor = startOfWeekMonday(parseYMD(ymd))
        await loadForRange(anchor, addDays(anchor, 6))
      } else if (planView === 'day') {
        const d = parseYMD(ymd)
        await loadForRange(d, d)
      } else {
        const fa = toYMD(periodFrom)
        const fb = toYMD(periodTo)
        let lo = fa <= fb ? fa : fb
        let hi = fa <= fb ? fb : fa
        if (ymd < lo) lo = ymd
        if (ymd > hi) hi = ymd
        const startD = parseYMD(lo)
        const endD = parseYMD(hi)
        const n = daysInclusiveCount(startD, endD)
        if (n > MAX_PLANNING_PERIOD_DAYS) {
          setError(`Intervallo troppo lungo (${n} giorni). Massimo ${MAX_PLANNING_PERIOD_DAYS} giorni: restringi «Dal» / «Al».`)
          setShifts([])
          setPlanningLoaded(false)
          return
        }
        await loadForRange(startD, endD)
      }
      setPlanningLoaded(true)
    } catch (e) {
      setError(e?.message || 'Errore caricamento personale')
      setPlanningLoaded(false)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!success) return
    const t = window.setTimeout(() => setSuccess(''), 2800)
    return () => window.clearTimeout(t)
  }, [success])

  useEffect(() => {
    if (planView === 'day' && editingShiftId == null) {
      setFormDate(dayStr)
    }
  }, [planView, dayStr, editingShiftId])

  useEffect(() => {
    if (planView === 'period' && editingShiftId == null) {
      setFormDate(periodLoStr)
    }
  }, [planView, periodLoStr, editingShiftId])

  useEffect(() => {
    if (!voiceGuideInfoOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') setVoiceGuideInfoOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [voiceGuideInfoOpen])

  function shiftLine(s) {
    const name = s.staff_member_name
    if (s.entry_kind === 'shift' && s.time_start && s.time_end) {
      return `${name} ${fmtTime(s.time_start)}–${fmtTime(s.time_end)}`
    }
    const kindIt = KIND_LABELS[s.entry_kind] || s.entry_kind
    const extra = s.notes ? ` (${s.notes})` : ''
    const times =
      s.time_start && s.time_end ? ` ${fmtTime(s.time_start)}–${fmtTime(s.time_end)}` : ''
    return `${name} — ${kindIt}${times}${extra}`
  }

  function openDayAndInsertShift(d) {
    const picked = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    setPlanView('day')
    setDayFocus(picked)
    setEditingShiftId(null)
    setFormDate(toYMD(picked))
    setFormKind('shift')
    setFormStart('08:00')
    setFormEnd('16:00')
    window.setTimeout(scrollToShiftForm, 80)
  }

  async function openWhatsAppPlanning() {
    if (!planningLoaded || displayDayCells.length === 0) {
      setError('Carica prima il piano con «Carica piano» (oppure «Solo demo»).')
      return
    }
    setError('')
    const rangeLabel = `${rangeFromStr} → ${rangeToStr}`
    const title = `📅 Planning turni (${rangeLabel})`
    const body = buildWhatsAppPlanningBody(shifts, displayDayCells, shiftLine)
    const fullText = `${title}\n\n${body}`
    const waUrl = `https://wa.me/?text=${encodeURIComponent(fullText)}`

    if (waUrl.length <= WA_ME_URL_MAX_LEN) {
      window.open(waUrl, '_blank', 'noopener,noreferrer')
      return
    }

    const copied = await copyTextToClipboard(fullText)
    if (!copied) {
      setError(
        'Planning troppo lungo per il link WhatsApp e copia negli appunti non riuscita. Usa HTTPS, riduci il periodo oppure copia le righe dalla griglia.',
      )
      return
    }
    setSuccess(
      'Planning completo copiato negli appunti. Si apre WhatsApp: scegli la chat e incolla il messaggio (tasto destro › Incolla o Ctrl+V).',
    )
    window.open('https://wa.me/', '_blank', 'noopener,noreferrer')
  }

  async function openStaffReportPdf() {
    setReportLoading(true)
    setError('')
    try {
      const rr = reportPdfRange
      if (!rr.ok) {
        setError(
          `Intervallo troppo lungo (${rr.days} giorni) per il report PDF. Massimo ${MAX_PLANNING_PERIOD_DAYS} giorni: restringi «Dal» / «Al».`,
        )
        return
      }
      const { aggregateWeeklyStaffStats, buildWeeklyReportWhatsAppText, generateWeeklyStaffReportPdf } = await import(
        '../utils/staffWeeklyReport.js'
      )
      const fromStr = toYMD(rr.from)
      const toStr = toYMD(rr.to)
      const [mem, sh] = await Promise.all([fetchStaffMembers(), fetchStaffShifts(fromStr, toStr)])
      const rows = aggregateWeeklyStaffStats(mem || [], sh || [], fromStr, toStr)

      let pdfMainHeading = 'Report personale'
      let periodTitle = ''
      let periodSub = ''
      let modalTitle = 'Report personale (PDF)'
      let filename = `report-personale-${fromStr}.pdf`

      if (rr.kind === 'day') {
        pdfMainHeading = 'Report personale — giorno singolo'
        periodTitle = rr.from.toLocaleDateString('it-IT', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
        periodSub = `Data: ${fromStr}`
        modalTitle = 'Report giorno (PDF)'
        filename = `report-personale-giorno-${fromStr}.pdf`
      } else if (rr.kind === 'week') {
        pdfMainHeading = 'Report personale — settimana (lun–dom)'
        periodTitle = `Settimana dal ${rr.from.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} al ${rr.to.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`
        periodSub = `Intervallo dati: ${fromStr} → ${toStr} (7 giorni, lunedi–domenica)`
        modalTitle = 'Report settimana (PDF)'
        filename = `report-personale-settimana-${fromStr}.pdf`
      } else {
        pdfMainHeading = 'Report personale — periodo'
        periodTitle = `Dal ${rr.from.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })} al ${rr.to.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}`
        periodSub = `Intervallo dati: ${fromStr} → ${toStr} (${rr.dayCount} ${rr.dayCount === 1 ? 'giorno' : 'giorni'})`
        modalTitle = 'Report periodo (PDF)'
        filename = `report-personale-periodo-${fromStr}_${toStr}.pdf`
      }

      const blob = generateWeeklyStaffReportPdf({
        pdfMainHeading,
        periodTitle,
        periodSub,
        rows,
        shifts: sh || [],
        dateFromYmd: fromStr,
        dateToYmd: toStr,
      })
      const wa = buildWeeklyReportWhatsAppText(`${fromStr} → ${toStr}`, rows)
      setReportPdfBlob(blob)
      setReportFilename(filename)
      setReportWaText(wa)
      setReportPeriodLabel(`${fromStr} → ${toStr}`)
      setReportModalTitle(modalTitle)
      setReportModalOpen(true)
    } catch (e) {
      setError(e?.message || 'Errore generazione report')
    } finally {
      setReportLoading(false)
    }
  }

  function closeWeeklyReport() {
    setReportModalOpen(false)
    setReportPdfBlob(null)
  }

  async function handleAddMember(e) {
    e.preventDefault()
    const fn = newMemberFirstName.trim()
    const ln = newMemberLastName.trim()
    if (!fn && !ln) {
      setError('Indica almeno nome o cognome')
      return
    }
    try {
      setError('')
      await createStaffMember({
        name: `${fn} ${ln}`.trim(),
        first_name: fn || null,
        last_name: ln || null,
        email: newMemberEmail.trim() || null,
        phone: newMemberPhone.trim() || null,
        city: newMemberCity.trim() || null,
        birth_date: newMemberBirthDate.trim() || null,
        sort_order: members.length,
        is_active: true,
      })
      setNewMemberFirstName('')
      setNewMemberLastName('')
      setNewMemberEmail('')
      setNewMemberPhone('')
      setNewMemberCity('')
      setNewMemberBirthDate('')
      setSuccess('Dipendente aggiunto')
      await refreshMembers()
    } catch (err) {
      setError(err?.message || 'Errore salvataggio')
    }
  }

  const memberInfoTarget = useMemo(() => members.find((m) => m.id === memberInfoId) ?? null, [members, memberInfoId])

  /** Scheda Info aperta su un id che non è più in elenco (es. eliminato altrove): chiudi modale. */
  useEffect(() => {
    if (memberInfoId == null) return
    if (!members.some((m) => m.id === memberInfoId)) {
      setMemberInfoId(null)
    }
  }, [members, memberInfoId])

  async function handleSaveMemberInfo(id, payload) {
    setMemberInfoSaving(true)
    setError('')
    try {
      await updateStaffMember(id, payload)
      setSuccess('Anagrafica aggiornata')
      setMemberInfoId(null)
      await refreshMembers()
    } catch (err) {
      const msg = String(err?.message || '')
      if (msg.includes('404') || msg.includes('non trovato') || msg.includes('Not Found')) {
        setMemberInfoId(null)
        await refreshMembers()
        setError('Questo dipendente non esiste più sul server. La scheda è stata chiusa.')
      } else {
        setError(msg || 'Errore salvataggio anagrafica')
      }
    } finally {
      setMemberInfoSaving(false)
    }
  }

  async function handleDeleteMember(m) {
    if (!window.confirm(`Rimuovere ${m.name} e tutte le sue voci in pianificazione?`)) return
    try {
      if (memberInfoId === m.id) setMemberInfoId(null)
      await deleteStaffMember(m.id)
      setSuccess('Dipendente rimosso')
      await refreshMembers()
    } catch (err) {
      setError(err?.message || 'Errore eliminazione')
    }
  }

  async function handleDeleteAllMembers() {
    if (members.length === 0) return
    if (
      !window.confirm(
        `Eliminare TUTTI i dipendenti (${members.length})?\n\nVerranno rimosse anche tutte le voci di pianificazione (turni, permessi, assenze, malattia) collegate. L’operazione non si può annullare.`,
      )
    ) {
      return
    }
    try {
      setError('')
      setMemberInfoId(null)
      const r = await deleteAllStaffMembers()
      const n = r?.deleted ?? 0
      markPlanningStale()
      setEditingShiftId(null)
      setFormMemberId('')
      setFormDate(toYMD(new Date()))
      setFormStart('08:00')
      setFormEnd('16:00')
      setFormKind('shift')
      setFormNotes('')
      await refreshMembers()
      setSuccess(
        n > 0
          ? `Eliminati ${n} dipendenti e tutta la pianificazione associata.`
          : 'Elenco dipendenti già vuoto.',
      )
    } catch (err) {
      setError(err?.message || 'Errore eliminazione elenco dipendenti')
    }
  }

  function normalizeLocaleName(value) {
    return String(value || '').trim()
  }

  function readStaffLocaleStore() {
    try {
      const raw = window.localStorage.getItem(STAFF_MEMBERS_BY_LOCALE_STORAGE_KEY)
      if (!raw) return {}
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
      return parsed
    } catch {
      return {}
    }
  }

  function writeStaffLocaleStore(store) {
    window.localStorage.setItem(STAFF_MEMBERS_BY_LOCALE_STORAGE_KEY, JSON.stringify(store))
  }

  const refreshSavedLocaleNames = useCallback(() => {
    const store = readStaffLocaleStore()
    const names = Object.keys(store).sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }))
    setSavedLocaleNames(names)
  }, [])

  useEffect(() => {
    refreshSavedLocaleNames()
  }, [refreshSavedLocaleNames])

  async function handleSaveMembersByLocale() {
    const localeName = normalizeLocaleName(localeStaffName)
    if (!localeName) {
      setError('Inserisci il nome del locale prima di salvare i dipendenti')
      return
    }
    try {
      setError('')
      const snapshot = members.map((m) => ({
        name: m.name || '',
        first_name: m.first_name || null,
        last_name: m.last_name || null,
        email: m.email || null,
        phone: m.phone || null,
        city: m.city || null,
        birth_date: m.birth_date || null,
        sort_order: Number.isFinite(Number(m.sort_order)) ? Number(m.sort_order) : 0,
        is_active: Boolean(m.is_active),
      }))
      const store = readStaffLocaleStore()
      store[localeName] = {
        saved_at: new Date().toISOString(),
        members: snapshot,
      }
      writeStaffLocaleStore(store)
      refreshSavedLocaleNames()
      setSuccess(`Lista dipendenti salvata per locale "${localeName}" (${snapshot.length} elementi)`)
    } catch {
      setError('Errore nel salvataggio locale dei dipendenti')
    }
  }

  async function handleLoadMembersByLocale() {
    const localeName = normalizeLocaleName(localeStaffName)
    if (!localeName) {
      setError('Inserisci il nome del locale prima di caricare i dipendenti')
      return
    }
    const store = readStaffLocaleStore()
    const pack = store[localeName]
    if (!pack || !Array.isArray(pack.members)) {
      setError(`Nessuna lista salvata trovata per il locale "${localeName}"`)
      return
    }
    if (!window.confirm(`Caricare i dipendenti salvati per "${localeName}"?\n\nL'elenco attuale verrà sostituito.`)) return

    try {
      setError('')
      setShiftBusy(true)
      await deleteAllStaffMembers()
      for (const m of pack.members) {
        await createStaffMember({
          name: String(m.name || '').trim() || 'Dipendente',
          first_name: m.first_name || null,
          last_name: m.last_name || null,
          email: m.email || null,
          phone: m.phone || null,
          city: m.city || null,
          birth_date: m.birth_date || null,
          sort_order: Number.isFinite(Number(m.sort_order)) ? Number(m.sort_order) : 0,
          is_active: m.is_active !== false,
        })
      }
      markPlanningStale()
      setMemberInfoId(null)
      setEditingShiftId(null)
      setFormMemberId('')
      setFormDate(toYMD(new Date()))
      setFormStart('08:00')
      setFormEnd('16:00')
      setFormKind('shift')
      setFormNotes('')
      await refreshMembers()
      setSuccess(`Lista dipendenti caricata per locale "${localeName}" (${pack.members.length} elementi)`)
    } catch (err) {
      setError(err?.message || 'Errore nel caricamento dipendenti per locale')
      await refreshMembers()
    } finally {
      setShiftBusy(false)
    }
  }

  function startEditShift(s) {
    setError('')
    setEditingShiftId(s.id)
    setFormMemberId(String(s.staff_member_id))
    setFormDate(s.work_date)
    setFormStart(timeInputValue(s.time_start))
    setFormEnd(timeInputValue(s.time_end))
    setFormKind(s.entry_kind || 'shift')
    setFormNotes(s.notes || '')
  }

  const resetForm = useCallback(() => {
    setEditingShiftId(null)
    setFormMemberId(members[0] ? String(members[0].id) : '')
    setFormDate(toYMD(new Date()))
    setFormStart('08:00')
    setFormEnd('16:00')
    setFormKind('shift')
    setFormNotes('')
    setError('')
  }, [members])

  /** Mantieni il dipendente selezionato nel modulo turni allineato all’elenco reale (evita POST con id eliminato → 400). */
  useEffect(() => {
    if (members.length === 0) {
      if (formMemberId) setFormMemberId('')
      return
    }
    if (!formMemberId) {
      setFormMemberId(String(members[0].id))
      return
    }
    const id = Number(formMemberId)
    if (!Number.isFinite(id) || !members.some((m) => m.id === id)) {
      setFormMemberId(String(members[0].id))
    }
  }, [members, formMemberId])

  /** Allinea vista planning alla data del turno salvato (evita che sparisca dopo voce/AI se dayFocus o settimana erano altri giorni). */
  function focusPlanningOnWorkDate(ymd) {
    if (!ymd || typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return
    const d = parseYMD(ymd)
    if (Number.isNaN(d.getTime())) return

    if (planView === 'day') {
      setDayFocus(d)
      return
    }
    if (planView === 'week') {
      setWeekAnchor(startOfWeekMonday(d))
      return
    }
    if (planView === 'period') {
      const fa = toYMD(periodFrom)
      const fb = toYMD(periodTo)
      const lo = fa <= fb ? fa : fb
      const hi = fa <= fb ? fb : fa
      if (ymd < lo) {
        if (fa <= fb) setPeriodFrom(d)
        else setPeriodTo(d)
      } else if (ymd > hi) {
        if (fa <= fb) setPeriodTo(d)
        else setPeriodFrom(d)
      }
    }
  }

  async function handleSubmitShift(e) {
    e.preventDefault()
    if (shiftBusy) return
    if (!formMemberId) {
      setError('Seleziona un dipendente')
      dismissVoiceShiftSessionPrompt()
      return
    }
    const staffId = Number(formMemberId)
    if (!Number.isFinite(staffId) || !members.some((m) => m.id === staffId)) {
      setError('Il dipendente selezionato non è più in elenco. Scegli un altro nome dal menu.')
      await refreshMembers()
      dismissVoiceShiftSessionPrompt()
      return
    }
    const savedWorkDate = formDate
    const payload = {
      staff_member_id: staffId,
      work_date: formDate,
      time_start: formKind === 'shift' || formKind === 'permission' ? `${formStart}:00` : null,
      time_end: formKind === 'shift' || formKind === 'permission' ? `${formEnd}:00` : null,
      entry_kind: formKind,
      notes: formNotes.trim() || null,
    }
    if (formKind === 'shift') {
      if (!formStart || !formEnd) {
        setError('Per il turno servono ora inizio e fine')
        dismissVoiceShiftSessionPrompt()
        return
      }
    }
    if (formKind === 'permission') {
      if ((formStart && !formEnd) || (!formStart && formEnd)) {
        setError('Permesso: indicare sia inizio sia fine, oppure lasciare vuoto e usare le note')
        dismissVoiceShiftSessionPrompt()
        return
      }
      if (!formStart) {
        payload.time_start = null
        payload.time_end = null
      }
    }
    if (formKind === 'absence' || formKind === 'sick') {
      payload.time_start = formStart ? `${formStart}:00` : null
      payload.time_end = formEnd ? `${formEnd}:00` : null
    }

    setShiftBusy(true)
    try {
      setError('')
      if (editingShiftId) {
        await updateStaffShift(editingShiftId, payload)
        setSuccess('Voce aggiornata')
      } else {
        await createStaffShift(payload)
        setSuccess('Voce aggiunta')
      }
      focusPlanningOnWorkDate(savedWorkDate)
      resetForm()
      await reloadPlanningForWorkDate(savedWorkDate)
    } catch (err) {
      const msg = String(err?.message || '')
      if (msg.includes('404') || msg.includes('Voce non trovata') || msg.includes('Not Found')) {
        resetForm()
        setError('La voce non esiste più (già eliminata o elenco non aggiornato). Modulo ripristinato.')
        await reloadPlanning()
      } else if (msg.includes('400') && msg.includes('Dipendente non trovato')) {
        await refreshMembers()
        resetForm()
        setError('Dipendente non valido o non più presente: elenco aggiornato e modulo ripristinato.')
        await reloadPlanning()
      } else if (msg.includes('400')) {
        setError(msg.replace(/^400:\s*/, '') || 'Richiesta non valida: controlla tipo voce, orari e dipendente.')
      } else {
        setError(msg || 'Errore salvataggio')
      }
    } finally {
      setShiftBusy(false)
      dismissVoiceShiftSessionPrompt()
    }
  }

  async function handleDeleteShift(id) {
    if (shiftBusy) return
    if (!window.confirm('Eliminare questa voce?')) return
    setShiftBusy(true)
    try {
      await deleteStaffShift(id)
      setSuccess('Voce eliminata')
      if (editingShiftId === id) resetForm()
      await reloadPlanning()
    } catch (err) {
      const msg = String(err?.message || '')
      if (msg.includes('404') || msg.includes('Voce non trovata') || msg.includes('Not Found')) {
        if (editingShiftId === id) resetForm()
        setError('Voce già assente sul server. Elenco aggiornato.')
        await reloadPlanning()
      } else {
        setError(msg || 'Errore eliminazione')
      }
    } finally {
      setShiftBusy(false)
    }
  }

  async function handleDeleteWeekPlanning() {
    if (shiftBusy || loading) return
    const periodoDesc =
      planView === 'week'
        ? `settimana visibile (dal ${rangeFromStr} al ${rangeToStr})`
        : planView === 'day'
          ? `giorno ${dayLongLabel} (${rangeFromStr})`
          : `periodo scelto (dal ${rangeFromStr} al ${rangeToStr})`
    if (
      !window.confirm(
        `Eliminare TUTTE le voci di pianificazione per ${periodoDesc}?\n\nL’anagrafica dipendenti non viene toccata.`,
      )
    ) {
      return
    }
    setShiftBusy(true)
    setError('')
    try {
      const r = await deleteStaffShiftsBulk(rangeFromStr, rangeToStr)
      const n = r?.deleted ?? 0
      setSuccess(n > 0 ? `Eliminate ${n} voci di planning.` : 'Nessuna voce da eliminare in questo periodo.')
      resetForm()
      await reloadPlanning()
    } catch (err) {
      setError(err?.message || 'Errore eliminazione planning')
    } finally {
      setShiftBusy(false)
    }
  }

  async function loadDemoExample() {
    if (!window.confirm('Carica l’esempio (mar–apr 2026)? Vengono creati i dipendenti mancanti e le righe turno. Puoi duplicare o modificare dopo.')) return
    setDemoLoading(true)
    setError('')
    try {
      markPlanningStale()
      let mem = await fetchStaffMembers()
      const names = new Set()
      for (const r of expandDemoRows()) names.add(r.name)
      for (const n of names) {
        if (!mem.find((m) => m.name === n)) {
          await createStaffMember({ name: n, sort_order: 0, is_active: true })
        }
      }
      mem = await fetchStaffMembers()
      setMembers(mem || [])
      const idByName = Object.fromEntries(mem.map((m) => [m.name, m.id]))
      for (const r of expandDemoRows()) {
        const sid = idByName[r.name]
        if (!sid) continue
        await createStaffShift({
          staff_member_id: sid,
          work_date: r.work_date,
          time_start: r.time_start,
          time_end: r.time_end,
          entry_kind: r.entry_kind,
        })
      }
      const anchor = startOfWeekMonday(parseYMD('2026-03-30'))
      setPlanView('week')
      setWeekAnchor(anchor)
      setSuccess(
        'Esempio caricato (8 giorni). La settimana parte da lunedi e termina domenica.',
      )
      await loadForRange(anchor, addDays(anchor, 6))
      setPlanningLoaded(true)
    } catch (err) {
      setError(err?.message || 'Errore caricamento esempio')
    } finally {
      setDemoLoading(false)
    }
  }

  function submitVoiceShiftForm(options = {}) {
    const { showSavingPrompt = false } = options
    // Bug pregresso: cliccare un bottone display:none non triggera il form submit
    // in nessun browser. Qui prima provo requestSubmit() sul <form>, poi se non
    // disponibile faccio fallback al bottone "Aggiungi" visibile cercandolo nel form.
    const form = voiceShiftFormRef.current
    if (form && typeof form.reportValidity === 'function' && !form.reportValidity()) {
      setVoiceError('Controlla dipendente, data e campi obbligatori prima di salvare.')
      dismissVoiceShiftSessionPrompt()
      return false
    }
    if (showSavingPrompt) setVoiceGuidePrompt('Salvataggio in corso…')
    if (form && typeof form.requestSubmit === 'function') {
      try {
        form.requestSubmit()
        return true
      } catch {
        /* prosegui col fallback */
      }
    }
    if (form) {
      const submitBtn = form.querySelector('button[type="submit"]:not([style*="display: none"])')
      if (submitBtn) {
        submitBtn.click()
        return true
      }
    }
    // Ultima spiaggia: click sul bottone vocale dedicato (storicamente non funzionante).
    voiceSubmitBtnRef.current?.click()
    return true
  }

  function applyVoiceShiftFields(parsed, options = {}) {
    if (!parsed) return []
    const applied = []
    if (parsed.staff_member_id) {
      setFormMemberId(String(parsed.staff_member_id))
      const member = members.find((mm) => String(mm.id) === String(parsed.staff_member_id))
      applied.push(`Dipendente: ${member ? member.name : parsed.staff_member_id}`)
    }
    if (parsed.work_date) {
      setFormDate(parsed.work_date)
      applied.push(`Data: ${parsed.work_date}`)
    }
    if (parsed.entry_kind) {
      setFormKind(parsed.entry_kind)
      applied.push(`Tipo: ${KIND_LABELS[parsed.entry_kind] || parsed.entry_kind}`)
    }
    if (parsed.time_start) {
      setFormStart(parsed.time_start)
      applied.push(`Inizio: ${parsed.time_start}`)
    }
    if (parsed.time_end) {
      setFormEnd(parsed.time_end)
      applied.push(`Fine: ${parsed.time_end}`)
    }
    if (parsed.notes && !options.skipNotes) {
      setFormNotes(parsed.notes)
      applied.push('Note aggiornate')
    }
    return applied
  }

  function resetVoiceShiftFields() {
    if (voiceGuideActive) stopVoiceShiftGuide()
    if (assistantActive) {
      assistantCancelledRef.current = true
      setAssistantActive(false)
      try { assistantRecognitionRef.current?.stop() } catch { /* noop */ }
    }
    stopVoiceShiftConfirmListen()
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try { window.speechSynthesis.cancel() } catch { /* noop */ }
    }
    setAssistantPhrases([])
    setAssistantTranscript('')
    resetForm()
    setVoiceGuideHeard('')
    setVoiceGuidePrompt('')
    setVoiceError('')
    setVoiceListening(false)
    setSuccess('Campi turno azzerati. Pronto a ricominciare.')
  }

  function reapplyAssistantDictation(phrases) {
    resetForm()
    const merged = (phrases || []).join('. ').trim()
    setAssistantTranscript(merged)
    if (merged) {
      const parsed = voiceParseShift(merged, members)
      const times = voiceMergeTimesFromPhrases(phrases)
      if (times?.start) parsed.time_start = times.start
      if (times?.end) parsed.time_end = times.end
      applyVoiceShiftFields(parsed)
    }
    setVoiceGuideHeard(phrases.length ? phrases[phrases.length - 1] : '')
  }

  function clearAssistantDictation() {
    if (!assistantActive) return
    setAssistantPhrases([])
    setAssistantTranscript('')
    setVoiceGuideHeard('')
    setVoiceError('')
    resetForm()
  }

  function undoLastAssistantDictationPhrase() {
    if (!assistantActive || assistantPhrases.length === 0) return
    const next = assistantPhrases.slice(0, -1)
    setAssistantPhrases(next)
    reapplyAssistantDictation(next)
  }

  function startVoiceShiftAssistant() {
    if (!SpeechRecognition) {
      setVoiceError("L'assistente vocale non è supportato (usa Chrome o Edge)")
      return
    }
    if (assistantActive || voiceGuideActive) return
    setVoiceError('')
    setVoiceGuideHeard('')
    setVoiceGuidePrompt('Assistente attivo: dimmi liberamente dipendente, data, ora di inizio e fine. Premi "Ferma" quando hai finito.')
    setAssistantPhrases([])
    setAssistantTranscript('')
    assistantCancelledRef.current = false
    setAssistantActive(true)
    startVoiceShiftLoop()
  }

  function startVoiceShiftLoop() {
    if (assistantCancelledRef.current) return
    if (!SpeechRecognition) return
    let rec
    try {
      rec = new SpeechRecognition()
    } catch {
      setVoiceError('Riconoscimento vocale non disponibile')
      return
    }
    rec.lang = 'it-IT'
    rec.continuous = true
    rec.interimResults = false
    rec.onstart = () => setVoiceListening(true)
    rec.onend = () => {
      setVoiceListening(false)
      if (assistantCancelledRef.current) return
      window.setTimeout(() => {
        if (!assistantCancelledRef.current) startVoiceShiftLoop()
      }, 200)
    }
    rec.onerror = (e) => {
      if (e?.error === 'not-allowed') {
        setVoiceError('Microfono non autorizzato')
        assistantCancelledRef.current = true
        setAssistantActive(false)
      }
    }
    rec.onresult = (e) => {
      const startIdx = typeof e.resultIndex === 'number' ? e.resultIndex : 0
      const additions = []
      for (let i = startIdx; i < e.results.length; i++) {
        const r = e.results[i]
        if (!r || !r.isFinal) continue
        const phrase = String(r[0]?.transcript || '').trim()
        if (phrase) additions.push(phrase)
      }
      if (!additions.length) return
      const added = additions.join(' ')
      let nextPhrases = assistantPhrases
      setAssistantPhrases((prev) => {
        nextPhrases = [...prev, added]
        return nextPhrases
      })
      reapplyAssistantDictation(nextPhrases)
    }
    assistantRecognitionRef.current = rec
    try { rec.start() } catch { setVoiceListening(false) }
  }

  function stopVoiceShiftAssistant() {
    if (!assistantActive) return
    assistantCancelledRef.current = true
    setAssistantActive(false)
    setVoiceListening(false)
    try { assistantRecognitionRef.current?.stop() } catch { /* noop */ }
    askVoiceShiftSaveOrReset()
  }

  function askVoiceShiftSaveOrReset() {
    stopVoiceShiftConfirmListen()
    setVoiceGuidePrompt('Vuoi salvare il turno? Rispondi sì o no.')
    if (!SpeechRecognition || typeof window === 'undefined') {
      const ok = window.confirm('Vuoi salvare il turno appena dettato?\nOK = salva  •  Annulla = resetta')
      if (ok) {
        if (!formMemberId) setVoiceError('Manca il dipendente: completa e salva manualmente.')
        else window.setTimeout(() => submitVoiceShiftForm({ showSavingPrompt: true }), 150)
      } else {
        resetVoiceShiftFields()
      }
      return
    }
    const speakAndListen = () => {
      try {
        const utter = new SpeechSynthesisUtterance('Vuoi salvare il turno? Rispondi sì o no.')
        utter.lang = 'it-IT'
        utter.rate = 1
        utter.onend = () => window.setTimeout(listenForVoiceShiftAnswer, 150)
        window.speechSynthesis.cancel()
        window.speechSynthesis.speak(utter)
      } catch {
        listenForVoiceShiftAnswer()
      }
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      speakAndListen()
    } else {
      listenForVoiceShiftAnswer()
    }
  }

  function listenForVoiceShiftAnswer() {
    if (!SpeechRecognition) return
    let rec
    try { rec = new SpeechRecognition() } catch { return }
    rec.lang = 'it-IT'
    rec.continuous = false
    rec.interimResults = false
    rec.onstart = () => setVoiceListening(true)
    rec.onend = () => setVoiceListening(false)
    rec.onerror = () => setVoiceListening(false)
    rec.onresult = (e) => {
      const transcript = Array.from(e.results).map((r) => r[0].transcript).join(' ').trim()
      setVoiceGuideHeard(transcript)
      const yes = /\b(si|sì|salva|ok|conferma|procedi|va bene|aggiungi|certo)\b/i.test(transcript)
      const no = /\b(no|annulla|cancella|resetta|reset|non salvare)\b/i.test(transcript)
      if (yes && !no) {
        if (!formMemberId) {
          setVoiceError('Manca il dipendente: non posso salvare automaticamente.')
          window.setTimeout(() => dismissVoiceShiftSessionPrompt(), 4000)
        } else {
          window.setTimeout(() => submitVoiceShiftForm({ showSavingPrompt: true }), 200)
        }
      } else if (no && !yes) {
        resetVoiceShiftFields()
        setVoiceGuidePrompt('Campi azzerati. Pronto per ricominciare.')
      } else {
        setVoiceError(`Non ho capito "${transcript}". Premi Aggiungi o 🔁 Reset manualmente.`)
        window.setTimeout(() => dismissVoiceShiftSessionPrompt(), 4000)
      }
    }
    assistantConfirmRef.current = rec
    try { rec.start() } catch { /* noop */ }
  }

  function stopVoiceShiftGuide() {
    stopVoiceShiftConfirmListen()
    setVoiceGuideActive(false)
    setVoiceGuidePrompt('')
    setVoiceGuideStep(0)
    setVoiceGuideHeard('')
    setVoiceListening(false)
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try { window.speechSynthesis.cancel() } catch { /* noop */ }
    }
  }

  function startVoiceShiftGuide() {
    if (!SpeechRecognition) {
      setVoiceError("L'assistente vocale non è supportato (usa Chrome o Edge)")
      return
    }
    if (assistantActive) return
    setVoiceError('')
    setVoiceGuideHeard('')
    setVoiceGuideActive(true)
    setVoiceGuideStep(0)
  }

  useEffect(() => {
    if (!voiceGuideActive) return
    const memberPrompt = formMemberId
      ? `Dipendente attuale: ${(members.find((m) => String(m.id) === String(formMemberId)) || {}).name || ''}. Per cambiarlo dimmi un altro nome.`
      : 'Per chi è il turno? Dimmi il nome del dipendente.'
    const steps = [
      { key: 'member', prompt: memberPrompt },
      { key: 'kind', prompt: 'Che tipo? Dimmi turno, permesso, assenza o malattia.' },
      { key: 'work_date', prompt: 'Che giorno? Oggi, domani, lunedì o una data.' },
      { key: 'time_range', prompt: 'Orario? Es. inizio turno 9, fine turno 17, oppure dalle 9 alle 17, 9-17.' },
      { key: 'notes', prompt: 'Vuoi aggiungere note? Dimmi le note oppure passa.' },
      { key: '__confirm__', prompt: 'Aggiungo questo turno? Rispondi sì o no.' },
    ]
    if (voiceGuideStep >= steps.length) {
      setVoiceGuidePrompt('Compilazione vocale completata.')
      setVoiceGuideActive(false)
      setVoiceListening(false)
      return undefined
    }
    const step = steps[voiceGuideStep]
    setVoiceGuidePrompt(step.prompt)

    const TERMINATOR_RX = /\b(andiamo\s+avanti|vai\s+avanti|prossim[oa]|continu[ai]|sono\s+pronto|pronto\s+ad?\s+andare|avanti)\b/i
    const SKIP_RX = /^(passa|salta|skip|nessuno|vuoto|nulla)\b/i
    const REPEAT_RX = /^(ripeti|ripet[iy]|di nuovo|repeat)\b/i
    const YES_RX = /\b(si|sì|ok|confermo|salva|procedi|va bene|aggiungi)\b/i

    let cancelled = false
    let recognition = null
    let buffer = ''
    let inactivityTimer = null
    let advancing = false

    const speak = (text, cb) => {
      if (cancelled) return
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
          const u = new SpeechSynthesisUtterance(text)
          u.lang = 'it-IT'
          u.rate = 1.22
          if (cb) u.onend = () => window.setTimeout(cb, 60)
          window.speechSynthesis.cancel()
          window.speechSynthesis.speak(u)
          return
        } catch { /* fallthrough */ }
      }
      if (cb) window.setTimeout(cb, 60)
    }
    const isTimeStep = step.key === 'time_range' || step.key === 'time_start' || step.key === 'time_end'
    const armInactivityTimer = () => {
      if (inactivityTimer) window.clearTimeout(inactivityTimer)
      inactivityTimer = window.setTimeout(() => {
        if (cancelled || advancing) return
        speak(isTimeStep ? 'Dimmi l\'orario, oppure passa.' : 'Sei pronto ad andare avanti?')
        armInactivityTimer()
      }, isTimeStep ? 12000 : 30000)
    }
    const advance = () => {
      if (advancing || cancelled) return
      advancing = true
      cancelled = true
      if (inactivityTimer) window.clearTimeout(inactivityTimer)
      try { recognition && recognition.stop() } catch { /* noop */ }
      window.setTimeout(() => setVoiceGuideStep((s) => s + 1), 50)
    }
    const applyAndAdvance = (rawText) => {
      const text = (rawText || '').trim()
      const isSkip = SKIP_RX.test(text)
      const valueText = isSkip ? '' : text
      if (step.key === 'member') {
        if (valueText) {
          const m = voiceMatchMember(valueText, members)
          if (m) setFormMemberId(String(m.id))
          else if (!formMemberId) setVoiceError(`Dipendente "${valueText}" non trovato. Selezionalo manualmente.`)
        }
      } else if (step.key === 'kind') {
        const k = voiceParseEntryKind(text) || 'shift'
        setFormKind(k)
      } else if (step.key === 'work_date') {
        const iso = voiceParseDateIso(valueText || text)
        if (iso) setFormDate(iso)
      } else if (step.key === 'time_range' || step.key === 'time_start' || step.key === 'time_end') {
        if (valueText) {
          let t = voiceParseShiftTimesWithRoles(valueText)
          if (!t?.start && step.key === 'time_start') {
            const one = voiceExtractTimeFromPhrase(valueText)
            if (one) t = { start: one, end: null }
          }
          if (!t?.end && step.key === 'time_end') {
            const one = voiceExtractTimeFromPhrase(valueText)
            if (one) t = { start: null, end: one }
          }
          voiceApplyShiftTimesToForm(t, { setFormStart, setFormEnd })
        }
      } else if (step.key === 'notes') {
        if (valueText) setFormNotes(valueText)
      } else if (step.key === '__confirm__') {
        const yes = YES_RX.test(text)
        if (yes) {
          if (!formMemberId) {
            setVoiceError('Manca il dipendente: non posso salvare automaticamente.')
          } else {
            window.setTimeout(() => submitVoiceShiftForm({ showSavingPrompt: true }), 200)
          }
        }
      }
      advance()
    }

    const startRecognition = () => {
      if (cancelled) return
      if (!SpeechRecognition) {
        setVoiceError('Riconoscimento vocale non disponibile')
        advance()
        return
      }
      try {
        recognition = new SpeechRecognition()
        recognition.lang = 'it-IT'
        recognition.continuous = true
        recognition.interimResults = false
      } catch {
        setVoiceError('Riconoscimento vocale non disponibile')
        advance()
        return
      }
      recognition.onstart = () => {
        setVoiceListening(true)
        armInactivityTimer()
      }
      recognition.onend = () => {
        setVoiceListening(false)
        if (cancelled) return
        window.setTimeout(() => {
          if (!cancelled) startRecognition()
        }, isTimeStep ? 80 : 180)
      }
      recognition.onerror = () => { /* onend riavvia */ }
      recognition.onresult = (e) => {
        armInactivityTimer()
        const startIdx = typeof e.resultIndex === 'number' ? e.resultIndex : 0
        for (let i = startIdx; i < e.results.length; i++) {
          const r = e.results[i]
          if (!r || !r.isFinal) continue
          const phrase = String(r[0]?.transcript || '').trim()
          if (!phrase) continue
          setVoiceGuideHeard(phrase)

          if (REPEAT_RX.test(phrase)) {
            speak(step.prompt)
            continue
          }
          if (step.key === '__confirm__') {
            applyAndAdvance(phrase)
            return
          }
          if (TERMINATOR_RX.test(phrase)) {
            const cleaned = phrase.replace(TERMINATOR_RX, '').trim()
            if (cleaned) buffer = (buffer + ' ' + cleaned).trim()
            applyAndAdvance(buffer)
            return
          }
          if (SKIP_RX.test(phrase)) {
            applyAndAdvance('')
            return
          }
          buffer = (buffer + ' ' + phrase).trim()
          if (isTimeStep) {
            const partial = voiceParseShiftTimesWithRoles(buffer)
            if (partial?.start) setFormStart(partial.start)
            if (partial?.end) setFormEnd(partial.end)
            if (voiceTimeStepLooksComplete(step.key, buffer)) {
              applyAndAdvance(buffer)
              return
            }
            continue
          }
        }
      }
      try { recognition.start() } catch { setVoiceListening(false) }
    }

    speak(step.prompt, startRecognition)

    return () => {
      cancelled = true
      advancing = true
      if (inactivityTimer) window.clearTimeout(inactivityTimer)
      try { recognition && recognition.stop() } catch { /* noop */ }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try { window.speechSynthesis.cancel() } catch { /* noop */ }
      }
      setVoiceListening(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceGuideActive, voiceGuideStep])

  return (
    <div className="staff-page">
      <header className="staff-page-hero">
        <div className="staff-page-hero-inner">
          <h1 className="page-header staff-page-title">Personale</h1>
          <p className="staff-page-lead">
            Gestisci i dipendenti e la pianificazione: <strong>turni</strong> con fascia oraria, <strong>permessi</strong>,{' '}
            <strong>assenze</strong> e <strong>malattia</strong>. Scegli <strong>Settimana</strong>, un singolo <strong>Giorno</strong>,
            oppure <strong>Periodo</strong> con date Dal/Al (fino a {MAX_PLANNING_PERIOD_DAYS} giorni), poi usa
            <strong> «Carica piano»</strong> per scaricare i turni dal server in base alle date selezionate (il caricamento non
            parte da solo quando cambi data).
          </p>
        </div>
      </header>

      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-info">{success}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <section className="card" style={{ order: 1, marginBottom: 0 }}>
        <h2 className="page-subheader" style={{ marginTop: 0 }}>
          Dipendenti
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: '-0.35rem', marginBottom: '0.85rem', maxWidth: 720, lineHeight: 1.45 }}>
          La colonna <strong>Ordine</strong> serve a definire in che sequenza compaiono i dipendenti negli elenchi caricati dal server (in particolare il menu a tendina quando aggiungi o modifichi una voce in pianificazione).
          <br />
          Usa numeri crescenti: chi ha il valore più basso viene elencato per primo; a parità di ordine vale l’ordine alfabetico sul nome.
        </p>
        <form onSubmit={handleAddMember} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', alignItems: 'flex-end', marginBottom: '1rem' }}>
          <div className="form-group" style={{ marginBottom: 0, flex: '1 1 140px' }}>
            <label>Nome</label>
            <input className="form-control" value={newMemberFirstName} onChange={(e) => setNewMemberFirstName(e.target.value)} placeholder="Nome" />
          </div>
          <div className="form-group" style={{ marginBottom: 0, flex: '1 1 140px' }}>
            <label>Cognome</label>
            <input className="form-control" value={newMemberLastName} onChange={(e) => setNewMemberLastName(e.target.value)} placeholder="Cognome" />
          </div>
          <div className="form-group" style={{ marginBottom: 0, flex: '1 1 180px' }}>
            <label>Email</label>
            <input type="email" className="form-control" value={newMemberEmail} onChange={(e) => setNewMemberEmail(e.target.value)} placeholder="email@esempio.it" />
          </div>
          <div className="form-group" style={{ marginBottom: 0, flex: '1 1 130px' }}>
            <label>Telefono</label>
            <input type="tel" className="form-control" value={newMemberPhone} onChange={(e) => setNewMemberPhone(e.target.value)} placeholder="Cell. / tel." />
          </div>
          <div className="form-group" style={{ marginBottom: 0, flex: '1 1 130px' }}>
            <label>Città</label>
            <input className="form-control" value={newMemberCity} onChange={(e) => setNewMemberCity(e.target.value)} placeholder="Città" />
          </div>
          <div className="form-group" style={{ marginBottom: 0, flex: '0 1 150px' }}>
            <label>Nascita</label>
            <input type="date" className="form-control" value={newMemberBirthDate} onChange={(e) => setNewMemberBirthDate(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary">
            Aggiungi
          </button>
          <button
            type="button"
            className="btn btn-outline-danger"
            disabled={members.length === 0 || shiftBusy || demoLoading || reportLoading}
            onClick={() => void handleDeleteAllMembers()}
            title="Rimuove tutti i dipendenti e tutta la pianificazione collegata (irreversibile)"
          >
            Elimina elenco dipendenti
          </button>
        </form>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.65rem',
            alignItems: 'flex-end',
            marginBottom: '1rem',
            padding: '0.7rem',
            border: '1px dashed var(--border)',
            borderRadius: 'var(--radius)',
            background: 'color-mix(in oklab, var(--bg-card) 92%, #0ea5e9 8%)',
          }}
        >
          <div className="form-group" style={{ marginBottom: 0, flex: '1 1 250px' }}>
            <label>Nome locale</label>
            <input
              className="form-control"
              value={localeStaffName}
              onChange={(e) => setLocaleStaffName(e.target.value)}
              placeholder="Es. La Risacca"
              disabled={shiftBusy || loading || demoLoading || reportLoading}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0, flex: '1 1 240px', minWidth: 220 }}>
            <label>Locali salvati</label>
            <select
              className="form-control"
              value={savedLocaleNames.includes(localeStaffName.trim()) ? localeStaffName.trim() : ''}
              onChange={(e) => setLocaleStaffName(e.target.value)}
              disabled={shiftBusy || loading || demoLoading || reportLoading || savedLocaleNames.length === 0}
            >
              <option value="">{savedLocaleNames.length === 0 ? 'Nessun locale salvato' : 'Seleziona locale salvato'}</option>
              {savedLocaleNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSaveMembersByLocale()}
            disabled={shiftBusy || loading || demoLoading || reportLoading}
            title="Salva la lista dipendenti corrente associandola al nome locale"
          >
            Salva dipendenti
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void handleLoadMembersByLocale()}
            disabled={shiftBusy || loading || demoLoading || reportLoading}
            title="Carica la lista dipendenti salvata per questo locale e sostituisce l'elenco attuale"
          >
            Carica dipendenti
          </button>
        </div>
        <div className="table-wrap">
          <table className="app-table app-table--compact">
            <thead>
              <tr>
                <th>Nome (piano)</th>
                <th>Email</th>
                <th>Telefono</th>
                <th>Città</th>
                <th>Ordine</th>
                <th>Attivo</th>
                <th className="text-end">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td style={{ fontWeight: 600 }}>{m.name}</td>
                  <td style={{ fontSize: '0.9rem', maxWidth: 200 }} title={m.email || ''}>
                    {m.email ? (
                      <a href={`mailto:${m.email}`}>{m.email}</a>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>—</span>
                    )}
                  </td>
                  <td style={{ fontSize: '0.9rem', whiteSpace: 'nowrap' }} title={m.phone || ''}>
                    {m.phone ? (
                      <a href={`tel:${m.phone.replace(/\s/g, '')}`}>{m.phone}</a>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>—</span>
                    )}
                  </td>
                  <td style={{ fontSize: '0.9rem', maxWidth: 140 }} title={m.city || ''}>
                    {m.city || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td>
                    <input
                      type="number"
                      className="form-control"
                      style={{ width: 72 }}
                      defaultValue={m.sort_order}
                      onBlur={async (e) => {
                        const v = Number(e.target.value)
                        if (Number.isNaN(v) || v === m.sort_order) return
                        try {
                          await updateStaffMember(m.id, { sort_order: v })
                          await refreshMembers()
                        } catch (err) {
                          const msg = String(err?.message || '')
                          await refreshMembers()
                          if (msg.includes('404') || msg.includes('non trovato')) {
                            setError('Dipendente non più presente: elenco aggiornato.')
                          } else {
                            setError('Aggiornamento ordine non riuscito')
                          }
                        }
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={m.is_active}
                      onChange={async (e) => {
                        try {
                          await updateStaffMember(m.id, { is_active: e.target.checked })
                          await refreshMembers()
                        } catch (err) {
                          const msg = String(err?.message || '')
                          await refreshMembers()
                          if (msg.includes('404') || msg.includes('non trovato')) {
                            setError('Dipendente non più presente: elenco aggiornato.')
                          } else {
                            setError('Aggiornamento stato non riuscito')
                          }
                        }
                      }}
                    />
                  </td>
                  <td className="text-end" style={{ whiteSpace: 'nowrap' }}>
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      style={{ marginRight: '0.35rem' }}
                      onClick={() => setMemberInfoId(m.id)}
                      title="Scheda anagrafica: nome, cognome, email, telefono, città, età"
                    >
                      Info
                    </button>
                    <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => handleDeleteMember(m)}>
                      Elimina
                    </button>
                  </td>
                </tr>
              ))}
              {members.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-state">
                    Nessun dipendente: aggiungi almeno un nome per pianificare i turni.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" style={{ order: 3, marginBottom: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '1rem' }}>
          <h2 className="page-subheader" style={{ marginTop: 0, marginBottom: 0 }}>
            Pianificazione turni
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
            <div className="btn-group" role="group" aria-label="Vista calendario">
              <button
                type="button"
                className={`btn btn-sm ${planView === 'week' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => {
                  markPlanningStale()
                  if (planView === 'day') {
                    setWeekAnchor(startOfWeekMonday(dayFocus))
                  }
                  setPlanView('week')
                }}
              >
                Settimana
              </button>
              <button
                type="button"
                className={`btn btn-sm ${planView === 'day' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => {
                  markPlanningStale()
                  setDayFocus(todayDate())
                  setPlanView('day')
                }}
              >
                Giorno
              </button>
              <button
                type="button"
                className={`btn btn-sm ${planView === 'period' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => {
                  markPlanningStale()
                  if (planView === 'week') {
                    setPeriodFrom(new Date(weekAnchor.getFullYear(), weekAnchor.getMonth(), weekAnchor.getDate()))
                    setPeriodTo(addDays(weekAnchor, 6))
                  } else if (planView === 'day') {
                    setPeriodFrom(new Date(dayFocus.getFullYear(), dayFocus.getMonth(), dayFocus.getDate()))
                    setPeriodTo(new Date(dayFocus.getFullYear(), dayFocus.getMonth(), dayFocus.getDate()))
                  }
                  setPlanView('period')
                }}
              >
                Periodo
              </button>
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => {
                  markPlanningStale()
                  const t = todayDate()
                  const y = t.getFullYear()
                  const mo = t.getMonth()
                  setPeriodFrom(new Date(y, mo, 1))
                  setPeriodTo(new Date(y, mo + 1, 0))
                  setPlanView('period')
                }}
                title="Passa alla vista Periodo con Dal/Al = mese solare corrente (poi usa «Carica piano» o «Aggiorna piano»)"
              >
                Mese
              </button>
            </div>
            {planView === 'week' ? (
              <>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    markPlanningStale()
                    setWeekAnchor((w) => addDays(w, -7))
                  }}
                >
                  « Settimana prec.
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    markPlanningStale()
                    setWeekAnchor((w) => addDays(w, 7))
                  }}
                >
                  Settimana succ. »
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    markPlanningStale()
                    setWeekAnchor(startOfWeekMonday(new Date()))
                  }}
                >
                  Settimana corrente
                </button>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.9rem' }}>
                  Vai a settimana che contiene
                  <input
                    type="date"
                    className="form-control"
                    value={toYMD(weekAnchor)}
                    onChange={(e) => {
                      const v = e.target.value
                      if (!v) return
                      markPlanningStale()
                      setWeekAnchor(startOfWeekMonday(parseYMD(v)))
                    }}
                  />
                </label>
              </>
            ) : planView === 'day' ? (
              <>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    markPlanningStale()
                    setDayFocus((d) => addDays(d, -1))
                  }}
                >
                  « Giorno prec.
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    markPlanningStale()
                    setDayFocus((d) => addDays(d, 1))
                  }}
                >
                  Giorno succ. »
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    markPlanningStale()
                    setDayFocus(todayDate())
                  }}
                >
                  Oggi
                </button>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.9rem' }}>
                  Data
                  <input
                    type="date"
                    className="form-control"
                    value={dayStr}
                    onChange={(e) => {
                      const v = e.target.value
                      if (!v) return
                      markPlanningStale()
                      setDayFocus(parseYMD(v))
                    }}
                  />
                </label>
              </>
            ) : (
              <>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.9rem' }}>
                  Dal
                  <input
                    type="date"
                    className="form-control"
                    value={periodFromStr}
                    onChange={(e) => {
                      const v = e.target.value
                      if (!v) return
                      markPlanningStale()
                      setPeriodFrom(parseYMD(v))
                    }}
                  />
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.9rem' }}>
                  Al
                  <input
                    type="date"
                    className="form-control"
                    value={periodToStr}
                    onChange={(e) => {
                      const v = e.target.value
                      if (!v) return
                      markPlanningStale()
                      setPeriodTo(parseYMD(v))
                    }}
                  />
                </label>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', maxWidth: 240 }}>
                  Max {MAX_PLANNING_PERIOD_DAYS} giorni. Se «Dal» è dopo «Al», in «Carica piano» l’intervallo viene letto in ordine corretto.
                </span>
              </>
            )}
            <button
              type="button"
              className="btn btn-primary"
              disabled={loading || demoLoading}
              onClick={() => reloadPlanning()}
              title="Scarica turni dal server per il periodo selezionato"
            >
              {loading ? 'Caricamento…' : 'Carica piano'}
            </button>
            <button
              type="button"
              className="btn btn-whatsapp btn-sm"
              disabled={loading || demoLoading || !planningLoaded || displayDayCells.length === 0}
              onClick={openWhatsAppPlanning}
              title="Invia il planning su WhatsApp: testo completo nel messaggio se possibile; se è molto lungo, viene copiato negli appunti e si apre WhatsApp per incollare"
            >
              WhatsApp
            </button>
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              disabled={reportLoading || demoLoading || !reportPdfRange.ok}
              onClick={() => void openStaffReportPdf()}
              title={
                !reportPdfRange.ok
                  ? `Periodo troppo lungo (${reportPdfRange.days} giorni). Massimo ${MAX_PLANNING_PERIOD_DAYS} giorni.`
                  : planView === 'week'
                    ? 'Report PDF della settimana (lun–dom): ore turno, permessi, assenze e malattia per dipendente.'
                    : planView === 'day'
                      ? 'Report PDF del giorno selezionato: stesso riepilogo per quel solo giorno.'
                      : 'Report PDF dell’intervallo Dal–Al (fino a 93 giorni): stesso riepilogo sul periodo.'
              }
            >
              {reportLoading ? 'Report…' : 'Report PDF'}
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              disabled={shiftBusy || loading || demoLoading}
              onClick={() => void reloadPlanning()}
              title={
                planView === 'week'
                  ? 'Ricarica dal server tutti i turni della settimana (lun–dom) selezionata'
                  : planView === 'day'
                    ? 'Ricarica dal server le voci del giorno selezionato'
                    : 'Ricarica dal server tutte le voci dell’intervallo Dal–Al (anche dopo «Mese»)'
              }
            >
              {loading ? 'Aggiornamento…' : 'Aggiorna piano'}
            </button>
            <button
              type="button"
              className="btn btn-outline-danger btn-sm"
              disabled={shiftBusy || loading || demoLoading}
              onClick={handleDeleteWeekPlanning}
              title={
                planView === 'week'
                  ? 'Rimuove tutte le voci nel periodo settimanale indicato'
                  : planView === 'day'
                    ? 'Rimuove tutte le voci del giorno selezionato'
                    : 'Rimuove tutte le voci nell’intervallo Dal–Al'
              }
            >
              {planView === 'week' ? 'Elimina planning settimana' : planView === 'day' ? 'Elimina planning giorno' : 'Elimina planning periodo'}
            </button>
          </div>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: '-0.25rem' }}>
          {planView === 'week' ? (
            <>
              Periodo: <strong>{fromStr}</strong> → <strong>{toStr}</strong>
            </>
          ) : planView === 'day' ? (
            <>
              Giorno: <strong style={{ textTransform: 'capitalize' }}>{dayLongLabel}</strong> <span style={{ opacity: 0.85 }}>({dayStr})</span>
            </>
          ) : (
            <>
              Intervallo caricato: <strong>{rangeFromStr}</strong> → <strong>{rangeToStr}</strong>
              <span style={{ marginLeft: '0.5rem', opacity: 0.85 }}>
                ({displayDayCells.length} {displayDayCells.length === 1 ? 'giorno' : 'giorni'} in griglia)
              </span>
            </>
          )}
        </p>

        {loading && <p className="loading">Caricamento…</p>}

        {!loading && (
          <div
            className={
              planView === 'day'
                ? 'staff-week-grid staff-week-grid--single'
                : planView === 'period' && displayDayCells.length > 14
                  ? 'staff-week-grid staff-week-grid--period-scroll'
                  : 'staff-week-grid'
            }
          >
            {displayDayCells.map((d) => {
              const ymd = toYMD(d)
              const dow = d.getDay()
              const label = DAY_HEADERS[dow]
              const dayNum = d.getDate()
              const list = shiftsByDate.get(ymd) || []
              return (
                <div key={ymd} className="staff-day-card card" style={{ padding: '0.85rem', margin: 0 }}>
                  <div
                    className="staff-day-title"
                    style={{
                      fontWeight: 700,
                      fontSize: '0.95rem',
                      marginBottom: '0.6rem',
                      borderBottom: '1px solid var(--border, #e5e7eb)',
                      paddingBottom: '0.35rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.5rem',
                    }}
                  >
                    <span>
                      {label} {dayNum}
                    </span>
                    <button
                      type="button"
                      className="btn btn-vino btn-sm"
                      style={{ padding: '0.2rem 0.5rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }}
                      onClick={() => openDayAndInsertShift(d)}
                      disabled={shiftBusy}
                      title="Apri questo giorno e vai al modulo per inserire un turno"
                    >
                      Apri giorno
                    </button>
                  </div>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: '0.88rem', lineHeight: 1.45 }}>
                    {list.map((s) => (
                      <li key={s.id} style={{ marginBottom: '0.35rem', display: 'flex', justifyContent: 'space-between', gap: '0.35rem', alignItems: 'flex-start' }}>
                        <span>{shiftLine(s)}</span>
                        <span style={{ flexShrink: 0 }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            style={{ padding: '0.15rem 0.4rem' }}
                            disabled={shiftBusy}
                            onClick={() => startEditShift(s)}
                          >
                            Mod.
                          </button>
                        </span>
                      </li>
                    ))}
                    {list.length === 0 && <li style={{ color: 'var(--text-muted)' }}>Nessuna voce</li>}
                  </ul>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section id="staff-shift-form-card" className="card" style={{ order: 2 }}>
        <h2 className="page-subheader" style={{ marginTop: 0, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <span>{editingShiftId ? 'Modifica voce' : 'Nuova voce in pianificazione'}</span>
          {SpeechRecognition && (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={startVoiceShiftGuide}
                disabled={assistantActive || voiceGuideActive}
                style={{ marginLeft: '0.5rem', padding: '0.35rem 0.7rem', fontSize: '0.85rem' }}
                title="Assistente vocale: ti fa le domande una alla volta (dipendente, tipo, giorno, orari…). Le domande compaiono anche in un riquadro in primo piano."
              >
                🎤 Assistente vocale
              </button>
              <button
                type="button"
                className="btn btn-warning"
                onClick={() => {
                  if (assistantActive) stopVoiceShiftAssistant()
                  else if (voiceGuideActive) stopVoiceShiftGuide()
                }}
                disabled={!assistantActive && !voiceGuideActive}
                style={{ padding: '0.35rem 0.7rem', fontSize: '0.85rem' }}
                title="Interrompe il dettato libero oppure la guida vocale"
              >
                ⏹️ Ferma
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={startVoiceShiftAssistant}
                disabled={assistantActive || voiceGuideActive}
                style={{ padding: '0.35rem 0.7rem', fontSize: '0.85rem' }}
                title="Microfono continuo: detta tutto in una volta, poi Ferma; niente domande passo-passo"
              >
                🎧 Dettato libero
              </button>
              <button
                type="button"
                className="btn btn-outline-danger"
                onClick={resetVoiceShiftFields}
                style={{ padding: '0.35rem 0.7rem', fontSize: '0.85rem' }}
                title="Cancella i campi del turno per ricominciare"
              >
                🔁 Reset campi
              </button>
            </>
          )}
        </h2>
        {SpeechRecognition && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '0.75rem',
              marginBottom: '0.75rem',
            }}
          >
            <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-muted)', flex: '1 1 240px', maxWidth: '100%' }}>
              Usa <strong>Assistente vocale</strong> per le <strong>domande passo-passo</strong> (anche in un riquadro in primo piano), <strong>Dettato libero</strong> per parlare in continuo, <strong>Ferma</strong> per interrompere, <strong>Reset campi</strong> per azzerare. Per il dettaglio apri{' '}
              <strong>Info guida</strong>.
            </p>
            <button
              type="button"
              className="btn btn-outline-secondary"
              style={{ flexShrink: 0 }}
              onClick={() => setVoiceGuideInfoOpen(true)}
            >
              Info guida
            </button>
          </div>
        )}
        {voiceError ? <div className="alert alert-warning" style={{ marginBottom: '0.5rem' }}>{voiceError}</div> : null}
        <form
          ref={voiceShiftFormRef}
          onSubmit={handleSubmitShift}
          className="form-row"
          style={{ flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end' }}
          aria-busy={shiftBusy}
        >
          <div className="form-group" style={{ flex: '1 1 160px' }}>
            <label>Dipendente</label>
            <select
              className="form-control"
              value={formMemberId}
              onChange={(e) => setFormMemberId(e.target.value)}
              required
              disabled={shiftBusy}
            >
              <option value="">—</option>
              {members.map((m) => (
                <option key={m.id} value={String(m.id)}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ flex: '0 1 150px' }}>
            <label>Data</label>
            <input type="date" className="form-control" value={formDate} onChange={(e) => setFormDate(e.target.value)} required disabled={shiftBusy} />
          </div>
          <div className="form-group" style={{ flex: '0 1 130px' }}>
            <label>Tipo</label>
            <select className="form-control" value={formKind} onChange={(e) => setFormKind(e.target.value)} disabled={shiftBusy}>
              <option value="shift">Turno</option>
              <option value="permission">Permesso</option>
              <option value="absence">Assenza</option>
              <option value="sick">Malattia</option>
            </select>
          </div>
          {(formKind === 'shift' || formKind === 'permission') && (
            <>
              <div className="form-group" style={{ flex: '0 1 100px' }}>
                <label>Inizio</label>
                <input type="time" className="form-control" value={formStart} onChange={(e) => setFormStart(e.target.value)} disabled={shiftBusy} />
              </div>
              <div className="form-group" style={{ flex: '0 1 100px' }}>
                <label>Fine</label>
                <input type="time" className="form-control" value={formEnd} onChange={(e) => setFormEnd(e.target.value)} disabled={shiftBusy} />
              </div>
            </>
          )}
          {(formKind === 'absence' || formKind === 'sick') && (
            <>
              <div className="form-group" style={{ flex: '0 1 100px' }}>
                <label>Inizio (opz.)</label>
                <input type="time" className="form-control" value={formStart} onChange={(e) => setFormStart(e.target.value)} disabled={shiftBusy} />
              </div>
              <div className="form-group" style={{ flex: '0 1 100px' }}>
                <label>Fine (opz.)</label>
                <input type="time" className="form-control" value={formEnd} onChange={(e) => setFormEnd(e.target.value)} disabled={shiftBusy} />
              </div>
            </>
          )}
          <div className="form-group" style={{ flex: '1 1 200px' }}>
            <label>Note</label>
            <input
              className="form-control"
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              placeholder="Dettagli utili"
              disabled={shiftBusy}
            />
          </div>
          <div className="btn-group" style={{ marginBottom: '0.35rem' }}>
            <button type="submit" className="btn btn-primary" disabled={shiftBusy}>
              {shiftBusy ? 'Attendere…' : editingShiftId ? 'Salva modifiche' : 'Aggiungi'}
            </button>
            <button
              ref={voiceSubmitBtnRef}
              type="submit"
              className="btn btn-primary"
              style={{ display: 'none' }}
              aria-hidden
              tabIndex={-1}
            >
              Salva (vocale)
            </button>
            {editingShiftId && (
              <button
                type="button"
                className="btn btn-outline-secondary"
                disabled={shiftBusy || loading || demoLoading}
                onClick={() => reloadPlanning()}
                title="Ricarica i turni dal server per il periodo selezionato (il modulo resta aperto; le modifiche non salvate restano nei campi)"
              >
                {loading ? 'Aggiornamento…' : 'Aggiorna planning'}
              </button>
            )}
            {editingShiftId && (
              <button type="button" className="btn btn-secondary" onClick={() => resetForm()} disabled={shiftBusy}>
                Annulla
              </button>
            )}
            {editingShiftId && (
              <button type="button" className="btn btn-outline-danger" onClick={() => handleDeleteShift(editingShiftId)} disabled={shiftBusy}>
                Elimina
              </button>
            )}
          </div>
        </form>
      </section>
      </div>

      {(assistantActive || voiceGuideActive || (voiceGuidePrompt || '').trim() !== '') && (
        <div className="staff-report-modal-backdrop" role="presentation">
          <div
            className="card staff-report-modal"
            style={{ maxWidth: 520, width: 'min(94vw, 520px)' }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="staff-voice-session-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="staff-voice-session-title" className="page-subheader" style={{ marginTop: 0 }}>
              {voiceGuideActive
                ? 'Assistente vocale — domande'
                : assistantActive
                  ? 'Dettato libero'
                  : /vuoi salvare/i.test(voiceGuidePrompt || '')
                    ? 'Conferma salvataggio'
                    : 'Assistente vocale'}
            </h3>
            <p style={{ fontSize: '1.05rem', lineHeight: 1.5, margin: '0 0 1rem', color: 'var(--text-heading)' }}>{voiceGuidePrompt}</p>
            {voiceGuideHeard ? (
              <p style={{ margin: '0 0 0.75rem', color: 'var(--text-muted)', fontSize: '0.92rem' }}>
                Ultimo riconoscimento: &quot;{voiceGuideHeard}&quot;
              </p>
            ) : null}
            {assistantActive && assistantPhrases.length > 0 ? (
              <details open style={{ marginBottom: '0.85rem', fontSize: '0.88rem' }}>
                <summary style={{ cursor: 'pointer', userSelect: 'none' }}>
                  Frasi raccolte ({assistantPhrases.length})
                </summary>
                <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.2rem', color: 'var(--text-muted)' }}>
                  {assistantPhrases.map((phrase, idx) => (
                    <li key={`${idx}-${phrase.slice(0, 24)}`} style={{ marginBottom: '0.25rem' }}>
                      {phrase}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {(voiceListening && (assistantActive || voiceGuideActive)) ? (
              <p className="loading" style={{ margin: '0 0 1rem' }}>
                Microfono in ascolto…
              </p>
            ) : null}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {(assistantActive || voiceGuideActive) && (
                  <button
                    type="button"
                    className="btn btn-warning"
                    onClick={() => {
                      if (assistantActive) stopVoiceShiftAssistant()
                      else if (voiceGuideActive) stopVoiceShiftGuide()
                    }}
                  >
                    ⏹️ Ferma
                  </button>
                )}
                {assistantActive && (
                  <>
                    <button
                      type="button"
                      className="btn btn-outline-danger"
                      onClick={() => clearAssistantDictation()}
                      disabled={assistantPhrases.length === 0}
                      title="Azzera testo dettato e campi del modulo"
                    >
                      Cancella tutto
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      onClick={() => undoLastAssistantDictationPhrase()}
                      disabled={assistantPhrases.length === 0}
                      title="Rimuove l’ultima frase riconosciuta e ricalcola i campi"
                    >
                      Annulla ultima frase
                    </button>
                  </>
                )}
                {!assistantActive &&
                  !voiceGuideActive &&
                  /vuoi salvare/i.test(voiceGuidePrompt || '') &&
                  !/salvataggio in corso/i.test(voiceGuidePrompt || '') && (
                    <>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => {
                          if (!formMemberId) {
                            setVoiceError('Manca il dipendente: non posso salvare.')
                            return
                          }
                          window.setTimeout(() => submitVoiceShiftForm({ showSavingPrompt: true }), 200)
                        }}
                      >
                        Salva
                      </button>
                      <button type="button" className="btn btn-secondary" onClick={() => resetVoiceShiftFields()}>
                        Annulla
                      </button>
                    </>
                  )}
                {!assistantActive &&
                  !voiceGuideActive &&
                  /vuoi salvare/i.test(voiceGuidePrompt || '') &&
                  voiceListening &&
                  !/salvataggio in corso/i.test(voiceGuidePrompt || '') && (
                    <button type="button" className="btn btn-outline-secondary" onClick={() => stopVoiceShiftConfirmListen()}>
                      Interrompi ascolto
                    </button>
                  )}
                {!assistantActive &&
                  !voiceGuideActive &&
                  /salvataggio in corso/i.test(voiceGuidePrompt || '') &&
                  !shiftBusy && (
                    <button type="button" className="btn btn-secondary" onClick={() => dismissVoiceShiftSessionPrompt()}>
                      Chiudi
                    </button>
                  )}
                {!assistantActive && !voiceGuideActive && /completat/i.test(voiceGuidePrompt || '') && (
                  <button type="button" className="btn btn-primary" onClick={() => setVoiceGuidePrompt('')}>
                    Chiudi
                  </button>
                )}
              </div>
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setVoiceGuideInfoOpen(true)}>
                Info guida
              </button>
            </div>
          </div>
        </div>
      )}

      {voiceGuideInfoOpen && (
        <div
          className="staff-report-modal-backdrop"
          role="presentation"
          onClick={() => setVoiceGuideInfoOpen(false)}
        >
          <div
            className="card staff-report-modal"
            style={{ maxWidth: 520, width: 'min(96vw, 520px)' }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="staff-voice-guide-info-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="staff-voice-guide-info-title" className="page-subheader" style={{ marginTop: 0 }}>
              Assistente e guida vocale (Personale)
            </h3>
            <div style={{ fontSize: '0.92rem', lineHeight: 1.55, color: 'var(--text-body)' }}>
              <p style={{ margin: '0 0 0.75rem' }}>
                <strong>Assistente vocale:</strong> avvia la <strong>guida con domande</strong> (dipendente, tipo, giorno, orari…). Ogni domanda compare anche in un <strong>riquadro in primo piano</strong>. Per parlare in continuo senza domande usa <strong>Dettato libero</strong>, poi <strong>Ferma</strong>; ti chiederà se salvare.
              </p>
              <p style={{ margin: '0 0 0.75rem' }}>
                <strong>Dettato libero:</strong> microfono continuo; detta tutto insieme (es. &quot;Mario, domani, turno 8–16&quot;) e premi <strong>Ferma</strong>. Poi &quot;vuoi salvare?&quot;: <strong>sì</strong> salva, <strong>no</strong> azzera.
              </p>
              <p style={{ margin: '0 0 0.75rem' }}>
                <strong>Orario:</strong> puoi dire <em>inizio turno 9</em> e <em>fine turno 17</em> (anche in due frasi), oppure <em>dalle 9 alle 17</em>, <em>9-17</em>. <em>Inizio</em> va nel campo Inizio, <em>fine</em> nel campo Fine. Quando hai entrambi si passa avanti.
              </p>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                Suggerimento: usa Chrome o Edge per il riconoscimento vocale. Chiudi con <strong>Chiudi</strong>, clic fuori dalla finestra o tasto <strong>Esc</strong>. Per annullare i campi usa <strong>Reset campi</strong>.
              </p>
            </div>
            <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" className="btn btn-primary" onClick={() => setVoiceGuideInfoOpen(false)}>
                Chiudi
              </button>
            </div>
          </div>
        </div>
      )}

      <WeeklyStaffReportModal
        open={reportModalOpen}
        onClose={closeWeeklyReport}
        pdfBlob={reportPdfBlob}
        filename={reportFilename}
        whatsappText={reportWaText}
        periodLabel={reportPeriodLabel}
        modalTitle={reportModalTitle}
        onNotify={(msg) => setSuccess(msg)}
      />

      <StaffMemberInfoModal
        member={memberInfoTarget}
        onClose={() => !memberInfoSaving && setMemberInfoId(null)}
        onSave={handleSaveMemberInfo}
        saving={memberInfoSaving}
      />
    </div>
  )
}
