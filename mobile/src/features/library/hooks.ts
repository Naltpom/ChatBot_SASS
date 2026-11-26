// Hooks des listes : pages chargées au défilement (curseur de l'API), recherche avec pause de frappe,
// en-têtes de session pour les médias (miniatures, lecteur vidéo).
import { useCallback, useEffect, useRef, useState } from 'react'
import { authHeaders, type Page } from '../../lib/http'
import { t } from '../../lib/i18n'
import { mergeById } from './logic'

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** Liste paginée : première page, « tirer pour actualiser », page suivante en bas de liste. */
export function usePaged<T extends { id: number }>(fetchPage: (cursor: string | null) => Promise<Page<T>>, deps: unknown[]) {
  const [items, setItems] = useState<T[] | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const gen = useRef(0)
  const fetchRef = useRef(fetchPage)
  fetchRef.current = fetchPage

  const load = useCallback(async (pull: boolean) => {
    const g = ++gen.current
    if (pull) setRefreshing(true)
    try {
      const p = await fetchRef.current(null)
      if (g !== gen.current) return
      setItems(p.items); setNext(p.next); setError(null)
    } catch (e) {
      if (g === gen.current) setError((e as Error).message || t('Erreur'))
    } finally {
      if (g === gen.current) setRefreshing(false)
    }
  }, [])

  useEffect(() => { setItems(null); setNext(null); load(false) }, deps) // eslint-disable-line react-hooks/exhaustive-deps

  const more = useCallback(async () => {
    if (!next || loadingMore) return
    const g = gen.current
    setLoadingMore(true)
    try {
      const p = await fetchRef.current(next)
      if (g !== gen.current) return
      setItems(cur => mergeById(cur || [], p.items)); setNext(p.next)
    } catch (e) {
      if (g === gen.current) setError((e as Error).message || t('Erreur'))
    } finally {
      setLoadingMore(false)
    }
  }, [next, loadingMore])

  return { items, setItems, next, error, refreshing, loadingMore, refresh: () => load(true), reload: () => load(false), more }
}

/** En-têtes de la session (cookie) pour charger une miniature ou une vidéo protégée. */
export function useAuthHeaders(): Record<string, string> | null {
  const [h, setH] = useState<Record<string, string> | null>(null)
  useEffect(() => {
    let alive = true
    authHeaders().then(x => { if (alive) setH(x) }).catch(() => { if (alive) setH({}) })
    return () => { alive = false }
  }, [])
  return h
}
