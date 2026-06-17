// Tracé SVG du chapeau Chapote, partagé par Login / Register / BotWizard
// (en-tête de marque, bulles bot). Couleur par défaut `currentColor` pour
// hériter du contexte ; les appelants qui rendent sur fond sombre passent
// `color="#fff"`.
export default function HatIcon({ size = 20, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 16.5c0-.6.4-1 1-1.1 2.2-.6 4.4-.9 7-.9s4.8.3 7 .9c.6.1 1 .5 1 1.1" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M7.5 15.1l1.2-7.2c.2-1.1 1.2-1.9 2.3-1.9h2c1.1 0 2.1.8 2.3 1.9l1.2 7.2" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
