// Petits outils partagés des écrans Commentaires, Stats, Vidéos, Fiche vidéo.
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as WebBrowser from 'expo-web-browser'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Linking } from 'react-native'
import type { Order, Page, Scope } from '../../lib/api'
import { useLoad, useSession } from '../../lib/session'

/** Valeur recopiée après `ms` sans changement (recherche envoyée à l'API). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

/** Recherche (saisie + valeur envoyée) et tri dans les deux sens. */
export function useListState<S extends string>(defaultSort: S, natural: (s: S) => Order) {
  const [input, setInput] = useState('')
  const q = useDebounced(input.trim(), 300)
  const [sort, setSortState] = useState<S>(defaultSort)
  const [order, setOrder] = useState<Order>(natural(defaultSort))
  /** Choisir un tri ; le tri déjà choisi inverse le sens. */
  const pick = (s: S) => {
    if (s === sort) setOrder(o => (o === 'asc' ? 'desc' : 'asc'))
    else { setSortState(s); setOrder(natural(s)) }
  }
  return { input, setInput, q, sort, order, pick }
}
export type ListState<S extends string> = ReturnType<typeof useListState<S>>

/**
 * Liste paginée par curseur (en-tête X-Next-Cursor) : première page par le cache de `useLoad`,
 * suivantes avec `more()` (FlatList onEndReached). `reload()` repart de la première page.
 */
export function usePages<T>(load: (scope: Scope, cursor: string | null) => Promise<Page<T>>, deps: unknown[], key: string) {
  const { scope } = useSession()
  const first = useLoad(s => load(s, null), deps, key)
  const [extra, setExtra] = useState<T[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const gen = useRef(0)
  useEffect(() => { gen.current++; setExtra([]); setNext(first.data?.next ?? null); setBusy(false) }, [first.data])
  useEffect(() => { if (!first.loading) setRefreshing(false) }, [first.loading])
  const more = useCallback(async () => {
    if (!next || busy) return
    const g = gen.current
    setBusy(true)
    try {
      const p = await load(scope, next)
      if (g !== gen.current) return
      setExtra(m => [...m, ...p.items]); setNext(p.next)
    } catch { if (g === gen.current) setNext(null) } finally { if (g === gen.current) setBusy(false) }
  }, [next, busy, scope, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps
  const items = first.data ? [...first.data.items, ...extra] : null
  const reload = () => { setRefreshing(true); first.reload() }
  return { items, next, busy, more, reload, refreshing, error: first.error, loading: first.loading }
}

/** Valeur gardée sur le téléphone (mot-clé, modèle de message). */
export function useStored(key: string, fallback: string): [string, (v: string) => void, boolean] {
  const [v, setV] = useState(fallback)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    AsyncStorage.getItem(key).then(x => { if (x != null) setV(x) }).catch(() => {}).finally(() => setReady(true))
  }, [key])
  const set = (x: string) => { setV(x); AsyncStorage.setItem(key, x).catch(() => {}) }
  return [v, set, ready]
}

/** Page web dans le navigateur intégré. */
export const openWeb = (url: string) => { WebBrowser.openBrowserAsync(url).catch(() => Linking.openURL(url).catch(() => {})) }
/** Lien vers une app (profil ou message Instagram, TikTok) : l'app si installée, sinon le navigateur. */
export const openApp = (url: string) => { Linking.openURL(url).catch(() => openWeb(url)) }

export const errText = (e: unknown) => (e as { data?: { message?: string } })?.data?.message || (e as Error)?.message || 'Erreur'
