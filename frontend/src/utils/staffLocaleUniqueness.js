/** Chiave confronto nome locale (case-insensitive, senza spazi extra). */
export function localeNameCompareKey(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('it')
}

/** Impronta lista dipendenti per rilevare duplicati tra locali diversi. */
export function memberListFingerprint(members) {
  if (!Array.isArray(members) || members.length === 0) return ''
  return members
    .map((m) => {
      const name = String(m?.name || '').trim().toLocaleLowerCase('it')
      if (name) return name
      const fn = String(m?.first_name || '').trim().toLocaleLowerCase('it')
      const ln = String(m?.last_name || '').trim().toLocaleLowerCase('it')
      return `${fn} ${ln}`.trim()
    })
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }))
    .join('\n')
}

/**
 * @param {string} localeName nome richiesto
 * @param {object[]} snapshot dipendenti da salvare
 * @param {{ name: string, members?: object[] }[]} existing elenco locali già salvati
 * @returns {{ ok: true, canonicalName: string } | { ok: false, message: string }}
 */
export function validateLocalePackUniqueness(localeName, snapshot, existing) {
  const requested = String(localeName || '').trim()
  if (!requested) {
    return { ok: false, message: 'Inserisci il nome del locale.' }
  }
  if (!Array.isArray(snapshot) || snapshot.length === 0) {
    return { ok: false, message: 'Aggiungi almeno un dipendente prima di salvare il locale.' }
  }

  const requestedKey = localeNameCompareKey(requested)
  const requestedFp = memberListFingerprint(snapshot)
  let canonicalName = requested

  for (const row of existing || []) {
    const existingName = String(row?.name || '').trim()
    if (!existingName) continue
    const existingKey = localeNameCompareKey(existingName)
    const existingFp = memberListFingerprint(row?.members)

    if (existingKey === requestedKey) {
      canonicalName = existingName
      continue
    }

    if (requestedFp && existingFp && requestedFp === existingFp) {
      return {
        ok: false,
        message: `Questa lista dipendenti è già salvata come "${existingName}". Usa quel nome oppure modifica l'elenco prima di associarlo a "${requested}".`,
      }
    }
  }

  if (canonicalName !== requested) {
    return {
      ok: true,
      canonicalName,
      renamed: true,
      message: `Il nome verrà salvato come "${canonicalName}" (stesso locale già presente).`,
    }
  }

  return { ok: true, canonicalName }
}
