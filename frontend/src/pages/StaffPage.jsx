import React, { useCallback, useEffect, useMemo, useState } from 'react'
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

const KIND_LABELS = {
  shift: 'Turno',
  permission: 'Permesso',
  absence: 'Assenza',
  sick: 'Malattia',
}

/** Domenica come primo giorno della settimana (indice getDay: dom=0). */
function startOfWeekSunday(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dow = x.getDay()
  x.setDate(x.getDate() - dow)
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
  const [weekAnchor, setWeekAnchor] = useState(() => startOfWeekSunday(new Date()))
  /** Vista: settimana | singolo giorno | intervallo date libero (dal / al). */
  const [planView, setPlanView] = useState('week')
  const [dayFocus, setDayFocus] = useState(todayDate)
  const [periodFrom, setPeriodFrom] = useState(() => {
    const w = startOfWeekSunday(new Date())
    return new Date(w.getFullYear(), w.getMonth(), w.getDate())
  })
  const [periodTo, setPeriodTo] = useState(() => addDays(startOfWeekSunday(new Date()), 6))
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

  const [formMemberId, setFormMemberId] = useState('')
  const [formDate, setFormDate] = useState(() => toYMD(new Date()))
  const [formStart, setFormStart] = useState('08:00')
  const [formEnd, setFormEnd] = useState('16:00')
  const [formKind, setFormKind] = useState('shift')
  const [formNotes, setFormNotes] = useState('')
  const [editingShiftId, setEditingShiftId] = useState(null)
  /** Evita richieste duplicate (doppio clic / Invio mentre parte un’altra azione). */
  const [shiftBusy, setShiftBusy] = useState(false)

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

  /** Intervallo date per il report PDF in base alla vista: settimana dom–sab, singolo giorno, o Dal–Al. */
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
        pdfMainHeading = 'Report personale — settimana (dom–sab)'
        periodTitle = `Settimana dal ${rr.from.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} al ${rr.to.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`
        periodSub = `Intervallo dati: ${fromStr} → ${toStr} (7 giorni, domenica–sabato)`
        modalTitle = 'Report settimana (PDF)'
        filename = `report-personale-settimana-${fromStr}.pdf`
      } else {
        pdfMainHeading = 'Report personale — periodo'
        periodTitle = `Dal ${rr.from.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })} al ${rr.to.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}`
        periodSub = `Intervallo dati: ${fromStr} → ${toStr} (${rr.dayCount} ${rr.dayCount === 1 ? 'giorno' : 'giorni'})`
        modalTitle = 'Report periodo (PDF)'
        filename = `report-personale-periodo-${fromStr}_${toStr}.pdf`
      }

      const blob = generateWeeklyStaffReportPdf({ pdfMainHeading, periodTitle, periodSub, rows })
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

  async function handleSubmitShift(e) {
    e.preventDefault()
    if (shiftBusy) return
    if (!formMemberId) {
      setError('Seleziona un dipendente')
      return
    }
    const staffId = Number(formMemberId)
    if (!Number.isFinite(staffId) || !members.some((m) => m.id === staffId)) {
      setError('Il dipendente selezionato non è più in elenco. Scegli un altro nome dal menu.')
      await refreshMembers()
      return
    }
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
        return
      }
    }
    if (formKind === 'permission') {
      if ((formStart && !formEnd) || (!formStart && formEnd)) {
        setError('Permesso: indicare sia inizio sia fine, oppure lasciare vuoto e usare le note')
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
      resetForm()
      await reloadPlanning()
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
      const anchor = startOfWeekSunday(parseYMD('2026-03-29'))
      setPlanView('week')
      setWeekAnchor(anchor)
      setSuccess(
        'Esempio caricato (8 giorni). La prima settimana mostra fino a sabato 4; per domenica 5 apr usa «Settimana succ.».',
      )
      await loadForRange(anchor, addDays(anchor, 6))
      setPlanningLoaded(true)
    } catch (err) {
      setError(err?.message || 'Errore caricamento esempio')
    } finally {
      setDemoLoading(false)
    }
  }

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
                    setWeekAnchor(startOfWeekSunday(dayFocus))
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
                    setWeekAnchor(startOfWeekSunday(new Date()))
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
                      setWeekAnchor(startOfWeekSunday(parseYMD(v)))
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
                    ? 'Report PDF della settimana (dom–sab): ore turno, permessi, assenze e malattia per dipendente.'
                    : planView === 'day'
                      ? 'Report PDF del giorno selezionato: stesso riepilogo per quel solo giorno.'
                      : 'Report PDF dell’intervallo Dal–Al (fino a 93 giorni): stesso riepilogo sul periodo.'
              }
            >
              {reportLoading ? 'Report…' : 'Report PDF'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={demoLoading || loading}
              onClick={loadDemoExample}
              title="Solo dimostrazione: crea dipendenti e turni di esempio (mar–apr 2026)"
            >
              {demoLoading ? 'Carico…' : 'Solo demo: carica esempio'}
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              disabled={shiftBusy || loading || demoLoading}
              onClick={() => void reloadPlanning()}
              title={
                planView === 'week'
                  ? 'Ricarica dal server tutti i turni della settimana (dom–sab) selezionata'
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
        <h2 className="page-subheader" style={{ marginTop: 0 }}>
          {editingShiftId ? 'Modifica voce' : 'Nuova voce in pianificazione'}
        </h2>
        <form
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
