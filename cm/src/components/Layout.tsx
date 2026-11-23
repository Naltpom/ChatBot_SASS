// Coque de l'application. Mobile : barre du haut (périmètre + compte) et onglets en bas avec le
// bouton « Publier » au centre. Ordinateur : barre latérale (navigation, groupes) et contenu en
// pleine largeur. Le choix des comptes affichés est au-dessus de « Nouvelle publication ».
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '../session'
import { PLATFORM_LABEL } from '../api'
import { PlatformLogo } from './PlatformLogo'
import { Avatar, Brand, GroupDot, Icon, Sheet, type IconName } from './ui'

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Accueil', icon: 'home', end: true },
  { to: '/planning', label: 'Planning', icon: 'calendar' },
  { to: '/stats', label: 'Stats', icon: 'chart' },
  { to: '/comptes', label: 'Comptes', icon: 'users' },
]

const keyOf = (a: { platform: string; id: number }) => `${a.platform}:${a.id}`

/** Choix de ce qui est affiché : tous les comptes, un groupe ou un seul compte (onglets), et
 *  l'espace s'il y en a plusieurs d'utiles. */
export function ScopeList({ onPick }: { onPick?: () => void }) {
  const { visibleSpaces, org, setOrg, groups, group, setGroup, accounts, account, setAccount } = useSession()
  const nav = useNavigate()
  const [tab, setTab] = useState<'groups' | 'accounts'>(account || !groups.length ? 'accounts' : 'groups')
  const all = !group && !account
  return (
    <div className="col" style={{ gap: 4 }}>
      {visibleSpaces.length > 1 && (
        <>
          <div className="tiny muted strong" style={{ padding: '4px 12px' }}>Espace</div>
          {visibleSpaces.map(s => (
            <button key={s.org_id ?? 'perso'} type="button" className="menu-item" aria-pressed={s.org_id === org}
                    onClick={() => { setOrg(s.org_id); onPick?.() }}>
              <Icon name={s.org_id == null ? 'home' : 'users'} />
              <span className="grow ellipsis">{s.name}{!s.owner && s.owner_name ? <span className="tiny muted"> · partagé par {s.owner_name}</span> : null}</span>
              {s.org_id === org && <Icon name="check" />}
            </button>
          ))}
          <div className="menu-sep" />
        </>
      )}
      <button type="button" className="menu-item" aria-pressed={all} onClick={() => { setGroup(null); setAccount(null); onPick?.() }}>
        <Icon name="layers" /><span className="grow">Tous les comptes</span>
        <span className="tiny muted">{accounts.length}</span>{all && <Icon name="check" />}
      </button>
      <div className="tabs" role="tablist" aria-label="Afficher">
        <button type="button" role="tab" aria-selected={tab === 'groups'} onClick={() => setTab('groups')}>Groupes</button>
        <button type="button" role="tab" aria-selected={tab === 'accounts'} onClick={() => setTab('accounts')}>Comptes</button>
      </div>
      {tab === 'groups' ? (
        <div role="tabpanel" className="col" style={{ gap: 2 }}>
          {groups.map(g => (
            <button key={g.id} type="button" className="menu-item" aria-pressed={group?.id === g.id && !account} onClick={() => { setGroup(g.id); onPick?.() }}>
              <span style={{ width: 18, display: 'grid', placeItems: 'center' }}><GroupDot color={g.color} /></span>
              <span className="grow ellipsis">{g.name}</span>
              <span className="tiny muted">{g.accounts.length}</span>
              {group?.id === g.id && !account && <Icon name="check" />}
            </button>
          ))}
          {!groups.length && <p className="tiny muted" style={{ margin: '4px 12px' }}>Rassemblez des comptes (un client, un projet…) pour les suivre ensemble.</p>}
          <button type="button" className="menu-item" style={{ color: 'var(--accent)' }} onClick={() => { onPick?.(); nav('/comptes#groupes') }}>
            <Icon name="plus" /><span>{groups.length ? 'Gérer les groupes' : 'Créer un groupe'}</span>
          </button>
        </div>
      ) : (
        <div role="tabpanel" className="col" style={{ gap: 2 }}>
          {accounts.map(a => (
            <button key={keyOf(a)} type="button" className="menu-item" aria-pressed={account === keyOf(a)} onClick={() => { setAccount(keyOf(a)); onPick?.() }}>
              <Avatar src={a.avatar_url} name={a.name} platform={a.platform} size="sm" />
              <span className="grow ellipsis">{a.name || PLATFORM_LABEL[a.platform]}</span>
              {account === keyOf(a) && <Icon name="check" />}
            </button>
          ))}
          {!accounts.length && <p className="tiny muted" style={{ margin: '4px 12px' }}>Aucun compte connecté.</p>}
        </div>
      )}
    </div>
  )
}

/** Libellé et pastille de ce qui est affiché. */
function useScopeLabel() {
  const { group, accounts, account } = useSession()
  const acc = account ? accounts.find(a => keyOf(a) === account) : null
  if (acc) return { label: acc.name || PLATFORM_LABEL[acc.platform], mark: <PlatformLogo platform={acc.platform} size={16} /> }
  if (group) return { label: group.name, mark: <GroupDot color={group.color} /> }
  return { label: 'Tous les comptes', mark: <Icon name="layers" size={16} /> }
}

function ScopeButton({ block }: { block?: boolean }) {
  const { visibleSpaces, org } = useSession()
  const [open, setOpen] = useState(false)
  const { label, mark } = useScopeLabel()
  const space = visibleSpaces.length > 1 ? visibleSpaces.find(s => s.org_id === org) : null
  return (
    <>
      <button type="button" className={`scope-btn${block ? ' scope-btn-block' : ''}`} onClick={() => setOpen(true)} aria-haspopup="dialog"
              aria-label={`Comptes affichés : ${label}${space ? `, ${space.name}` : ''}`}>
        {mark}
        <span className="grow col" style={{ minWidth: 0, gap: 0, textAlign: 'left' }}>
          <span className="ellipsis">{label}</span>
          {space && block && <span className="tiny muted ellipsis">{space.name}</span>}
        </span>
        <Icon name="down" size={16} />
      </button>
      {open && <Sheet title="Comptes affichés" onClose={() => setOpen(false)}><ScopeList onPick={() => setOpen(false)} /></Sheet>}
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

export default function Layout({ fallback }: { fallback?: ReactNode }) {
  const { pathname } = useLocation()
  const composing = pathname === '/nouvelle'
  const title = composing ? 'Nouvelle publication' : pathname.startsWith('/bibliotheque') ? 'Bibliothèque' : pathname.startsWith('/personnes') ? 'Personnes' : NAV.find(n => (n.end ? pathname === n.to : pathname.startsWith(n.to)))?.label
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])

  return (
    <div className="app">
      <a href="#contenu" className="skip">Aller au contenu</a>
      <aside className="sidebar" aria-label="Navigation">
        <Brand to="/" />
        <ScopeButton block />
        <Link to="/nouvelle" className="btn btn-primary btn-block" style={{ margin: '8px 0 10px' }}><Icon name="plus" />Nouvelle publication</Link>
        <nav className="side-nav" aria-label="Navigation principale">
          {NAV.map(n => <NavLink key={n.to} to={n.to} end={n.end}><Icon name={n.icon} />{n.label}</NavLink>)}
          <NavLink to="/bibliotheque"><Icon name="layers" />Bibliothèque</NavLink>
          <NavLink to="/videos"><Icon name="video" />Vidéos</NavLink>
          <NavLink to="/personnes"><Icon name="users" />Personnes</NavLink>
        </nav>
        <div className="side-foot small muted" style={{ padding: '12px 12px 0' }}>
          Même compte que chapote.fr
        </div>
      </aside>

      <div style={{ minWidth: 0 }}>
        <header className="appbar">
          {composing
            ? <Link to="/planning" className="btn btn-ghost icon-btn only-mobile" aria-label="Retour au planning"><Icon name="left" /></Link>
            : <span className="only-mobile" style={{ minWidth: 0 }}><ScopeButton /></span>}
          {composing && <span className="appbar-title only-mobile">Nouvelle publication</span>}
          <span className="appbar-title only-desktop">{title}</span>
          <span className="grow" />
          <AccountMenu />
        </header>
        <main id="contenu" className={`content${composing ? ' no-tabbar' : ''}`}>
          <Suspense fallback={fallback ?? null}><Outlet /></Suspense>
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
