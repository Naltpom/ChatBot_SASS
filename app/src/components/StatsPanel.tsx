// Onglet Stats d'un bot — porté de pages-overview.jsx, branché sur les vraies
// données de l'API stats. v4 : satisfaction CSAT, comparatif A/B et funnel
// d'arbre (GET /funnel), avec mapping node_key → labels du tree_json local.
import React, { useEffect, useState } from 'react'
import { Bot as BotIcon, GitBranch, MessageSquare, Sparkles, ThumbsDown, ThumbsUp, User, Users } from 'lucide-react'
import { api } from '../api'
import { Bars, Card, Chip, Meter, SectionTitle, Seg, Stat } from '../ui'

interface DailyRow { day: string; user_messages: number; ai_replies: number; tree_replies: number }

interface Satisfaction { up: number; down: number; total: number }

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
  // Clés ADDITIVES v4 — toujours présentes (zéros si A/B inactif / aucun avis)
  satisfaction: Satisfaction
  variants: {
    a: { conversations: number; satisfaction: Satisfaction }
    b: { conversations: number; satisfaction: Satisfaction }
  }
}

interface FunnelNode {
  node_key: string
  count: number
  exits: number
  exit_rate: number   // FRACTION 0-1 (3 décimales), jamais recalculée côté front
  variants: { a: { count: number; exits: number }; b: { count: number; exits: number } }
}

interface Funnel {
  days: number
  total_events: number
  nodes: FunnelNode[]            // triés count desc côté serveur
  variant_totals: { a: number; b: number }
}

interface Conv {
  id: string
  page_url: string | null
  started_at: string
  messages: { role: string; source: string; content: string; at: string }[]
}

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

export default function StatsPanel({ botId, botName, tree, variantTree, abSplit }: {
  botId: number; botName: string; orgId?: number
  tree: Record<string, any>                  // tree_json : mapping node_key → label du funnel
  variantTree: Record<string, any> | null    // tree_variant_json : détection A/B actif + labels B
  abSplit: number                            // ab_split_pct courant (chip « N % vers B »)
}) {
  const [days, setDays] = useState(7)
  const [stats, setStats] = useState<Stats | null>(null)
  const [convs, setConvs] = useState<Conv[]>([])
  const [openConv, setOpenConv] = useState<string | null>(null)
  // Funnel : composant autonome — erreur LOCALE, jamais le canal d'erreur de BotPage
  const [funnel, setFunnel] = useState<Funnel | null>(null)
  const [funnelError, setFunnelError] = useState('')

  useEffect(() => {
    api<Stats>(`/api/stats/bots/${botId}?days=${days}`).then(setStats)
  }, [botId, days])

  useEffect(() => {
    let alive = true
    setFunnel(null)
    setFunnelError('')
    api<Funnel>(`/api/stats/bots/${botId}/funnel?days=${days}`)
      .then(f => { if (alive) setFunnel(f) })
      .catch((err: any) => { if (alive) setFunnelError(err.message) })
    return () => { alive = false }
  }, [botId, days])

  useEffect(() => {
    api<Conv[]>(`/api/stats/bots/${botId}/conversations?limit=15`).then(setConvs)
  }, [botId])

  // Label d'un nœud du funnel : racine → libellé fixe ; sinon l'option qui
  // pointe vers lui (logique nodeLabel de TreeBuilder), d'abord dans l'arbre A
  // puis dans la variante B (suffixée) ; à défaut la clé brute (nœud supprimé).
  function funnelLabel(key: string): { text: string; raw?: boolean } {
    if (key === tree?.start) return { text: "Message d'accueil (racine)" }
    for (const n of Object.values((tree?.nodes || {}) as Record<string, any>)) {
      const opt = ((n.options || []) as any[]).find(o => o.next === key)
      if (opt) return { text: opt.label }
    }
    for (const n of Object.values((variantTree?.nodes || {}) as Record<string, any>)) {
      const opt = ((n.options || []) as any[]).find(o => o.next === key)
      if (opt) return { text: `${opt.label} (variante B)` }
    }
    return { text: key, raw: true }
  }

  if (!stats) return <div style={{ color: 'var(--mut)', padding: 20 }}>Chargement…</div>

  const aiPct = stats.user_messages ? Math.round((stats.ai_replies / stats.user_messages) * 100) : 0
  const chartData = stats.daily.map(d => {
    const date = new Date(d.day)
    const label = days <= 7 ? DAY_LABELS[date.getDay()] : d.day.slice(5)
    return { label, a: d.ai_replies, b: d.tree_replies }
  })
  const capPct = Math.round((stats.ai_replies_today / Math.max(1, stats.daily_ai_message_cap)) * 100)
  const sat = stats.satisfaction
  const satPct = Math.round((sat.up / Math.max(1, sat.up + sat.down)) * 100)
  const variantActive = !!variantTree
  // A/B inactif mais données B résiduelles sur la fenêtre : on montre quand même le comparatif
  const showAb = variantActive || stats.variants.b.conversations > 0
  const maxCount = funnel?.nodes[0]?.count || 1   // nodes triés count desc côté serveur
  const funnelHasB = (funnel?.variant_totals.b ?? 0) > 0

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
          <div className="card-title">Plafond IA journalier</div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>Réponses IA aujourd'hui</div>
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

      <div className="grid2">
        <Card>
          <div className="card-title">Satisfaction visiteurs (CSAT)</div>
          {sat.total === 0 ? (
            <div style={{ color: 'var(--faint)', fontSize: 12, lineHeight: 1.55 }}>
              Aucun avis sur la période. Les visiteurs peuvent noter chaque réponse du bot (pouces sous les
              bulles du widget).
            </div>
          ) : (
            <>
              <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
                <span className="row" style={{ gap: 6 }}>
                  <ThumbsUp size={14} style={{ color: 'var(--go)' }} />
                  <span className="num" style={{ fontSize: 22, fontWeight: 800 }}>{sat.up}</span>
                </span>
                <span className="row" style={{ gap: 6 }}>
                  <ThumbsDown size={14} style={{ color: 'var(--danger)' }} />
                  <span className="num" style={{ fontSize: 22, fontWeight: 800 }}>{sat.down}</span>
                </span>
                <Chip tone="mut">{sat.total} avis</Chip>
              </div>
              <div style={{ margin: '10px 0 6px' }}>
                <Meter pct={satPct} tone={satPct < 50 ? 'warn' : 'acc'} />
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--mut)' }}>{satPct} % d'avis positifs</div>
            </>
          )}
          <div className="field-hint" style={{ marginTop: 10 }}>
            Recueillis via les pouces sous les réponses arbre et IA du widget (30 avis max par visiteur et
            par heure).
          </div>
        </Card>

        <Card>
          <div className="row" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div className="card-title" style={{ marginBottom: 0 }}>Test A/B</div>
            {variantActive ? (
              <Chip tone="acc">{abSplit} % vers B</Chip>
            ) : showAb ? (
              <Chip tone="mut">test arrêté</Chip>
            ) : null}
          </div>
          {!showAb ? (
            <div style={{ color: 'var(--faint)', fontSize: 12, lineHeight: 1.55, marginTop: 10 }}>
              Aucune variante B active sur la période. Activez un test A/B dans l'onglet Arbre pour comparer
              deux versions du menu.
            </div>
          ) : (
            <div className="grid2" style={{ marginTop: 12 }}>
              {(['a', 'b'] as const).map(k => {
                const v = stats.variants[k]
                const tot = v.satisfaction.up + v.satisfaction.down
                const pct = tot ? Math.round((v.satisfaction.up / tot) * 100) : 0
                return (
                  <div key={k} className="col" style={{ gap: 7 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mut)' }}>
                      Variante {k.toUpperCase()}
                    </div>
                    <div className="row" style={{ gap: 6, alignItems: 'baseline' }}>
                      <span className="num" style={{ fontSize: 18, fontWeight: 800 }}>
                        {v.conversations.toLocaleString('fr-FR')}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--mut)' }}>conversations</span>
                    </div>
                    <div className="row" style={{ gap: 12, fontSize: 12, fontWeight: 700 }}>
                      <span className="row" style={{ gap: 4 }}>
                        <ThumbsUp size={12} style={{ color: 'var(--go)' }} /> {v.satisfaction.up}
                      </span>
                      <span className="row" style={{ gap: 4 }}>
                        <ThumbsDown size={12} style={{ color: 'var(--danger)' }} /> {v.satisfaction.down}
                      </span>
                    </div>
                    <div className="row g8">
                      <div style={{ flex: 1 }}>
                        <Meter pct={tot ? pct : 0} height={6} />
                      </div>
                      <span className="num" style={{ fontSize: 11, fontWeight: 700, color: 'var(--mut)', width: 34, textAlign: 'right' }}>
                        {tot ? `${pct} %` : '—'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <div className="field-hint" style={{ marginTop: 10 }}>
            L'affectation A/B est tirée au sort à l'ouverture de la conversation et reste stable ensuite.
          </div>
        </Card>
      </div>

      <Card>
        <div className="row" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Parcours dans l'arbre (funnel)</div>
          {funnelHasB && funnel && (
            <div className="row g6">
              <Chip tone="acc">A {funnel.variant_totals.a}</Chip>
              <Chip tone="mut">B {funnel.variant_totals.b}</Chip>
            </div>
          )}
        </div>
        {funnelError ? (
          <div className="error">{funnelError}</div>
        ) : !funnel ? (
          <div style={{ color: 'var(--faint)', fontSize: 12 }}>Chargement…</div>
        ) : funnel.total_events === 0 ? (
          <div style={{ color: 'var(--faint)', fontSize: 12, lineHeight: 1.55 }}>
            Aucun événement d'arbre sur la période — le funnel se remplit à mesure que les visiteurs
            naviguent dans le menu guidé.
          </div>
        ) : (
          <div className="col" style={{ gap: 9 }}>
            {funnel.nodes.slice(0, 12).map(n => {
              const lbl = funnelLabel(n.node_key)
              const exitPct = Math.round(n.exit_rate * 100)
              const hot = n.exit_rate > 0.5 && n.count >= 5
              return (
                <div key={n.node_key} className="col" style={{ gap: 3 }}>
                  <div className="row g10">
                    <span title={lbl.text} className={lbl.raw ? 'mono' : undefined}
                          style={{
                            flex: 1, minWidth: 0, fontSize: lbl.raw ? 11.5 : 12.5, fontWeight: 600,
                            color: lbl.raw ? 'var(--faint)' : undefined,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                      {lbl.text}
                    </span>
                    <span className="num mono" style={{ fontSize: 12, fontWeight: 700 }}>{n.count}</span>
                    <div style={{ width: 150, flexShrink: 0 }}>
                      <Meter pct={Math.round((n.count / maxCount) * 100)} height={6} />
                    </div>
                    <span style={{ fontSize: 10.5, width: 112, textAlign: 'right', flexShrink: 0, color: hot ? 'var(--warn)' : 'var(--faint)' }}>
                      {n.exits} sorties · {exitPct} %
                    </span>
                  </div>
                  {funnelHasB && (
                    <div style={{ fontSize: 10.5, color: 'var(--faint)' }}>
                      A {n.variants.a.count} ({n.variants.a.exits} sorties) · B {n.variants.b.count} ({n.variants.b.exits} sorties)
                    </div>
                  )}
                </div>
              )
            })}
            {funnel.nodes.length > 12 && (
              <div style={{ fontSize: 11, color: 'var(--faint)' }}>
                +{funnel.nodes.length - 12} autres nœuds
              </div>
            )}
          </div>
        )}
        <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 12, lineHeight: 1.5 }}>
          Une "sortie" = dernier nœud vu dans la conversation. Mesuré côté serveur ; les valeurs sont
          affichées telles quelles.
        </div>
      </Card>

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
