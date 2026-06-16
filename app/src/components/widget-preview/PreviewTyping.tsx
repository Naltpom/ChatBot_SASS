// Indicateur « en train d'écrire » — réplique des trois animations widget.js
// (dots | wave | pulse). Pur présentationnel.
import type { PreviewStyle } from './shared'

export default function PreviewTyping({ st }: { st: PreviewStyle }) {
  const { brand, botBg, botBorder, anim } = st
  return (
    <div style={{ display: 'flex' }}>
      <div style={{ padding: '10px 14px', borderRadius: '4px 14px 14px 14px', background: botBg, border: `1px solid ${botBorder}`, display: 'flex', gap: 4, alignItems: 'center' }}>
        {anim === 'pulse' ? (
          <span style={{ width: 10, height: 10, borderRadius: 9, background: brand, display: 'inline-block', animation: 'kcPulse 1s infinite ease-in-out' }} />
        ) : [0, 1, 2].map(i => (
          <span key={i} style={{
            width: 6, height: 6, borderRadius: 9,
            background: anim === 'wave' ? brand : '#b9c4c0', display: 'inline-block',
            animation: anim === 'wave' ? `kcWave 1s ${i * .14}s infinite ease-in-out` : `kcBlink 1.2s ${i * .18}s infinite`,
          }} />
        ))}
      </div>
    </div>
  )
}
