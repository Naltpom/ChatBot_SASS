// Types partagés des sous-composants de StatsPanel — formes exactes renvoyées
// par l'API stats (snake_case). Extraits de StatsPanel.tsx (refacto R13) pour
// que les cards SatisfactionCard / AbTestCard / FunnelCard /
// RecentConversationsTable les consomment sans dupliquer les interfaces.

export interface DailyRow {
  day: string
  user_messages: number
  ai_replies: number
  tree_replies: number
}

export interface Satisfaction { up: number; down: number; total: number }

// % d'avis positifs (up / up+down), arrondi — partagé par SatisfactionCard et
// AbTestCard. Le diviseur min(1, …) évite la division par zéro (renvoie 0).
export const satPct = (s: Satisfaction): number =>
  Math.round((s.up / Math.max(1, s.up + s.down)) * 100)

export interface Stats {
  days: number
  conversations: number
  unique_visitors: number
  user_messages: number
  ai_replies: number
  tree_replies: number
  ai_replies_today: number
  daily: DailyRow[]
  top_pages: { page: string; conversations: number }[]
  // Clés ADDITIVES v4 — toujours présentes (zéros si A/B inactif / aucun avis)
  satisfaction: Satisfaction
  variants: {
    a: { conversations: number; satisfaction: Satisfaction }
    b: { conversations: number; satisfaction: Satisfaction }
  }
}

export interface FunnelNode {
  node_key: string
  count: number
  exits: number
  exit_rate: number   // FRACTION 0-1 (3 décimales), jamais recalculée côté front
  variants: { a: { count: number; exits: number }; b: { count: number; exits: number } }
}

export interface Funnel {
  days: number
  total_events: number
  nodes: FunnelNode[]            // triés count desc côté serveur
  variant_totals: { a: number; b: number }
}

export interface Conv {
  id: string
  page_url: string | null
  started_at: string
  messages: { role: string; source: string; content: string; at: string }[]
}
