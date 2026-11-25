// Onglets de Stats (ancien Accueil fusionné dedans) : vue d'ensemble et liste de toutes les vidéos.
import { NavLink } from 'react-router-dom'

export function StatsTabs() {
  return (
    <nav className="picker-tabs stats-tabs" aria-label="Statistiques">
      <NavLink to="/stats" end>Vue d’ensemble</NavLink>
      <NavLink to="/videos">Vidéos</NavLink>
    </nav>
  )
}
