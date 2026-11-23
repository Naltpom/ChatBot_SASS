// Équipe : travailler à plusieurs dans un même espace (comptes, planning, bibliothèque partagés).
// Rôles : Admin (comptes, dossiers, groupes, membres), Éditeur (programme et modifie), Lecteur
// (consulte). Un éditeur ou un lecteur peut être limité à des groupes de comptes.
import { useState, type FormEvent } from 'react'
import {
  cancelInvite, createTeam, getTeam, inviteMember, removeMember, setMemberRole,
  type CmRole, type Group, type Team as TeamT,
} from '../api'
import { Empty, GroupDot, Icon, Msg, Skeleton } from '../components/ui'
import { useLoad, useSession } from '../session'

const ROLES: [CmRole, string, string][] = [
  ['admin', 'Admin', 'Connecte et retire les comptes et dossiers, gère groupes et membres.'],
  ['editor', 'Éditeur', 'Programme, modifie et annule les publications, édite la bibliothèque.'],
  ['viewer', 'Lecteur', 'Consulte le planning, les statistiques et la bibliothèque.'],
]
const ROLE_LABEL: Record<CmRole, string> = { admin: 'Admin', editor: 'Éditeur', viewer: 'Lecteur' }

function GroupPicker({ groups, value, onChange, disabled }: { groups: Group[]; value: number[] | null; onChange: (v: number[] | null) => void; disabled?: boolean }) {
  if (!groups.length) return null
  const all = !value || value.length === 0
  const toggle = (id: number) => {
    const cur = value || []
    const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]
    onChange(next.length ? next : null)
  }
  return (
    <div className="chips" role="group" aria-label="Comptes accessibles">
      <button type="button" className="chip chip-sm" aria-pressed={all} disabled={disabled} onClick={() => onChange(null)}>Tous les comptes</button>
      {groups.map(g => (
        <button key={g.id} type="button" className="chip chip-sm" aria-pressed={!all && value!.includes(g.id)} disabled={disabled} onClick={() => toggle(g.id)}>
          <GroupDot color={g.color} />{g.name}
        </button>
      ))}
    </div>
  )
}

function CreateTeam() {
  const { refresh, setOrg, spaces } = useSession()
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const teams = spaces.filter(s => s.org_id != null)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try { const t = await createTeam(name.trim()); await refresh(); setOrg(t.org_id) }
    catch (ex) { setErr((ex as Error).message) } finally { setBusy(false) }
  }
  return (
    <>
      <Empty title="Travailler à plusieurs" icon="users">
        <p style={{ margin: '0 0 14px' }}>Une équipe partage ses comptes, son planning et sa bibliothèque. Chacun a son rôle, et vous pouvez limiter une personne à certains groupes de comptes. Quand quelqu'un part, les comptes restent dans l'équipe.</p>
        <form className="row" style={{ gap: 8, justifyContent: 'center' }} onSubmit={submit}>
          <input className="input" style={{ maxWidth: 260 }} value={name} onChange={e => setName(e.target.value)} placeholder="Nom de l'équipe (ex. Studio Ghost Hands)" required maxLength={120} aria-label="Nom de l'équipe" />
          <button className="btn btn-primary" disabled={busy || !name.trim()}><Icon name="plus" />Créer l'équipe</button>
        </form>
        {err && <div style={{ marginTop: 10 }}><Msg kind="err">{err}</Msg></div>}
      </Empty>
      {teams.length > 0 && (
        <section className="card col" style={{ gap: 8 }}>
          <h2>Vos équipes</h2>
          {teams.map(t => (
            <div key={t.org_id} className="row between">
              <span className="strong">{t.name}</span>
              <span className="row" style={{ gap: 8 }}>
                <span className="tiny muted">{ROLE_LABEL[t.cm_role || 'editor']}</span>
                <button type="button" className="btn btn-sm" onClick={() => setOrg(t.org_id)}>Ouvrir</button>
              </span>
            </div>
          ))}
        </section>
      )}
    </>
  )
}

export default function Team() {
  const { org, groups } = useSession()
  const team = useLoad(() => (org == null ? Promise.resolve(null) : getTeam(org)), [org])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<CmRole>('editor')
  const [inviteGroups, setInviteGroups] = useState<number[] | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  if (org == null) {
    return (
      <>
        <div className="page-head"><div><h1>Équipe</h1><p>Vous êtes dans votre espace perso.</p></div></div>
        <CreateTeam />
      </>
    )
  }
  const t: TeamT | null = team.data
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setMsg(null)
    try { await fn(); team.reload(); if (ok) setMsg({ kind: 'ok', text: ok }) } catch (e) { setMsg({ kind: 'err', text: (e as Error).message }) }
  }
  const invite = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true)
    await run(async () => {
      const r = await inviteMember(org, email.trim(), role, role === 'admin' ? null : inviteGroups)
      setEmail(''); setInviteGroups(null)
      return r
    }, 'Invitation envoyée.')
    setBusy(false)
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Équipe{t ? ` · ${t.name}` : ''}</h1><p>Comptes, planning et bibliothèque partagés. Votre rôle : <b>{t ? ROLE_LABEL[t.my_role] : '…'}</b>.</p></div>
      </div>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      {team.error && <Msg kind="err">{team.error}</Msg>}
      {!t && team.loading && <Skeleton h={80} n={3} />}
      {t && (
        <>
          <section className="card col" style={{ gap: 4 }} aria-labelledby="t-membres">
            <h2 id="t-membres">Membres</h2>
            <ul className="list">
              {t.members.map(m => {
                const locked = m.org_role === 'admin' || m.you || !t.can_manage_roles
                return (
                  <li key={m.user_id} style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    <div className="grow" style={{ flex: '1 1 200px', minWidth: 0 }}>
                      <div className="strong ellipsis">{m.name || m.email}{m.you && <span className="tiny muted"> (vous)</span>}</div>
                      <div className="tiny muted ellipsis">{m.email}{m.is_owner ? ' · propriétaire' : m.org_role === 'admin' ? ' · admin de l’équipe' : ''}</div>
                      {m.cm_role !== 'admin' && groups.length > 0 && (
                        <div style={{ marginTop: 6 }}>
                          <GroupPicker groups={groups} value={m.group_ids} disabled={!t.can_manage_roles}
                                       onChange={v => run(() => setMemberRole(org, m.email, m.cm_role, v), 'Accès mis à jour.')} />
                        </div>
                      )}
                    </div>
                    <select className="input select-sm" style={{ width: 'auto' }} aria-label={`Rôle de ${m.email}`} value={m.cm_role} disabled={locked}
                            title={m.org_role === 'admin' ? 'Admin de l’équipe : toujours admin ici' : undefined}
                            onChange={e => run(() => setMemberRole(org, m.email, e.target.value as CmRole, m.group_ids), 'Rôle mis à jour.')}>
                      {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    {t.can_manage_members && !m.you && (
                      <button type="button" className="btn btn-ghost icon-btn btn-sm btn-danger" aria-label={`Retirer ${m.email}`}
                              onClick={() => { if (window.confirm(`Retirer ${m.email} de l’équipe ? Les comptes et le planning restent dans l’équipe.`)) run(() => removeMember(org, m.user_id), 'Membre retiré.') }}>
                        <Icon name="close" />
                      </button>
                    )}
                  </li>
                )
              })}
              {t.invitations.map(i => (
                <li key={`i${i.id}`} style={{ flexWrap: 'wrap' }}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="ellipsis">{i.email}</div>
                    <div className="tiny muted">Invitation en attente · {ROLE_LABEL[i.cm_role]}</div>
                  </div>
                  {t.can_manage_members && <button type="button" className="btn btn-sm" onClick={() => run(() => cancelInvite(org, i.id), 'Invitation annulée.')}>Annuler</button>}
                </li>
              ))}
            </ul>
          </section>

          {t.can_manage_members && (
            <section className="card col" style={{ gap: 12 }} aria-labelledby="t-inviter">
              <h2 id="t-inviter">Inviter quelqu'un</h2>
              <form className="col" style={{ gap: 12 }} onSubmit={invite}>
                <label className="field">Adresse e-mail
                  <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="prenom@exemple.fr" />
                  <span className="field-hint">Avec un compte Chapote, la personne rejoint l'équipe tout de suite ; sinon elle reçoit une invitation.</span>
                </label>
                <fieldset className="col" style={{ gap: 4 }}>
                  <legend>Rôle</legend>
                  {ROLES.map(([v, l, d]) => (
                    <label key={v} className="check"><input type="radio" name="role" checked={role === v} onChange={() => setRole(v)} /><span><b>{l}</b><br /><span className="field-hint">{d}</span></span></label>
                  ))}
                </fieldset>
                {role !== 'admin' && groups.length > 0 && (
                  <div className="col" style={{ gap: 6 }}>
                    <span className="small strong">Comptes accessibles</span>
                    <GroupPicker groups={groups} value={inviteGroups} onChange={setInviteGroups} />
                  </div>
                )}
                <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={busy || !email.trim()}>Inviter</button>
              </form>
            </section>
          )}
          <p className="tiny muted" style={{ margin: 0 }}>Un compte TikTok, YouTube ou Instagram n'est connecté que dans un seul espace Chapote : quand quelqu'un part, les comptes de l'équipe restent dans l'équipe. Un compte relié dans un espace perso peut être transféré (Comptes → Transférer).</p>
        </>
      )}
    </>
  )
}
