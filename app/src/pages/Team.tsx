// « Équipe & permissions » :
// invitation par email, rôles admin/membre, matrice de permissions PAR BOT
// (copy / test / appearance / context / security / inbox), invitations en attente.
// La matrice vit dans sa propre section, TOUJOURS rendue (découvrable dès le
// 1er jour, même sans membre au rôle « member »).
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../AuthContext'
import { Btn, Card, Chip, InfoBox, SectionTitle, Seg, brandBg } from '../ui'
import { BotSummary } from '../types/bot'
import { errMsg } from '../utils/errors'

// 'inbox' volontairement EN FIN (ordre aligné sur BOT_PERMS côté API ; le spec
// e2e team-permissions toggle la 1re colonne = copy via .first())
const PERMS = [
  { id: 'copy', label: 'Copier le script', desc: "récupérer les snippets d'intégration" },
  { id: 'test', label: 'Tester', desc: 'prévisualiser le widget' },
  { id: 'appearance', label: 'Apparence', desc: 'design, nom, mode' },
  { id: 'context', label: 'Contexte (arbre + IA)', desc: 'arbre, IA, actions, leads, exports' },
  { id: 'security', label: 'Sécurité', desc: 'domaines, captcha, activation' },
  { id: 'inbox', label: 'Boîte de réception (chat humain)', desc: 'voir et répondre aux conversations transmises à un conseiller' },
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

// Légende des permissions — affichée sous la matrice ET dans l'état vide,
// pour que la délégation fine soit découvrable avant le premier membre.
function PermLegend() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px 16px' }}>
      {PERMS.map(p => (
        <div key={p.id}>
          <div style={{ fontSize: 11.5, fontWeight: 700 }}>{p.label}</div>
          <div style={{ fontSize: 11, color: 'var(--faint)', lineHeight: 1.45 }}>{p.desc}</div>
        </div>
      ))}
    </div>
  )
}

export default function Team() {
  const { activeOrg } = useAuth()
  const [members, setMembers] = useState<Member[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [bots, setBots] = useState<BotSummary[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const matrixRef = useRef<HTMLDivElement | null>(null)

  const isAdmin = activeOrg?.role === 'admin'

  // useCallback : reload est en dépendance de l'effet ci-dessous ; non mémoïsé
  // (recréé à chaque rendu) l'effet bouclerait. Mémoïsé sur l'id de l'équipe
  // active, il ne se recrée qu'au changement d'équipe (orgs/team couvrent) —
  // pas à chaque refreshUser renvoyant un nouvel objet à id identique.
  const reload = useCallback(() => {
    if (!activeOrg) return
    // .catch : sans lui, un échec afficherait « 0 membre » mensonger
    api(`/api/orgs/${activeOrg.id}/members`).then(d => {
      setMembers(d.members)
      setInvitations(d.invitations)
    }).catch((err: unknown) => setError(`Chargement de l'équipe impossible : ${errMsg(err)}`))
    api<BotSummary[]>(`/api/orgs/${activeOrg.id}/bots`).then(setBots)
      .catch((err: unknown) => setError(`Chargement des bots impossible : ${errMsg(err)}`))
    // activeOrg lu via closure ; seul son id pilote le rechargement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrg?.id])
  useEffect(() => { reload() }, [reload])

  if (!activeOrg) {
    return (
      <Card style={{ textAlign: 'center', padding: '36px 24px' }}>
        <div className="col" style={{ alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 14.5, fontWeight: 800 }}>Aucune équipe active</div>
          <div style={{ fontSize: 12.5, color: 'var(--mut)', maxWidth: 380, lineHeight: 1.55 }}>
            Sélectionnez une équipe dans le menu latéral, ou créez-en une.
          </div>
          <Link to="/app/orgs" style={{ fontSize: 13, fontWeight: 700, color: 'var(--acc)' }}>Mes équipes</Link>
        </div>
      </Card>
    )
  }

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
    } catch (err: unknown) {
      setError(errMsg(err))
    }
  }

  async function patchMember(m: Member, body: Record<string, any>) {
    setError('')
    try {
      await api(`/api/orgs/${activeOrg!.id}/members/${m.id}`, { method: 'PATCH', body })
      reload()
    } catch (err: unknown) {
      setError(errMsg(err))
    }
  }

  async function togglePerm(m: Member, botId: number, perm: string) {
    const key = String(botId)
    const cur = m.permissions[key] || []
    const next = cur.includes(perm) ? cur.filter(p => p !== perm) : [...cur, perm]
    const nextMap = { ...m.permissions, [key]: next }
    // Mise à jour OPTIMISTE avant le PATCH : des toggles en rafale partiraient
    // sinon avec un snapshot périmé (le PATCH envoie la map complète) et le
    // 2e clic écraserait le 1er côté serveur. Re-sync (reload) sur échec.
    setMembers(ms => ms.map(x => (x.id === m.id ? { ...x, permissions: nextMap } : x)))
    setError('')
    try {
      await api(`/api/orgs/${activeOrg!.id}/members/${m.id}`, { method: 'PATCH', body: { permissions: nextMap } })
    } catch (err: unknown) {
      setError(errMsg(err))
      reload()
    }
  }

  async function removeMember(m: Member) {
    setError('')
    try {
      await api(`/api/orgs/${activeOrg!.id}/members/${m.id}`, { method: 'DELETE' })
      reload()
    } catch (err: unknown) {
      setError(errMsg(err))
    }
  }

  async function cancelInvitation(inv: Invitation) {
    await api(`/api/orgs/${activeOrg!.id}/invitations/${inv.id}`, { method: 'DELETE' })
    reload()
  }

  const initials = (m: { name?: string | null; email: string }) =>
    m.name ? m.name.split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase() : m.email[0].toUpperCase()

  // Membres au rôle « member » : seuls concernés par les permissions fines
  const memberUsers = members.filter(m => m.role === 'member')
  const selectedMember = memberUsers.find(m => m.id === selectedId) || memberUsers[0] || null

  function focusMember(m: Member) {
    setSelectedId(m.id)
    matrixRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

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
        <div className="card-title" style={{ padding: '14px 16px 4px' }}>Membres</div>
        {members.map((m, i) => (
          <div key={m.id} className="member-row"
               style={{ borderBottom: i < members.length - 1 || invitations.length > 0 ? '1px solid var(--border)' : 'none' }}>
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
              <Btn kind="soft" small onClick={() => focusMember(m)}>Permissions</Btn>
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
        ))}

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

      {/* ---- Permissions par bot (toujours visible : découvrable dès 1 membre) ---- */}
      <div ref={matrixRef} className="col g18" style={{ scrollMarginTop: 14 }}>
        <SectionTitle sub="Les admins ont tout accès ; chaque membre reçoit des droits fins, bot par bot.">
          Permissions par bot
        </SectionTitle>

        {memberUsers.length === 0 ? (
          <Card>
            <div style={{ fontSize: 12.5, color: 'var(--mut)', lineHeight: 1.55, marginBottom: 14 }}>
              Aucun membre avec permissions fines pour l'instant — les admins ont déjà tout accès.
              Invitez un membre (rôle Membre) pour lui déléguer des droits précis.
            </div>
            <PermLegend />
          </Card>
        ) : (
          <Card>
            <div className="row g8" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
              {memberUsers.length <= 4 ? (
                <Seg small value={String(selectedMember!.id)} onChange={v => setSelectedId(Number(v))}
                     options={memberUsers.map(m => ({ value: String(m.id), label: m.name || m.email }))} />
              ) : (
                <select value={String(selectedMember!.id)} onChange={e => setSelectedId(Number(e.target.value))}
                        style={{ minWidth: 220 }}>
                  {memberUsers.map(m => (
                    <option key={m.id} value={String(m.id)}>{m.name || m.email}</option>
                  ))}
                </select>
              )}
              <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>{selectedMember!.email}</span>
            </div>

            <div style={{ border: '1px solid var(--border)', borderRadius: 11, overflow: 'hidden' }}>
              <div className="table-scroll">
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
                        const on = (selectedMember!.permissions[String(b.id)] || []).includes(p.id)
                        return (
                          <td key={p.id}>
                            <button className={`perm-check ${on ? 'on' : ''}`} aria-pressed={on}
                                    disabled={!isAdmin}
                                    onClick={() => isAdmin && togglePerm(selectedMember!, b.id, p.id)}>
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
            </div>

            <div style={{ fontSize: 10.5, color: 'var(--faint)', margin: '7px 0 14px', lineHeight: 1.5 }}>
              « Contexte » couvre l'arbre de décision, le modèle, les instructions, les actions IA et les
              leads. Les stats sont visibles par tous les membres.
            </div>
            <PermLegend />
          </Card>
        )}
      </div>
    </div>
  )
}
