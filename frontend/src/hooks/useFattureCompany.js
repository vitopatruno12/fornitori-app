import { useCallback, useEffect, useState } from 'react'
import {
  companyLabel,
  FATTURE_COMPANY_ORDER,
  fetchFattureCompanies,
  readFattureCompany,
  resolveEmbeddedFattureCompany,
  writeFattureCompany,
} from '../utils/fattureCompany.js'

/**
 * @param {boolean} gestionaleMode — true = gestionale grande (menu società); false = postazione operativa (società fissa).
 */
export function useFattureCompany(gestionaleMode = true) {
  const embeddedCompanyId = gestionaleMode ? '' : resolveEmbeddedFattureCompany()
  const [companies, setCompanies] = useState([])
  const [companyId, setCompanyIdState] = useState(() => {
    if (!gestionaleMode) return embeddedCompanyId
    return readFattureCompany()
  })
  const [loadingCompanies, setLoadingCompanies] = useState(Boolean(gestionaleMode))

  const refreshCompanies = useCallback(async () => {
    if (!gestionaleMode) {
      const fixed = resolveEmbeddedFattureCompany()
      setCompanyIdState(fixed)
      setCompanies(fixed ? [{ id: fixed, label: companyLabel(fixed) }] : [])
      setLoadingCompanies(false)
      return fixed ? [{ id: fixed, label: companyLabel(fixed) }] : []
    }
    setLoadingCompanies(true)
    try {
      const rows = await fetchFattureCompanies()
      const ordered = FATTURE_COMPANY_ORDER.map((id) => rows.find((r) => r.id === id)).filter(Boolean)
      setCompanies(ordered.length ? ordered : rows)
      const stored = readFattureCompany()
      if (stored && ordered.some((r) => r.id === stored)) {
        setCompanyIdState(stored)
      } else if (ordered.length === 1) {
        setCompanyIdState(ordered[0].id)
        writeFattureCompany(ordered[0].id)
      } else if (stored && !ordered.some((r) => r.id === stored)) {
        setCompanyIdState('')
        writeFattureCompany('')
      }
      return ordered.length ? ordered : rows
    } catch {
      setCompanies(FATTURE_COMPANY_ORDER.map((id) => ({ id, label: companyLabel(id) })))
      return []
    } finally {
      setLoadingCompanies(false)
    }
  }, [gestionaleMode])

  useEffect(() => {
    void refreshCompanies()
  }, [refreshCompanies])

  useEffect(() => {
    if (!gestionaleMode) {
      const fixed = resolveEmbeddedFattureCompany()
      setCompanyIdState(fixed)
      setCompanies(fixed ? [{ id: fixed, label: companyLabel(fixed) }] : [])
    }
  }, [gestionaleMode])

  const setCompanyId = useCallback(
    (id) => {
      if (!gestionaleMode) return
      const next = String(id || '').trim()
      writeFattureCompany(next)
      setCompanyIdState(next)
    },
    [gestionaleMode],
  )

  return {
    companies,
    companyId,
    setCompanyId,
    loadingCompanies,
    refreshCompanies,
    gestionaleMode,
    embeddedCompanyId: gestionaleMode ? '' : companyId,
  }
}
