// Logos des plateformes (mêmes dessins que le site).
import Svg, { Circle, Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg'
import type { Platform } from '../lib/api'

export function PlatformLogo({ platform, size = 16 }: { platform: Platform; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24' }
  if (platform === 'youtube') {
    return (
      <Svg {...common}>
        <Rect x="1" y="4.5" width="22" height="15" rx="4.5" fill="#FF0033" />
        <Path d="M10 8.6v6.8l5.8-3.4z" fill="#fff" />
      </Svg>
    )
  }
  if (platform === 'instagram') {
    return (
      <Svg {...common}>
        <Defs>
          <RadialGradient id="ig" cx="30%" cy="107%" r="150%">
            <Stop offset="0" stopColor="#FFD776" /><Stop offset=".1" stopColor="#FFD776" />
            <Stop offset=".5" stopColor="#F3425F" /><Stop offset="1" stopColor="#9F31E3" />
          </RadialGradient>
        </Defs>
        <Rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="url(#ig)" />
        <Rect x="6" y="6" width="12" height="12" rx="3.6" fill="none" stroke="#fff" strokeWidth="1.8" />
        <Circle cx="12" cy="12" r="2.9" fill="none" stroke="#fff" strokeWidth="1.8" />
        <Circle cx="15.9" cy="8.1" r="1" fill="#fff" />
      </Svg>
    )
  }
  const d = 'M13.4 5.5h2.2c.2 1.6 1.3 2.8 2.9 3v2.2c-1.1 0-2.1-.3-2.9-.9v4.7a4 4 0 1 1-4-4v2.2a1.8 1.8 0 1 0 1.8 1.8z'
  return (
    <Svg {...common}>
      <Rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="#111" />
      <Path d={d} fill="#25F4EE" transform="translate(-.6 -.5)" />
      <Path d={d} fill="#FE2C55" transform="translate(.6 .5)" />
      <Path d={d} fill="#fff" />
    </Svg>
  )
}
