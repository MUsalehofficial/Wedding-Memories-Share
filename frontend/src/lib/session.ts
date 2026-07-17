const KEY = 'wedding_guest_token'
const EXP = 'wedding_guest_exp'

export function saveGuestSession(token: string, expiresInSec: number) {
  sessionStorage.setItem(KEY, token)
  sessionStorage.setItem(EXP, String(Date.now() + expiresInSec * 1000))
}

export function getGuestToken(): string | null {
  const token = sessionStorage.getItem(KEY)
  const exp = Number(sessionStorage.getItem(EXP) || 0)
  if (!token || !exp || Date.now() > exp) {
    clearGuestSession()
    return null
  }
  return token
}

export function clearGuestSession() {
  sessionStorage.removeItem(KEY)
  sessionStorage.removeItem(EXP)
}

const ADMIN_KEY = 'wedding_admin_secret'

export function saveAdminSecret(secret: string) {
  sessionStorage.setItem(ADMIN_KEY, secret)
}

export function getAdminSecret(): string | null {
  return sessionStorage.getItem(ADMIN_KEY)
}

export function clearAdminSecret() {
  sessionStorage.removeItem(ADMIN_KEY)
}
