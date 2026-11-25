// Coque de l'application, alignée sur l'app mobile : Planning (page d'accueil), Commentaires, « + », Stats,
// Bibliothèque ; Comptes et Réglages en haut à droite. Pages de suivi (Planning, Stats, Vidéos,
// Commentaires, À valider) : barre de filtres (Tous, groupes, comptes). Pas d'« espaces » visibles.
// Mobile : onglets en bas comme l'app ; ordinateur : barre latérale.
import { StorageGate } from './Storage'
import { Component, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useRole, useSession } from '../session'
import { getProposalCount, PLATFORM_LABEL, type Account, type Group } from '../api'
import { PlatformLogo } from './PlatformLogo'
import { useDesktop } from '../hooks'
import { AccountPicker, accKey, usePins, type PinKey } from './AccountPicker'
import { Avatar, Brand, GroupDot, Icon, Sheet, type IconName } from './ui'

// Pages « suivi » : filtrées par la barre de comptes. Pages « gestion » : tout l'espace.
// Mêmes onglets que l'app mobile, dans le même ordre (« + » au centre sur téléphone).
const NAV: { to: string; label: string; icon: IconName; also?: string[] }[] = [
  { to: '/planning', label: 'Planning', icon: 'calendar' },
  { to: '/commentaires', label: 'Commentaires', icon: 'comment' },
  { to: '/stats', label: 'Stats', icon: 'chart', also: ['/videos'] },
  { to: '/bibliotheque', label: 'Bibliothèque', icon: 'folder' },
]
const MANAGE: { to: string; label: string; icon: IconName }[] = [
  { to: '/comptes', label: 'Comptes', icon: 'users' },
  { to: '/partage', label: 'Partage', icon: 'share' },
  { to: '/reglages', label: 'Réglages', icon: 'settings' },
]
const TITLES: [string, string][] = [['/a-valider', 'À valider'], ['/videos', 'Stats'], ['/reglages', 'Réglages']]
const FILTERED = (path: string) => ['/planning', '/a-valider', '/stats', '/videos', '/commentaires'].some(p => path.startsWith(p))
const isOn = (path: string, n: { to: string; also?: string[] }) => [n.to, ...(n.also || [])].some(p => path.startsWith(p))

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

/** En haut à droite, comme l'app : Comptes et Réglages (pastille : brouillons à valider + invitations). */
function HeaderActions({ badge }: { badge: number }) {
  return (
    <span className="row-nw" style={{ gap: 2 }}>
      <NavLink to="/comptes" className="btn btn-ghost icon-btn" aria-label="Comptes connectés" title="Comptes connectés"><Icon name="users" /></NavLink>
      <NavLink to="/reglages" className="btn btn-ghost icon-btn" style={{ position: 'relative' }} title="Réglages"
               aria-label={badge ? `Réglages (${badge} à voir)` : 'Réglages'}>
        <Icon name="settings" />
        {badge > 0 && <span className="nav-badge" style={{ position: 'absolute', top: 2, right: 0, transform: 'scale(.8)' }} aria-hidden="true">{badge > 99 ? '99+' : badge}</span>}
      </NavLink>
    </span>
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
  const { canEdit } = useRole()
  const composing = pathname === '/nouvelle'
  const filtered = FILTERED(pathname)
  const title = composing ? 'Nouvelle publication'
    : TITLES.find(([p]) => pathname.startsWith(p))?.[1] || [...NAV, ...MANAGE].find(n => pathname.startsWith(n.to))?.label
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  // Brouillons à valider (pastille ; onglet caché s'il n'y en a aucun pour ce qui est affiché) : relu à chaque changement de page.
  const [drafts, setDrafts] = useState<number | null>(null)
  const { scope } = useSession()
  useEffect(() => { getProposalCount(scope).then(r => setDrafts(r.open)).catch(() => setDrafts(0)) }, [scope, pathname])

  return (
    <div className="app">
      <a href="#contenu" className="skip">Aller au contenu</a>
      <aside className="sidebar" aria-label="Navigation">
        <Brand to="/planning" />
        <Link to="/nouvelle" className="btn btn-primary btn-block" style={{ margin: '8px 0 10px' }}><Icon name="plus" />Nouvelle publication</Link>
        <nav className="side-nav" aria-label="Navigation principale">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} className={() => (isOn(pathname, n) ? 'active' : '')}><Icon name={n.icon} />{n.label}</NavLink>
          ))}
          {(!!drafts || pathname.startsWith('/a-valider')) && (
            <NavLink to="/a-valider"><Icon name="check" />À valider
              {!!drafts && <span className="nav-badge" aria-label={`${drafts} à valider`}>{drafts > 99 ? '99+' : drafts}</span>}
            </NavLink>
          )}
          <div className="side-label">Mon espace</div>
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
            : <span className="only-mobile row-nw" style={{ gap: 8, minWidth: 0 }}><Brand to="/planning" /></span>}
          <span className={`appbar-title${composing ? '' : ' only-desktop'}`}>{title}</span>
          <span className="grow" />
          {!composing && <HeaderActions badge={(drafts || 0) + invitations} />}
        </header>
        {filtered && <ScopeBar />}
        <main id="contenu" className={`content${composing ? ' no-tabbar' : ''}`}>
          {!pathname.startsWith('/drive/') && <StorageGate />}
          <PageBoundary path={pathname}><Suspense fallback={fallback ?? null}><Outlet /></Suspense></PageBoundary>
        </main>
      </div>

      {!composing && (
        <nav className="tabbar" aria-label="Navigation principale">
          {NAV.slice(0, 2).map(n => <NavLink key={n.to} to={n.to} className={() => (isOn(pathname, n) ? 'active' : '')}><Icon name={n.icon} size={22} />{n.label}</NavLink>)}
          {canEdit && <Link to="/nouvelle" className="fab" aria-label="Nouvelle publication"><Icon name="plus" size={26} /></Link>}
          {NAV.slice(2).map(n => <NavLink key={n.to} to={n.to} className={() => (isOn(pathname, n) ? 'active' : '')}><Icon name={n.icon} size={22} />{n.label}</NavLink>)}
        </nav>
      )}
    </div>
  )
}
