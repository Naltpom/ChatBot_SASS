// Vue ADMIN (opérateur du SaaS) — portée de pages-admin.jsx : KPIs, table de
// tous les clients, drill-down avec cards de bots paramétrables.
import { useEffect, useState } from 'react'
import { Bot as BotIcon, Building2, ChevronRight, CreditCard, MessageSquare, Sparkles, TrendingUp } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { Btn, Card, Chip, InfoBox, Meter, SectionTitle, Stat, orgColor, orgInitials } from '../ui'
import { PLAN_LABELS } from '../botConstants'
import { BotCard, BotSummary } from './BotList'

interface AdminOrg {
  id: number
  name: string
  plan: string
  plan_price: number
  is_active: boolean
  created_at: string
  contact: string | null
  members: number
  bots: number
  bots_quota: number
  byok: boolean
  msgs_7d: number
  ai_messages_used: number
  ai_messages_quota: number
}

function orgStatusChip(o: AdminOrg) {
  if (!o.is_active) return <Chip tone="danger">Suspendue</Chip>
  if (o.ai_messages_used >= o.ai_messages_quota) return <Chip tone="warn">Quota dépassé</Chip>
  return <Chip tone="go">Actif</Chip>
}

function since(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })
}

// ---------- Accueil admin : tous les clients ----------
export default function AdminHome() {
  const navigate = useNavigate()
  const [orgs, setOrgs] = useState<AdminOrg[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api<AdminOrg[]>('/api/admin/organizations').then(setOrgs).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="center-page">Chargement…</div>

  const mrr = orgs.reduce((n, o) => n + o.plan_price, 0)
  const totBots = orgs.reduce((n, o) => n + o.bots, 0)
  const msgs = orgs.reduce((n, o) => n + o.msgs_7d, 0)

  return (
    <div className="col g18">
      <SectionTitle sub="Tous les clients Kertios Chat — vue opérateur.">Clients</SectionTitle>

      <div className="stat-row">
        <Stat label="Clients" value={orgs.length} icon={<Building2 size={15} />} sub="organisations" />
        <Stat label="MRR" value={`${mrr} €`} icon={<TrendingUp size={15} />} sub="récurrent mensuel" />
        <Stat label="Bots actifs" value={totBots} icon={<BotIcon size={15} />} sub="tous clients confondus" />
        <Stat label="Msgs / 7 jours" value={msgs.toLocaleString('fr-FR')} icon={<MessageSquare size={15} />} sub="toute la plateforme" />
      </div>

      <Card nopad>
        <table className="kc">
          <thead>
            <tr>
              <th>Client</th><th>Plan</th><th>Bots</th><th>Msgs / 7 j</th>
              <th>Crédits IA</th><th>Clé</th><th>Statut</th><th></th>
            </tr>
          </thead>
          <tbody>
            {orgs.map(o => {
              const used = Math.round((o.ai_messages_used / Math.max(1, o.ai_messages_quota)) * 100)
              return (
                <tr key={o.id} className="click" onClick={() => navigate(`/admin/clients/${o.id}`)}>
                  <td>
                    <div className="row g10">
                      <span className="org-avatar" style={{ width: 26, height: 26, fontSize: 10, background: orgColor(o.name) }}>
                        {orgInitials(o.name)}
                      </span>
                      <span>
                        <span style={{ display: 'block', fontWeight: 700 }}>{o.name}</span>
                        <span style={{ display: 'block', fontSize: 10.5, color: 'var(--faint)' }}>depuis {since(o.created_at)}</span>
                      </span>
                    </div>
                  </td>
                  <td><Chip tone="acc">{PLAN_LABELS[o.plan] || o.plan} · {o.plan_price} €</Chip></td>
                  <td className="num" style={{ fontWeight: 700 }}>{o.bots} / {o.bots_quota}</td>
                  <td className="num" style={{ color: 'var(--mut)' }}>{o.msgs_7d.toLocaleString('fr-FR')}</td>
                  <td style={{ minWidth: 110 }}>
                    <div className="row g8">
                      <div style={{ flex: 1 }}>
                        <Meter pct={used} tone={used > 95 ? 'danger' : used > 70 ? 'warn' : 'acc'} height={5} />
                      </div>
                      <span className="num" style={{ fontSize: 10.5, color: 'var(--faint)' }}>{used}%</span>
                    </div>
                  </td>
                  <td><Chip tone="mut">{o.byok ? 'BYOK' : 'Managée'}</Chip></td>
                  <td>{orgStatusChip(o)}</td>
                  <td style={{ color: 'var(--faint)' }}><ChevronRight size={14} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

// ---------- Détail d'un client (admin) ----------
export function AdminClient() {
  const { orgId } = useParams()
  const navigate = useNavigate()
  const [org, setOrg] = useState<AdminOrg | null>(null)
  const [bots, setBots] = useState<BotSummary[]>([])

  function reload() {
    api<AdminOrg[]>('/api/admin/organizations').then(list => {
      setOrg(list.find(o => o.id === Number(orgId)) || null)
    })
    api<BotSummary[]>(`/api/admin/organizations/${orgId}/bots`).then(setBots)
  }
  useEffect(reload, [orgId])

  if (!org) return <div className="center-page">Chargement…</div>

  const used = Math.round((org.ai_messages_used / Math.max(1, org.ai_messages_quota)) * 100)

  async function changePlan(plan: string) {
    await api(`/api/admin/organizations/${org!.id}`, { method: 'PATCH', body: { plan } })
    reload()
  }
  async function toggleActive() {
    await api(`/api/admin/organizations/${org!.id}`, { method: 'PATCH', body: { is_active: !org!.is_active } })
    reload()
  }

  return (
    <div className="col g18">
      <div>
        <button className="back-link" onClick={() => navigate('/admin')}>← Tous les clients</button>
        <div className="bot-head">
          <span className="org-avatar" style={{ width: 44, height: 44, fontSize: 15, borderRadius: 12, background: orgColor(org.name) }}>
            {orgInitials(org.name)}
          </span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div className="bot-head-title">{org.name} {orgStatusChip(org)}</div>
            <div style={{ fontSize: 12, color: 'var(--mut)', marginTop: 2 }}>
              {org.contact || '—'} · client depuis {since(org.created_at)} · {org.members} membre{org.members > 1 ? 's' : ''}
            </div>
          </div>
          <div className="row g8">
            <select value={org.plan} onChange={e => changePlan(e.target.value)}
                    style={{ width: 'auto', fontSize: 12.5, fontWeight: 700, padding: '7px 10px' }} title="Changer de plan">
              <option value="free">Free</option>
              <option value="starter">Starter</option>
              <option value="pro">Pro</option>
              <option value="agence">Agence</option>
            </select>
            <Btn kind="danger" small onClick={toggleActive}>{org.is_active ? 'Suspendre' : 'Réactiver'}</Btn>
          </div>
        </div>
      </div>

      <div className="stat-row">
        <Stat label="Plan" value={PLAN_LABELS[org.plan] || org.plan} sub={`${org.plan_price} € / mois`} icon={<CreditCard size={15} />} />
        <Stat label="Bots" value={`${org.bots} / ${org.bots_quota}`} icon={<BotIcon size={15} />} />
        <Stat label="Crédits IA" value={`${used}%`} icon={<Sparkles size={15} />}
              delta={`${org.ai_messages_used.toLocaleString('fr-FR')} / ${org.ai_messages_quota.toLocaleString('fr-FR')}`}
              deltaTone={used > 95 ? 'danger' : 'warn'} />
        <Stat label="Msgs / 7 jours" value={org.msgs_7d.toLocaleString('fr-FR')} icon={<MessageSquare size={15} />} />
      </div>

      {org.is_active && org.ai_messages_used >= org.ai_messages_quota && (
        <InfoBox tone="warn" title="Quota dépassé">
          Ce client a atteint sa limite de crédits IA — ses bots tournent en mode dégradé (arbre seul).
          Proposez-lui un plan supérieur.
        </InfoBox>
      )}
      {!org.is_active && (
        <InfoBox tone="danger" title="Organisation suspendue">
          Tous les widgets de ce client sont coupés. Réactivez l'organisation pour les remettre en ligne.
        </InfoBox>
      )}

      <div>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 11 }}>Ses chatbots</div>
        {bots.length === 0 && <Card style={{ color: 'var(--faint)' }}>Aucun bot.</Card>}
        <div className="bot-grid">
          {bots.map(b => (
            <BotCard key={b.id} bot={b} onOpen={id => navigate(`/app/bots/${id}?from=admin`)} />
          ))}
        </div>
      </div>
    </div>
  )
}
