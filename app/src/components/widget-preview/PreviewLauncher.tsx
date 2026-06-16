// Bulle lanceur — launcherText non vide et fermée : pilule [icône + libellé] ;
// ouverte : redevient un rond avec la croix (comportement widget.js). Pur
// présentationnel : l'état `open` et son toggle vivent dans WidgetPreview.
import { BubbleIcon } from '../../ui'
import type { T } from './shared'

export default function PreviewLauncher({ d, bg, bubblePx, oy, side, launcherText, open, t, onToggle }: {
  d: Record<string, any>
  bg: string
  bubblePx: number
  oy: number
  side: { left: number } | { right: number }
  launcherText: string
  open: boolean
  t: T
  onToggle: () => void
}) {
  return (
    <button onClick={onToggle} aria-label={t('open_chat')} style={{
      position: 'absolute', bottom: oy, ...side, height: bubblePx, borderRadius: launcherText && !open ? 99 : '50%',
      width: launcherText && !open ? 'auto' : bubblePx,
      border: d.bordered ? '3px solid rgba(255,255,255,.95)' : 'none', cursor: 'pointer',
      background: bg, color: '#fff', boxShadow: '0 8px 26px rgba(10,30,25,.3)',
      zIndex: 41, transform: open ? 'scale(.92)' : 'scale(1)', transition: 'transform .18s ease',
      ...(launcherText && !open
        ? { padding: '0 16px 0 12px', display: 'flex', alignItems: 'center', gap: 8 }
        : { padding: 0, display: 'grid', placeItems: 'center' }),
    }}>
      {open
        ? <svg width={bubblePx * .38} height={bubblePx * .38} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        : (
          <>
            <BubbleIcon kind={d.icon} size={d.icon === 'image' && d.avatarImage ? bubblePx * .58 : bubblePx * .44} avatarImg={d.avatarImage} />
            {launcherText && <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>{launcherText}</span>}
          </>
        )}
    </button>
  )
}
