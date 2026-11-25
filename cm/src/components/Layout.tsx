// Coque de l'application (mobile d'abord). En haut des pages de suivi (Accueil, Planning, Stats,
// Vidéos) : une barre de filtres qui défile (Tous, groupes, comptes), un geste pour changer. Les
// pages de gestion (Comptes, Bibliothèque, Partage) n'ont pas la barre. Pas d'« espaces » visibles.
// Mobile : onglets en bas, « Publier » au centre.
import { StorageGate } from './Storage'
import { Component, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import FeedbackSheet from './FeedbackSheet'
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
  { to: '/partage', label: 'Partage', icon: 'users' },
]
const FILTERED = (path: string) => path === '/' || path === '/videos' || ['/planning', '/a-valider', '/stats', '/commentaires'].some(p => path.startsWith(p))

/** Barre de filtres des pages de suivi : « Tous » (mes comptes + les groupes partagés avec moi), vos
 *  épinglés, vos derniers choix, et « Choisir… » (recherche, onglets Groupes / Comptes). Les groupes
 *  se cumulent (plusieurs à la fois) ; un compte s'affiche seul. Toujours une seule ligne. */
function ScopeBar() {
  const { groups, picked, toggleGroup, setGroup, accounts, account, setAccount, ownerOf } = useSession()
  const desktop = useDesktop()
  const { pins, recent, togglePin, touch } = usePins('all')
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open || !desktop) return
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open, desktop])
  if (accounts.length < 2 && !groups.length) return null

  const isOn = (k: PinKey) => (k.startsWith('a:') ? account === k.slice(2) : !account && picked.includes(Number(k.slice(2))))
  const all = !account && !picked.length
  type Item = { k: PinKey; g: Group; a?: undefined } | { k: PinKey; a: Account; g?: undefined }
  const resolve = (k: PinKey): Item | null => {
    if (k.startsWith('g:')) { const g = groups.find(x => x.id === Number(k.slice(2))); return g ? { k, g } : null }
    const a = accounts.find(x => accKey(x) === k.slice(2)); return a ? { k, a } : null
  }
  const current: PinKey[] = account ? [`a:${account}`] : picked.map(id => `g:${id}` as PinKey)
  const shown: PinKey[] = []
  for (const k of [...pins, ...recent.filter(r => !pins.includes(r)).slice(0, 3), ...current]) {
    if (!shown.includes(k) && resolve(k)) shown.push(k)
  }
  const pick = (v: { group: number | null; account: string | null }) => {
    if (v.account) { setAccount(account === v.account ? null : v.account); touch(`a:${v.account}`); setOpen(false) }
    else if (v.group != null) { toggleGroup(v.group); touch(`g:${v.group}`) }
    else { setGroup(null); setAccount(null); setOpen(false) }
  }
  const label = account ? null : picked.length > 1 ? `${picked.length} groupes` : null
  const picker = (
    <AccountPicker mode="single" accounts={accounts} groups={groups} pins={pins} onTogglePin={togglePin} ownerOf={ownerOf}
                   value={{ group: null, account, groups: picked }} onPick={pick}
                   initialTab={account || !groups.length ? 'accounts' : 'groups'}
                   footer={<p className="tiny muted" style={{ margin: 0 }}>Cochez plusieurs groupes pour les voir ensemble, ou un compte pour le voir seul.</p>} />
  )
  return (
    <div className="scopebar" ref={box} onKeyDown={e => { if (e.key === 'Escape' && open) { setOpen(false) } }}>
      <div className="scopebar-in" role="toolbar" aria-label="Filtrer par groupe ou compte"
           onWheel={e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY }}>
        <button type="button" className="fchip" aria-pressed={all} onClick={() => pick({ group: null, account: null })}
                title="Mes comptes et les groupes partagés avec moi">
          Tous <span className="fchip-n">{accounts.length}</span>
        </button>
        {shown.map(k => {
          const r = resolve(k)!
          const on = isOn(k)
          const owner = ownerOf(r.g || r.a!)
          return r.g ? (
            <button key={k} type="button" className="fchip" aria-pressed={on} onClick={() => pick({ group: r.g.id, account: null })}
                    title={`Groupe · ${r.g.accounts.length} compte${r.g.accounts.length > 1 ? 's' : ''}${owner ? ` · partagé par ${owner}` : ''}`}>
              <GroupDot color={r.g.color} />{r.g.name}{pins.includes(k) && <span className="sr-only"> (épinglé)</span>}
            </button>
          ) : (
            <button key={k} type="button" className="fchip fchip-acc" aria-pressed={on} onClick={() => pick({ group: null, account: accKey(r.a) })}
                    title={`${PLATFORM_LABEL[r.a.platform]}${owner ? ` · de ${owner}` : ''}`}>
              <span className="fchip-av"><Avatar src={r.a.avatar_url} name={r.a.name} size="sm" /><PlatformLogo platform={r.a.platform} size={12} /></span>
              {r.a.name || PLATFORM_LABEL[r.a.platform]}
            </button>
          )
        })}
        <button type="button" className="fchip fchip-more" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          <Icon name="search" size={16} />{label || 'Choisir…'}
        </button>
      </div>
      {open && desktop && <div className="scope-pop" role="dialog" aria-label="Choisir les groupes ou le compte affichés">{picker}</div>}
      {open && !desktop && <Sheet title="Groupes et comptes affichés" onClose={() => setOpen(false)}>{picker}</Sheet>}
    </div>
  )
}

function AccountMenu() {
  const { me, appUrl, signOut } = useSession()
  const [open, setOpen] = useState(false)
  const [feedback, setFeedback] = useState(false)
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
          <button type="button" className="menu-item" role="menuitem" onClick={() => { setOpen(false); setFeedback(true) }}><Icon name="comment" />Donner mon avis</button>
          <div className="menu-sep" />
          <button type="button" className="menu-item" role="menuitem" onClick={signOut}><Icon name="logout" />Se déconnecter</button>
        </div>
      )}
      {feedback && <FeedbackSheet onClose={() => setFeedback(false)} />}
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
  const { invitations } = useSession()
  const composing = pathname === '/nouvelle'
  const filtered = FILTERED(pathname)
  const title = composing ? 'Nouvelle publication' : [...NAV, ...MANAGE].find(n => ('end' in n && n.end ? pathname === n.to : pathname.startsWith(n.to)))?.label
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  // Brouillons à valider (pastille ; onglet caché s'il n'y en a aucun pour ce qui est affiché) : relu à chaque changement de page.
  const [drafts, setDrafts] = useState<number | null>(null)
  const { scope } = useSession()
  useEffect(() => { getProposalCount(scope).then(r => setDrafts(r.open)).catch(() => setDrafts(0)) }, [scope, pathname])
  const nav = NAV.filter(n => n.to !== '/a-valider' || drafts !== 0 || pathname.startsWith('/a-valider'))

  return (
    <div className="app">
      <a href="#contenu" className="skip">Aller au contenu</a>
      <aside className="sidebar" aria-label="Navigation">
        <Brand to="/" />
        <Link to="/nouvelle" className="btn btn-primary btn-block" style={{ margin: '8px 0 10px' }}><Icon name="plus" />Nouvelle publication</Link>
        <nav className="side-nav" aria-label="Navigation principale">
          <div className="side-label">Suivi · filtrable</div>
          {nav.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end}><Icon name={n.icon} />{n.label}
              {n.to === '/a-valider' && !!drafts && <span className="nav-badge" aria-label={`${drafts} à valider`}>{drafts > 99 ? '99+' : drafts}</span>}
            </NavLink>
          ))}
          <div className="side-label">Gestion</div>
          {MANAGE.map(n => <NavLink key={n.to} to={n.to}><Icon name={n.icon} />{n.label}
            {n.to === '/partage' && invitations > 0 && <span className="nav-badge" aria-label={`${invitations} invitation${invitations > 1 ? 's' : ''}`}>{invitations}</span>}
          </NavLink>)}
        </nav>
        <div className="side-foot small muted" style={{ padding: '12px 12px 0' }}>
          Même compte que chapote.fr
        </div>
      </aside>

      <div style={{ minWidth: 0 }}>
        <header className="appbar">
          {composing
            ? <Link to="/planning" className="btn btn-ghost icon-btn only-mobile" aria-label="Retour au planning"><Icon name="left" /></Link>
            : <span className="only-mobile row-nw" style={{ gap: 8, minWidth: 0 }}><Brand to="/" /></span>}
          <span className={`appbar-title${composing ? '' : ' only-desktop'}`}>{title}</span>
          <span className="grow" />
          {!composing && <MobileMore drafts={drafts || 0} invitations={invitations} />}
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
function MobileMore({ drafts, invitations }: { drafts: number; invitations: number }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="only-mobile">
      <button type="button" className="btn btn-ghost icon-btn" aria-label={drafts || invitations ? `Plus de pages (${[drafts ? `${drafts} à valider` : '', invitations ? `${invitations} invitation${invitations > 1 ? 's' : ''}` : ''].filter(Boolean).join(', ')})` : 'Plus de pages'} onClick={() => setOpen(true)} style={{ position: 'relative' }}>
        <Icon name="menu" />{drafts + invitations > 0 && <span className="nav-badge" style={{ position: 'absolute', top: 2, right: 0, transform: 'scale(.8)' }} aria-hidden="true">{drafts + invitations > 99 ? '99+' : drafts + invitations}</span>}
      </button>
      {open && (
        <Sheet title="Pages" onClose={() => setOpen(false)}>
          <div className="col" style={{ gap: 2 }}>
            <div className="tiny muted strong" style={{ padding: '4px 12px' }}>Suivi · selon les comptes affichés</div>
            {drafts > 0 && <NavLink className="menu-item" to="/a-valider" onClick={() => setOpen(false)}><Icon name="check" />À valider<span className="nav-badge">{drafts}</span></NavLink>}
            <NavLink className="menu-item" to="/commentaires" onClick={() => setOpen(false)}><Icon name="comment" />Commentaires</NavLink>
            <NavLink className="menu-item" to="/videos" onClick={() => setOpen(false)}><Icon name="video" />Vidéos</NavLink>
            <div className="menu-sep" />
            <div className="tiny muted strong" style={{ padding: '4px 12px' }}>Gestion</div>
            <NavLink className="menu-item" to="/bibliotheque" onClick={() => setOpen(false)}><Icon name="layers" />Bibliothèque</NavLink>
            <NavLink className="menu-item" to="/partage" onClick={() => setOpen(false)}><Icon name="users" />Partage{invitations > 0 && <span className="nav-badge">{invitations}</span>}</NavLink>
          </div>
        </Sheet>
      )}
    </span>
  )
}
