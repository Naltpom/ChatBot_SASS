// Mise en forme (français) et libellés communs.
import type { TargetStatus } from './api'
import { locale, t } from './i18n'

// Langue fixée au chargement : changer de langue recharge la page.
const nf = new Intl.NumberFormat(locale())
const compact = new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 })

export const num = (v: number | null | undefined) => (v == null ? '—' : nf.format(v))
export const short = (v: number | null | undefined) => (v == null ? '—' : v < 10000 ? nf.format(v) : compact.format(v))
export const signed = (v: number | null | undefined) => (v == null ? '—' : (v > 0 ? '+' : '') + nf.format(v))

export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' })
export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
export const fmtDuration = (s: number | null | undefined) => {
  if (s == null) return '—'
  const m = Math.floor(s / 60), r = Math.round(s % 60)
  return m ? t('{m} min {s}', { m, s: String(r).padStart(2, '0') }) : t('{s} s', { s: r })
}
export const fmtSize = (b: number) => (b >= 1024 ** 3 ? t('{n} Go', { n: (b / 1024 ** 3).toFixed(1) }) : t('{n} Mo', { n: Math.max(1, Math.round(b / 1024 ** 2)) }))

export function relDay(iso: string): string {
  const d = new Date(iso), today = new Date()
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((start(d) - start(today)) / 86400000)
  if (diff === 0) return t("aujourd'hui")
  if (diff === 1) return t('demain')
  if (diff === -1) return t('hier')
  return d.toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' })
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

export const pct = (v: number | null | undefined, digits = 1) =>
  v == null ? '—' : t('{n} %', { n: (v * 100).toLocaleString(locale(), { maximumFractionDigits: digits, minimumFractionDigits: v < 0.1 ? digits : 0 }) })

export const METRIC_LABEL: Record<string, string> = {
  followers: 'Abonnés', views: 'Vues', likes: "J'aime", comments: 'Commentaires', shares: 'Partages', saves: 'Enregistrements',
}

/** Jour local (AAAA-MM-JJ) d'une date. */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
export function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
export const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
export const greeting = () => { const h = new Date().getHours(); return h < 5 ? t('Bonsoir') : h < 18 ? t('Bonjour') : t('Bonsoir') }
/** « à l'instant », « il y a 2 h », « hier », puis la date. */
export const fmtAgo = (iso: string | null | undefined) => {
  if (!iso) return ''
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return t('à l’instant')
  if (s < 3600) return t('il y a {n} min', { n: Math.floor(s / 60) })
  if (s < 86400) return t('il y a {n} h', { n: Math.floor(s / 3600) })
  if (s < 172800) return t('hier')
  return new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })
}
