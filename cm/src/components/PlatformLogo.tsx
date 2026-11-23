// Logos des plateformes (versions simplifiées), dessinés en SVG : lisibles de 12 à 32 px.
import type { Platform } from '../api'
import { PLATFORM_LABEL } from '../api'

export function PlatformLogo({ platform, size = 16, title }: { platform: Platform; size?: number; title?: boolean }) {
  const a11y = title ? { role: 'img', 'aria-label': PLATFORM_LABEL[platform] } : { 'aria-hidden': true as const }
  const common = { width: size, height: size, viewBox: '0 0 24 24', className: `plogo plogo-${platform}`, ...a11y }
  if (platform === 'youtube') {
    return (
      <svg {...common}>
        <rect x="1" y="4.5" width="22" height="15" rx="4.5" fill="#FF0033" />
        <path d="M10 8.6v6.8l5.8-3.4z" fill="#fff" />
      </svg>
    )
  }
  if (platform === 'instagram') {
    return (
      <svg {...common}>
        <defs>
          <radialGradient id="plogo-ig" cx="30%" cy="107%" r="150%">
            <stop offset="0" stopColor="#FFD776" /><stop offset=".1" stopColor="#FFD776" />
            <stop offset=".5" stopColor="#F3425F" /><stop offset="1" stopColor="#9F31E3" />
          </radialGradient>
        </defs>
        <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="url(#plogo-ig)" />
        <rect x="6" y="6" width="12" height="12" rx="3.6" fill="none" stroke="#fff" strokeWidth="1.8" />
        <circle cx="12" cy="12" r="2.9" fill="none" stroke="#fff" strokeWidth="1.8" />
        <circle cx="15.9" cy="8.1" r="1" fill="#fff" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="#111" />
      <path d="M13.4 5.5h2.2c.2 1.6 1.3 2.8 2.9 3v2.2c-1.1 0-2.1-.3-2.9-.9v4.7a4 4 0 1 1-4-4v2.2a1.8 1.8 0 1 0 1.8 1.8z" fill="#25F4EE" transform="translate(-.6 -.5)" />
      <path d="M13.4 5.5h2.2c.2 1.6 1.3 2.8 2.9 3v2.2c-1.1 0-2.1-.3-2.9-.9v4.7a4 4 0 1 1-4-4v2.2a1.8 1.8 0 1 0 1.8 1.8z" fill="#FE2C55" transform="translate(.6 .5)" />
      <path d="M13.4 5.5h2.2c.2 1.6 1.3 2.8 2.9 3v2.2c-1.1 0-2.1-.3-2.9-.9v4.7a4 4 0 1 1-4-4v2.2a1.8 1.8 0 1 0 1.8 1.8z" fill="#fff" />
    </svg>
  )
}
