// Coque de l'application (mobile d'abord). En haut des pages de suivi (Accueil, Planning, Stats,
// Vidéos) : une barre de filtres qui défile (Tous, groupes, comptes), un geste pour changer. Les
// pages de gestion (Comptes, Bibliothèque, Personnes) portent sur tout l'espace et n'ont pas la barre.
// Choix de l'espace (rare) : menu du compte. Mobile : onglets en bas, « Publier » au centre.
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useSession } from '../session'
import { PLATFORM_LABEL } from '../api'
import { PlatformLogo } from './PlatformLogo'
import { Avatar, Brand, GroupDot, Icon, Sheet, type IconName } from './ui'

// Pages « suivi » : filtrées par la barre de comptes. Pages « gestion » : tout l'espace.
const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Accueil', icon: 'home', end: true },
  { to: '/planning', label: 'Planning', icon: 'calendar' },
  { to: '/stats', label: 'Stats', icon: 'chart' },
  { to: '/videos', label: 'Vidéos', icon: 'video' },
]
const MANAGE: { to: string; label: string; icon: IconName }[] = [
  { to: '/comptes', label: 'Comptes', icon: 'users' },
  { to: '/bibliotheque', label: 'Bibliothèque', icon: 'layers' },
  { to: '/personnes', label: 'Personnes', icon: 'users' },
]
const FILTERED = (path: string) => path === '/' || ['/planning', '/stats', '/videos'].some(p => path.startsWith(p))
const keyOf = (a: { platform: string; id: number }) => `${a.platform}:${a.id}`

/** Barre de filtres : un geste pour passer de « Tous » à un groupe ou à un compte. Défile
 *  horizontalement (pouce sur mobile, molette ou glisser sur ordinateur). Absente s'il n'y a rien à filtrer. */
function ScopeBar() {
  const { groups, group, setGroup, accounts, account, setAccount } = useSession()
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {   // le filtre choisi reste visible
    bar.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [group?.id, account])
  if (accounts.length < 2 && !groups.length) return null
  const all = !group && !account
  return (
    <div className="scopebar" role="toolbar" aria-label="Filtrer par compte">
      <div className="scopebar-in" ref={bar}
           onWheel={e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY }}>
        <button type="button" className="fchip" aria-pressed={all} onClick={() => { setGroup(null); setAccount(null) }}>
          Tous <span className="fchip-n">{accounts.length}</span>
        </button>
        {groups.map(g => (
          <button key={g.id} type="button" className="fchip" aria-pressed={!account && group?.id === g.id} onClick={() => setGroup(g.id)}
                  title={`Groupe : ${g.accounts.length} compte${g.accounts.length > 1 ? 's' : ''}`}>
            <GroupDot color={g.color} />{g.name}
          </button>
        ))}
        {groups.length > 0 && accounts.length > 0 && <span className="fchip-sep" aria-hidden="true" />}
        {accounts.map(a => (
          <button key={keyOf(a)} type="button" className="fchip fchip-acc" aria-pressed={account === keyOf(a)} onClick={() => setAccount(keyOf(a))}
                  title={PLATFORM_LABEL[a.platform]}>
            <span className="fchip-av"><Avatar src={a.avatar_url} name={a.name} size="sm" /><PlatformLogo platform={a.platform} size={12} /></span>
            {a.name || PLATFORM_LABEL[a.platform]}
          </button>
        ))}
      </div>
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

export default function Layout({ fallback }: { fallback?: ReactNode }) {
  const { pathname } = useLocation()
  const { visibleSpaces, org } = useSession()
  const composing = pathname === '/nouvelle'
  const filtered = FILTERED(pathname)
  const title = composing ? 'Nouvelle publication' : [...NAV, ...MANAGE].find(n => ('end' in n && n.end ? pathname === n.to : pathname.startsWith(n.to)))?.label
  const space = visibleSpaces.length > 1 ? visibleSpaces.find(s => s.org_id === org) : null
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])

  return (
    <div className="app">
      <a href="#contenu" className="skip">Aller au contenu</a>
      <aside className="sidebar" aria-label="Navigation">
        <Brand to="/" />
        {space && <div className="tiny muted ellipsis" style={{ padding: '0 12px' }}>{space.name}</div>}
        <Link to="/nouvelle" className="btn btn-primary btn-block" style={{ margin: '8px 0 10px' }}><Icon name="plus" />Nouvelle publication</Link>
        <nav className="side-nav" aria-label="Navigation principale">
          <div className="side-label">Suivi · filtrable</div>
          {NAV.map(n => <NavLink key={n.to} to={n.to} end={n.end}><Icon name={n.icon} />{n.label}</NavLink>)}
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
          {!composing && <MobileMore />}
          <AccountMenu />
        </header>
        {filtered && <ScopeBar />}
        <main id="contenu" className={`content${composing ? ' no-tabbar' : ''}`}>
          <Suspense fallback={fallback ?? null}><Outlet /></Suspense>
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
function MobileMore() {
  const [open, setOpen] = useState(false)
  return (
    <span className="only-mobile">
      <button type="button" className="btn btn-ghost icon-btn" aria-label="Plus de pages" onClick={() => setOpen(true)}><Icon name="menu" /></button>
      {open && (
        <Sheet title="Pages" onClose={() => setOpen(false)}>
          <div className="col" style={{ gap: 2 }}>
            <NavLink className="menu-item" to="/videos" onClick={() => setOpen(false)}><Icon name="video" />Vidéos</NavLink>
            <NavLink className="menu-item" to="/bibliotheque" onClick={() => setOpen(false)}><Icon name="layers" />Bibliothèque</NavLink>
            <NavLink className="menu-item" to="/personnes" onClick={() => setOpen(false)}><Icon name="users" />Personnes</NavLink>
          </div>
        </Sheet>
      )}
    </span>
  )
}
