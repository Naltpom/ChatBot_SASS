// Choisir des comptes quand il y en a beaucoup (50 comptes, 10 groupes…) : recherche, onglets
// Groupes / Comptes, filtre par plateforme, épingles. Deux usages :
// - `single` : le filtre des pages de suivi (un groupe OU un compte) ;
// - `multi`  : les comptes d'une publication (cases à cocher, groupes cochés d'un coup).
// Clavier : flèches pour se déplacer, Entrée pour choisir, Échap pour fermer (géré par le conteneur).
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { PLATFORM_LABEL, PLATFORMS, type Account, type Group, type Platform } from '../api'
import { useDesktop } from '../hooks'
import { PlatformLogo } from './PlatformLogo'
import { Avatar, GroupDot, Icon } from './ui'
import { t } from '../i18n'

export const accKey = (a: { platform: string; id: number }) => `${a.platform}:${a.id}`
const norm = (s: string | null | undefined) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^@/, '')

// ---------------------------------------------------------------------------
// Épingles et récents (par espace, dans le navigateur)
// ---------------------------------------------------------------------------
export type PinKey = `g:${number}` | `a:${string}`
function readList(key: string): PinKey[] {
  try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}
function writeList(key: string, v: PinKey[]) {
  try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* stockage indisponible */ }
}
export function usePins(org: number | string | null) {
  const pk = `cm.pins.${org ?? 'perso'}`, rk = `cm.recent.${org ?? 'perso'}`
  const [pins, setPins] = useState<PinKey[]>(() => readList(pk))
  const [recent, setRecent] = useState<PinKey[]>(() => readList(rk))
  useEffect(() => { setPins(readList(pk)); setRecent(readList(rk)) }, [pk, rk])
  const togglePin = (k: PinKey) => setPins(p => { const n = p.includes(k) ? p.filter(x => x !== k) : [...p, k]; writeList(pk, n); return n })
  const touch = (k: PinKey) => setRecent(r => { const n = [k, ...r.filter(x => x !== k)].slice(0, 6); writeList(rk, n); return n })
  return { pins, recent, togglePin, touch }
}

// ---------------------------------------------------------------------------
// Sélecteur
// ---------------------------------------------------------------------------
type Row = { kind: 'group'; g: Group } | { kind: 'account'; a: Account }

interface Common {
  accounts: Account[]
  groups: Group[]
  pins?: PinKey[]
  onTogglePin?: (k: PinKey) => void
  /** Onglet ouvert au départ. */
  initialTab?: 'groups' | 'accounts'
  /** Comptes seulement (pas d'onglet Groupes), ex. composer un groupe. */
  accountsOnly?: boolean
  footer?: ReactNode
  /** Propriétaire d'un groupe ou d'un compte partagé avec moi (« Nathan »), sinon null. */
  ownerOf?: (x: { org_id?: number | null }) => string | null
}
interface Single extends Common {
  mode: 'single'
  /** `groups` : plusieurs groupes cochés (filtre « Tous / groupes »). */
  value: { group: number | null; account: string | null; groups?: number[] }
  onPick: (v: { group: number | null; account: string | null }) => void
}
interface Multi extends Common {
  mode: 'multi'
  picked: string[]
  onChange: (keys: string[]) => void
  /** Raison pour laquelle un compte ne peut pas être choisi (ou null). */
  disabled?: (a: Account) => string | null
  /** Ligne d'info sous le nom du compte. */
  detail?: (a: Account) => ReactNode
}

export function AccountPicker(props: Single | Multi) {
  const { accounts, groups, pins = [], onTogglePin } = props
  const desktop = useDesktop()
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'groups' | 'accounts'>(props.accountsOnly ? 'accounts' : props.initialTab || (groups.length ? 'groups' : 'accounts'))
  const [platform, setPlatform] = useState<'' | Platform>('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const id = useId()
  const byKey = useMemo(() => new Map(accounts.map(a => [accKey(a), a])), [accounts])
  const membersOf = (g: Group) => g.accounts.map(x => byKey.get(accKey(x))).filter(Boolean) as Account[]
  const n = norm(query)

  const rows: Row[] = useMemo(() => {
    const pinRank = (k: PinKey) => (pins.includes(k) ? 0 : 1)
    if (tab === 'groups') {
      return groups.filter(g => !n || norm(g.name).includes(n))
        .sort((x, y) => pinRank(`g:${x.id}`) - pinRank(`g:${y.id}`))
        .map(g => ({ kind: 'group' as const, g }))
    }
    return accounts.filter(a => (!platform || a.platform === platform)
      && (!n || norm(a.name).includes(n) || norm(a.handle).includes(n) || norm(a.username).includes(n)))
      .sort((x, y) => pinRank(`a:${accKey(x)}`) - pinRank(`a:${accKey(y)}`) || norm(x.name).localeCompare(norm(y.name)))
      .map(a => ({ kind: 'account' as const, a }))
  }, [tab, groups, accounts, n, platform, pins])
  useEffect(() => { setActive(0) }, [tab, n, platform])
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  // --- sélection ---
  const isOn = (r: Row): boolean | 'mixed' => {
    if (props.mode === 'single') {
      if (r.kind === 'account') return props.value.account === accKey(r.a)
      return !props.value.account && (props.value.groups ? props.value.groups.includes(r.g.id) : props.value.group === r.g.id)
    }
    if (r.kind === 'account') return props.picked.includes(accKey(r.a))
    const keys = membersOf(r.g).filter(a => !props.disabled?.(a)).map(accKey)
    const on = keys.filter(k => props.picked.includes(k)).length
    return on === 0 ? false : on === keys.length ? true : 'mixed'
  }
  const choose = (r: Row) => {
    if (props.mode === 'single') {
      props.onPick(r.kind === 'group' ? { group: r.g.id, account: null } : { group: null, account: accKey(r.a) })
      return
    }
    if (r.kind === 'account') {
      if (props.disabled?.(r.a)) return
      const k = accKey(r.a)
      props.onChange(props.picked.includes(k) ? props.picked.filter(x => x !== k) : [...props.picked, k])
      return
    }
    const keys = membersOf(r.g).filter(a => !props.disabled?.(a)).map(accKey)
    props.onChange(isOn(r) === true ? props.picked.filter(k => !keys.includes(k)) : [...new Set([...props.picked, ...keys])])
  }
  const selectAllShown = () => {
    if (props.mode !== 'multi') return
    const keys = rows.flatMap(r => (r.kind === 'account' ? [r.a] : membersOf(r.g))).filter(a => !props.disabled?.(a)).map(accKey)
    props.onChange([...new Set([...props.picked, ...keys])])
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(rows.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)) }
    else if (e.key === 'Enter' && rows[active]) { e.preventDefault(); choose(rows[active]) }
  }
  const counts = { groups: groups.length, accounts: accounts.length }
  const optId = (i: number) => `${id}-o${i}`

  return (
    <div className="picker" onKeyDown={onKey}>
      <div className="searchbox" style={{ maxWidth: 'none' }}>
        <Icon name="search" size={16} />
        <input className="input" type="search" role="combobox" aria-expanded="true" aria-controls={`${id}-list`}
               aria-activedescendant={rows[active] ? optId(active) : undefined} aria-autocomplete="list"
               autoFocus={desktop} value={query} onChange={e => setQuery(e.target.value)} enterKeyHint="search"
               placeholder={tab === 'groups' ? t('Rechercher un groupe') : t('Rechercher un compte')} aria-label={t('Rechercher')} autoComplete="off" />
        {query && <button type="button" className="searchbox-clear" aria-label={t('Effacer la recherche')} onClick={() => setQuery('')}><Icon name="close" size={16} /></button>}
      </div>
      {!props.accountsOnly && <div className="picker-tabs" role="tablist" aria-label={t('Choisir parmi')}>
        {(['groups', 'accounts'] as const).map(k => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {k === 'groups' ? t('Groupes') : t('Comptes')} <span className="fchip-n">{counts[k]}</span>
          </button>
        ))}
      </div>}
      {tab === 'accounts' && (
        <div className="picker-plat" role="group" aria-label={t('Plateforme')}>
          <button type="button" className="chip chip-sm" aria-pressed={platform === ''} onClick={() => setPlatform('')}>{t('Toutes')}</button>
          {PLATFORMS.filter(p => accounts.some(a => a.platform === p)).map(p => (
            <button key={p} type="button" className="chip chip-sm" aria-pressed={platform === p} onClick={() => setPlatform(platform === p ? '' : p)}
                    aria-label={PLATFORM_LABEL[p]} title={PLATFORM_LABEL[p]}>
              <PlatformLogo platform={p} size={16} /><span className="only-desktop">{PLATFORM_LABEL[p]}</span>
            </button>
          ))}
        </div>
      )}
      <p className="sr-only" aria-live="polite">{rows.length > 1 ? t('{n} résultats', { n: rows.length }) : t('{n} résultat', { n: rows.length })}</p>
      <ul id={`${id}-list`} ref={listRef} className="picker-list" role="listbox" aria-multiselectable={props.mode === 'multi' || undefined}
          aria-label={tab === 'groups' ? t('Groupes') : t('Comptes')}>
        {rows.map((r, i) => {
          const on = isOn(r)
          const pinKey: PinKey = r.kind === 'group' ? `g:${r.g.id}` : `a:${accKey(r.a)}`
          const why = r.kind === 'account' && props.mode === 'multi' ? props.disabled?.(r.a) : null
          return (
            <li key={pinKey} id={optId(i)} data-i={i} role="option" aria-selected={on === true} aria-disabled={!!why || undefined}
                className={`picker-row${i === active ? ' active' : ''}${why ? ' off' : ''}`}
                onMouseMove={() => setActive(i)} onClick={() => choose(r)}>
              {props.mode === 'multi' && (
                <span className={`pcheck${on === true ? ' on' : on === 'mixed' ? ' mixed' : ''}`} aria-hidden="true">
                  {on === true ? <Icon name="check" size={14} /> : on === 'mixed' ? '–' : null}
                </span>
              )}
              {r.kind === 'group' ? (
                <>
                  <span className="picker-ico"><GroupDot color={r.g.color} /></span>
                  <span className="grow col" style={{ minWidth: 0, gap: 0 }}>
                    <span className="ellipsis strong">{r.g.name}</span>
                    <span className="tiny muted row-nw" style={{ gap: 4 }}>
                      {props.ownerOf?.(r.g) && <span className="ellipsis">{t('Partagé par {name} ·', { name: props.ownerOf(r.g) })}</span>}
                      {membersOf(r.g).length > 1 ? t('{n} comptes', { n: membersOf(r.g).length }) : t('{n} compte', { n: membersOf(r.g).length })}
                      {[...new Set(membersOf(r.g).map(a => a.platform))].map(p => <PlatformLogo key={p} platform={p} size={12} />)}
                    </span>
                  </span>
                </>
              ) : (
                <>
                  <span className="fchip-av"><Avatar src={r.a.avatar_url} name={r.a.name} size="sm" /><PlatformLogo platform={r.a.platform} size={12} /></span>
                  <span className="grow col" style={{ minWidth: 0, gap: 0 }}>
                    <span className="ellipsis strong">{r.a.name || PLATFORM_LABEL[r.a.platform]}</span>
                    <span className="tiny muted ellipsis">{why || (props.mode === 'multi' && props.detail ? props.detail(r.a) : PLATFORM_LABEL[r.a.platform])}{!why && props.ownerOf?.(r.a) ? ` · ${t('de {owner}', { owner: props.ownerOf(r.a) })}` : ''}</span>
                  </span>
                </>
              )}
              {onTogglePin && (
                <button type="button" className={`pin${pins.includes(pinKey) ? ' on' : ''}`} aria-pressed={pins.includes(pinKey)}
                        aria-label={pins.includes(pinKey) ? t('Désépingler {name}', { name: r.kind === 'group' ? r.g.name : r.a.name }) : t('Épingler {name}', { name: r.kind === 'group' ? r.g.name : r.a.name })}
                        onClick={e => { e.stopPropagation(); onTogglePin(pinKey) }}>
                  <Icon name="star" size={16} />
                </button>
              )}
              {props.mode === 'single' && on === true && <Icon name="check" />}
            </li>
          )
        })}
        {!rows.length && <li className="picker-empty muted small">{n ? t('Rien ne correspond à « {q} ».', { q: query }) : tab === 'groups' ? t('Aucun groupe.') : t('Aucun compte.')}</li>}
      </ul>
      {props.mode === 'multi' && rows.length > 1 && (
        <button type="button" className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={selectAllShown}>
          {n || platform ? t('Tout cocher (résultats affichés)') : t('Tout cocher')}
        </button>
      )}
      {props.footer}
    </div>
  )
}
