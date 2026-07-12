const LS_KEY = 'fornitori_app_order_courier_contact_v1'

function defaultContact() {
  return {
    sendCopyToCourier: false,
    name: '',
    phone: '',
    email: '',
  }
}

function text(value) {
  const t = String(value ?? '').trim()
  return t || null
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

export function loadOrderCourierContact() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return defaultContact()
    const parsed = JSON.parse(raw)
    return {
      ...defaultContact(),
      sendCopyToCourier: Boolean(parsed?.sendCopyToCourier),
      name: String(parsed?.name || '').trim(),
      phone: String(parsed?.phone || '').trim(),
      email: String(parsed?.email || '').trim(),
    }
  } catch {
    return defaultContact()
  }
}

export function saveOrderCourierContact(contact) {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        sendCopyToCourier: Boolean(contact?.sendCopyToCourier),
        name: String(contact?.name || '').trim(),
        phone: String(contact?.phone || '').trim(),
        email: String(contact?.email || '').trim(),
      }),
    )
    return true
  } catch {
    return false
  }
}

export function hasSavedCourierPhone() {
  const data = loadOrderCourierContact()
  const phone = String(data?.phone || '').trim()
  return Boolean(phone)
}

/**
 * Messaggio WhatsApp/email dedicato al corriere: ritiro presso il fornitore.
 * @param {{ name?: string, address?: string, city?: string, phone?: string, contact_person?: string, email?: string } | null} supplier
 * @param {{ courierName?: string, orderNumber?: string, orderDate?: string, expectedDeliveryDate?: string, deliveryLocation?: string, items?: Array, note?: string, supplierName?: string }} order
 */
export function buildCourierPickupMessage(supplier, order = {}) {
  const supplierName = text(supplier?.name) || text(order?.supplierName) || 'Fornitore'
  const lines = ['Buongiorno corriere,', '', "l'ordine attende di essere prelevato da:", '']

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
