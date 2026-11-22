// Module YouTube « Chapote Publisher » (Shorts, Espace client, /app/youtube) :
// types et libellés. L'espace (équipe / perso) et les formats viennent du
// module TikTok (même logique de tenant côté API).
export { useTikTokSpace as useYouTubeSpace, fmtDate, fmtDuration, fmtSize } from '../tiktok/common'

export interface YouTubeConfig {
  enabled: boolean
  max_upload_bytes: number
  max_duration_sec: number
  part_size: number
  title_max: number
  description_max_bytes: number
  tags_max: number
  daily_posts: number
  formats: string[]
}

export interface YouTubeAccount {
  id: number
  channel_id: string
  title: string | null
  handle: string | null
  thumbnail_url: string | null
  can_upload: boolean
  needs_reconnect: boolean
  connected_at: string | null
  can_disconnect: boolean
}

export interface YouTubePost {
  id: number
  account_id: number
  account_name: string | null
  title: string
  privacy_status: 'public' | 'unlisted' | 'private'
  final_privacy: string | null
  publish_at: string | null
  made_for_kids: boolean
  synthetic_media: boolean
  file_name: string | null
  video_size: number
  duration_sec: number | null
  status: string
  upload_status: string | null
  video_id: string | null
  url: string | null
  fail_reason: string | null
  error_message: string | null
  created_at: string | null
  updated_at: string | null
}

export const PRIVACY_LABELS: Record<string, string> = {
  public: 'Publique',
  unlisted: 'Non répertoriée',
  private: 'Privée',
}

export const STATUS_LABELS: Record<string, string> = {
  RECEIVING: 'Envoi de la vidéo à Chapote…',
  QUEUED: 'En attente d\'envoi à YouTube…',
  UPLOADING: 'Envoi à YouTube…',
  PROCESSING: 'Traitement par YouTube…',
  PUBLISHED: 'En ligne',
  FAILED: 'Échec',
}

export const STATUS_TONES: Record<string, 'go' | 'warn' | 'danger' | 'info'> = {
  PUBLISHED: 'go',
  FAILED: 'danger',
}

export const FINAL_STATUSES = new Set(['PUBLISHED', 'FAILED'])

// Catégories YouTube les plus utiles pour des Shorts (videoCategories, région FR).
export const CATEGORIES: { value: string; label: string }[] = [
  { value: '22', label: 'Personnes et blogs' },
  { value: '10', label: 'Musique' },
  { value: '24', label: 'Divertissement' },
  { value: '27', label: 'Éducation' },
  { value: '28', label: 'Science et technologie' },
  { value: '1', label: 'Films et animations' },
  { value: '20', label: 'Jeux vidéo' },
  { value: '23', label: 'Humour' },
  { value: '26', label: 'Vie pratique et style' },
]

export const TXT = {
  otherAccount: 'Pour connecter une autre chaîne (ou une chaîne de marque), choisissez-la sur l\'écran Google qui s\'ouvre.',
  unaudited: 'Tant que Chapote n\'a pas passé l\'audit de conformité de l\'API YouTube, YouTube garde privées les vidéos envoyées : passez-les en public depuis YouTube Studio.',
  short: 'Un Short est une vidéo verticale (ou carrée) de 3 minutes au plus : YouTube la classe en Short tout seul.',
}
