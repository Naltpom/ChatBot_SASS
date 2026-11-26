// Onglets de Stats (ancien Accueil fusionné dedans) : vue d'ensemble et liste de toutes les vidéos.
import { NavLink } from 'react-router-dom'
import { t } from '../i18n'

export function StatsTabs() {
  return (
    <nav className="picker-tabs stats-tabs" aria-label={t('Statistiques')}>
      <NavLink to="/stats" end>{t('Vue d’ensemble')}</NavLink>
      <NavLink to="/videos">{t('Vidéos')}</NavLink>
    </nav>
  )
}
