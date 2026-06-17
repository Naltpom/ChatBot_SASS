// Onglet Stats d'un bot — porté de pages-overview.jsx, branché sur les vraies
// données de l'API stats. v4 : satisfaction CSAT, comparatif A/B et funnel
// d'arbre (GET /funnel), avec mapping node_key → labels du tree_json local.
// Refacto R13 : les cards présentationnelles sont extraites dans stats-panel/
// (SatisfactionCard / AbTestCard / FunnelCard / RecentConversationsTable) ;
// ce fichier ne garde que le câblage des fetchs et la mise en page.
import { useEffect, useState } from 'react'
import { GitBranch, MessageSquare, Sparkles, Users } from 'lucide-react'
import { api } from '../api'
import { errMsg } from '../utils/errors'
import { Bars, Card, Chip, SectionTitle, Seg, Stat } from '../ui'
import type { Tree } from '../types/bot'
import SatisfactionCard from './stats-panel/SatisfactionCard'
import AbTestCard from './stats-panel/AbTestCard'
import FunnelCard from './stats-panel/FunnelCard'
import RecentConversationsTable from './stats-panel/RecentConversationsTable'
import type { Conv, Funnel, Stats } from './stats-panel/types'

const DAY_LABELS = ['Di', 'Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa']

export default function StatsPanel({ botId, botName, tree, variantTree, abSplit }: {
  botId: number; botName: string
  tree: Tree                  // tree_json : mapping node_key → label du funnel
  variantTree: Tree | null    // tree_variant_json : détection A/B actif + labels B
  abSplit: number             // ab_split_pct courant (chip « N % vers B »)
}) {
  const [days, setDays] = useState(7)
  const [stats, setStats] = useState<Stats | null>(null)
  const [statsError, setStatsError] = useState('')
  const [convs, setConvs] = useState<Conv[]>([])
  // Funnel : composant autonome — erreur LOCALE, jamais le canal d'erreur de BotPage
  const [funnel, setFunnel] = useState<Funnel | null>(null)
  const [funnelError, setFunnelError] = useState('')

  useEffect(() => {
    let alive = true
    setStatsError('')
    api<Stats>(`/api/stats/bots/${botId}?days=${days}`)
      .then(s => { if (alive) setStats(s) })
      .catch((err: unknown) => { if (alive) setStatsError(errMsg(err, 'Statistiques indisponibles.')) })
    return () => { alive = false }
  }, [botId, days])

  useEffect(() => {
    let alive = true
    setFunnel(null)
    setFunnelError('')
    api<Funnel>(`/api/stats/bots/${botId}/funnel?days=${days}`)
      .then(f => { if (alive) setFunnel(f) })
      .catch((err: unknown) => { if (alive) setFunnelError(err instanceof Error ? err.message : 'Erreur') })
    return () => { alive = false }
  }, [botId, days])

  useEffect(() => {
    let alive = true
    api<Conv[]>(`/api/stats/bots/${botId}/conversations?limit=15`)
      .then(c => { if (alive) setConvs(c) })
      // Échec non bloquant : la table « conversations récentes » a déjà un rendu
      // vide ; on évite juste l'unhandled rejection.
      .catch((err: unknown) => { console.error('Chargement conversations récentes échoué:', errMsg(err)) })
    return () => { alive = false }
  }, [botId])

  // Erreur sur les stats principales : on n'a pas de données à afficher → message
  // discret plutôt qu'un « Chargement… » figé indéfiniment.
  if (statsError && !stats) return <div style={{ color: 'var(--danger)', padding: 20 }}>{statsError}</div>
  if (!stats) return <div style={{ color: 'var(--mut)', padding: 20 }}>Chargement…</div>

  const aiPct = stats.user_messages ? Math.round((stats.ai_replies / stats.user_messages) * 100) : 0
  const chartData = stats.daily.map(d => {
    const date = new Date(d.day)
    const label = days <= 7 ? DAY_LABELS[date.getDay()] : d.day.slice(5)
    return { label, a: d.ai_replies, b: d.tree_replies }
  })
  const variantActive = !!variantTree
  // A/B inactif mais données B résiduelles sur la fenêtre : on montre quand même le comparatif
  const showAb = variantActive || stats.variants.b.conversations > 0

  return (
    <div className="col g18">
      <SectionTitle
        sub={`Activité du widget « ${botName} » sur les ${days} derniers jours.`}
        right={<Seg small value={String(days)} onChange={v => setDays(Number(v))}
                    options={[{ value: '7', label: '7 jours' }, { value: '30', label: '30 jours' }, { value: '90', label: '90 jours' }]} />}>
        Vue d'ensemble
      </SectionTitle>

      <div className="stat-row">
        <Stat label="Conversations" value={stats.conversations.toLocaleString('fr-FR')} icon={<MessageSquare size={15} />} sub={`${days} jours`} />
        <Stat label="Visiteurs uniques" value={stats.unique_visitors.toLocaleString('fr-FR')} icon={<Users size={15} />} sub="ID anonyme (localStorage)" />
        <Stat label="Réponses IA" value={stats.ai_replies.toLocaleString('fr-FR')} icon={<Sparkles size={15} />} sub={`${aiPct}% des messages`} />
        <Stat label="Réponses arbre" value={stats.tree_replies.toLocaleString('fr-FR')} icon={<GitBranch size={15} />} sub="gratuites, illimitées" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 14, alignItems: 'start' }}>
        <Card>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>Messages par jour</div>
            <div className="row" style={{ gap: 12, fontSize: 11, color: 'var(--mut)' }}>
              <span className="row" style={{ gap: 5 }}><span className="legend-sq" style={{ background: 'var(--acc)' }} /> IA</span>
              <span className="row" style={{ gap: 5 }}><span className="legend-sq" style={{ background: 'var(--acc-bd)' }} /> Arbre</span>
            </div>
          </div>
          {chartData.length === 0
            ? <div style={{ color: 'var(--faint)', fontSize: 12, padding: '30px 0', textAlign: 'center' }}>Aucune activité sur la période.</div>
            : <Bars data={chartData} height={150} />}
        </Card>

        <Card>
          <div className="card-title">Réponses IA aujourd'hui</div>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span className="num" style={{ fontSize: 26, fontWeight: 800 }}>
              {stats.ai_replies_today.toLocaleString('fr-FR')}
            </span>
            <Sparkles size={16} style={{ color: 'var(--acc)' }} />
          </div>
          <div style={{ marginTop: 12 }}>
            <Chip tone="mut">Réponses arbre : illimitées et gratuites</Chip>
          </div>
        </Card>
      </div>

      <div className="grid2">
        <SatisfactionCard sat={stats.satisfaction} />
        <AbTestCard variants={stats.variants} variantActive={variantActive} showAb={showAb} abSplit={abSplit} />
      </div>

      <FunnelCard funnel={funnel} funnelError={funnelError} tree={tree} variantTree={variantTree} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 14, alignItems: 'start' }}>
        <Card>
          <div className="card-title">Pages d'ouverture du chat</div>
          {stats.top_pages.length === 0 && <div style={{ color: 'var(--faint)', fontSize: 12 }}>Aucune donnée.</div>}
          <div className="col" style={{ gap: 10 }}>
            {stats.top_pages.map((p, i) => (
              <div key={p.page} className="row g10">
                <span className="num" style={{ fontSize: 11, fontWeight: 800, color: 'var(--faint)', width: 16 }}>{i + 1}</span>
                <span className="mono" style={{ flex: 1, fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.page}</span>
                <span className="num" style={{ fontSize: 12, fontWeight: 700, color: 'var(--mut)' }}>{p.conversations}×</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 12 }}>
            L'URL de la page est aussi injectée comme contexte dans les réponses IA.
          </div>
        </Card>

        <RecentConversationsTable convs={convs} />
      </div>
    </div>
  )
}
