// Comptes connectés (TikTok, YouTube, Instagram) : les miens et ceux des groupes partagés avec moi
// (avec leur propriétaire), et les groupes de comptes. Un groupe réunit plusieurs comptes, toutes
// plateformes ; un compte peut être dans plusieurs groupes. On partage un groupe, pas un compte seul.
// Chaque action se fait dans l'espace du compte (org_id), selon mon rôle sur ce compte.
import { useEffect, useState, type FormEvent } from 'react'
import { PlatformLogo } from '../components/PlatformLogo'
import { Link, useLocation } from 'react-router-dom'
import {
  acceptTransfer, addRoutineAccount, cancelTransfer, createGroup, declineTransfer, deleteGroup, disconnect, getAccounts,
  getTransfers, startOAuth, syncAccount, transferAccount, updateGroup,
  GROUP_COLORS, PLATFORM_LABEL, PLATFORMS, type Account, type Group, type GroupColor, type Platform,
  setYoutubeAccount, ALL,
} from '../api'
import { GroupShareSheet } from './People'
import { AccountPicker } from '../components/AccountPicker'
import { Avatar, GroupDot, Icon, Msg, Sheet, Skeleton } from '../components/ui'
import { fmtDateTime, short } from '../format'
import { useLoad, useRole, useSession } from '../session'
import { SearchBox, SortControl, useListState } from '../components/list'
import { accountState } from './Dashboard'
import { t } from '../i18n'

const HINT: Record<Platform, string> = {
  tiktok: "Pour connecter un autre compte, connectez-vous d'abord à ce compte sur tiktok.com dans ce navigateur.",
  youtube: "Pour une chaîne de marque, choisissez-la sur l'écran Google qui s'ouvre.",
  instagram: 'Compte professionnel (Créateur ou Entreprise) seulement.',
}
const COLOR_LABEL: Record<GroupColor, string> = { blue: 'Bleu', orange: 'Orange', green: 'Vert', purple: 'Violet', pink: 'Rose', teal: 'Turquoise', amber: 'Ambre', slate: 'Gris',
  red: 'Rouge', indigo: 'Indigo', cyan: 'Cyan', lime: 'Citron vert', rose: 'Framboise', sky: 'Ciel', emerald: 'Émeraude', brown: 'Marron' }
const akey = (p: Platform, id: number) => `${p}:${id}`

function GroupEditor({ group, accounts: everyone, onClose, onSaved }: { group: Group | null; accounts: Account[]; onClose: () => void; onSaved: (g: Group) => void }) {
  const { org: home } = useSession()
  // Un groupe réunit les comptes d'un même propriétaire (son espace).
  const org = group ? group.org_id ?? null : home
  const accounts = everyone.filter(a => (a.org_id ?? null) === org)
  const [name, setName] = useState(group?.name || '')
  const [color, setColor] = useState<GroupColor>(group?.color || GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)])
  const [picked, setPicked] = useState<string[]>(group ? group.accounts.map(a => akey(a.platform, a.id)) : [])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const toggle = (k: string) => setPicked(p => p.includes(k) ? p.filter(x => x !== k) : [...p, k])
  const save = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true)
    const body = { name: name.trim(), color, accounts: picked.map(k => { const [platform, id] = k.split(':'); return { platform: platform as Platform, account_id: Number(id) } }) }
    try { onSaved(group ? await updateGroup(org, group.id, body) : await createGroup(org, body)) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Sheet title={group ? t('Modifier le groupe') : t('Nouveau groupe')} onClose={onClose}>
      <form className="col" style={{ gap: 16 }} onSubmit={save}>
        <label className="field">{t('Nom')}
          <input className="input" value={name} onChange={e => setName(e.target.value)} maxLength={60} required autoFocus placeholder={t('Ex. Ghost Hands, Clients, Piano FR')} />
        </label>
        <fieldset>
          <legend>{t('Couleur')}</legend>
          <div className="row" style={{ gap: 6 }}>
            {GROUP_COLORS.map(c => (
              <button key={c} type="button" className="chip" aria-pressed={c === color} aria-label={t(COLOR_LABEL[c])} onClick={() => setColor(c)}
                      style={{ width: 40, padding: 0, justifyContent: 'center' }}><GroupDot color={c} /></button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>{t('Comptes du groupe')} <span className="muted" style={{ fontWeight: 400 }}>· {picked.length > 1 ? t('{n} choisis', { n: picked.length }) : t('{n} choisi', { n: picked.length })}</span></legend>
          {accounts.length === 0 ? <p className="muted small">{t('Connectez d’abord des comptes.')}</p> : (
            <AccountPicker mode="multi" accountsOnly accounts={accounts} groups={[]} picked={picked} onChange={setPicked} />
          )}
          <p className="field-hint" style={{ marginTop: 8 }}>{t('Un compte peut appartenir à plusieurs groupes.')}</p>
        </fieldset>
        {err && <Msg kind="err">{err}</Msg>}
        <div className="row-nw">
          <button type="button" className="btn grow" onClick={onClose}>{t('Annuler')}</button>
          <button className="btn btn-primary grow" disabled={busy || !name.trim()}>{group ? t('Enregistrer') : t('Créer le groupe')}</button>
        </div>
      </form>
    </Sheet>
  )
}

/** Transférer un compte : vers un autre de mes espaces (immédiat) ou une autre personne (à accepter). */
function TransferSheet({ a, onClose, onDone }: { a: Account; onClose: () => void; onDone: (text: string) => void }) {
  const { spaces } = useSession()
  const org = a.org_id ?? null
  const mine = spaces.filter(s => s.org_id !== org && (s.cm_role || 'admin') === 'admin')
  const [to, setTo] = useState<string>(mine.length ? String(mine[0].org_id ?? 'perso') : 'email')
  const [email, setEmail] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      const body = to === 'email' ? { to_email: email.trim() } : to === 'perso' ? { to_perso: true } : { to_org_id: Number(to) }
      const r = await transferAccount(org, a, body)
      const dest = spaces.find(s => String(s.org_id ?? 'perso') === to)?.name
      onDone(r.pending ? (r.message || t('Transfert proposé.'))
        : !r.moved_targets ? t('{account} est maintenant dans « {space} ».', { account: a.name, space: dest })
        : r.moved_targets > 1 ? t('{account} est maintenant dans « {space} », avec {n} publications à venir.', { account: a.name, space: dest, n: r.moved_targets })
        : t('{account} est maintenant dans « {space} », avec {n} publication à venir.', { account: a.name, space: dest, n: r.moved_targets }))
    } catch (ex) { setErr((ex as Error).message) } finally { setBusy(false) }
  }
  return (
    <Sheet title={t('Transférer {account}', { account: a.name })} onClose={onClose}>
      <form className="col" style={{ gap: 14 }} onSubmit={submit}>
        <p className="small muted" style={{ margin: 0 }}>{t('Le compte part avec son planning à venir, ses chiffres et ses vidéos. Les publications déjà parties restent dans l’historique de cet espace.')}</p>
        <fieldset className="col" style={{ gap: 6 }}>
          <legend>{t('Vers')}</legend>
          {mine.map(sp => (
            <label key={sp.org_id ?? 'perso'} className="check"><input type="radio" name="to" checked={to === String(sp.org_id ?? 'perso')} onChange={() => setTo(String(sp.org_id ?? 'perso'))} />{sp.name}</label>
          ))}
          <label className="check"><input type="radio" name="to" checked={to === 'email'} onChange={() => setTo('email')} />{t('Une autre personne')}</label>
        </fieldset>
        {to === 'email' && (
          <label className="field">{t('Son adresse e-mail Chapote')}
            <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
            <span className="field-hint">{t('Elle devra accepter le transfert dans cm (14 jours). Rien ne change d’ici là.')}</span>
          </label>
        )}
        {err && <Msg kind="err">{err}</Msg>}
        <div className="row-nw">
          <button type="button" className="btn grow" onClick={onClose}>{t('Annuler')}</button>
          <button className="btn btn-primary grow" disabled={busy || (to === 'email' && !email.trim())}>{to === 'email' ? t('Proposer le transfert') : t('Transférer')}</button>
        </div>
      </form>
    </Sheet>
  )
}

/** Transferts reçus (à accepter dans un de mes espaces) et envoyés (en attente). */
function Transfers({ onChanged }: { onChanged: (text: string) => void }) {
  const { spaces } = useSession()
  const data = useLoad(() => getTransfers(), [])
  const adminSpaces = spaces.filter(s => (s.cm_role || 'admin') === 'admin')
  const [dest, setDest] = useState<Record<number, string>>({})
  const [err, setErr] = useState('')
  const act = async (fn: () => Promise<unknown>, text: string) => {
    setErr('')
    try { await fn(); data.reload(); onChanged(text) } catch (e) { setErr((e as Error).message) }
  }
  const d = data.data
  if (!d || (!d.incoming.length && !d.outgoing.length)) return null
  return (
    <section className="card col" style={{ gap: 10 }} aria-label={t('Transferts de comptes')}>
      {d.incoming.map(tr => (
        <div key={tr.id} className="row" style={{ gap: 10 }}>
          <span className="grow small"><b>{tr.from || t('Quelqu’un')}</b> {t('vous transfère')} <b>{tr.account_name}</b> ({PLATFORM_LABEL[tr.platform]}).</span>
          {adminSpaces.length > 1 && (
            <select className="input select-sm" style={{ width: 'auto' }} aria-label={t('Espace d’arrivée')} value={dest[tr.id] ?? 'perso'}
                    onChange={e => setDest(x => ({ ...x, [tr.id]: e.target.value }))}>
              {adminSpaces.map(sp => <option key={sp.org_id ?? 'perso'} value={sp.org_id ?? 'perso'}>{sp.name}</option>)}
            </select>
          )}
          <button type="button" className="btn btn-sm btn-primary" onClick={() => act(() => acceptTransfer(tr.id, (dest[tr.id] ?? 'perso') === 'perso' ? null : Number(dest[tr.id])), t('{account} a rejoint votre espace.', { account: tr.account_name }))}>{t('Accepter')}</button>
          <button type="button" className="btn btn-sm" onClick={() => act(() => declineTransfer(tr.id), t('Transfert refusé.'))}>{t('Refuser')}</button>
        </div>
      ))}
      {d.outgoing.map(tr => (
        <div key={tr.id} className="row" style={{ gap: 10 }}>
          <span className="grow small muted">{t('En attente :')} <b>{tr.account_name}</b> {t('proposé à {email}.', { email: tr.to_email })}</span>
          <button type="button" className="btn btn-sm" onClick={() => act(() => cancelTransfer(tr.id), t('Transfert annulé.'))}>{t('Annuler')}</button>
        </div>
      ))}
      {err && <Msg kind="err">{err}</Msg>}
    </section>
  )
}

export default function Accounts() {
  const { org, config, groups, reloadGroups, picked, toggleGroup, spaces, ownerOf } = useSession()
  const loc = useLocation()
  const accounts = useLoad(() => getAccounts(ALL), ['all'])
  type ASort = 'name' | 'followers' | 'views' | 'connected'
  const lst = useListState<ASort>('connected', v => (v === 'name' || v === 'connected' ? 'asc' : 'desc'))
  const filtered = lst.q || lst.sort !== 'connected' || lst.order !== 'asc'
  const shown = useLoad(() => (filtered ? getAccounts(ALL, { q: lst.q || undefined, sort: lst.sort, order: lst.order }) : Promise.resolve(null)),
                        [lst.q, lst.sort, lst.order])
  const [msg, setMsg] = useState<{ kind: 'err' | 'ok' | 'info'; text: string } | null>(
    (loc.state as { flash?: string } | null)?.flash ? { kind: 'ok', text: (loc.state as { flash: string }).flash } : null)
  const [routineName, setRoutineName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<Group | 'new' | null>(null)
  const [transferring, setTransferring] = useState<Account | null>(null)
  const [sharing, setSharing] = useState<Group | null>(null)
  const { canAdmin } = useRole()
  // Droits : sur un compte, mon rôle sur lui ; sur un groupe, mon rôle dans l'espace de son propriétaire.
  const adminOf = (a: Account) => (a.role || 'admin') === 'admin' && a.mine !== false
  const groupAdmin = (g: Group) => (spaces.find(s => s.org_id === (g.org_id ?? null))?.cm_role || 'admin') === 'admin'

  useEffect(() => {
    if (loc.hash === '#groupes') document.getElementById('groupes')?.scrollIntoView({ block: 'start' })
  }, [loc.hash])

  const all = accounts.data || []
  const byKey = new Map(all.map(a => [akey(a.platform, a.id), a]))
  const groupsOf = (a: Account) => groups.filter(g => g.accounts.some(x => x.platform === a.platform && x.id === a.id))
  const enabled = (p: Platform) => (p === 'tiktok' ? config?.tiktok : p === 'youtube' ? config?.youtube : config?.instagram_api) ?? false
  const connect = async (p: Platform, where: number | null = org) => {
    setBusy(p); setMsg(null)
    try { window.location.assign((await startOAuth(p, where)).authorize_url) }
    catch (e) { setMsg({ kind: 'err', text: (e as Error).message }); setBusy(null) }
  }
  const run = async (id: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(id); setMsg(null)
    try {
      const r = await fn() as { warning?: string | null } | undefined
      setMsg(r && typeof r === 'object' && 'warning' in r && r.warning ? { kind: 'info', text: r.warning } : ok ? { kind: 'ok', text: ok } : null)
      accounts.reload(); reloadGroups()
    } catch (e) { setMsg({ kind: 'err', text: (e as Error).message }) } finally { setBusy(null) }
  }
  const addRoutine = (e: FormEvent) => {
    e.preventDefault()
    if (!routineName.trim()) return
    run('routine', () => addRoutineAccount(org, routineName), t('Compte ajouté : la routine publiera les Reels programmés et enverra les chiffres.'))
      .then(() => setRoutineName(''))
  }
  const removeGroup = (g: Group) => {
    if (!window.confirm(t('Supprimer le groupe « {group} » ? Les comptes restent connectés.', { group: g.name }))) return
    run(`g${g.id}`, async () => { await deleteGroup(g.org_id ?? null, g.id); if (picked.includes(g.id)) toggleGroup(g.id) }, t('Groupe supprimé.'))
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('Comptes')}</h1>
          <p>{t('Vos comptes, et ceux des groupes partagés avec vous (avec le nom de leur propriétaire).')}</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link to="/partage" className="btn"><Icon name="users" />{t('Partage')}</Link>
          <Link to="/bibliotheque" className="btn"><Icon name="layers" />{t('Bibliothèque Google Drive')}</Link>
        </div>
      </div>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <Transfers onChanged={text => { setMsg({ kind: 'ok', text }); accounts.reload(); reloadGroups() }} />
      {accounts.error && <Msg kind="err">{accounts.error}</Msg>}

      <section id="groupes" className="col" aria-labelledby="t-groupes" style={{ scrollMarginTop: 80 }}>
        <div className="card-head">
          <div>
            <h2 id="t-groupes">{t('Groupes')}</h2>
            <p className="small muted" style={{ marginTop: 2 }}>{t('Par artiste, client, langue… Filtrez l’accueil, le planning et les stats, publiez sur un groupe en un geste, et partagez-le.')}</p>
          </div>
          {canAdmin && <button type="button" className="btn btn-sm" onClick={() => setEditing('new')}><Icon name="plus" size={16} />{t('Nouveau groupe')}</button>}
        </div>
        {groups.length === 0 ? (
          <button type="button" className="card empty" style={{ cursor: 'pointer', borderStyle: 'dashed', width: '100%', color: 'var(--text)' }} onClick={() => setEditing('new')}>
            <span className="empty-ico"><Icon name="layers" size={24} /></span>
            <span className="strong">{t('Créer un premier groupe')}</span>
            <span className="small muted">{t('Ex. « Ghost Hands » = TikTok + YouTube + Instagram de l’artiste.')}</span>
          </button>
        ) : (
          <div className="grid-3">
            {groups.map(g => {
              const members = g.accounts.map(x => byKey.get(akey(x.platform, x.id))).filter(Boolean) as Account[]
              const followers = members.reduce((s, a) => s + (a.stats?.followers || 0), 0)
              const admin = groupAdmin(g)
              const owner = ownerOf(g)
              return (
                <article key={g.id} className="card col" style={{ gap: 12 }}>
                  <div className="row-nw">
                    <GroupDot color={g.color} />
                    <h3 className="grow ellipsis">{g.name}{owner && <span className="tiny muted" style={{ fontWeight: 400 }}> · {t('de {owner}', { owner })}</span>}</h3>
                    {admin && <button type="button" className="btn btn-sm" onClick={() => setSharing(g)}>{t('Partager')}</button>}
                    {admin && !owner && <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={t('Modifier {group}', { group: g.name })} onClick={() => setEditing(g)}><Icon name="edit" size={16} /></button>}
                    {admin && !owner && <button type="button" className="btn btn-ghost icon-btn btn-sm btn-danger" aria-label={t('Supprimer {group}', { group: g.name })} disabled={busy === `g${g.id}`} onClick={() => removeGroup(g)}><Icon name="trash" size={16} /></button>}
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    {members.length === 0 ? <span className="small muted">{t('Aucun compte')}</span>
                      : members.map(a => <Avatar key={akey(a.platform, a.id)} src={a.avatar_url} name={a.name} platform={a.platform} size="sm" />)}
                  </div>
                  <div className="row between small">
                    <span className="muted">{members.length > 1 ? t('{n} comptes', { n: members.length }) : t('{n} compte', { n: members.length })}{followers ? ` · ${t('{n} abonnés', { n: short(followers) })}` : ''}</span>
                    <button type="button" className="btn btn-sm btn-ghost" aria-pressed={picked.includes(g.id)} onClick={() => toggleGroup(g.id)}>
                      {picked.includes(g.id) ? <><Icon name="check" size={16} />{t('Affiché')}</> : t('Afficher')}
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      {all.length > 4 && (
        <div className="listbar">
          <SearchBox value={lst.input} onChange={lst.setInput} label={t('Rechercher un compte')} />
          <span className="sortctl"><SortControl list={lst} options={[['connected', t('Date de connexion')], ['name', t('Nom')], ['followers', t('Abonnés')], ['views', t('Vues')]]} /></span>
        </div>
      )}
      {!accounts.data && accounts.loading && <Skeleton h={120} n={3} />}
      {accounts.data && PLATFORMS.map(p => {
        const list = ((filtered && shown.data) || all).filter(a => a.platform === p)
        if (filtered && lst.q && !list.length) return null
        return (
          <section key={p} className="card col" aria-labelledby={`t-${p}`}>
            <div className="card-head">
              <h2 id={`t-${p}`} className="row-nw" style={{ gap: 10 }}><PlatformLogo platform={p} size={22} />{PLATFORM_LABEL[p]}</h2>
              {!canAdmin ? null : enabled(p) ? (
                <button type="button" className="btn btn-sm" disabled={busy === p} onClick={() => connect(p)}>
                  <Icon name="plus" size={16} />{list.length ? t('Autre compte') : t('Connecter')}
                </button>
              ) : <span className="muted small">{p === 'instagram' ? t('Connexion officielle bientôt (validation Meta)') : t('Module indisponible')}</span>}
            </div>
            {list.length === 0 && <p className="muted small">{t('Aucun compte.')} {enabled(p) && t(HINT[p])}</p>}
            {list.length > 0 && (
              <ul className="list">
                {list.map(a => <AccountRow key={a.id} a={a} groups={groupsOf(a)} busy={busy} canAdmin={adminOf(a)} owner={ownerOf(a)}
                  onTransfer={() => setTransferring(a)}
                  onSync={() => run(`s${p}${a.id}`, () => syncAccount(a.org_id ?? null, a), t('Chiffres actualisés.'))}
                  onRemove={() => { if (window.confirm(t('Déconnecter {account} ? Les publications à venir sur ce compte ne partiront plus.', { account: a.name }))) run(`d${p}${a.id}`, () => disconnect(a.org_id ?? null, a)) }}
                  onReconnect={() => connect(p, a.org_id ?? null)}
                  onPublicDomain={v => run(`p${p}${a.id}`, () => setYoutubeAccount(a.org_id ?? null, a.id, { public_domain_only: v }),
                    v ? t('Cette chaîne n’accepte plus que des œuvres du domaine public.') : t('Réglage « domaine public seulement » retiré.'))} />)}
              </ul>
            )}
            {p === 'instagram' && canAdmin && (
              <form onSubmit={addRoutine} className="row" style={{ borderTop: '1px solid var(--border)', paddingTop: 14, alignItems: 'flex-end' }}>
                <label className="field grow" style={{ flex: '1 1 240px' }}>{t('Compte géré par la routine Claude')}
                  <input className="input" value={routineName} onChange={e => setRoutineName(e.target.value)} placeholder={t('@nom.du.compte')} autoCapitalize="none" />
                  <span className="field-hint">{t('Sans connexion officielle : la routine publie les Reels programmés et envoie les chiffres.')}</span>
                </label>
                <button className="btn" disabled={busy === 'routine' || !routineName.trim()}>{t('Ajouter')}</button>
              </form>
            )}
          </section>
        )
      })}
      {config && !config.tiktok_stats && (
        <p className="muted small">{t("Statistiques TikTok : elles s'afficheront après la validation de l'accès aux chiffres par TikTok, puis une reconnexion des comptes.")}</p>
      )}
      {transferring && (
        <TransferSheet a={transferring} onClose={() => setTransferring(null)}
                       onDone={text => { setTransferring(null); setMsg({ kind: 'ok', text }); accounts.reload(); reloadGroups() }} />
      )}
      {sharing && <GroupShareSheet g={sharing} onClose={() => setSharing(null)} />}
      {editing && (
        <GroupEditor group={editing === 'new' ? null : editing} accounts={all} onClose={() => setEditing(null)}
                     onSaved={g => { setEditing(null); reloadGroups(); setMsg({ kind: 'ok', text: t('Groupe « {group} » enregistré.', { group: g.name }) }) }} />
      )}
    </>
  )
}

function AccountRow({ a, groups, busy, canAdmin, owner, onSync, onRemove, onReconnect, onTransfer, onPublicDomain }:
  { a: Account; groups: Group[]; busy: string | null; canAdmin: boolean; owner: string | null; onSync: () => void; onRemove: () => void; onReconnect: () => void; onTransfer: () => void; onPublicDomain: (v: boolean) => void }) {
  const st = accountState(a)
  return (
    <li style={{ flexWrap: 'wrap' }}>
      <Avatar src={a.avatar_url} name={a.name} platform={a.platform} />
      <div className="grow" style={{ flex: '1 1 180px' }}>
        <div className="strong ellipsis">{a.name}</div>
        <div className="tiny muted">
          {owner && <span>{t('De {owner}', { owner })} · {a.role === 'viewer' ? t('Lecture seule') : a.role === 'editor' ? t('Peut publier') : t('Admin')} · </span>}
          <span className={`status-${st.tone}`}>{t(st.label)}</span>
          {a.stats?.updated_at && ` · ${t('chiffres du {date}', { date: fmtDateTime(a.stats.updated_at) })}`}
          {a.stats?.error && <> · <span className="status-warn">{a.stats.error}</span></>}
        </div>
        {a.platform === 'youtube' && (
          <label className={`check tiny${canAdmin ? '' : ' disabled'}`} style={{ marginTop: 6 }}>
            <input type="checkbox" checked={!!a.public_domain_only} disabled={!canAdmin || busy === `p${a.platform}${a.id}`}
                   onChange={e => onPublicDomain(e.target.checked)} />
            <span>{t('Domaine public seulement')} <span className="muted">{t('(refuse les œuvres protégées ou aux droits inconnus)')}</span></span>
          </label>
        )}
        {groups.length > 0 && (
          <div className="row" style={{ gap: 4, marginTop: 6 }}>
            {groups.map(g => <span key={g.id} className="chip chip-sm"><GroupDot color={g.color} />{g.name}</span>)}
          </div>
        )}
      </div>
      {a.stats_available && a.stats && (
        <div className="metrics" style={{ fontSize: 13 }}>
          <span><b>{short(a.stats.followers)}</b> {t('abonnés')}</span>
          <span><b>{short(a.stats.views)}</b> {t('vues')}</span>
        </div>
      )}
      <div className="row" style={{ gap: 6 }}>
        {a.needs_reconnect && canAdmin && <button type="button" className="btn btn-sm btn-primary" onClick={onReconnect}>{t('Reconnecter')}</button>}
        {a.stats_available && a.mode !== 'routine' && !a.needs_reconnect && (
          <button type="button" className="btn btn-sm" onClick={onSync} disabled={busy === `s${a.platform}${a.id}`} aria-label={t('Actualiser les chiffres de {account}', { account: a.name })}><Icon name="refresh" size={16} /><span className="only-desktop">{t('Actualiser')}</span></button>
        )}
        {canAdmin && <button type="button" className="btn btn-sm" onClick={onTransfer}>{t('Transférer')}</button>}
        {canAdmin && (
          <button type="button" className="btn btn-sm btn-danger" onClick={onRemove} disabled={busy === `d${a.platform}${a.id}`}>
            {a.mode === 'routine' ? t('Retirer') : t('Déconnecter')}
          </button>
        )}
      </div>
    </li>
  )
}
