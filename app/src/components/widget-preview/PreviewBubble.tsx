// Une bulle de message + son CSAT simulé. Pur présentationnel : reçoit le
// message, l'index, l'état du vote local et le callback de notation. La logique
// (état ratings, machine à états) reste dans WidgetPreview.
import { Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react'
import type { Msg, PreviewStyle, T } from './shared'
import { renderMarkdown } from './markdown'

export default function PreviewBubble({ m, i, st, t, rating, onRate }: {
  m: Msg
  i: number
  st: PreviewStyle
  t: T
  rating?: 1 | -1
  onRate: (i: number, v: 1 | -1) => void
}) {
  const { brand, accent, scale, tail, timestamps, ts, r14, compact, square, botBg, botBorder, botText, mutedText } = st
  // Coins : square force r8 partout ; sinon ergot asymétrique (tail) ou r14 plein.
  const radius = square ? 8
    : tail
      ? (m.from === 'user' ? `${r14}px ${r14}px 4px ${r14}px` : `4px ${r14}px ${r14}px ${r14}px`)
      : `${r14}px`
  // textScale : multiplie la taille de police de base de la bulle (compact=12.5, cozy=13.5).
  const fontPx = (compact ? 12.5 : 13.5) * scale
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: m.from === 'user' ? 'flex-end' : 'flex-start' }}>
      <div style={{
        maxWidth: '82%', padding: compact ? '7px 10px' : '9px 12px', fontSize: fontPx, lineHeight: 1.5,
        borderRadius: radius,
        background: m.from === 'user' ? brand : botBg,
        color: m.from === 'user' ? '#fff' : (m.sys ? mutedText : botText),
        fontStyle: m.sys ? 'italic' : undefined,
        border: m.from === 'user' ? 'none' : `1px solid ${botBorder}`,
        boxShadow: m.from === 'user' ? 'none' : '0 1px 2px rgba(0,0,0,.04)',
      }}>
        {m.ai && (
          <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: .5, color: brand, marginBottom: 3, display: 'flex', alignItems: 'center', gap: 3 }}>
            <Sparkles size={10} /> {t('tag_ai').trim()}
          </div>
        )}
        {m.advisor && (
          <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: .5, color: brand, marginBottom: 3 }}>
            {t('tag_advisor').trim()}
          </div>
        )}
        {/* Bulle bot : markdown léger (gras/italique/lien/sauts de ligne).
            Bulle user (libellés cliqués) : texte brut. white-space pre-wrap pour
            que les sauts de ligne s'affichent comme dans le widget. */}
        <span style={{ whiteSpace: 'pre-wrap' }}>{m.from === 'bot' ? renderMarkdown(m.text) : m.text}</span>
      </div>
      {/* Horodatage simulé (clé timestamps) — heure statique HH:MM, parité visuelle. */}
      {timestamps && (
        <div style={{ fontSize: 9.5, color: mutedText, marginTop: 2, padding: '0 4px', opacity: .8 }}>{ts}</div>
      )}
      {/* CSAT simulé — HORS de la bulle (parité .kc-rate hors .kc-msg),
          jamais sur les bulles système/Conseiller (parité : le widget
          ne propose le vote que sur les réponses ai|tree) */}
      {m.from === 'bot' && !m.sys && !m.advisor && (
        <div style={{ display: 'flex', gap: 4, marginTop: 2, paddingLeft: 4 }}>
          <button onClick={() => onRate(i, 1)}
                  title={t('rate_up')} aria-label={t('rate_up')}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 2, lineHeight: 0,
                           color: rating === 1 ? 'var(--go)' : 'var(--faint)' }}>
            <ThumbsUp size={12} />
          </button>
          <button onClick={() => onRate(i, -1)}
                  title={t('rate_down')} aria-label={t('rate_down')}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 2, lineHeight: 0,
                           color: rating === -1 ? 'var(--danger)' : 'var(--faint)' }}>
            <ThumbsDown size={12} />
          </button>
        </div>
      )}
    </div>
  )
}
