// Logo Chapote CM : le chapeau Chapote posé sur un M, blanc sur le bleu de l'app.
import Svg, { G, Path, Rect } from 'react-native-svg'

const HAT = ['M4 16.5c0-.6.4-1 1-1.1 2.2-.6 4.4-.9 7-.9s4.8.3 7 .9c.6.1 1 .5 1 1.1', 'M7.5 15.1l1.2-7.2c.2-1.1 1.2-1.9 2.3-1.9h2c1.1 0 2.1.8 2.3 1.9l1.2 7.2']

export function Logo({ size = 56, bg = '#0071e3', fg = '#fff' }: { size?: number; bg?: string; fg?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel="Chapote CM">
      <Rect width="24" height="24" rx="5.4" fill={bg} />
      <G transform="translate(12 8.6) scale(0.5) translate(-12 -11)" stroke={fg} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none">
        {HAT.map(d => <Path key={d} d={d} />)}
      </G>
      <Path d="M6.5 19v-6.2l5.5 4.4 5.5-4.4V19" stroke={fg} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  )
}
