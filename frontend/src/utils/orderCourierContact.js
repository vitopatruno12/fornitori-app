const LS_KEY = 'fornitori_app_order_courier_contact_v1'

function defaultContact() {
  return {
    sendCopyToCourier: false,
    name: '',
    phone: '',
    email: '',
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
  } catch {
    // ignore
  }
}

export function buildCourierCopyPrefix(courierName) {
  const name = String(courierName || '').trim()
  if (name) return `Copia ordine merce per trasporto (${name}):\n\n`
  return 'Copia ordine merce per trasporto / corriere:\n\n'
}
