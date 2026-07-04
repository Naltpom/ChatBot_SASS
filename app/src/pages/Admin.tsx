// Vue ADMIN (opérateur du SaaS) : KPIs, table de tous les clients, drill-down
// avec cards de bots paramétrables.
import { useCallback, useEffect, useState } from 'react'
import { Bot as BotIcon, Building2, ChevronRight, MessageSquare } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { Btn, Card, Chip, InfoBox, SectionTitle, Stat, orgColor, orgInitials } from '../ui'
import { BotCard } from './BotList'
import { BotSummary } from '../types/bot'
import { errMsg } from '../utils/errors'

interface AdminOrg {
  id: number
  name: string
  type: string
  is_active: boolean
  created_at: string
  contact: string | null
  members: number
  bots: number
  byok: boolean
  msgs_7d: number
}

function orgStatusChip(o: AdminOrg) {
  if (!o.is_active) return <Chip tone="danger">Suspendue</Chip>
  return <Chip tone="go">Actif</Chip>
}

function since(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })
}

export default function AdminHome() {
  const navigate = useNavigate()
  const [orgs, setOrgs] = useState<AdminOrg[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    // .catch : sans lui, un échec afficherait « 0 client » mensonger.
    api<AdminOrg[]>('/api/admin/organizations').then(setOrgs)
      .catch((err: unknown) => setError(`Chargement des clients impossible : ${errMsg(err)}`))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="center-page">Chargement…</div>

  const totBots = orgs.reduce((n, o) => n + o.bots, 0)
  const msgs = orgs.reduce((n, o) => n + o.msgs_7d, 0)

  return (
    <div className="col g18">
      <SectionTitle sub="Tous les clients Chapote — vue opérateur.">Clients</SectionTitle>

      {error && <div className="error">{error}</div>}

      <div className="stat-row">
        <Stat label="Clients" value={orgs.length} icon={<Building2 size={15} />} sub="organisations" />
        <Stat label="Bots actifs" value={totBots} icon={<BotIcon size={15} />} sub="tous clients confondus" />
        <Stat label="Msgs / 7 jours" value={msgs.toLocaleString('fr-FR')} icon={<MessageSquare size={15} />} sub="toute la plateforme" />
      </div>

      <Card nopad>
        <div className="table-scroll">
<table className="kc">
          <thead>
            <tr>
              <th>Client</th><th>Type</th><th>Bots</th><th>Msgs / 7 j</th>
              <th>Clé</th><th>Statut</th><th></th>
            </tr>
          </thead>
          <tbody>
            {orgs.map(o => (
              // Ligne cliquable opérable au clavier (Enter/Espace) ; le test
              // target === currentTarget évite les déclenchements internes.
              <tr key={o.id} className="click" tabIndex={0}
                  onClick={() => navigate(`/admin/clients/${o.id}`)}
                  onKeyDown={e => {
                    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault()
                      navigate(`/admin/clients/${o.id}`)
                    }
                  }}>
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
                <td><Chip tone="mut">{o.type === 'perso' ? 'Personnel' : 'Entreprise'}</Chip></td>
                <td className="num" style={{ fontWeight: 700 }}>{o.bots}</td>
                <td className="num" style={{ color: 'var(--mut)' }}>{o.msgs_7d.toLocaleString('fr-FR')}</td>
                <td><Chip tone="mut">{o.byok ? 'BYOK' : 'Managée'}</Chip></td>
                <td>{orgStatusChip(o)}</td>
                <td style={{ color: 'var(--faint)' }}><ChevronRight size={14} /></td>
              </tr>
            ))}
          </tbody>
        </table>
</div>
      </Card>
    </div>
  )
}

export function AdminClient() {
  const { orgId } = useParams()
  const navigate = useNavigate()
  const [org, setOrg] = useState<AdminOrg | null>(null)
  const [bots, setBots] = useState<BotSummary[]>([])
  const [error, setError] = useState('')

  // useCallback : reload est référencé en dépendance de l'effet ci-dessous ;
  // sans mémoïsation (recréé à chaque rendu) l'effet boucle. Mémoïsé sur orgId,
  // il ne change qu'au changement de client (admin-split couvre).
  const reload = useCallback(() => {
    // .catch : sans lui, un échec laisserait la page bloquée sur « Chargement… »
    // (org reste null) sans rien signaler.
    api<AdminOrg[]>('/api/admin/organizations').then(list => {
      setOrg(list.find(o => o.id === Number(orgId)) || null)
    }).catch((err: unknown) => setError(`Chargement du client impossible : ${errMsg(err)}`))
    api<BotSummary[]>(`/api/admin/organizations/${orgId}/bots`).then(setBots)
      .catch((err: unknown) => setError(`Chargement des bots impossible : ${errMsg(err)}`))
  }, [orgId])
  useEffect(() => { reload() }, [reload])

  if (!org) return <div className="center-page">{error || 'Chargement…'}</div>

  async function toggleActive() {
    try {
      await api(`/api/admin/organizations/${org!.id}`, { method: 'PATCH', body: { is_active: !org!.is_active } })
      reload()
    } catch (err: unknown) {
      setError(`Changement de statut impossible : ${errMsg(err)}`)
    }
  }

  return (
    <div className="col g18">
      <div>
        <button className="back-link" onClick={() => navigate('/admin/clients')}>← Tous les clients</button>
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
            <Btn kind="danger" small onClick={toggleActive}>{org.is_active ? 'Suspendre' : 'Réactiver'}</Btn>
          </div>
        </div>
      </div>

      <div className="stat-row">
        <Stat label="Type" value={org.type === 'perso' ? 'Personnel' : 'Entreprise'} icon={<Building2 size={15} />} />
        <Stat label="Bots" value={org.bots} icon={<BotIcon size={15} />} />
        <Stat label="Clé API" value={org.byok ? 'BYOK' : 'Managée'} icon={<BotIcon size={15} />} />
        <Stat label="Msgs / 7 jours" value={org.msgs_7d.toLocaleString('fr-FR')} icon={<MessageSquare size={15} />} />
      </div>

      {!org.is_active && (
        <InfoBox tone="danger" title="Organisation suspendue">
          Tous les widgets de ce client sont coupés. Réactivez l'organisation pour les remettre en ligne.
        </InfoBox>
      )}

      <div>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 11 }}>Ses chatbots</div>
        {error && <div className="error" style={{ marginBottom: 11 }}>{error}</div>}
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
