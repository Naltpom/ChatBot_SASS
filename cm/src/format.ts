// Mise en forme (français) et libellés communs.
import type { TargetStatus } from './api'

const nf = new Intl.NumberFormat('fr-FR')
const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 })

export const num = (v: number | null | undefined) => (v == null ? '—' : nf.format(v))
export const short = (v: number | null | undefined) => (v == null ? '—' : v < 10000 ? nf.format(v) : compact.format(v))
export const signed = (v: number | null | undefined) => (v == null ? '—' : (v > 0 ? '+' : '') + nf.format(v))

export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
export const fmtDuration = (s: number | null | undefined) => {
  if (s == null) return '—'
  const m = Math.floor(s / 60), r = Math.round(s % 60)
  return m ? `${m} min ${String(r).padStart(2, '0')}` : `${r} s`
}
export const fmtSize = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} Go` : `${Math.max(1, Math.round(b / 1024 ** 2))} Mo`)

export function relDay(iso: string): string {
  const d = new Date(iso), today = new Date()
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((start(d) - start(today)) / 86400000)
  if (diff === 0) return "aujourd'hui"
  if (diff === 1) return 'demain'
  if (diff === -1) return 'hier'
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
}

/** Valeur d'un <input type="datetime-local"> (heure locale) pour une date. */
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export const STATUS: Record<TargetStatus, { label: string; tone: 'ok' | 'warn' | 'danger' | 'muted' }> = {
  DRAFT: { label: 'Envoi de la vidéo…', tone: 'muted' },
  SCHEDULED: { label: 'Programmée', tone: 'muted' },
  DISPATCHING: { label: 'Envoi en cours', tone: 'warn' },
  PUBLISHING: { label: 'Publication en cours', tone: 'warn' },
  AWAITING_ROUTINE: { label: 'À publier par la routine', tone: 'warn' },
  ROUTINE_CLAIMED: { label: 'Routine en cours', tone: 'warn' },
  PUBLISHED: { label: 'Publiée', tone: 'ok' },
  INBOX: { label: 'Brouillon TikTok', tone: 'ok' },
  FAILED: { label: 'Échec', tone: 'danger' },
  CANCELLED: { label: 'Annulée', tone: 'muted' },
}

export const TIKTOK_PRIVACY: Record<string, string> = {
  PUBLIC_TO_EVERYONE: 'Tout le monde',
  MUTUAL_FOLLOW_FRIENDS: 'Amis',
  FOLLOWER_OF_CREATOR: 'Abonnés',
  SELF_ONLY: 'Moi uniquement',
}
export const TIKTOK_MUSIC_URL = 'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en'
export const TIKTOK_BC_URL = 'https://www.tiktok.com/legal/page/global/bc-policy/en'
