// Overlay rendez-vous simulé : pas de vraie iframe Calendly dans le dashboard —
// le widget réel embarque le calendrier (hôtes whitelistés). Pur présentationnel.
import { CalendarDays } from 'lucide-react'
import { hostnameOf } from './shared'
import type { PreviewStyle, T } from './shared'

export default function PreviewAppointmentOverlay({ url, st, t, onClose }: {
  url: string
  st: PreviewStyle
  t: T
  onClose: () => void
}) {
  const { bg, brand, panelBg, mutedText } = st
  return (
    <div style={{ position: 'absolute', inset: 0, background: panelBg, zIndex: 50, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: bg, color: '#fff', padding: '12px 15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>{t('appointment_title')}</span>
        <button onClick={onClose} aria-label={t('close')} style={{
          background: 'none', border: 'none', color: '#fff', cursor: 'pointer',
          fontSize: 18, lineHeight: 1, padding: 4, opacity: .85,
        }}>×</button>
      </div>
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 10, padding: 20, textAlign: 'center',
      }}>
        <CalendarDays size={22} style={{ color: '#93a8a2' }} />
        <div style={{ fontSize: 12.5, color: mutedText, lineHeight: 1.55, maxWidth: 250 }}>
          Aperçu : le calendrier ({hostnameOf(url)}) s'affiche ici dans le widget réel.
        </div>
        <a href={url} target="_blank" rel="noopener noreferrer" style={{
          fontSize: 12.5, fontWeight: 700, color: brand, textDecoration: 'underline',
        }}>{t('open_new_tab')}</a>
      </div>
    </div>
  )
}
