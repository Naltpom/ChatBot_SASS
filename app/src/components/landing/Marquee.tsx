// Bandeau navy qui défile en continu (liste doublée pour une boucle sans saut).
import { CLASH, MARQUEE, HatIcon } from './data'

export function Marquee() {
  return (
    <div aria-hidden="true" style={{ background: '#1C3F5C', color: '#fff', overflow: 'hidden', padding: '24px 0' }}>
      <div style={{ display: 'flex', width: 'max-content', animation: 'ch-marquee 32s linear infinite' }}>
        {[...MARQUEE, ...MARQUEE].map((w, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 36, paddingRight: 36, fontFamily: CLASH, fontWeight: 500, fontSize: 34, letterSpacing: '-.01em', whiteSpace: 'nowrap' }}>
            {w}<HatIcon size={26} stroke="#2F9E79" w={2} />
          </span>
        ))}
      </div>
    </div>
  )
}
