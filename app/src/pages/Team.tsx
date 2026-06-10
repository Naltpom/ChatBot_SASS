// « Équipe & permissions » — portée de pages-team.jsx (design) :
// invitation par email, rôles admin/membre, matrice de permissions PAR BOT
// (copy / test / appearance / context / security), invitations en attente.
import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../AuthContext'
import { Btn, Card, Chip, InfoBox, SectionTitle, Seg, brandBg } from '../ui'
import { BotSummary } from './BotList'

const PERMS = [
  { id: 'copy', label: 'Copier le script' },
  { id: 'test', label: 'Tester' },
  { id: 'appearance', label: 'Apparence' },
  { id: 'context', label: 'Contexte (arbre + IA)' },
  { id: 'security', label: 'Sécurité' },
]

interface Member {
  id: number
  name: string
  email: string
  role: string
  permissions: Record<string, string[]>
  you: boolean
}

interface Invitation { id: number; email: string; role: string }

export default function Team() {
  const { activeOrg, refreshUser } = useAuth()
  const [members, setMembers] = useState<Member[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [bots, setBots] = useState<BotSummary[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [converting, setConverting] = useState(false)

  const isAdmin = activeOrg?.role === 'admin'

  function reload() {
    if (!activeOrg) return
    api(`/api/orgs/${activeOrg.id}/members`).then(d => {
      setMembers(d.members)
      setInvitations(d.invitations)
    })
    api<BotSummary[]>(`/api/orgs/${activeOrg.id}/bots`).then(setBots)
  }
  useEffect(reload, [activeOrg?.id])

  if (!activeOrg) return <Card>Sélectionnez d'abord une organisation.</Card>

  // ---------- Compte personnel ----------
  if (activeOrg.type === 'perso') {
    async function convert() {
      setConverting(true)
      try {
        await api(`/api/orgs/${activeOrg!.id}`, { method: 'PATCH', body: { type: 'entreprise' } })
        await refreshUser()
      } catch (err: any) {
        setError(err.message)
      } finally {
        setConverting(false)
      }
    }
    return (
      <div className="col g18">
        <SectionTitle sub="Compte personnel — vous êtes le seul membre.">Équipe</SectionTitle>
        {error && <div className="error">{error}</div>}
        <InfoBox tone="info" title="Passer en entreprise">
          Même architecture, plus de monde : convertissez cet espace pour inviter des collègues et gérer des
          permissions par bot.
        </InfoBox>
        {isAdmin && (
          <div>
            <Btn onClick={convert} disabled={converting}>
              {converting ? 'Conversion…' : 'Convertir en espace entreprise'}
            </Btn>
          </div>
        )}
      </div>
    )
  }

  // ---------- Entreprise ----------
  async function invite() {
    const email = inviteEmail.trim().toLowerCase()
    if (!email.includes('@')) return
    setError('')
    setInfo('')
    try {
      const res = await api(`/api/orgs/${activeOrg!.id}/members`, {
        method: 'POST', body: { email, role: inviteRole },
      })
      setInfo(res.joined
        ? `${email} avait déjà un compte — ajouté directement à l'équipe.`
        : `Invitation enregistrée : ${email} rejoindra l'espace en créant son compte.`)
      setInviteEmail('')
      reload()
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function patchMember(m: Member, body: Record<string, any>) {
    setError('')
    try {
      await api(`/api/orgs/${activeOrg!.id}/members/${m.id}`, { method: 'PATCH', body })
      reload()
    } catch (err: any) {
      setError(err.message)
    }
  }

  function togglePerm(m: Member, botId: number, perm: string) {
    const key = String(botId)
    const cur = m.permissions[key] || []
    const next = cur.includes(perm) ? cur.filter(p => p !== perm) : [...cur, perm]
    patchMember(m, { permissions: { ...m.permissions, [key]: next } })
  }

  async function removeMember(m: Member) {
    setError('')
    try {
      await api(`/api/orgs/${activeOrg!.id}/members/${m.id}`, { method: 'DELETE' })
      reload()
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function cancelInvitation(inv: Invitation) {
    await api(`/api/orgs/${activeOrg!.id}/invitations/${inv.id}`, { method: 'DELETE' })
    reload()
  }

  const initials = (m: { name?: string | null; email: string }) =>
    m.name ? m.name.split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase() : m.email[0].toUpperCase()

  return (
    <div className="col g18">
      <SectionTitle sub={`${members.length} membre${members.length > 1 ? 's' : ''} dans ${activeOrg.name}. Les admins gèrent tout ; les membres reçoivent des permissions par bot.`}>
        Équipe &amp; permissions
      </SectionTitle>

      {error && <div className="error">{error}</div>}
      {info && <InfoBox tone="go">{info}</InfoBox>}

      {isAdmin && (
        <Card>
          <div className="card-title">Inviter quelqu'un</div>
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            <input type="email" value={inviteEmail} placeholder="collegue@entreprise.fr"
                   onChange={e => setInviteEmail(e.target.value)}
                   onKeyDown={e => e.key === 'Enter' && invite()}
                   style={{ flex: 1, minWidth: 220 }} />
            <Seg value={inviteRole} onChange={setInviteRole}
                 options={[{ value: 'member', label: 'Membre' }, { value: 'admin', label: 'Admin' }]} />
            <Btn onClick={invite}>Envoyer l'invitation</Btn>
          </div>
          <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 8 }}>
            La personne rejoint l'espace dès la création de son compte avec cet email. Un nouveau membre n'a
            aucune permission — accordez-les ci-dessous.
          </div>
        </Card>
      )}

      <Card nopad>
        {members.map((m, i) => {
          const isOpen = expanded === m.id
          return (
            <div key={m.id} style={{ borderBottom: i < members.length - 1 || invitations.length > 0 ? '1px solid var(--border)' : 'none' }}>
              <div className="member-row">
                <span className="member-avatar">{initials(m)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {m.name}
                    {m.you && <Chip tone="acc">vous</Chip>}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>{m.email}</div>
                </div>
                {isAdmin && !m.you ? (
                  <Seg small value={m.role} onChange={v => patchMember(m, { role: v })}
                       options={[{ value: 'member', label: 'Membre' }, { value: 'admin', label: 'Admin' }]} />
                ) : (
                  <Chip tone={m.role === 'admin' ? 'warn' : 'mut'}>{m.role === 'admin' ? 'Admin' : 'Membre'}</Chip>
                )}
                {m.role === 'member' ? (
                  <Btn kind="soft" small onClick={() => setExpanded(isOpen ? null : m.id)}>
                    {isOpen ? 'Fermer' : 'Permissions'}
                  </Btn>
                ) : (
                  <Chip tone="go">Accès total</Chip>
                )}
                {isAdmin && !m.you && (
                  <button onClick={() => removeMember(m)} aria-label="Retirer"
                          style={{ border: 'none', background: 'none', color: 'var(--faint)', cursor: 'pointer', padding: 4 }}>
                    <X size={15} />
                  </button>
                )}
              </div>

              {/* Matrice de permissions par bot */}
              {isOpen && m.role === 'member' && (
                <div style={{ padding: '0 16px 15px 62px' }}>
                  <div style={{ border: '1px solid var(--border)', borderRadius: 11, overflow: 'hidden' }}>
                    <table className="perm-matrix">
                      <thead>
                        <tr>
                          <th>Bot</th>
                          {PERMS.map(p => <th key={p.id}>{p.label}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {bots.map(b => (
                          <tr key={b.id}>
                            <td>
                              <div className="row g8">
                                <span style={{ width: 18, height: 18, borderRadius: 99, background: brandBg(b.design_json), flexShrink: 0 }} />
                                <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{b.name}</span>
                              </div>
                            </td>
                            {PERMS.map(p => {
                              const on = (m.permissions[String(b.id)] || []).includes(p.id)
                              return (
                                <td key={p.id}>
                                  <button className={`perm-check ${on ? 'on' : ''}`} aria-pressed={on}
                                          disabled={!isAdmin}
                                          onClick={() => isAdmin && togglePerm(m, b.id, p.id)}>
                                    {on && <Check size={13} strokeWidth={3} />}
                                  </button>
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                        {bots.length === 0 && (
                          <tr><td colSpan={PERMS.length + 1} style={{ color: 'var(--faint)', padding: 14 }}>Aucun bot pour l'instant.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 7, lineHeight: 1.5 }}>
                    « Contexte » couvre l'arbre de décision, le modèle et les instructions. Les stats sont
                    visibles par tous les membres.
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {/* Invitations en attente */}
        {invitations.map((inv, i) => (
          <div key={inv.id} className="member-row" style={{ borderBottom: i < invitations.length - 1 ? '1px solid var(--border)' : 'none' }}>
            <span className="member-avatar pending">{inv.email[0].toUpperCase()}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {inv.email}
                <Chip tone="warn">invitation en attente</Chip>
              </div>
            </div>
            <Chip tone={inv.role === 'admin' ? 'warn' : 'mut'}>{inv.role === 'admin' ? 'Admin' : 'Membre'}</Chip>
            {isAdmin && (
              <button onClick={() => cancelInvitation(inv)} aria-label="Annuler"
                      style={{ border: 'none', background: 'none', color: 'var(--faint)', cursor: 'pointer', padding: 4 }}>
                <X size={15} />
              </button>
            )}
          </div>
        ))}
      </Card>
    </div>
  )
}
