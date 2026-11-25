// Quel domaine sert une route de l'API (logique pure, testée).
// cm.chapote.fr ne laisse passer que ces routes de connexion (cm/nginx.conf) ; le reste de /api/auth/ et /api/orgs/
// passe par chapote.fr (même API).
const CM_AUTH = /^\/api\/auth\/(login|register|google|logout|me|verify-email\/request|password\/forgot|2fa\/login\/totp|2fa\/login\/recovery)(\?|$)/

export function baseFor(path: string, cmUrl: string, mainUrl: string): string {
  if (path.startsWith('/api/auth/') && !CM_AUTH.test(path)) return mainUrl
  if (path.startsWith('/api/orgs/') || path.startsWith('/api/orgs?')) return mainUrl
  return cmUrl
}
