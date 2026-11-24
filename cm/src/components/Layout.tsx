// Coque de l'application (mobile d'abord). En haut des pages de suivi (Accueil, Planning, Stats,
// Vidéos) : une barre de filtres qui défile (Tous, groupes, comptes), un geste pour changer. Les
// pages de gestion (Comptes, Bibliothèque, Personnes) portent sur tout l'espace et n'ont pas la barre.
// Choix de l'espace (rare) : menu du compte. Mobile : onglets en bas, « Publier » au centre.
import { StorageGate } from './Storage'
import { Component, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useSession } from '../session'
import { getProposalCount, PLATFORM_LABEL, type Account, type Group } from '../api'
import { PlatformLogo } from './PlatformLogo'
import { useDesktop } from '../hooks'
import { AccountPicker, accKey, usePins, type PinKey } from './AccountPicker'
import { Avatar, Brand, GroupDot, Icon, Sheet, type IconName } from './ui'

// Pages « suivi » : filtrées par la barre de comptes. Pages « gestion » : tout l'espace.
const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Accueil', icon: 'home', end: true },
  { to: '/planning', label: 'Planning', icon: 'calendar' },
  { to: '/a-valider', label: 'À valider', icon: 'check' },
  { to: '/stats', label: 'Stats', icon: 'chart' },
  { to: '/videos', label: 'Vidéos', icon: 'video' },
  { to: '/commentaires', label: 'Commentaires', icon: 'comment' },
]
const MANAGE: { to: string; label: string; icon: IconName }[] = [
  { to: '/comptes', label: 'Comptes', icon: 'users' },
  { to: '/bibliotheque', label: 'Bibliothèque', icon: 'layers' },
  { to: '/personnes', label: 'Personnes', icon: 'users' },
]
const FILTERED = (path: string) => path === '/' || path === '/videos' || ['/planning', '/a-valider', '/stats', '/commentaires'].some(p => path.startsWith(p))

/** Barre de filtres des pages de suivi : « Tous », vos épinglés, vos derniers choix, et
 *  « Choisir… » qui ouvre le sélecteur (recherche, onglets Groupes / Comptes). Toujours une
 *  seule ligne, même avec 50 comptes. Ordinateur : sélecteur en popover sous la barre. */
function ScopeBar() {
  const { org, groups, group, setGroup, accounts, account, setAccount } = useSession()
  const desktop = useDesktop()
  const { pins, recent, togglePin, touch } = usePins(org)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open || !desktop) return
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open, desktop])
  if (accounts.length < 2 && !groups.length) return null

  const current: PinKey | null = account ? `a:${account}` : group ? `g:${group.id}` : null
  type Item = { k: PinKey; g: Group; a?: undefined } | { k: PinKey; a: Account; g?: undefined }
  const resolve = (k: PinKey): Item | null => {
    if (k.startsWith('g:')) { const g = groups.find(x => x.id === Number(k.slice(2))); return g ? { k, g } : null }
    const a = accounts.find(x => accKey(x) === k.slice(2)); return a ? { k, a } : null
  }
  const shown: PinKey[] = []
  for (const k of [...pins, ...recent.filter(r => !pins.includes(r)).slice(0, 3), ...(current ? [current] : [])]) {
    if (!shown.includes(k) && resolve(k)) shown.push(k)
  }
  const pick = (v: { group: number | null; account: string | null }) => {
    if (v.account) { setAccount(v.account); touch(`a:${v.account}`) }
    else if (v.group != null) { setGroup(v.group); touch(`g:${v.group}`) }
    else { setGroup(null); setAccount(null) }
    setOpen(false)
  }
  const picker = (
    <AccountPicker mode="single" accounts={accounts} groups={groups} pins={pins} onTogglePin={togglePin}
                   value={{ group: group?.id ?? null, account }} onPick={pick}
                   initialTab={account || !groups.length ? 'accounts' : 'groups'} />
  )
  return (
    <div className="scopebar" ref={box} onKeyDown={e => { if (e.key === 'Escape' && open) { setOpen(false) } }}>
      <div className="scopebar-in" role="toolbar" aria-label="Filtrer par compte"
           onWheel={e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY }}>
        <button type="button" className="fchip" aria-pressed={!current} onClick={() => pick({ group: null, account: null })}>
          Tous <span className="fchip-n">{accounts.length}</span>
        </button>
        {shown.map(k => {
          const r = resolve(k)!
          const on = k === current
          return r.g ? (
            <button key={k} type="button" className="fchip" aria-pressed={on} onClick={() => pick({ group: r.g.id, account: null })}
                    title={`Groupe · ${r.g.accounts.length} compte${r.g.accounts.length > 1 ? 's' : ''}`}>
              <GroupDot color={r.g.color} />{r.g.name}{pins.includes(k) && <span className="sr-only"> (épinglé)</span>}
            </button>
          ) : (
            <button key={k} type="button" className="fchip fchip-acc" aria-pressed={on} onClick={() => pick({ group: null, account: accKey(r.a) })}
                    title={PLATFORM_LABEL[r.a.platform]}>
              <span className="fchip-av"><Avatar src={r.a.avatar_url} name={r.a.name} size="sm" /><PlatformLogo platform={r.a.platform} size={12} /></span>
              {r.a.name || PLATFORM_LABEL[r.a.platform]}
            </button>
          )
        })}
        <button type="button" className="fchip fchip-more" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          <Icon name="search" size={16} />Choisir…
        </button>
      </div>
      {open && desktop && <div className="scope-pop" role="dialog" aria-label="Choisir les comptes affichés">{picker}</div>}
      {open && !desktop && <Sheet title="Comptes affichés" onClose={() => setOpen(false)}>{picker}</Sheet>}
    </div>
  )
}

function AccountMenu() {
  const { me, appUrl, signOut, visibleSpaces, org, setOrg } = useSession()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])
  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button type="button" className="btn btn-ghost icon-btn" aria-label="Mon compte" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Avatar src={me?.avatar_url} name={me?.name || me?.email} size="sm" />
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          <div style={{ padding: '8px 12px 10px' }}>
            <div className="strong ellipsis">{me?.name}</div>
            <div className="small muted ellipsis">{me?.email}</div>
          </div>
          <div className="menu-sep" />
          {visibleSpaces.length > 1 && (
            <>
              <div className="tiny muted strong" style={{ padding: '4px 12px' }}>Espace</div>
              {visibleSpaces.map(sp => (
                <button key={sp.org_id ?? 'perso'} type="button" className="menu-item" role="menuitemradio" aria-checked={sp.org_id === org}
                        onClick={() => { setOrg(sp.org_id); setOpen(false) }}>
                  <Icon name={sp.org_id == null ? 'home' : 'users'} />
                  <span className="grow ellipsis">{sp.name}{!sp.owner && sp.owner_name ? <span className="tiny muted"> · {sp.owner_name}</span> : null}</span>
                  {sp.org_id === org && <Icon name="check" />}
                </button>
              ))}
              <div className="menu-sep" />
            </>
          )}
          <a className="menu-item" role="menuitem" href={`${appUrl.replace(/\/$/, '')}/app`}><Icon name="external" />Espace client chapote.fr</a>
          <a className="menu-item" role="menuitem" href={`${appUrl.replace(/\/$/, '')}/app/profile`}><Icon name="shield" />Sécurité du compte</a>
          <button type="button" className="menu-item" role="menuitem" onClick={signOut}><Icon name="logout" />Se déconnecter</button>
        </div>
      )}
    </div>
  )
}

/** Une page qui ne charge pas (ex. ancienne version après une mise en ligne) : message clair, pas d'écran blanc. */
class PageBoundary extends Component<{ children: ReactNode; path: string }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidUpdate(prev: { path: string }) { if (prev.path !== this.props.path && this.state.failed) this.setState({ failed: false }) }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="card col" role="alert" style={{ gap: 10, alignItems: 'flex-start' }}>
        <h2 style={{ margin: 0 }}>Nouvelle version disponible</h2>
        <p className="small muted" style={{ margin: 0 }}>Chapote CM vient d’être mis à jour. Rechargez la page pour continuer.</p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Recharger</button>
      </div>
    )
  }
}

export default function Layout({ fallback }: { fallback?: ReactNode }) {
  const { pathname } = useLocation()
  const { visibleSpaces, org } = useSession()
  const composing = pathname === '/nouvelle'
  const filtered = FILTERED(pathname)
  const title = composing ? 'Nouvelle publication' : [...NAV, ...MANAGE].find(n => ('end' in n && n.end ? pathname === n.to : pathname.startsWith(n.to)))?.label
  const space = visibleSpaces.length > 1 ? visibleSpaces.find(s => s.org_id === org) : null
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  // Brouillons à valider (pastille) : relu à chaque changement de page.
  const [drafts, setDrafts] = useState(0)
  const { scope } = useSession()
  useEffect(() => { getProposalCount(scope).then(r => setDrafts(r.open)).catch(() => setDrafts(0)) }, [scope, pathname])

  return (
    <div className="app">
      <a href="#contenu" className="skip">Aller au contenu</a>
      <aside className="sidebar" aria-label="Navigation">
        <Brand to="/" />
        {space && <div className="tiny muted ellipsis" style={{ padding: '0 12px' }}>{space.name}</div>}
        <Link to="/nouvelle" className="btn btn-primary btn-block" style={{ margin: '8px 0 10px' }}><Icon name="plus" />Nouvelle publication</Link>
        <nav className="side-nav" aria-label="Navigation principale">
          <div className="side-label">Suivi · filtrable</div>
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end}><Icon name={n.icon} />{n.label}
              {n.to === '/a-valider' && drafts > 0 && <span className="nav-badge" aria-label={`${drafts} à valider`}>{drafts > 99 ? '99+' : drafts}</span>}
            </NavLink>
          ))}
          <div className="side-label">Gestion · tout l’espace</div>
          {MANAGE.map(n => <NavLink key={n.to} to={n.to}><Icon name={n.icon} />{n.label}</NavLink>)}
        </nav>
        <div className="side-foot small muted" style={{ padding: '12px 12px 0' }}>
          Même compte que chapote.fr
        </div>
      </aside>

      <div style={{ minWidth: 0 }}>
        <header className="appbar">
          {composing
            ? <Link to="/planning" className="btn btn-ghost icon-btn only-mobile" aria-label="Retour au planning"><Icon name="left" /></Link>
            : <span className="only-mobile row-nw" style={{ gap: 8, minWidth: 0 }}><Brand to="/" />{space && <span className="small strong ellipsis">{space.name}</span>}</span>}
          <span className={`appbar-title${composing ? '' : ' only-desktop'}`}>{title}</span>
          <span className="grow" />
          {!composing && <MobileMore drafts={drafts} />}
          <AccountMenu />
        </header>
        {filtered && <ScopeBar />}
        <main id="contenu" className={`content${composing ? ' no-tabbar' : ''}`}>
          {!pathname.startsWith('/drive/') && <StorageGate />}
          <PageBoundary path={pathname}><Suspense fallback={fallback ?? null}><Outlet /></Suspense></PageBoundary>
        </main>
      </div>

      {!composing && (
        <nav className="tabbar" aria-label="Navigation principale">
          {NAV.slice(0, 2).map(n => <NavLink key={n.to} to={n.to} end={n.end}><Icon name={n.icon} size={22} />{n.label}</NavLink>)}
          <Link to="/nouvelle" className="fab" aria-label="Nouvelle publication"><Icon name="plus" size={26} /></Link>
          <NavLink to="/stats"><Icon name="chart" size={22} />Stats</NavLink>
          <NavLink to="/comptes"><Icon name="users" size={22} />Comptes</NavLink>
        </nav>
      )}
    </div>
  )
}

/** Mobile : les pages hors de la barre du bas (Vidéos, Bibliothèque, Personnes). */
function MobileMore({ drafts }: { drafts: number }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="only-mobile">
      <button type="button" className="btn btn-ghost icon-btn" aria-label={drafts ? `Plus de pages (${drafts} à valider)` : 'Plus de pages'} onClick={() => setOpen(true)} style={{ position: 'relative' }}>
        <Icon name="menu" />{drafts > 0 && <span className="nav-badge" style={{ position: 'absolute', top: 2, right: 0, transform: 'scale(.8)' }} aria-hidden="true">{drafts > 99 ? '99+' : drafts}</span>}
      </button>
      {open && (
        <Sheet title="Pages" onClose={() => setOpen(false)}>
          <div className="col" style={{ gap: 2 }}>
            <div className="tiny muted strong" style={{ padding: '4px 12px' }}>Suivi · selon les comptes affichés</div>
            <NavLink className="menu-item" to="/a-valider" onClick={() => setOpen(false)}><Icon name="check" />À valider{drafts > 0 && <span className="nav-badge">{drafts}</span>}</NavLink>
            <NavLink className="menu-item" to="/commentaires" onClick={() => setOpen(false)}><Icon name="comment" />Commentaires</NavLink>
            <NavLink className="menu-item" to="/videos" onClick={() => setOpen(false)}><Icon name="video" />Vidéos</NavLink>
            <div className="menu-sep" />
            <div className="tiny muted strong" style={{ padding: '4px 12px' }}>Gestion · tout l’espace</div>
            <NavLink className="menu-item" to="/bibliotheque" onClick={() => setOpen(false)}><Icon name="layers" />Bibliothèque</NavLink>
            <NavLink className="menu-item" to="/personnes" onClick={() => setOpen(false)}><Icon name="users" />Personnes</NavLink>
          </div>
        </Sheet>
      )}
    </span>
  )
}
