// Bulle lanceur — launcherText non vide et fermée : pilule [icône + libellé] ;
// ouverte : redevient un rond avec la croix (comportement widget.js). Pur
// présentationnel : l'état `open` et son toggle vivent dans WidgetPreview.
// Refonte Apparence : launcherShape (round|pill|square), launcherAnimation
// (none|float|pulse) au repos, et accroche greeting au-dessus du lanceur fermé.
import { BubbleIcon } from '../../ui'
import type { DesignJson } from '../../types/bot'
import type { T } from './shared'

export default function PreviewLauncher({ d, bg, onBrand = '#fff', bubblePx, oy, side, launcherText, open, t, onToggle }: {
  d: DesignJson
  bg: string
  onBrand?: string
  bubblePx: number
  oy: number
  side: { left: number } | { right: number }
  launcherText: string
  open: boolean
  t: T
  onToggle: () => void
}) {
  // launcherShape gouverne la géométrie ICÔNE SEULE (launcherText vide). Avec un
  // libellé, le lanceur reste la pilule historique (priorité au texte). Ouvert :
  // toujours un rond avec la croix (parité widget.js).
  const shape = d.launcherShape === 'pill' || d.launcherShape === 'square' ? d.launcherShape : 'round'
  const labelled = !!launcherText && !open
  let radius: number | string = '50%'
  let width: number | string = bubblePx
  if (labelled) {
    radius = 99
    width = 'auto'
  } else if (!open) {
    if (shape === 'square') radius = Math.max(14, Math.round(bubblePx * 0.3))
    else if (shape === 'pill') { radius = 999; width = Math.round(bubblePx * 1.35) }
  }
  // launcherAnimation au repos (lanceur FERMÉ uniquement). pulse pose un halo via
  // box-shadow animé : on expose la teinte de marque comme variable CSS --kc-halo.
  const animOn = !open
  const animName = d.launcherAnimation === 'float' ? 'float' : d.launcherAnimation === 'pulse' ? 'pulse' : 'none'
  const animation = animOn && animName === 'float' ? 'kcLauncherFloat 3s ease-in-out infinite'
    : animOn && animName === 'pulse' ? 'kcLauncherPulse 2.2s ease-out infinite'
    : undefined
  // Accroche greeting : petite bulle au-dessus du lanceur, panneau fermé seulement.
  const greetingText = (typeof d.greetingText === 'string' ? d.greetingText : '').slice(0, 80).trim()
  const showGreeting = d.greeting === true && !open && !!greetingText
  const onLeft = 'left' in side

  return (
    <>
      {showGreeting && (
        <div style={{
          position: 'absolute', bottom: bubblePx + oy + 14, ...side, maxWidth: 220,
          background: '#fff', color: '#1d2b27', fontSize: 12.5, fontWeight: 600, lineHeight: 1.4,
          padding: '9px 12px', borderRadius: 14, boxShadow: '0 6px 22px rgba(10,30,25,.16)',
          border: '1px solid rgba(0,0,0,.05)', zIndex: 41, animation: 'kcGreetingIn .3s ease both',
          [onLeft ? 'borderBottomLeftRadius' : 'borderBottomRightRadius']: 4,
        }}>
          {greetingText}
        </div>
      )}
      <button onClick={onToggle} aria-label={t('open_chat')} style={{
        position: 'absolute', bottom: oy, ...side, height: bubblePx, borderRadius: radius, width,
        border: d.bordered ? '3px solid rgba(255,255,255,.95)' : 'none', cursor: 'pointer',
        background: bg, color: onBrand, boxShadow: '0 8px 26px rgba(10,30,25,.3)',
        zIndex: 41, transform: open ? 'scale(.92)' : 'scale(1)', transition: 'transform .18s ease',
        animation,
        // Teinte du halo pour l'animation pulse (50% d'opacité, dérivée du brand).
        ...(animation && animName === 'pulse' ? ({ '--kc-halo': 'rgba(13,148,136,.4)' } as React.CSSProperties) : {}),
        ...(labelled
          ? { padding: '0 16px 0 12px', display: 'flex', alignItems: 'center', gap: 8 }
          : { padding: 0, display: 'grid', placeItems: 'center' }),
      }}>
        {open
          ? <svg width={bubblePx * .38} height={bubblePx * .38} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          : (
            <>
              <BubbleIcon kind={d.icon} size={d.icon === 'image' && d.avatarImage ? bubblePx * .58 : bubblePx * .44} avatarImg={d.avatarImage} />
              {launcherText && <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>{launcherText}</span>}
              {/* Pastille « 1 » (launcherBadge, défaut affichée) : parité .kc-badge de widget.js. */}
              {d.launcherBadge !== false && (
                <span aria-hidden="true" style={{
                  position: 'absolute', top: -2, right: -2, width: 19, height: 19, borderRadius: 99,
                  background: '#e74c3c', color: '#fff', fontSize: 11, fontWeight: 700,
                  display: 'grid', placeItems: 'center', border: '2px solid #fff',
                }}>1</span>
              )}
            </>
          )}
      </button>
    </>
  )
}
