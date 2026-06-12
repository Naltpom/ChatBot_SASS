// Dashboard opérateur — agrégats GET /api/admin/stats : MRR (total + par
// plan), clients actifs/suspendus, conso IA du mois, inscriptions 6 mois,
// projection LINÉAIRE indicative calculée côté front (formule fixée).
import { useEffect, useState } from 'react'
import { Building2, MessageSquare, Sparkles, TrendingUp } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { Bars, Btn, Card, Chip, Meter, SectionTitle, Stat } from '../ui'
import { PLAN_LABELS } from '../botConstants'

interface AdminStats {
  mrr: number
  mrr_by_plan: Record<string, number>
  orgs_total: number
  orgs_active: number
  orgs_suspended: number
  orgs_by_plan: Record<string, number>
  paying_orgs: number
  stripe_subscriptions: number
  users_total: number
  bots_total: number
  msgs_7d: number
  ai_messages_month: number
  ai_quota_month: number
  signups_by_month: { month: string; orgs: number; users: number }[]
}

const PAYING_PLANS = ['starter', 'pro', 'agence']

function monthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'short' })
}

export default function AdminDashboard() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    setError('')
    api<AdminStats>('/api/admin/stats').then(setStats).catch((err: any) => setError(err.message))
  }, [retry])

  if (error) {
    return (
      <div className="col g18">
        <SectionTitle sub="Vue d'ensemble de la plateforme.">Dashboard</SectionTitle>
        <div className="error">{error}</div>
        <div><Btn kind="soft" onClick={() => setRetry(n => n + 1)}>Réessayer</Btn></div>
      </div>
    )
  }
  if (!stats) return <div className="center-page">Chargement…</div>

  // Projection simple (formule fixée) : rythme d'inscriptions des 3 derniers
  // mois COMPLETS × taux de conversion actuel × ARPU, sur 3 mois.
  const arpu = stats.mrr / Math.max(1, stats.paying_orgs)
  const completed = stats.signups_by_month.slice(-4, -1) // mois courant (dernier) exclu
  const avgNew = completed.length ? completed.reduce((n, m) => n + m.orgs, 0) / completed.length : 0
  const tauxPayant = stats.paying_orgs / Math.max(1, stats.orgs_total)
  const mrrProj = Math.round(stats.mrr + avgNew * tauxPayant * arpu * 3)

  return (
    <div className="col g18">
      <SectionTitle sub="Vue d'ensemble de la plateforme — données temps réel."
                    right={<Btn kind="ghost" small onClick={() => navigate('/admin/clients')}>Voir les clients</Btn>}>
        Dashboard
      </SectionTitle>

      <div className="stat-row">
        <Stat label="MRR" value={`${stats.mrr} €`} icon={<TrendingUp size={15} />}
              sub={`${stats.stripe_subscriptions} abonnement${stats.stripe_subscriptions > 1 ? 's' : ''} Stripe actif${stats.stripe_subscriptions > 1 ? 's' : ''}`} />
        <Stat label="Clients actifs" value={stats.orgs_active} icon={<Building2 size={15} />}
              delta={stats.orgs_suspended > 0 ? `${stats.orgs_suspended} suspendue${stats.orgs_suspended > 1 ? 's' : ''}` : undefined}
              deltaTone="danger" sub={`sur ${stats.orgs_total} organisations`} />
        <Stat label="Conso IA du mois" value={stats.ai_messages_month.toLocaleString('fr-FR')} icon={<Sparkles size={15} />}
              sub={`sur ${stats.ai_quota_month.toLocaleString('fr-FR')} inclus dans les plans`} />
        <Stat label="Msgs / 7 jours" value={stats.msgs_7d.toLocaleString('fr-FR')} icon={<MessageSquare size={15} />}
              sub="toute la plateforme" />
      </div>

      <div className="grid2">
        <Card>
          <div className="card-title">MRR par plan</div>
          <div className="col" style={{ gap: 12 }}>
            {PAYING_PLANS.map(p => {
              const amount = stats.mrr_by_plan[p] || 0
              const pct = Math.round((amount / Math.max(1, stats.mrr)) * 100)
              return (
                <div key={p}>
                  <div className="row g8" style={{ justifyContent: 'space-between', marginBottom: 5 }}>
                    <div className="row g8">
                      <Chip tone="acc">{PLAN_LABELS[p] || p}</Chip>
                      <span style={{ fontSize: 11.5, color: 'var(--mut)' }}>
                        {stats.orgs_by_plan[p] || 0} client{(stats.orgs_by_plan[p] || 0) > 1 ? 's' : ''}
                      </span>
                    </div>
                    <span className="mono num" style={{ fontSize: 12.5, fontWeight: 700 }}>{amount} €</span>
                  </div>
                  <Meter pct={pct} height={6} />
                </div>
              )
            })}
            <div style={{ fontSize: 11.5, color: 'var(--faint)', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              {stats.orgs_by_plan.free || 0} compte{(stats.orgs_by_plan.free || 0) > 1 ? 's' : ''} free — 0 €
            </div>
          </div>
        </Card>

        <Card>
          <div className="card-title">Inscriptions (6 mois)</div>
          <Bars aLabel="Orgs" bLabel="Users"
                data={stats.signups_by_month.map(m => ({ label: monthLabel(m.month), a: m.orgs, b: m.users }))} />
          <div className="row g14" style={{ marginTop: 10 }}>
            <span className="row g6" style={{ fontSize: 11, color: 'var(--mut)' }}>
              <span className="legend-sq" style={{ background: 'var(--acc)' }} /> Organisations
            </span>
            <span className="row g6" style={{ fontSize: 11, color: 'var(--mut)' }}>
              <span className="legend-sq" style={{ background: 'var(--acc-bd)' }} /> Utilisateurs
            </span>
          </div>
        </Card>
      </div>

      <Card>
        <div className="card-title">Projection simple</div>
        <div className="stat-row">
          <div style={{ flex: 1, minWidth: 150 }}>
            <div className="stat-label">MRR actuel</div>
            <div className="stat-value" style={{ fontSize: 22 }}>{stats.mrr} €</div>
          </div>
          <div style={{ flex: 1, minWidth: 150 }}>
            <div className="stat-label">Nouvelles orgs / mois</div>
            <div className="stat-value" style={{ fontSize: 22 }}>{avgNew.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</div>
            <div className="stat-foot"><span className="sub">moyenne des 3 derniers mois complets</span></div>
          </div>
          <div style={{ flex: 1, minWidth: 150 }}>
            <div className="stat-label">MRR projeté à +3 mois</div>
            <div className="stat-value" style={{ fontSize: 22, color: 'var(--acc)' }}>{mrrProj} €</div>
          </div>
        </div>
        <div className="field-hint" style={{ marginTop: 10 }}>
          Projection linéaire indicative — fondée sur le rythme d'inscriptions et le taux de
          conversion actuels, sans saisonnalité.
        </div>
      </Card>
    </div>
  )
}
