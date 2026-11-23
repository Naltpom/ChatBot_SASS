// Coque de l'application. Mobile : barre du haut (périmètre + compte) et onglets en bas avec le
// bouton « Publier » au centre. Ordinateur : barre latérale (navigation, groupes) et contenu en
// pleine largeur.
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '../session'
import { Avatar, Brand, GroupDot, Icon, Sheet, type IconName } from './ui'

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Accueil', icon: 'home', end: true },
  { to: '/planning', label: 'Planning', icon: 'calendar' },
  { to: '/stats', label: 'Stats', icon: 'chart' },
  { to: '/comptes', label: 'Comptes', icon: 'users' },
]

/** Choix de l'espace (perso / équipe) et du groupe de comptes affiché. */
export function ScopeList({ onPick }: { onPick?: () => void }) {
  const { spaces, org, setOrg, groups, group, setGroup } = useSession()
  const nav = useNavigate()
  return (
    <div className="col" style={{ gap: 4 }}>
      {spaces.length > 1 && (
        <>
          <div className="tiny muted strong" style={{ padding: '4px 12px' }}>Espace</div>
          {spaces.map(s => (
            <button key={s.org_id ?? 'perso'} type="button" className="menu-item" aria-pressed={s.org_id === org}
                    onClick={() => { setOrg(s.org_id); onPick?.() }}>
              <Icon name={s.org_id == null ? 'home' : 'users'} />
              <span className="grow ellipsis">{s.name}</span>
              {s.org_id === org && <Icon name="check" />}
            </button>
          ))}
          <div className="menu-sep" />
        </>
      )}
      <div className="tiny muted strong" style={{ padding: '4px 12px' }}>Comptes affichés</div>
      <button type="button" className="menu-item" aria-pressed={!group} onClick={() => { setGroup(null); onPick?.() }}>
        <Icon name="layers" /><span className="grow">Tous les comptes</span>{!group && <Icon name="check" />}
      </button>
      {groups.map(g => (
        <button key={g.id} type="button" className="menu-item" aria-pressed={group?.id === g.id} onClick={() => { setGroup(g.id); onPick?.() }}>
          <span style={{ width: 18, display: 'grid', placeItems: 'center' }}><GroupDot color={g.color} /></span>
          <span className="grow ellipsis">{g.name}</span>
          <span className="tiny muted">{g.accounts.length}</span>
          {group?.id === g.id && <Icon name="check" />}
        </button>
      ))}
      <button type="button" className="menu-item" style={{ color: 'var(--accent)' }} onClick={() => { onPick?.(); nav('/comptes#groupes') }}>
        <Icon name="plus" /><span>{groups.length ? 'Gérer les groupes' : 'Créer un groupe de comptes'}</span>
      </button>
    </div>
  )
}

function ScopeButton() {
  const { spaces, org, group } = useSession()
  const [open, setOpen] = useState(false)
  const space = spaces.find(s => s.org_id === org)
  const label = group ? group.name : 'Tous les comptes'
  return (
    <>
      <button type="button" className="scope-btn" onClick={() => setOpen(true)} aria-haspopup="dialog">
        {group ? <GroupDot color={group.color} /> : <Icon name="layers" size={16} />}
        <span className="ellipsis" style={{ maxWidth: 170 }}>{label}</span>
        {spaces.length > 1 && space && <span className="tiny muted ellipsis only-desktop" style={{ maxWidth: 140 }}>· {space.name}</span>}
        <Icon name="down" size={16} />
      </button>
      {open && <Sheet title="Afficher" onClose={() => setOpen(false)}><ScopeList onPick={() => setOpen(false)} /></Sheet>}
    </>
  )
}

function AccountMenu() {
  const { me, appUrl, signOut } = useSession()
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
          <a className="menu-item" role="menuitem" href={`${appUrl.replace(/\/$/, '')}/app`}><Icon name="external" />Espace client chapote.fr</a>
          <a className="menu-item" role="menuitem" href={`${appUrl.replace(/\/$/, '')}/app/profile`}><Icon name="shield" />Sécurité du compte</a>
          <button type="button" className="menu-item" role="menuitem" onClick={signOut}><Icon name="logout" />Se déconnecter</button>
        </div>
      )}
    </div>
  )
}

export default function Layout() {
  const { pathname } = useLocation()
  const composing = pathname === '/nouvelle'
  const title = composing ? 'Nouvelle publication' : NAV.find(n => (n.end ? pathname === n.to : pathname.startsWith(n.to)))?.label
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])

  return (
    <div className="app">
      <a href="#contenu" className="skip">Aller au contenu</a>
      <aside className="sidebar" aria-label="Navigation">
        <Brand to="/" />
        <Link to="/nouvelle" className="btn btn-primary btn-block" style={{ margin: '4px 0 10px' }}><Icon name="plus" />Nouvelle publication</Link>
        <nav className="side-nav" aria-label="Navigation principale">
          {NAV.map(n => <NavLink key={n.to} to={n.to} end={n.end}><Icon name={n.icon} />{n.label}</NavLink>)}
          <NavLink to="/videos"><Icon name="video" />Vidéos</NavLink>
        </nav>
        <div className="side-label">Périmètre</div>
        <ScopeList />
        <div className="side-foot small muted" style={{ padding: '12px 12px 0' }}>
          Même compte que chapote.fr
        </div>
      </aside>

      <div style={{ minWidth: 0 }}>
        <header className="appbar">
          {composing
            ? <Link to="/planning" className="btn btn-ghost icon-btn only-mobile" aria-label="Retour au planning"><Icon name="left" /></Link>
            : <span className="only-mobile"><Brand to="/" /></span>}
          {composing && <span className="appbar-title only-mobile">Publier</span>}
          <span className="appbar-title only-desktop">{title}</span>
          <span className="grow" />
          {!composing && <ScopeButton />}
          <AccountMenu />
        </header>
        <main id="contenu" className={`content${composing ? ' no-tabbar' : ''}`}>
          <Outlet />
        </main>
      </div>

      {!composing && (
        <nav className="tabbar" aria-label="Navigation principale">
          {NAV.slice(0, 2).map(n => <NavLink key={n.to} to={n.to} end={n.end}><Icon name={n.icon} size={22} />{n.label}</NavLink>)}
          <Link to="/nouvelle" className="fab" aria-label="Nouvelle publication"><Icon name="plus" size={26} /></Link>
          {NAV.slice(2).map(n => <NavLink key={n.to} to={n.to}><Icon name={n.icon} size={22} />{n.label}</NavLink>)}
        </nav>
      )}
    </div>
  )
}
