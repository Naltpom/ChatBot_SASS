// Comptes connectés (TikTok, YouTube, Instagram) et groupes de comptes de l'espace courant.
// Un groupe réunit plusieurs comptes, toutes plateformes ; un compte peut être dans plusieurs groupes.
import { useEffect, useState, type FormEvent } from 'react'
import type { ShareWhat } from '../api'
import { PlatformLogo } from '../components/PlatformLogo'
import { Link, useLocation } from 'react-router-dom'
import {
  acceptTransfer, addRoutineAccount, cancelTransfer, createGroup, declineTransfer, deleteGroup, disconnect, getAccounts,
  getTransfers, startOAuth, syncAccount, transferAccount, updateGroup,
  GROUP_COLORS, PLATFORM_LABEL, PLATFORMS, type Account, type Group, type GroupColor, type Platform,
} from '../api'
import { ShareSheet } from '../components/ShareSheet'
import { Avatar, GroupDot, Icon, Msg, Sheet, Skeleton } from '../components/ui'
import { fmtDateTime, short } from '../format'
import { useLoad, useRole, useSession } from '../session'
import { SearchBox, SortControl, useListState } from '../components/list'
import { accountState } from './Dashboard'

const HINT: Record<Platform, string> = {
  tiktok: "Pour connecter un autre compte, connectez-vous d'abord à ce compte sur tiktok.com dans ce navigateur.",
  youtube: "Pour une chaîne de marque, choisissez-la sur l'écran Google qui s'ouvre.",
  instagram: 'Compte professionnel (Créateur ou Entreprise) seulement.',
}
const COLOR_LABEL: Record<GroupColor, string> = { blue: 'Bleu', orange: 'Orange', green: 'Vert', purple: 'Violet', pink: 'Rose', teal: 'Turquoise', amber: 'Ambre', slate: 'Gris' }
const akey = (p: Platform, id: number) => `${p}:${id}`

function GroupEditor({ group, accounts, onClose, onSaved }: { group: Group | null; accounts: Account[]; onClose: () => void; onSaved: (g: Group) => void }) {
  const { org } = useSession()
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
    <Sheet title={group ? 'Modifier le groupe' : 'Nouveau groupe'} onClose={onClose}>
      <form className="col" style={{ gap: 16 }} onSubmit={save}>
        <label className="field">Nom
          <input className="input" value={name} onChange={e => setName(e.target.value)} maxLength={60} required autoFocus placeholder="Ex. Ghost Hands, Clients, Piano FR" />
        </label>
        <fieldset>
          <legend>Couleur</legend>
          <div className="row" style={{ gap: 8 }}>
            {GROUP_COLORS.map(c => (
              <button key={c} type="button" className="chip" aria-pressed={c === color} aria-label={COLOR_LABEL[c]} onClick={() => setColor(c)}
                      style={{ width: 40, padding: 0, justifyContent: 'center' }}><GroupDot color={c} /></button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Comptes du groupe <span className="muted" style={{ fontWeight: 400 }}>· {picked.length} choisi{picked.length > 1 ? 's' : ''}</span></legend>
          {accounts.length === 0 ? <p className="muted small">Connectez d’abord des comptes.</p> : (
            <div className="picks" style={{ gridTemplateColumns: '1fr' }}>
              {accounts.map(a => {
                const k = akey(a.platform, a.id), on = picked.includes(k)
                return (
                  <label key={k} className={`pick${on ? ' on' : ''}`}>
                    <input type="checkbox" checked={on} onChange={() => toggle(k)} />
                    <Avatar src={a.avatar_url} name={a.name} platform={a.platform} />
                    <span className="grow"><span className="ellipsis strong" style={{ display: 'block' }}>{a.name}</span><span className="tiny muted row-nw" style={{ gap: 4 }}><PlatformLogo platform={a.platform} size={12} />{PLATFORM_LABEL[a.platform]}</span></span>
                  </label>
                )
              })}
            </div>
          )}
          <p className="field-hint" style={{ marginTop: 8 }}>Un compte peut appartenir à plusieurs groupes.</p>
        </fieldset>
        {err && <Msg kind="err">{err}</Msg>}
        <div className="row-nw">
          <button type="button" className="btn grow" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary grow" disabled={busy || !name.trim()}>{group ? 'Enregistrer' : 'Créer le groupe'}</button>
        </div>
      </form>
    </Sheet>
  )
}

/** Transférer un compte : vers un autre de mes espaces (immédiat) ou une autre personne (à accepter). */
function TransferSheet({ a, onClose, onDone }: { a: Account; onClose: () => void; onDone: (text: string) => void }) {
  const { org, spaces } = useSession()
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
      onDone(r.pending ? (r.message || 'Transfert proposé.') : `${a.name} est maintenant dans « ${dest} »${r.moved_targets ? `, avec ${r.moved_targets} publication${r.moved_targets > 1 ? 's' : ''} à venir` : ''}.`)
    } catch (ex) { setErr((ex as Error).message) } finally { setBusy(false) }
  }
  return (
    <Sheet title={`Transférer ${a.name}`} onClose={onClose}>
      <form className="col" style={{ gap: 14 }} onSubmit={submit}>
        <p className="small muted" style={{ margin: 0 }}>Le compte part avec son planning à venir, ses chiffres et ses vidéos. Les publications déjà parties restent dans l’historique de cet espace.</p>
        <fieldset className="col" style={{ gap: 6 }}>
          <legend>Vers</legend>
          {mine.map(sp => (
            <label key={sp.org_id ?? 'perso'} className="check"><input type="radio" name="to" checked={to === String(sp.org_id ?? 'perso')} onChange={() => setTo(String(sp.org_id ?? 'perso'))} />{sp.name}</label>
          ))}
          <label className="check"><input type="radio" name="to" checked={to === 'email'} onChange={() => setTo('email')} />Une autre personne</label>
        </fieldset>
        {to === 'email' && (
          <label className="field">Son adresse e-mail Chapote
            <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
            <span className="field-hint">Elle devra accepter le transfert dans cm (14 jours). Rien ne change d’ici là.</span>
          </label>
        )}
        {err && <Msg kind="err">{err}</Msg>}
        <div className="row-nw">
          <button type="button" className="btn grow" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary grow" disabled={busy || (to === 'email' && !email.trim())}>{to === 'email' ? 'Proposer le transfert' : 'Transférer'}</button>
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
    <section className="card col" style={{ gap: 10 }} aria-label="Transferts de comptes">
      {d.incoming.map(t => (
        <div key={t.id} className="row" style={{ gap: 10 }}>
          <span className="grow small"><b>{t.from || 'Quelqu’un'}</b> vous transfère <b>{t.account_name}</b> ({PLATFORM_LABEL[t.platform]}).</span>
          {adminSpaces.length > 1 && (
            <select className="input select-sm" style={{ width: 'auto' }} aria-label="Espace d’arrivée" value={dest[t.id] ?? 'perso'}
                    onChange={e => setDest(x => ({ ...x, [t.id]: e.target.value }))}>
              {adminSpaces.map(sp => <option key={sp.org_id ?? 'perso'} value={sp.org_id ?? 'perso'}>{sp.name}</option>)}
            </select>
          )}
          <button type="button" className="btn btn-sm btn-primary" onClick={() => act(() => acceptTransfer(t.id, (dest[t.id] ?? 'perso') === 'perso' ? null : Number(dest[t.id])), `${t.account_name} a rejoint votre espace.`)}>Accepter</button>
          <button type="button" className="btn btn-sm" onClick={() => act(() => declineTransfer(t.id), 'Transfert refusé.')}>Refuser</button>
        </div>
      ))}
      {d.outgoing.map(t => (
        <div key={t.id} className="row" style={{ gap: 10 }}>
          <span className="grow small muted">En attente : <b>{t.account_name}</b> proposé à {t.to_email}.</span>
          <button type="button" className="btn btn-sm" onClick={() => act(() => cancelTransfer(t.id), 'Transfert annulé.')}>Annuler</button>
        </div>
      ))}
      {err && <Msg kind="err">{err}</Msg>}
    </section>
  )
}

export default function Accounts() {
  const { org, config, groups, reloadGroups, group: current, setGroup } = useSession()
  const loc = useLocation()
  const accounts = useLoad(s => getAccounts(s.org))
  type ASort = 'name' | 'followers' | 'views' | 'connected'
  const lst = useListState<ASort>('connected', v => (v === 'name' || v === 'connected' ? 'asc' : 'desc'))
  const filtered = lst.q || lst.sort !== 'connected' || lst.order !== 'asc'
  const shown = useLoad(s => (filtered ? getAccounts(s.org, { q: lst.q || undefined, sort: lst.sort, order: lst.order }) : Promise.resolve(null)),
                        [lst.q, lst.sort, lst.order])
  const [msg, setMsg] = useState<{ kind: 'err' | 'ok' | 'info'; text: string } | null>(
    (loc.state as { flash?: string } | null)?.flash ? { kind: 'ok', text: (loc.state as { flash: string }).flash } : null)
  const [routineName, setRoutineName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<Group | 'new' | null>(null)
  const [transferring, setTransferring] = useState<Account | null>(null)
  const [sharing, setSharing] = useState<{ what: ShareWhat; label: string } | null>(null)
  const { canAdmin, role } = useRole()

  useEffect(() => {
    if (loc.hash === '#groupes') document.getElementById('groupes')?.scrollIntoView({ block: 'start' })
  }, [loc.hash])

  const all = accounts.data || []
  const byKey = new Map(all.map(a => [akey(a.platform, a.id), a]))
  const groupsOf = (a: Account) => groups.filter(g => g.accounts.some(x => x.platform === a.platform && x.id === a.id))
  const enabled = (p: Platform) => (p === 'tiktok' ? config?.tiktok : p === 'youtube' ? config?.youtube : config?.instagram_api) ?? false
  const connect = async (p: Platform) => {
    setBusy(p); setMsg(null)
    try { window.location.assign((await startOAuth(p, org)).authorize_url) }
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
    run('routine', () => addRoutineAccount(org, routineName), 'Compte ajouté : la routine publiera les Reels programmés et enverra les chiffres.')
      .then(() => setRoutineName(''))
  }
  const removeGroup = (g: Group) => {
    if (!window.confirm(`Supprimer le groupe « ${g.name} » ? Les comptes restent connectés.`)) return
    run(`g${g.id}`, async () => { await deleteGroup(org, g.id); if (current?.id === g.id) setGroup(null) }, 'Groupe supprimé.')
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Comptes</h1>
          <p>Les comptes et les groupes de cet espace ne sont visibles que dans cet espace.</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link to="/personnes" className="btn"><Icon name="users" />Personnes</Link>
          <Link to="/bibliotheque" className="btn"><Icon name="layers" />Bibliothèque Google Drive</Link>
        </div>
      </div>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      {!canAdmin && <Msg>Votre rôle dans cette équipe ({role === 'viewer' ? 'lecteur' : 'éditeur'}) ne permet pas de connecter, retirer ou transférer des comptes.</Msg>}
      <Transfers onChanged={t => { setMsg({ kind: 'ok', text: t }); accounts.reload(); reloadGroups() }} />
      {accounts.error && <Msg kind="err">{accounts.error}</Msg>}

      <section id="groupes" className="col" aria-labelledby="t-groupes" style={{ scrollMarginTop: 80 }}>
        <div className="card-head">
          <div>
            <h2 id="t-groupes">Groupes</h2>
            <p className="small muted" style={{ marginTop: 2 }}>Par artiste, client, langue… Filtrez l’accueil, le planning et les stats, et publiez sur un groupe en un geste.</p>
          </div>
          {canAdmin && <button type="button" className="btn btn-sm" onClick={() => setEditing('new')}><Icon name="plus" size={16} />Nouveau groupe</button>}
        </div>
        {groups.length === 0 ? (
          <button type="button" className="card empty" style={{ cursor: 'pointer', borderStyle: 'dashed', width: '100%', color: 'var(--text)' }} onClick={() => setEditing('new')}>
            <span className="empty-ico"><Icon name="layers" size={24} /></span>
            <span className="strong">Créer un premier groupe</span>
            <span className="small muted">Ex. « Ghost Hands » = TikTok + YouTube + Instagram de l’artiste.</span>
          </button>
        ) : (
          <div className="grid-3">
            {groups.map(g => {
              const members = g.accounts.map(x => byKey.get(akey(x.platform, x.id))).filter(Boolean) as Account[]
              const followers = members.reduce((s, a) => s + (a.stats?.followers || 0), 0)
              return (
                <article key={g.id} className="card col" style={{ gap: 12 }}>
                  <div className="row-nw">
                    <GroupDot color={g.color} />
                    <h3 className="grow ellipsis">{g.name}</h3>
                    {canAdmin && <button type="button" className="btn btn-sm" onClick={() => setSharing({ what: { group_id: g.id }, label: `le groupe « ${g.name} »` })}>Partager</button>}
                    {canAdmin && <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={`Modifier ${g.name}`} onClick={() => setEditing(g)}><Icon name="edit" size={16} /></button>}
                    {canAdmin && <button type="button" className="btn btn-ghost icon-btn btn-sm btn-danger" aria-label={`Supprimer ${g.name}`} disabled={busy === `g${g.id}`} onClick={() => removeGroup(g)}><Icon name="trash" size={16} /></button>}
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    {members.length === 0 ? <span className="small muted">Aucun compte</span>
                      : members.map(a => <Avatar key={akey(a.platform, a.id)} src={a.avatar_url} name={a.name} platform={a.platform} size="sm" />)}
                  </div>
                  <div className="row between small">
                    <span className="muted">{members.length} compte{members.length > 1 ? 's' : ''}{followers ? ` · ${short(followers)} abonnés` : ''}</span>
                    <button type="button" className="btn btn-sm btn-ghost" aria-pressed={current?.id === g.id} onClick={() => setGroup(current?.id === g.id ? null : g.id)}>
                      {current?.id === g.id ? <><Icon name="check" size={16} />Affiché</> : 'Afficher'}
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
          <SearchBox value={lst.input} onChange={lst.setInput} label="Rechercher un compte" />
          <span className="sortctl"><SortControl list={lst} options={[['connected', 'Date de connexion'], ['name', 'Nom'], ['followers', 'Abonnés'], ['views', 'Vues']]} /></span>
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
                  <Icon name="plus" size={16} />{list.length ? 'Autre compte' : 'Connecter'}
                </button>
              ) : <span className="muted small">{p === 'instagram' ? 'Connexion officielle bientôt (validation Meta)' : 'Module indisponible'}</span>}
            </div>
            {list.length === 0 && <p className="muted small">Aucun compte. {enabled(p) && HINT[p]}</p>}
            {list.length > 0 && (
              <ul className="list">
                {list.map(a => <AccountRow key={a.id} a={a} groups={groupsOf(a)} busy={busy} canAdmin={canAdmin}
                  onTransfer={() => setTransferring(a)}
                  onShare={() => setSharing({ what: { platform: a.platform, account_id: a.id }, label: a.name || PLATFORM_LABEL[a.platform] })}
                  onSync={() => run(`s${p}${a.id}`, () => syncAccount(org, a), 'Chiffres actualisés.')}
                  onRemove={() => { if (window.confirm(`Déconnecter ${a.name} ? Les publications à venir sur ce compte ne partiront plus.`)) run(`d${p}${a.id}`, () => disconnect(org, a)) }}
                  onReconnect={() => connect(p)} />)}
              </ul>
            )}
            {p === 'instagram' && canAdmin && (
              <form onSubmit={addRoutine} className="row" style={{ borderTop: '1px solid var(--border)', paddingTop: 14, alignItems: 'flex-end' }}>
                <label className="field grow" style={{ flex: '1 1 240px' }}>Compte géré par la routine Claude
                  <input className="input" value={routineName} onChange={e => setRoutineName(e.target.value)} placeholder="@nom.du.compte" autoCapitalize="none" />
                  <span className="field-hint">Sans connexion officielle : la routine publie les Reels programmés et envoie les chiffres.</span>
                </label>
                <button className="btn" disabled={busy === 'routine' || !routineName.trim()}>Ajouter</button>
              </form>
            )}
          </section>
        )
      })}
      {config && !config.tiktok_stats && (
        <p className="muted small">Statistiques TikTok : elles s'afficheront après la validation de l'accès aux chiffres par TikTok, puis une reconnexion des comptes.</p>
      )}
      {transferring && (
        <TransferSheet a={transferring} onClose={() => setTransferring(null)}
                       onDone={t => { setTransferring(null); setMsg({ kind: 'ok', text: t }); accounts.reload(); reloadGroups() }} />
      )}
      {sharing && <ShareSheet what={sharing.what} label={sharing.label} onClose={() => setSharing(null)} />}
      {editing && (
        <GroupEditor group={editing === 'new' ? null : editing} accounts={all} onClose={() => setEditing(null)}
                     onSaved={g => { setEditing(null); reloadGroups(); setMsg({ kind: 'ok', text: `Groupe « ${g.name} » enregistré.` }) }} />
      )}
    </>
  )
}

function AccountRow({ a, groups, busy, canAdmin, onSync, onRemove, onReconnect, onTransfer, onShare }:
  { a: Account; groups: Group[]; busy: string | null; canAdmin: boolean; onSync: () => void; onRemove: () => void; onReconnect: () => void; onTransfer: () => void; onShare: () => void }) {
  const st = accountState(a)
  return (
    <li style={{ flexWrap: 'wrap' }}>
      <Avatar src={a.avatar_url} name={a.name} platform={a.platform} />
      <div className="grow" style={{ flex: '1 1 180px' }}>
        <div className="strong ellipsis">{a.name}</div>
        <div className="tiny muted">
          <span className={`status-${st.tone}`}>{st.label}</span>
          {a.stats?.updated_at && ` · chiffres du ${fmtDateTime(a.stats.updated_at)}`}
          {a.stats?.error && <> · <span className="status-warn">{a.stats.error}</span></>}
        </div>
        {groups.length > 0 && (
          <div className="row" style={{ gap: 4, marginTop: 6 }}>
            {groups.map(g => <span key={g.id} className="chip chip-sm"><GroupDot color={g.color} />{g.name}</span>)}
          </div>
        )}
      </div>
      {a.stats_available && a.stats && (
        <div className="metrics" style={{ fontSize: 13 }}>
          <span><b>{short(a.stats.followers)}</b> abonnés</span>
          <span><b>{short(a.stats.views)}</b> vues</span>
        </div>
      )}
      <div className="row" style={{ gap: 6 }}>
        {a.needs_reconnect && canAdmin && <button type="button" className="btn btn-sm btn-primary" onClick={onReconnect}>Reconnecter</button>}
        {a.stats_available && a.mode !== 'routine' && !a.needs_reconnect && (
          <button type="button" className="btn btn-sm" onClick={onSync} disabled={busy === `s${a.platform}${a.id}`} aria-label={`Actualiser les chiffres de ${a.name}`}><Icon name="refresh" size={16} /><span className="only-desktop">Actualiser</span></button>
        )}
        {canAdmin && <button type="button" className="btn btn-sm" onClick={onShare}><Icon name="users" size={16} />Partager</button>}
        {canAdmin && <button type="button" className="btn btn-sm" onClick={onTransfer}>Transférer</button>}
        {canAdmin && (
          <button type="button" className="btn btn-sm btn-danger" onClick={onRemove} disabled={busy === `d${a.platform}${a.id}`}>
            {a.mode === 'routine' ? 'Retirer' : 'Déconnecter'}
          </button>
        )}
      </div>
    </li>
  )
}
