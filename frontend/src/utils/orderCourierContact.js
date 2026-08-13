const LS_KEY_V2 = 'fornitori_app_order_courier_contact_v2'
const LS_KEY_V1 = 'fornitori_app_order_courier_contact_v1'

/** Giorni settimana (come Date#getDay): 0=Domenica … 6=Sabato */
export const COURIER_WEEKDAY_OPTIONS = [
  { value: 1, label: 'Lunedì' },
  { value: 2, label: 'Martedì' },
  { value: 3, label: 'Mercoledì' },
  { value: 4, label: 'Giovedì' },
  { value: 5, label: 'Venerdì' },
  { value: 6, label: 'Sabato' },
  { value: 0, label: 'Domenica' },
]

function text(value) {
  const t = String(value ?? '').trim()
  return t || null
}

function normalizeRestDay(value) {
  if (value === '' || value == null) return null
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0 || n > 6) return null
  return n
}

let courierKeySeq = 0

export function emptyCourierCarrier() {
  return createCourierCarrier()
}

export function createCourierCarrier() {
  courierKeySeq += 1
  return {
    _key: `courier-${courierKeySeq}-${Date.now()}`,
    name: '',
    phone: '',
    email: '',
    enabled: true,
    inService: false,
    outOfService: false,
    restDay: null,
  }
}

export function normalizeCourierCarrier(raw, index = 0) {
  const item = raw && typeof raw === 'object' ? raw : {}
  const outOfService = Boolean(item.outOfService)
  const enabled = item.enabled !== false
  const restDay = normalizeRestDay(item.restDay)
  const restingToday = restDay != null && restDay === new Date().getDay()
  const blocked = outOfService || restingToday || !enabled
  return {
    ...(item.id != null ? { id: item.id } : {}),
    name: String(item.name || '').trim(),
    phone: String(item.phone || '').trim(),
    email: String(item.email || '').trim(),
    enabled,
    outOfService,
    restDay,
    inService: blocked ? false : Boolean(item.inService),
    ...('vanLabel' in item ? { vanLabel: item.vanLabel || '' } : {}),
    ...('vanPlate' in item ? { vanPlate: item.vanPlate || '' } : {}),
    _key: item._key || `c-${index}-${Date.now()}`,
  }
}

/** Oggi è il giorno di riposo del trasportatore. */
export function isCourierRestDayToday(carrier, today = new Date()) {
  const restDay = normalizeRestDay(carrier?.restDay)
  if (restDay == null) return false
  return restDay === today.getDay()
}

/**
 * Semaforo stato trasportatore:
 * - green: attivo e in servizio
 * - yellow: attivo ma non in servizio (solo disponibile)
 * - red: riposo / fuori servizio / non attivo
 */
export function getCourierTrafficStatus(carrier, today = new Date()) {
  const resting = isCourierRestDayToday(carrier, today)
  if (resting) {
    return { color: 'red', label: 'Riposo', reason: 'rest' }
  }
  if (carrier?.outOfService) {
    return { color: 'red', label: 'Fuori servizio', reason: 'out' }
  }
  if (carrier?.enabled === false) {
    return { color: 'red', label: 'Non attivo', reason: 'disabled' }
  }
  if (carrier?.inService) {
    return { color: 'green', label: 'In servizio', reason: 'in_service' }
  }
  return { color: 'yellow', label: 'Disponibile', reason: 'available' }
}

export function isCourierOperational(carrier, today = new Date()) {
  const status = getCourierTrafficStatus(carrier, today)
  return status.color !== 'red'
}

/** Mappa record API `/carriers` → shape editor / semaforo. */
export function mapApiCarrierToEditor(carrier) {
  if (!carrier) return createCourierCarrier()
  return {
    id: carrier.id,
    _key: `api-${carrier.id}`,
    name: String(carrier.name || '').trim(),
    phone: String(carrier.phone || '').trim(),
    email: String(carrier.email || '').trim(),
    enabled: carrier.is_active !== false,
    outOfService: Boolean(carrier.out_of_service),
    inService: Boolean(carrier.in_service),
    restDay: carrier.rest_day == null ? null : Number(carrier.rest_day),
    vanLabel: carrier.van_label || '',
    vanPlate: carrier.van_plate || '',
  }
}

export function mapApiCarriersToEditor(list) {
  const rows = Array.isArray(list) ? list.map(mapApiCarrierToEditor) : []
  return rows.length ? rows : []
}

export function normalizeCourierCarriers(raw) {
  const list = Array.isArray(raw) ? raw : []
  const normalized = list.map((item, index) => normalizeCourierCarrier(item, index))
  return normalized.length ? normalized : [emptyCourierCarrier()]
}

function defaultContact() {
  return {
    sendCopyToCourier: false,
    carriers: [emptyCourierCarrier()],
  }
}

function migrateV1(parsed) {
  const phone = String(parsed?.phone || '').trim()
  const name = String(parsed?.name || '').trim()
  const email = String(parsed?.email || '').trim()
  if (!phone && !name && !email) return defaultContact()
  return {
    sendCopyToCourier: Boolean(parsed?.sendCopyToCourier),
    carriers: normalizeCourierCarriers([
      {
        name,
        phone,
        email,
        enabled: true,
        inService: true,
        outOfService: false,
        restDay: null,
      },
    ]),
  }
}

export function loadOrderCourierContact() {
  try {
    const rawV2 = localStorage.getItem(LS_KEY_V2)
    if (rawV2) {
      const parsed = JSON.parse(rawV2)
      return {
        ...defaultContact(),
        sendCopyToCourier: Boolean(parsed?.sendCopyToCourier),
        carriers: normalizeCourierCarriers(parsed?.carriers),
      }
    }
    const rawV1 = localStorage.getItem(LS_KEY_V1)
    if (rawV1) {
      return migrateV1(JSON.parse(rawV1))
    }
  } catch {
    // ignore
  }
  return defaultContact()
}

export function saveOrderCourierContact(contact) {
  try {
    const carriers = normalizeCourierCarriers(contact?.carriers).map(({ _key, ...rest }) => rest)
    localStorage.setItem(
      LS_KEY_V2,
      JSON.stringify({
        sendCopyToCourier: Boolean(contact?.sendCopyToCourier),
        carriers,
      }),
    )
    return true
  } catch {
    return false
  }
}

export function isCourierPhoneValid(phone, normalizeWhatsAppNumber) {
  return Boolean(normalizeWhatsAppNumber?.(phone))
}

export function resolveCouriersForWhatsApp(carriers, normalizeWhatsAppNumber) {
  const list = normalizeCourierCarriers(carriers)
  const eligible = list.filter(
    (c) => isCourierOperational(c) && isCourierPhoneValid(c.phone, normalizeWhatsAppNumber),
  )
  const inService = eligible.filter((c) => c.inService)
  if (inService.length) return inService
  return eligible.length ? [eligible[0]] : []
}

export function resolveCourierEmailsForSend(carriers) {
  const list = normalizeCourierCarriers(carriers)
  const eligible = list.filter((c) => isCourierOperational(c) && text(c.email))
  const inService = eligible.filter((c) => c.inService)
  const source = inService.length ? inService : eligible
  const emails = []
  for (const c of source) {
    const em = text(c.email)
    if (em && !emails.includes(em)) emails.push(em)
  }
  return emails
}

export function getPrimaryCourier(carriers) {
  return resolveCouriersForWhatsApp(carriers, (p) => {
    const d = String(p || '').replace(/\D/g, '')
    return d.length >= 8 ? d : null
  })[0] || null
}

export function hasSavedCourierPhone(carriers) {
  const data = Array.isArray(carriers) ? carriers : loadOrderCourierContact().carriers
  return resolveCouriersForWhatsApp(data, (p) => {
    const d = String(p || '').replace(/\D/g, '')
    return d.length >= 8 ? d : null
  }).length > 0
}

export function setCourierInService(carriers, index) {
  const list = Array.isArray(carriers) ? carriers.map((item) => ({ ...item })) : []
  if (!list.length) return [createCourierCarrier()]
  const current = list[index]
  if (!current || !isCourierOperational(current)) return list
  const turnOff = Boolean(current.inService)
  return list.map((item, itemIndex) => ({
    ...item,
    inService: turnOff ? false : itemIndex === index && isCourierOperational(item),
  }))
}

function formatSupplierAddress(supplier) {
  const parts = [text(supplier?.address), text(supplier?.city)].filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

function appendOrderLineQtyBits(bits, item) {
  const it = item || {}
  if (it.pieces != null && it.pieces !== '' && !Number.isNaN(Number(it.pieces))) bits.push(`${it.pieces} pz`)
  if (it.weight_kg != null && it.weight_kg !== '' && !Number.isNaN(Number(it.weight_kg))) bits.push(`${it.weight_kg} kg`)
  if (it.volume_liters != null && it.volume_liters !== '' && !Number.isNaN(Number(it.volume_liters))) {
    bits.push(`${it.volume_liters} l`)
  }
}

/**
 * Messaggio WhatsApp/email dedicato al corriere: ritiro presso il fornitore.
 */
export function buildCourierPickupMessage(supplier, order = {}) {
  const supplierName = text(supplier?.name) || text(order?.supplierName) || 'Fornitore'
  const lines = ['Buongiorno corriere,', '']

  const courierName = text(order?.courierName)
  if (courierName) lines.push(`${courierName},`)

  lines.push("l'ordine attende di essere prelevato da:", '')

  lines.push(`Fornitore: ${supplierName}`)

  const address = formatSupplierAddress(supplier)
  if (address) lines.push(`Indirizzo ritiro: ${address}`)
  else if (text(supplier?.city)) lines.push(`Città: ${supplier.city}`)

  const contact = text(supplier?.contact_person)
  if (contact) lines.push(`Referente: ${contact}`)

  const phone = text(supplier?.phone)
  if (phone) lines.push(`Telefono: ${phone}`)

  const email = text(supplier?.email)
  if (email) lines.push(`Email: ${email}`)

  const orderNumber = text(order?.orderNumber)
  const orderDate = text(order?.orderDate)
  const expectedDeliveryDate = text(order?.expectedDeliveryDate)
  const deliveryLocation = text(order?.deliveryLocation)
  const items = Array.isArray(order?.items) ? order.items : []
  const note = text(order?.note)

  if (orderNumber || orderDate || expectedDeliveryDate || deliveryLocation) {
    lines.push('')
    if (orderNumber) lines.push(`Riferimento ordine: n. #${orderNumber}`)
    if (orderDate) lines.push(`Data ordine: ${orderDate}`)
    if (expectedDeliveryDate) lines.push(`Consegna richiesta entro: ${expectedDeliveryDate}`)
    if (deliveryLocation) lines.push(`Destinazione scarico / consegna: ${deliveryLocation}`)
  }

  if (items.length > 0) {
    lines.push('', 'Merce da prelevare:')
    items.forEach((it) => {
      const bits = [text(it?.product_description) || '—']
      appendOrderLineQtyBits(bits, it)
      if (text(it?.note)) bits.push(`(${it.note})`)
      lines.push(`• ${bits.filter(Boolean).join(' — ')}`)
    })
  }

  if (note) lines.push('', `Note ordine: ${note}`)

  lines.push('', 'Grazie.')
  return lines.join('\n')
}
