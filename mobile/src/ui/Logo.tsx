// Logo Chapote CM (comme cm.chapote.fr) : trois vidéos verticales empilées, la première avec le bouton lecture,
// blanc sur la couleur de l'app (orange par défaut).
import Svg, { Path, Rect } from 'react-native-svg'

export function Logo({ size = 56, bg = '#F05A28', fg = '#fff' }: { size?: number; bg?: string; fg?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel="Chapote CM">
      <Rect width="24" height="24" rx="6.2" fill={bg} />
      <Rect x="5" y="6.2" width="7.4" height="12.2" rx="1.8" fill={fg} opacity={0.45} />
      <Rect x="8.3" y="5.4" width="7.4" height="12.2" rx="1.8" fill={fg} opacity={0.7} />
      <Rect x="11.6" y="4.6" width="7.4" height="12.8" rx="1.8" fill={fg} />
      <Path d="M14.3 8.8v4.6l3.6-2.3z" fill={bg} />
    </Svg>
  )
}
