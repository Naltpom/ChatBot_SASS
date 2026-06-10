// Onglet Stats d'un bot — porté de pages-overview.jsx, branché sur les vraies
// données de l'API stats.
import React, { useEffect, useState } from 'react'
import { Bot as BotIcon, GitBranch, MessageSquare, Sparkles, User, Users } from 'lucide-react'
import { api } from '../api'
import { Bars, Card, Chip, Divider, Meter, SectionTitle, Seg, Stat } from '../ui'

interface DailyRow { day: string; user_messages: number; ai_replies: number; tree_replies: number }

interface Stats {
  days: number
  conversations: number
  unique_visitors: number
  user_messages: number
  ai_replies: number
  tree_replies: number
  ai_replies_today: number
  daily_ai_message_cap: number
  daily: DailyRow[]
  top_pages: { page: string; conversations: number }[]
}

interface Conv {
  id: string
  page_url: string | null
  started_at: string
  messages: { role: string; source: string; content: string; at: string }[]
}

interface OrgUsage { plan: string; ai_messages_used: number; ai_messages_quota: number }

const DAY_LABELS = ['Di', 'Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa']

function convMode(messages: Conv['messages']) {
  const hasAI = messages.some(m => m.source === 'ai')
  const hasTree = messages.some(m => m.source === 'tree' && m.role === 'user')
  if (hasAI && hasTree) return 'TREE→IA'
  if (hasAI) return 'IA'
  return 'TREE'
}

function timeAgo(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso + 'Z').getTime()) / 60000))
  if (mins < 60) return `il y a ${mins} min`
  if (mins < 60 * 24) return `il y a ${Math.round(mins / 60)} h`
  return `il y a ${Math.round(mins / 1440)} j`
}

export default function StatsPanel({ botId, botName, orgId }: { botId: number; botName: string; orgId: number }) {
  const [days, setDays] = useState(7)
  const [stats, setStats] = useState<Stats | null>(null)
  const [usage, setUsage] = useState<OrgUsage | null>(null)
  const [convs, setConvs] = useState<Conv[]>([])
  const [openConv, setOpenConv] = useState<string | null>(null)

  useEffect(() => {
    api<Stats>(`/api/stats/bots/${botId}?days=${days}`).then(setStats)
  }, [botId, days])

  useEffect(() => {
    api<OrgUsage>(`/api/orgs/${orgId}/usage`).then(setUsage).catch(() => {})
    api<Conv[]>(`/api/stats/bots/${botId}/conversations?limit=15`).then(setConvs)
  }, [botId, orgId])

  if (!stats) return <div style={{ color: 'var(--mut)', padding: 20 }}>Chargement…</div>

  const aiPct = stats.user_messages ? Math.round((stats.ai_replies / stats.user_messages) * 100) : 0
  const chartData = stats.daily.map(d => {
    const date = new Date(d.day)
    const label = days <= 7 ? DAY_LABELS[date.getDay()] : d.day.slice(5)
    return { label, a: d.ai_replies, b: d.tree_replies }
  })
  const creditsPct = usage ? Math.round((usage.ai_messages_used / Math.max(1, usage.ai_messages_quota)) * 100) : 0
  const capPct = Math.round((stats.ai_replies_today / Math.max(1, stats.daily_ai_message_cap)) * 100)

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
          <div className="card-title">Crédits IA — plan {usage?.plan ?? ''}</div>
          <div className="row" style={{ alignItems: 'baseline', gap: 7 }}>
            <span className="num" style={{ fontSize: 25, fontWeight: 800 }}>{(usage?.ai_messages_used ?? 0).toLocaleString('fr-FR')}</span>
            <span style={{ fontSize: 12.5, color: 'var(--mut)' }}>/ {(usage?.ai_messages_quota ?? 0).toLocaleString('fr-FR')} réponses IA incluses</span>
          </div>
          <div style={{ margin: '10px 0 6px' }}>
            <Meter pct={creditsPct} tone={creditsPct > 95 ? 'danger' : creditsPct > 70 ? 'warn' : 'acc'} />
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--mut)', lineHeight: 1.5 }}>
            {creditsPct}% utilisés ce mois, toutes organisations de bots confondues.
          </div>
          <Divider />
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>Plafond journalier</div>
              <div style={{ fontSize: 11, color: 'var(--faint)' }}>Au-delà → mode arbre seul</div>
            </div>
            <Chip tone={capPct >= 100 ? 'danger' : 'go'}>{stats.ai_replies_today} / {stats.daily_ai_message_cap}</Chip>
          </div>
          <div style={{ marginTop: 8 }}>
            <Meter pct={capPct} tone={capPct >= 100 ? 'danger' : 'acc'} height={6} />
          </div>
          <div style={{ marginTop: 12 }}>
            <Chip tone="mut">Réponses arbre : illimitées et gratuites</Chip>
          </div>
        </Card>
      </div>

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

        <Card nopad>
          <div className="card-title" style={{ padding: '14px 16px 10px', marginBottom: 0 }}>Conversations récentes</div>
          <table className="kc">
            <thead>
              <tr><th>Page</th><th>Mode</th><th>Msgs</th><th>Quand</th></tr>
            </thead>
            <tbody>
              {convs.map(c => {
                const mode = convMode(c.messages)
                const open = openConv === c.id
                return (
                  <React.Fragment key={c.id}>
                    <tr className="click" onClick={() => setOpenConv(open ? null : c.id)}>
                      <td className="mono" style={{ fontSize: 11, color: 'var(--mut)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.page_url ? new URL(c.page_url).pathname : '—'}
                      </td>
                      <td><Chip tone={mode === 'IA' ? 'acc' : mode === 'TREE' ? 'mut' : 'warn'}>{mode}</Chip></td>
                      <td className="num" style={{ color: 'var(--mut)' }}>{c.messages.length}</td>
                      <td style={{ color: 'var(--faint)', fontSize: 11.5 }}>{timeAgo(c.started_at)}</td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={4} style={{ background: 'var(--surface3)' }}>
                          <div className="col" style={{ gap: 7, padding: '4px 2px' }}>
                            {c.messages.map((m, i) => (
                              <div key={i} className="row g8" style={{ alignItems: 'baseline', fontSize: 12.5 }}>
                                <Chip tone={m.source === 'ai' ? 'acc' : 'mut'}>
                                  {m.role === 'user' ? <User size={11} /> : <BotIcon size={11} />} {m.source}
                                </Chip>
                                <span style={{ color: m.role === 'user' ? 'var(--ink)' : 'var(--mut)' }}>{m.content}</span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
              {convs.length === 0 && (
                <tr><td colSpan={4} style={{ color: 'var(--faint)', textAlign: 'center', padding: 20 }}>Aucune conversation.</td></tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  )
}
