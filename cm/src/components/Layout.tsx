import { Link, NavLink, Outlet } from 'react-router-dom'
import { useSession } from '../session'

export default function Layout() {
  const { me, spaces, org, setOrg, signOut, appUrl } = useSession()
  return (
    <>
      <a href="#contenu" className="sr-only">Aller au contenu</a>
      <header className="topbar">
        <div className="topbar-in">
          <Link to="/" className="brand"><span className="brand-mark" aria-hidden="true">C</span>Chapote CM</Link>
          <nav className="nav" aria-label="Navigation principale">
            <NavLink to="/" end>Tableau de bord</NavLink>
            <NavLink to="/planning">Planning</NavLink>
            <NavLink to="/videos">Vidéos</NavLink>
            <NavLink to="/comptes">Comptes</NavLink>
          </nav>
          <div className="row" style={{ gap: 10 }}>
            {spaces.length > 1 && (
              <label className="row muted small" style={{ gap: 8 }}>Espace
                <select className="select" style={{ width: 'auto' }} value={org ?? ''}
                        onChange={e => setOrg(e.target.value ? Number(e.target.value) : null)}>
                  {spaces.map(s => <option key={s.org_id ?? 'perso'} value={s.org_id ?? ''}>{s.name}</option>)}
                </select>
              </label>
            )}
            <Link to="/nouvelle" className="btn btn-primary">Nouvelle publication</Link>
            <details style={{ position: 'relative' }}>
              <summary className="btn icon-btn" aria-label="Mon compte" style={{ listStyle: 'none', borderRadius: '50%' }}>
                {(me?.name || me?.email || '?').slice(0, 1).toUpperCase()}
              </summary>
              <div className="card" style={{ position: 'absolute', right: 0, top: 44, width: 240, padding: 12, zIndex: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="small"><strong>{me?.name}</strong><div className="muted ellipsis">{me?.email}</div></div>
                <a className="small" href={`${appUrl.replace(/\/$/, '')}/app`}>Espace client chapote.fr</a>
                <button type="button" className="btn btn-sm" onClick={signOut}>Se déconnecter</button>
              </div>
            </details>
          </div>
        </div>
      </header>
      <main id="contenu" className="page">
        <Outlet />
      </main>
    </>
  )
}
