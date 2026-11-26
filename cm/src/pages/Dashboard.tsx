// État d'un compte (Comptes, Stats). Libellés en français, traduits à l'affichage (t(st.label)). L'ancienne page Accueil est fusionnée dans Stats (comme l'app mobile).
import type { Account } from '../api'

export function accountState(a: Account): { label: string; tone: string } {
  if (a.needs_reconnect) return { label: 'À reconnecter', tone: 'danger' }
  if (a.mode === 'routine') return { label: 'Routine', tone: 'muted' }
  if (a.stats?.error) return { label: 'Relevé en échec', tone: 'warn' }
  return { label: 'Connecté', tone: 'ok' }
}
