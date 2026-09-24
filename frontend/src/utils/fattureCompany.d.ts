export const FATTURE_COMPANY_ORDER: string[]
export const FATTURE_COMPANY_LABELS: Record<string, string>
export const COMPANY_TO_ACTIVITIES: Record<string, string[]>
export const ACTIVITY_LABELS: Record<string, string>

export function isGestionaleFattureContext(fattureBase?: string): boolean
export function stationIdToFattureCompany(stationId: string | null | undefined): string
export function resolveEmbeddedFattureCompany(): string
export function readFattureCompany(): string
export function writeFattureCompany(companyId: string | null | undefined): void
export function fetchFattureCompanies(): Promise<Array<{ id: string; label?: string }>>
export function companyLabel(companyId: string | null | undefined): string
export function activityLabel(activity: string | null | undefined): string
export function companyFromActivity(activity: string | null | undefined): string
export function activitiesForCompany(companyId: string | null | undefined): string[]
