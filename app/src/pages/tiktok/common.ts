// Module TikTok « Chapote Publisher » (Espace client, /app/tiktok) : types et
// helpers partagés.
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../AuthContext'

export interface TikTokConfig {
  enabled: boolean
  max_upload_bytes: number
  max_duration_sec: number
  part_size: number
  title_max: number
  formats: string[]
}

export interface TikTokAccount {
  id: number
  display_name: string | null
  avatar_url: string | null
  can_publish: boolean
  can_upload: boolean
  needs_reconnect: boolean
  connected_at: string | null
  can_disconnect: boolean
}

export interface TikTokPost {
  id: number
  account_id: number
  account_name: string | null
  mode: 'direct' | 'draft'
  title: string | null
  privacy_level: string | null
  brand_organic: boolean
  brand_content: boolean
  file_name: string | null
  video_size: number
  status: string
  fail_reason: string | null
  error_message: string | null
  post_ids: string[]
  created_at: string | null
  updated_at: string | null
}

export const PRIVACY_LABELS: Record<string, string> = {
  PUBLIC_TO_EVERYONE: 'Tout le monde',
  MUTUAL_FOLLOW_FRIENDS: 'Amis',
  FOLLOWER_OF_CREATOR: 'Abonnés',
  SELF_ONLY: 'Moi uniquement',
}

export const STATUS_LABELS: Record<string, string> = {
  RECEIVING: 'Envoi de la vidéo à Chapote…',
  QUEUED: 'En attente d\'envoi à TikTok…',
  UPLOADING: 'Envoi à TikTok…',
  PROCESSING_UPLOAD: 'Traitement par TikTok…',
  SEND_TO_USER_INBOX: 'Dans la boîte de réception TikTok',
  PUBLISH_COMPLETE: 'Publiée',
  FAILED: 'Échec',
}

export const STATUS_TONES: Record<string, 'go' | 'warn' | 'danger' | 'info'> = {
  PUBLISH_COMPLETE: 'go',
  SEND_TO_USER_INBOX: 'go',
  FAILED: 'danger',
}

// Statuts après lesquels le suivi s'arrête côté navigateur.
export const FINAL_STATUSES = new Set(['PUBLISH_COMPLETE', 'SEND_TO_USER_INBOX', 'FAILED'])

export const MUSIC_URL = 'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en'
export const BC_POLICY_URL = 'https://www.tiktok.com/legal/page/global/bc-policy/en'

// Textes des Content Sharing Guidelines TikTok (traduction fidèle).
export const TXT = {
  commercialIncomplete: 'Vous devez indiquer si votre contenu fait la promotion de vous-même, d\'un tiers, ou des deux.',
  labelPromotional: 'Votre vidéo sera étiquetée « Contenu promotionnel ».',
  labelPaidPartnership: 'Votre vidéo sera étiquetée « Partenariat rémunéré ».',
  brandedNotPrivate: 'La visibilité d\'un contenu de marque ne peut pas être privée.',
  processing: 'Le traitement peut prendre quelques minutes avant que la vidéo soit visible sur votre profil.',
  otherAccount: 'Pour connecter un autre compte, connectez-vous d\'abord à ce compte sur tiktok.com dans ce navigateur.',
}

// Espace (tenant) de la page : l'équipe active, ou l'espace perso
// (?space=perso, ou utilisateur sans équipe).
export function useTikTokSpace() {
  const { activeOrg } = useAuth()
  const [params, setParams] = useSearchParams()
  const perso = !activeOrg || params.get('space') === 'perso'
  const orgId = perso ? null : activeOrg!.id
  const setPerso = (v: boolean) => {
    const next = new URLSearchParams(params)
    if (v) next.set('space', 'perso'); else next.delete('space')
    setParams(next, { replace: true })
  }
  return {
    orgId,
    orgName: activeOrg?.name || null,
    hasOrg: !!activeOrg,
    perso,
    setPerso,
    query: orgId ? `?org_id=${orgId}` : '',
    spaceParam: perso && activeOrg ? 'space=perso' : '',
  }
}

export function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60)
  return m ? `${m} min ${String(s).padStart(2, '0')} s` : `${s} s`
}

export function fmtSize(bytes: number) {
  return bytes >= 1024 * 1024 * 1024
    ? `${(bytes / 1024 / 1024 / 1024).toFixed(1)} Go`
    : `${Math.round(bytes / 1024 / 1024)} Mo`
}

export function fmtDate(iso: string | null) {
  if (!iso) return ''
  return new Date(iso.endsWith('Z') ? iso : `${iso}Z`).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}
