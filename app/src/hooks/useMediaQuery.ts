import { useEffect, useState } from 'react'

// Hook responsive : matchMedia + écoute du resize (les media queries sont
// impossibles en styles inline). Base = la version la plus robuste du code
// (BotWizard) : SSR-safe (window/matchMedia absents -> false au 1er rendu),
// addEventListener('change') moderne avec repli addListener (Safari ancien),
// cleanup systématique.
export function useMediaQuery(query: string): boolean {
  const get = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false
  const [match, setMatch] = useState<boolean>(get)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const on = () => setMatch(mql.matches)
    on()
    if (mql.addEventListener) mql.addEventListener('change', on)
    else mql.addListener(on)
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', on)
      else mql.removeListener(on)
    }
  }, [query])
  return match
}

// Helper « mobile » paramétrable. Breakpoint par défaut = 860px (celui du shell
// et de BotPage). Les pages auth utilisaient 760px : passer maxWidth={760} pour
// reproduire leur comportement. La query est sans espace après ':' — accepté
// partout par matchMedia, et identique à la forme Register/BotPage.
export function useIsMobile(maxWidth = 860): boolean {
  return useMediaQuery(`(max-width:${maxWidth}px)`)
}
