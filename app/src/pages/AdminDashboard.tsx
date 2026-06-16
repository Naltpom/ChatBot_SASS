// Dashboard opérateur — agrégats GET /api/admin/stats : clients
// actifs/suspendus, utilisateurs, bots, messages 7 jours, inscriptions 6 mois.
import { useEffect, useState } from 'react'
import { Bot, Building2, MessageSquare, Users } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { Bars, Btn, Card, SectionTitle, Stat } from '../ui'

interface AdminStats {
  orgs_total: number
  orgs_active: number
  orgs_suspended: number
  stripe_subscriptions: number
  users_total: number
  bots_total: number
  msgs_7d: number
  signups_by_month: { month: string; orgs: number; users: number }[]
}

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

  return (
    <div className="col g18">
      <SectionTitle sub="Vue d'ensemble de la plateforme — données temps réel."
                    right={<Btn kind="ghost" small onClick={() => navigate('/admin/clients')}>Voir les clients</Btn>}>
        Dashboard
      </SectionTitle>

      <div className="stat-row">
        <Stat label="Clients actifs" value={stats.orgs_active} icon={<Building2 size={15} />}
              delta={stats.orgs_suspended > 0 ? `${stats.orgs_suspended} suspendue${stats.orgs_suspended > 1 ? 's' : ''}` : undefined}
              deltaTone="danger" sub={`sur ${stats.orgs_total} organisations`} />
        <Stat label="Utilisateurs" value={stats.users_total.toLocaleString('fr-FR')} icon={<Users size={15} />}
              sub="comptes inscrits" />
        <Stat label="Bots" value={stats.bots_total.toLocaleString('fr-FR')} icon={<Bot size={15} />}
              sub="tous clients confondus" />
        <Stat label="Msgs / 7 jours" value={stats.msgs_7d.toLocaleString('fr-FR')} icon={<MessageSquare size={15} />}
              sub="toute la plateforme" />
      </div>

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
  )
}
