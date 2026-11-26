// Partage : on partage un GROUPE de comptes (Admin / Peut publier / Lecture seule), jamais « tout l'espace ».
// Ici : les invitations reçues (accepter / refuser), mes groupes et qui y a accès, les groupes partagés
// avec moi, et le nom de mon espace perso (vu par les personnes avec qui je partage).
import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  acceptInvitation, addGroupShare, declineInvitation, getGroupShares, getInvitations, getPeople, getProfile,
  removeGroupShare, removePerson, saveProfile, type CmRole, type Group, type GroupShare, type Invitation,
} from '../api'
import { ROLE_CHOICES, ROLE_NAME } from '../components/ShareSheet'
import { Avatar, Empty, GroupDot, Icon, Msg, Sheet, Skeleton } from '../components/ui'
import { useLoad, useSession } from '../session'
import { t } from '../i18n'

const STATUS: Record<GroupShare['status'], string> = { pending: 'Invitation envoyée', accepted: 'A accès', declined: 'A refusé' }

/** Qui a accès à un groupe, et ajouter une personne. */
export function GroupShareSheet({ g, onClose }: { g: Group; onClose: () => void }) {
  const list = useLoad(() => getGroupShares(g.id), [g.id])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<CmRole>('editor')
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setOk(''); setBusy(true)
    try {
      const r = await addGroupShare(g.id, email.trim(), role)
      setOk(r.status === 'accepted' ? t('Accès de {email} mis à jour.', { email: email.trim() }) : t('Invitation envoyée à {email} : elle la verra dans « Partage ».', { email: email.trim() }))
      setEmail(''); list.reload()
    } catch (ex) { setErr((ex as Error).message) } finally { setBusy(false) }
  }
  const remove = async (s: GroupShare) => {
    if (!window.confirm(t('Retirer l’accès de {email} au groupe « {group} » ?', { email: s.email, group: g.name }))) return
    try { await removeGroupShare(g.id, s.id); list.reload() } catch (ex) { setErr((ex as Error).message) }
  }
  const people = (list.data || []).filter(s => s.status !== 'declined')
  return (
    <Sheet title={<span className="row-nw" style={{ gap: 8 }}><GroupDot color={g.color} />{t('Partager « {group} »', { group: g.name })}</span>} onClose={onClose}>
      <form className="col" style={{ gap: 14 }} onSubmit={submit}>
        <label className="field">{t('Adresse e-mail')}
          <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus placeholder={t('prenom@exemple.fr')} autoCapitalize="none" />
        </label>
        <fieldset className="col" style={{ gap: 4 }}>
          <legend>{g.accounts.length > 1 ? t('Accès aux {n} comptes du groupe', { n: g.accounts.length }) : t('Accès au {n} compte du groupe', { n: g.accounts.length })}</legend>
          {ROLE_CHOICES.map(([v, l, d]) => (
            <label key={v} className="check"><input type="radio" name="gs-role" checked={role === v} onChange={() => setRole(v)} />
              <span><b>{t(l)}</b><br /><span className="field-hint">{v === 'admin' ? t('Publie, et peut partager ce groupe à son tour.') : t(d)}</span></span></label>
          ))}
        </fieldset>
        {err && <Msg kind="err">{err}</Msg>}
        {ok && <Msg kind="ok">{ok}</Msg>}
        <div className="row-nw">
          <button type="button" className="btn grow" onClick={onClose}>{t('Fermer')}</button>
          <button className="btn btn-primary grow" disabled={busy || !email.trim()}><Icon name="users" size={16} />{t('Partager')}</button>
        </div>
        {list.error && <Msg kind="err">{list.error}</Msg>}
        {people.length > 0 && (
          <div className="col" style={{ gap: 6 }}>
            <span className="small strong">{t('Ont accès')}</span>
            <ul className="list">
              {people.map(s => (
                <li key={s.id}>
                  <Avatar src={null} name={s.email} size="sm" />
                  <span className="grow col" style={{ minWidth: 0, gap: 0 }}>
                    <span className="ellipsis small">{s.email}</span>
                    <span className="tiny muted">{t(STATUS[s.status])} · {t(ROLE_NAME[s.role])}</span>
                  </span>
                  <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => remove(s)} aria-label={t('Retirer {email}', { email: s.email })}>{t('Retirer')}</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="tiny muted" style={{ margin: 0 }}>{t('Changer le rôle de quelqu’un : partagez de nouveau avec son adresse et le nouveau rôle.')}</p>
      </form>
    </Sheet>
  )
}

function Invitations({ onDone }: { onDone: (text: string) => void }) {
  const { reloadGroups, refresh } = useSession()
  const inv = useLoad(() => getInvitations(), [])
  const [busy, setBusy] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const answer = async (i: Invitation, yes: boolean) => {
    setBusy(i.id); setErr('')
    try {
      if (yes) await acceptInvitation(i.id); else await declineInvitation(i.id)
      await refresh(); await reloadGroups(); inv.reload()
      onDone(yes ? t('« {group} » est maintenant dans « Tous ».', { group: i.group_name }) : t('Invitation refusée.'))
    } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }
  if (!inv.data?.length) return null
  return (
    <section className="card col" aria-labelledby="t-inv" style={{ gap: 10, borderColor: 'var(--primary)' }}>
      <h2 id="t-inv">{t('Invitations reçues')}</h2>
      {err && <Msg kind="err">{err}</Msg>}
      <ul className="list">
        {inv.data.map(i => (
          <li key={i.id} style={{ flexWrap: 'wrap' }}>
            <GroupDot color={i.group_color} />
            <div className="grow" style={{ flex: '1 1 200px', minWidth: 0 }}>
              <div className="strong ellipsis">{i.group_name}</div>
              <div className="tiny muted">
                {i.invited_by || i.owner ? `${t('De {owner}', { owner: i.invited_by || i.owner })} · ` : ''}{i.accounts > 1 ? t('{n} comptes', { n: i.accounts }) : t('{n} compte', { n: i.accounts })} · {t(i.role_label)}
              </div>
            </div>
            <button type="button" className="btn btn-sm" disabled={busy === i.id} onClick={() => answer(i, false)}>{t('Refuser')}</button>
            <button type="button" className="btn btn-sm btn-primary" disabled={busy === i.id} onClick={() => answer(i, true)}>{t('Accepter')}</button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function PersoName({ onDone }: { onDone: (text: string) => void }) {
  const { refresh } = useSession()
  const [name, setName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { getProfile().then(p => setName(p.perso_name === 'Espace perso' ? '' : p.perso_name)).catch(() => setName('')) }, [])
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('')
    try { const r = await saveProfile((name || '').trim()); setName(r.perso_name); await refresh(); onDone(t('Nom enregistré.')) }
    catch (ex) { setErr((ex as Error).message) } finally { setBusy(false) }
  }
  if (name === null) return null
  return (
    <form className="card col" onSubmit={save} style={{ gap: 10 }} aria-labelledby="t-perso">
      <h2 id="t-perso">{t('Mon nom pour les autres')}</h2>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="field grow" style={{ flex: '1 1 220px' }}>{t('Nom affiché à côté de mes groupes partagés')}
          <input className="input" value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder={t('Ex. Studio Nathan')} />
        </label>
        <button className="btn" disabled={busy}>{t('Enregistrer')}</button>
      </div>
      {err && <Msg kind="err">{err}</Msg>}
    </form>
  )
}

/** Ancien partage « tout l'espace » (avant les groupes) : visible seulement s'il en reste, pour pouvoir le retirer. */
function LegacyAccess({ org, onDone }: { org: number; onDone: (text: string) => void }) {
  const data = useLoad(() => getPeople(org), [org])
  const people = (data.data?.people || []).filter(p => !p.you && !p.owner && (p.scope.all || p.role === 'admin'))
  if (!data.data?.can_manage || !people.length) return null
  const remove = async (email: string) => {
    if (!window.confirm(t('Retirer l’accès de {email} à tout l’espace ? Ses accès par groupe restent.', { email }))) return
    try { await removePerson(org, email); data.reload(); onDone(t('Accès retiré.')) } catch (e) { onDone((e as Error).message) }
  }
  return (
    <section className="card col" style={{ gap: 6 }} aria-labelledby={`t-legacy-${org}`}>
      <h2 id={`t-legacy-${org}`}>{t('Accès à tous les comptes')}{data.data.name ? ` · ${data.data.name}` : ''}</h2>
      <p className="small muted" style={{ margin: 0 }}>{t('Ancien partage, avant les groupes. Pour la suite, partagez plutôt un groupe.')}</p>
      <ul className="list">
        {people.map(p => (
          <li key={p.email}>
            <Avatar src={null} name={p.name || p.email} size="sm" />
            <span className="grow ellipsis small">{p.name || p.email}{p.pending && <span className="tiny muted"> · {t('invitation envoyée')}</span>}</span>
            <span className="tiny muted">{t(ROLE_NAME[p.role])}</span>
            <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => remove(p.email)}>{t('Retirer')}</button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function People() {
  const { groups, accounts, spaces, ownerOf, reloadGroups } = useSession()
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [sharing, setSharing] = useState<Group | null>(null)
  useEffect(() => { reloadGroups() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const isAdmin = (g: Group) => (spaces.find(s => s.org_id === (g.org_id ?? null))?.cm_role || 'admin') === 'admin'
  const mine = groups.filter(g => !ownerOf(g) && isAdmin(g))
  const withMe = groups.filter(g => !mine.includes(g))
  const roleIn = (g: Group) => {
    const rs = g.accounts.map(x => accounts.find(a => a.platform === x.platform && a.id === x.id)?.role).filter(Boolean) as CmRole[]
    return rs.includes('admin') ? 'admin' : rs.includes('editor') ? 'editor' : 'viewer'
  }
  const legacy = spaces.filter(s => s.org_id != null && s.cm_role === 'admin').map(s => s.org_id as number)
  const done = (text: string) => setMsg({ kind: 'ok', text })

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('Partage')}</h1>
          <p>{t('On partage un groupe de comptes :')} <b>{t('Admin')}</b>, <b>{t('Peut publier')}</b> {t('ou')} <b>{t('Lecture seule')}</b>. {t('Les groupes partagés avec vous s’ajoutent à « Tous ».')}</p>
        </div>
        <Link to="/comptes#groupes" className="btn"><Icon name="plus" />{t('Créer un groupe')}</Link>
      </div>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <Invitations onDone={done} />

      {(mine.length > 0 || !accounts.length || accounts.some(a => a.mine !== false)) && <section className="col" aria-labelledby="t-mine" style={{ gap: 10 }}>
        <h2 id="t-mine">{t('Mes groupes')}</h2>
        {!groups.length && !accounts.length && <Skeleton h={64} n={2} />}
        {mine.length === 0 && accounts.some(a => a.mine !== false) && (
          <Empty title={t('Aucun groupe à partager')} icon="users">
            <p style={{ margin: 0 }}>{t('Créez un groupe (ex. « Client A » = son TikTok + son Instagram) dans')} <Link to="/comptes#groupes">{t('Comptes')}</Link>{t(', puis partagez-le ici.')}</p>
          </Empty>
        )}
        {mine.length > 0 && (
          <ul className="list card">
            {mine.map(g => (
              <li key={g.id}>
                <GroupDot color={g.color} />
                <span className="grow col" style={{ minWidth: 0, gap: 0 }}>
                  <span className="strong ellipsis">{g.name}</span>
                  <span className="tiny muted">{g.accounts.length > 1 ? t('{n} comptes', { n: g.accounts.length }) : t('{n} compte', { n: g.accounts.length })}</span>
                </span>
                <button type="button" className="btn btn-sm" onClick={() => setSharing(g)}><Icon name="users" size={16} />{t('Partager')}</button>
              </li>
            ))}
          </ul>
        )}
      </section>}

      {withMe.length > 0 && (
        <section className="col" aria-labelledby="t-withme" style={{ gap: 10 }}>
          <h2 id="t-withme">{t('Partagés avec moi')}</h2>
          <ul className="list card">
            {withMe.map(g => (
              <li key={g.id}>
                <GroupDot color={g.color} />
                <span className="grow col" style={{ minWidth: 0, gap: 0 }}>
                  <span className="strong ellipsis">{g.name}</span>
                  <span className="tiny muted">{ownerOf(g) ? `${t('De {owner}', { owner: ownerOf(g) })} · ` : ''}{g.accounts.length > 1 ? t('{n} comptes', { n: g.accounts.length }) : t('{n} compte', { n: g.accounts.length })} · {t(ROLE_NAME[roleIn(g)])}</span>
                </span>
                {roleIn(g) === 'admin' && <button type="button" className="btn btn-sm" onClick={() => setSharing(g)}>{t('Partager')}</button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <PersoName onDone={done} />
      {legacy.map(o => <LegacyAccess key={o} org={o} onDone={done} />)}
      <p className="tiny muted" style={{ margin: 0 }}>{t('Un compte TikTok, YouTube ou Instagram reste à son propriétaire : quand quelqu’un part, ses accès s’arrêtent et les comptes restent. Pour confier un compte : Comptes → Transférer.')}</p>
      {sharing && <GroupShareSheet g={sharing} onClose={() => setSharing(null)} />}
    </>
  )
}
