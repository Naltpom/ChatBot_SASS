// Indicateur « en train d'écrire » — réplique des six animations widget.js
// (dots | wave | pulse | bars | ring | typing). Pur présentationnel.
import type { PreviewStyle } from './shared'

export default function PreviewTyping({ st }: { st: PreviewStyle }) {
  const { brand, botBg, botBorder, anim } = st
  // Conteneur commun (parité .kc-typing>div) ; l'ergot suit la même asymétrie
  // que les bulles bot. Le contenu interne dépend de l'animation choisie.
  const wrap: React.CSSProperties = {
    padding: '10px 14px', borderRadius: '4px 14px 14px 14px', background: botBg,
    border: `1px solid ${botBorder}`, display: 'flex', gap: 4, alignItems: 'center',
  }
  return (
    <div style={{ display: 'flex' }}>
      <div style={wrap}>
        {anim === 'pulse' ? (
          <span style={{ width: 10, height: 10, borderRadius: 9, background: brand, display: 'inline-block', animation: 'kcPulse 1s infinite ease-in-out' }} />
        ) : anim === 'ring' ? (
          // ring : anneau qui tourne (border + segment de marque)
          <span style={{
            width: 15, height: 15, borderRadius: '50%', display: 'inline-block',
            border: '2px solid #d7e0dd', borderTopColor: brand, animation: 'kcRing .7s linear infinite',
          }} />
        ) : anim === 'bars' ? (
          // bars : trois barres verticales qui pulsent en hauteur
          [0, 1, 2].map(i => (
            <span key={i} style={{
              width: 4, height: 14, borderRadius: 3, background: brand, display: 'inline-block',
              transformOrigin: 'center', animation: `kcBars .9s ${i * .15}s infinite ease-in-out`,
            }} />
          ))
        ) : anim === 'typing' ? (
          // typing : trois points plus larges qui clignotent en cascade (style « iMessage »)
          [0, 1, 2].map(i => (
            <span key={i} style={{
              width: 7, height: 7, borderRadius: 9, background: brand, display: 'inline-block',
              animation: `kcTyping 1.3s ${i * .2}s infinite ease-in-out`,
            }} />
          ))
        ) : (
          // dots (défaut) | wave : trois points
          [0, 1, 2].map(i => (
            <span key={i} style={{
              width: 6, height: 6, borderRadius: 9,
              background: anim === 'wave' ? brand : '#b9c4c0', display: 'inline-block',
              animation: anim === 'wave' ? `kcWave 1s ${i * .14}s infinite ease-in-out` : `kcBlink 1.2s ${i * .18}s infinite`,
            }} />
          ))
        )}
      </div>
    </div>
  )
}
