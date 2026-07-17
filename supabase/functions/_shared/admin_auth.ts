/** Administrator panel auth — ADMIN_PANEL_SECRET only (never ADMIN_EMAIL). */

export type AdminAuthResult =
  | { ok: true }
  | { ok: false; code: 'admin_not_configured' | 'admin_unauthorized' }

export function resolveAdminAuth(
  panelSecret: string | undefined | null,
  providedHeader: string | null | undefined,
): AdminAuthResult {
  if (!panelSecret || panelSecret.length === 0) {
    return { ok: false, code: 'admin_not_configured' }
  }
  if (!providedHeader || providedHeader !== panelSecret) {
    return { ok: false, code: 'admin_unauthorized' }
  }
  return { ok: true }
}

export function adminSecretConfigured(panelSecret: string | undefined | null): boolean {
  return Boolean(panelSecret && panelSecret.length > 0)
}
