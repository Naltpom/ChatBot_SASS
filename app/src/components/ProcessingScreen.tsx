// Écran d'attente de génération d'arbre par l'IA — composant PRÉSENTATIONNEL pur.
// Extrait de pages/BotWizard.tsx pour être réutilisé
// par l'éditeur embarqué (pages/embed/EmbedTreeEditor) pendant qu'un job de
// génération tourne. Aucune logique réseau ici : le parent pilote la progression
// (stage/pct) et enchaîne sur l'éditeur dès la fin (anti-piège StrictMode).
// Les keyframes `bob`/`blink`/`cin` sont globales (styles.css).

// Palette Chapote (alignée styles.css / charte) — locale au composant.
const NAVY = '#1C3F5C'
const MINT = '#2F9E79'
const CORAL = '#E86A5F'
const FAINT = '#9AA7B4'

export default function ProcessingScreen({ mobile, stage, pct }: { mobile?: boolean; stage: string; pct: number }) {
  const width = Math.max(4, Math.min(100, pct))
  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: mobile ? '60px 16px' : '88px 28px', textAlign: 'center', animation: 'cin .35s ease' }}>
      {/* Robot inline (palette Chapote) — antennes + yeux qui clignotent. */}
      <div style={{ display: 'inline-flex', position: 'relative' }}>
        <svg width="120" height="120" viewBox="0 0 120 120" fill="none" style={{ animation: 'bob 2.4s ease-in-out infinite' }}>
          <line x1="60" y1="20" x2="60" y2="34" stroke={MINT} strokeWidth="3" strokeLinecap="round" />
          <circle cx="60" cy="16" r="5" fill={CORAL} style={{ animation: 'blink 1.4s infinite' }} />
          <rect x="26" y="34" width="68" height="56" rx="16" fill="#fff" stroke={NAVY} strokeWidth="3" />
          <rect x="34" y="42" width="52" height="40" rx="11" fill={NAVY} />
          <circle cx="50" cy="62" r="6" fill="#fff" style={{ animation: 'blink 1.8s infinite' }} />
          <circle cx="70" cy="62" r="6" fill="#fff" style={{ animation: 'blink 1.8s infinite .2s' }} />
          <rect x="22" y="52" width="6" height="20" rx="3" fill={MINT} />
          <rect x="92" y="52" width="6" height="20" rx="3" fill={MINT} />
          <rect x="44" y="94" width="32" height="10" rx="5" fill={MINT} />
        </svg>
      </div>
      <h1 style={{ fontFamily: "'Clash Display',sans-serif", fontWeight: 600, fontSize: 26, margin: '18px 0 0', letterSpacing: '-.02em' }}>Notre IA construit votre arbre</h1>
      <p style={{ fontSize: 16, color: MINT, fontWeight: 600, margin: '14px 0 0', minHeight: 24 }}>{stage}</p>
      {/* Barre de progression RÉELLE (pct renvoyé par le flux de progression). */}
      <div style={{ height: 6, background: '#E8ECF0', borderRadius: 3, overflow: 'hidden', maxWidth: 320, margin: '22px auto 0' }}>
        <div style={{ height: '100%', width: `${width}%`, background: MINT, borderRadius: 3, transition: 'width .4s ease' }} />
      </div>
      <p style={{ fontSize: 13, color: FAINT, margin: '20px auto 0', maxWidth: 360, lineHeight: 1.5 }}>
        Nous lisons vos pages et documents pour proposer un arbre pertinent — quelques secondes.
      </p>
    </div>
  )
}
