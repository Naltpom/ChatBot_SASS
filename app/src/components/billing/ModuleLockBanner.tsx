// Bannière « fonctionnalité verrouillée » — PROPRE et VISIBLE. Posée AU-DESSUS du contenu d'un onglet
// gardé par un module : le contenu reste pleinement visible et réglable en
// dessous ; le blocage RÉEL est côté serveur (402 à l'enregistrement sans le
// module). Quand `locked` est faux, ne rend rien (zéro surcoût).
//
// INVARIANT facturation : `locked` dérive de l'entitlement (active_modules) côté
// BotPage — billing OFF => resolve() renvoie tous les modules => jamais verrouillé.
import { Lock } from 'lucide-react'
import { Btn } from '../../ui'

export default function ModuleLockBanner({ locked, label, onUpgrade }: {
  locked: boolean
  label: string
  onUpgrade: () => void
}) {
  if (!locked) return null
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      background: 'var(--warn-soft)', border: '1px solid var(--warn-bd)', borderRadius: 12,
      padding: '11px 14px',
    }}>
      <span style={{
        width: 32, height: 32, borderRadius: 9, flexShrink: 0,
        background: 'rgba(224,168,46,.18)', display: 'grid', placeItems: 'center',
      }}>
        <Lock size={15} style={{ color: 'var(--warn)' }} />
      </span>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>
          {label} — non inclus dans cet abonnement
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--mut)', marginTop: 1, lineHeight: 1.45 }}>
          Vous pouvez tout régler ici ; l'activation réelle demande d'ajouter le module.
        </div>
      </div>
      <Btn kind="primary" small onClick={onUpgrade}>Ajouter à mon abonnement →</Btn>
    </div>
  )
}
