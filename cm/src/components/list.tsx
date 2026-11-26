// Briques des listes : recherche et tri faits par l'API, état gardé dans l'adresse (retour arrière,
// lien partageable), pages chargées au défilement. Accessibles : en-têtes triables avec aria-sort,
// nombre de résultats annoncé, cibles de 44 px sur mobile.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Order, Page } from '../api'
import { Icon } from './ui'
import { t } from '../i18n'

export interface ListState<S extends string> {
  q: string            // recherche envoyée à l'API (après la pause de frappe)
  input: string        // ce qui est tapé
  setInput: (v: string) => void
  sort: S
  order: Order
  /** Clic sur un en-tête : même colonne = inverse l'ordre ; autre colonne = son ordre naturel. */
  toggle: (s: S) => void
  setSort: (s: S) => void
  setOrder: (o: Order) => void
}

/** Recherche + tri dans l'URL (`?q=&tri=&ordre=`). `natural` : ordre par défaut de chaque tri. */
export function useListState<S extends string>(defaultSort: S, natural: (s: S) => Order, prefix = ''): ListState<S> {
  const [params, setParams] = useSearchParams()
  const kq = `${prefix}q`, ks = `${prefix}tri`, ko = `${prefix}ordre`
  const sort = (params.get(ks) as S) || defaultSort
  const order = (params.get(ko) as Order) || natural(sort)
  const q = params.get(kq) || ''
  const [input, setInputState] = useState(q)
  const timer = useRef<number>()
  const patch = useCallback((changes: Record<string, string | null>) => {
    setParams(prev => {
      const p = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(changes)) (v ? p.set(k, v) : p.delete(k))
      return p
    }, { replace: true })
  }, [setParams])
  useEffect(() => { setInputState(q) }, [q])   // retour arrière
  const setInput = (v: string) => {
    setInputState(v)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => patch({ [kq]: v.trim() || null }), 300)
  }
  const setSort = (s: S) => patch({ [ks]: s === defaultSort ? null : s, [ko]: null })
  const setOrder = (o: Order) => patch({ [ko]: o === natural(sort) ? null : o })
  const toggle = (s: S) => {
    if (s === sort) setOrder(order === 'asc' ? 'desc' : 'asc')
    else setSort(s)
  }
  return { q, input, setInput, sort, order, toggle, setSort, setOrder }
}

export function SearchBox({ value, onChange, label, placeholder }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string }) {
  return (
    <div className="searchbox" role="search">
      <Icon name="search" size={16} />
      <input className="input" type="search" value={value} onChange={e => onChange(e.target.value)} aria-label={label}
             placeholder={placeholder || label} autoComplete="off" enterKeyHint="search" />
      {value && <button type="button" className="searchbox-clear" aria-label={t('Effacer la recherche')} onClick={() => onChange('')}><Icon name="close" size={16} /></button>}
    </div>
  )
}

/** En-tête de colonne triable (ordinateur). */
export function SortTh<S extends string>({ col, list, children, right }: { col: S; list: ListState<S>; children: ReactNode; right?: boolean }) {
  const active = list.sort === col
  return (
    <th scope="col" className={right ? 'r' : undefined} aria-sort={active ? (list.order === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`th-sort${active ? ' on' : ''}`} onClick={() => list.toggle(col)}>
        {children}
        <span className="th-arrow" aria-hidden="true">{active ? (list.order === 'asc' ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>
  )
}

/** Tri sur mobile (et là où il n'y a pas de tableau) : choix du critère + sens. */
export function SortControl<S extends string>({ list, options, label = t('Trier par') }: { list: ListState<S>; options: [S, string][]; label?: string }) {
  return (
    <div className="row-nw sortctl" style={{ gap: 6 }}>
      <select className="select select-sm" aria-label={label} value={list.sort} onChange={e => list.setSort(e.target.value as S)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <button type="button" className="btn btn-sm icon-btn" onClick={() => list.setOrder(list.order === 'asc' ? 'desc' : 'asc')}
              aria-label={list.order === 'asc' ? t('Ordre croissant (inverser)') : t('Ordre décroissant (inverser)')} title={list.order === 'asc' ? t('Croissant') : t('Décroissant')}>
        <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>{list.order === 'asc' ? '↑' : '↓'}</span>
      </button>
    </div>
  )
}

/** Annonce discrète du nombre de résultats (lecteurs d'écran). */
export function LiveCount({ n, more, what }: { n: number | null; more?: boolean; what: string }) {
  return <p className="sr-only" aria-live="polite">{n == null ? '' : `${n}${more ? '+' : ''} ${what}`}</p>
}

/** Pages suivantes au défilement : première page fournie (cache), suite via `load(cursor)`. */
export function useMorePages<T>(first: Page<T> | null, load: (cursor: string) => Promise<Page<T>>, deps: unknown[]) {
  const [more, setMore] = useState<T[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => { setMore([]); setNext(first?.next ?? null) }, [first])
  useEffect(() => {
    const el = sentinel.current
    if (!el || !next || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting || busy || !next) return
      setBusy(true)
      try { const p = await load(next); setMore(m => [...m, ...p.items]); setNext(p.next) }
      catch { setNext(null) } finally { setBusy(false) }
    }, { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [next, busy, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps
  const items = first ? [...first.items, ...more] : null
  return { items, next, busy, sentinel, reset: () => { setMore([]); setNext(first?.next ?? null) } }
}
