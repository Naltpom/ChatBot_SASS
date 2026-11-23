import { useEffect, useState } from 'react'

/** Vrai si la requête média correspond (ex. '(min-width: 1024px)'). */
export function useMedia(query: string): boolean {
  const get = () => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches
  const [m, setM] = useState(get)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setM(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return m
}
export const useDesktop = () => useMedia('(min-width: 1024px)')
