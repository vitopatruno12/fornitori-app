const LS_KEY_V2 = 'fornitori_app_order_courier_contact_v2'
const LS_KEY_V1 = 'fornitori_app_order_courier_contact_v1'

function text(value) {
  const t = String(value ?? '').trim()
  return t || null
}

export function emptyCourierCarrier() {
  return {
    name: '',
    phone: '',
    email: '',
    enabled: true,
    inService: false,
  }
}

export function normalizeCourierCarrier(raw, index = 0) {
  const item = raw && typeof raw === 'object' ? raw : {}
  return {
    name: String(item.name || '').trim(),
    phone: String(item.phone || '').trim(),
    email: String(item.email || '').trim(),
    enabled: item.enabled !== false,
    inService: Boolean(item.inService),
    _key: item._key || `c-${index}-${Date.now()}`,
  }
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
  const inService = list.filter(
    (c) => c.inService && c.enabled !== false && isCourierPhoneValid(c.phone, normalizeWhatsAppNumber),
  )
  if (inService.length) return inService
  const fallback = list.find(
    (c) => c.enabled !== false && isCourierPhoneValid(c.phone, normalizeWhatsAppNumber),
  )
  return fallback ? [fallback] : []
}

export function resolveCourierEmailsForSend(carriers) {
  const list = normalizeCourierCarriers(carriers)
  const inService = list.filter((c) => c.inService && c.enabled !== false && text(c.email))
  const source = inService.length ? inService : list.filter((c) => c.enabled !== false && text(c.email))
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
  const list = normalizeCourierCarriers(carriers)
  const current = list[index]
  const turnOff = current?.inService
  return list.map((c, i) => ({
    ...c,
    inService: turnOff ? false : i === index,
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
