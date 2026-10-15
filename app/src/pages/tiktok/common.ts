// Outil privé « Chapote Publisher » (/tiktok) : types et helpers partagés.
import { useEffect } from 'react'

export interface TikTokAccount {
  open_id: string
  display_name: string | null
  avatar_url: string | null
  scope: string | null
  can_publish: boolean
  needs_reconnect: boolean
  connected_at: string | null
  error?: string | null
}

// Pages /tiktok* : jamais indexées (complète l'en-tête X-Robots-Tag de nginx).
export function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    const prevTitle = document.title
    document.title = 'Chapote Publisher'
    return () => { meta.remove(); document.title = prevTitle }
  }, [])
}

export const PRIVACY_LABELS: Record<string, string> = {
  PUBLIC_TO_EVERYONE: 'Tout le monde',
  MUTUAL_FOLLOW_FRIENDS: 'Amis',
  FOLLOWER_OF_CREATOR: 'Abonnés',
  SELF_ONLY: 'Moi uniquement',
}
