// Démo interactive de la page d'accueil : le visiteur programme une vidéo de démonstration (comptes + heure),
// puis la voit passer de « programmée » à « publiée » dans le planning. Rien n'est envoyé : tout est local.
// Sans geste du visiteur, la démo se joue toute seule (quand elle est visible), comme une courte vidéo de
// l'outil en action. Au premier geste, elle s'arrête et le visiteur prend la main.
// Le choix du visiteur est gardé (sessionStorage) pour le rappeler sur la page d'inscription.
// CSS et quelques minuteries, aucune librairie. « Animations réduites » : pas de lecture automatique.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Platform } from '../api'
import { PlatformLogo } from '../components/PlatformLogo'
import './demo.css'
import { getLang, t } from '../i18n'

const NETS: { p: Platform; label: string }[] = [
  { p: 'tiktok', label: 'TikTok' }, { p: 'youtube', label: 'YouTube' }, { p: 'instagram', label: 'Instagram' },
]
const WHEN = { soir: { label: 'Ce soir', time: '18:30', before: '18:29' }, demain: { label: 'Demain', time: '12:00', before: '11:59' } }
type When = keyof typeof WHEN
type Status = 'prog' | 'run' | 'ok'
const TITLE = 'Hansel et Gretel — partie 2'
export const DEMO_KEY = 'cm.demo'

/** Choix fait dans la démo (gardé pour l'inscription), ou null. */
export function readDemoChoice(): { nets: Platform[]; when: When } | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(DEMO_KEY) || 'null')
    if (v && Array.isArray(v.nets) && v.nets.length && (v.when === 'soir' || v.when === 'demain')) return v
  } catch { /* stockage indisponible */ }
  return null
}
export function demoChoiceText(c: { nets: Platform[]; when: When }) {
  const names = NETS.filter(n => c.nets.includes(n.p)).map(n => n.label)
  const list = names.length > 1 ? t('{first} et {last}', { first: names.slice(0, -1).join(', '), last: names[names.length - 1] }) : names[0]
  const W = WHEN[c.when]
  const time = getLang() === 'en' ? W.time : W.time.replace(':', ' h ')
  return `${list}, ${t('{when} à {time}', { when: t(W.label).toLowerCase(), time })}`
}

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export default function Demo({ autoOnly = false }: { autoOnly?: boolean }) {
  const [nets, setNets] = useState<Platform[]>([])
  const [when, setWhen] = useState<When | null>(null)
  const [screen, setScreen] = useState<'compose' | 'planning'>('compose')
  const [status, setStatus] = useState<Record<string, Status>>({})
  const [clock, setClock] = useState('')
  const [done, setDone] = useState(false)
  const [tap, setTap] = useState('')            // élément « touché » par la lecture automatique (effet d'onde)
  const [user, setUser] = useState(false)       // le visiteur a pris la main
  const timers = useRef<number[]>([])
  const root = useRef<HTMLDivElement>(null)
  const visible = useRef(false)
  const userRef = useRef(false)

  const clear = () => { timers.current.forEach(clearTimeout); timers.current = [] }
  const at = (ms: number, f: () => void) => { timers.current.push(window.setTimeout(f, ms)) }

  const reset = useCallback(() => {
    clear(); setNets([]); setWhen(null); setScreen('compose'); setStatus({}); setClock(''); setDone(false); setTap('')
  }, [])

  /** Le planning : la publication arrive, l'heure passe, chaque réseau passe à « publiée ». */
  const run = useCallback((n: Platform[], w: When, offset = 0) => {
    const W = WHEN[w]
    at(offset, () => { setScreen('planning'); setClock(W.before); setStatus(Object.fromEntries(n.map(p => [p, 'prog']))) })
    at(offset + 1500, () => { setClock(W.time); setStatus(Object.fromEntries(n.map(p => [p, 'run']))) })
    n.forEach((p, i) => at(offset + 2200 + i * 550, () => setStatus(s => ({ ...s, [p]: 'ok' }))))
    at(offset + 2400 + n.length * 550, () => setDone(true))
  }, [])

  /** Lecture automatique : les gestes d'un utilisateur, en boucle. */
  const autoplay = useCallback(() => {
    reset()
    const all: Platform[] = ['tiktok', 'youtube', 'instagram']
    all.forEach((p, i) => at(700 + i * 550, () => { setTap(p); setNets(s => [...s, p]) }))
    at(2500, () => { setTap('soir'); setWhen('soir') })
    at(3300, () => setTap('go'))
    run(all, 'soir', 3700)
    at(3700 + 2400 + 3 * 550 + 3600, () => { if (visible.current) autoplay() })
  }, [reset, run])

  useEffect(() => {
    if (reduced()) {   // état final, sans mouvement
      setNets(['tiktok', 'youtube', 'instagram']); setWhen('soir'); setScreen('planning'); setClock('18:30')
      setStatus({ tiktok: 'ok', youtube: 'ok', instagram: 'ok' }); setDone(true)
      return
    }
    const el = root.current
    if (!el || !('IntersectionObserver' in window)) { visible.current = true; autoplay(); return clear }
    const io = new IntersectionObserver(([e]) => {
      const was = visible.current
      visible.current = e.isIntersecting
      if (e.isIntersecting && !was && !userRef.current) autoplay()
      if (!e.isIntersecting && !userRef.current) clear()
    }, { threshold: 0.4 })
    io.observe(el)
    return () => { io.disconnect(); clear() }
  }, [autoplay])

  const takeOver = () => {
    if (autoOnly || userRef.current) return
    userRef.current = true; setUser(true); reset()
  }

  const toggle = (p: Platform) => setNets(s => s.includes(p) ? s.filter(x => x !== p) : [...s, p])
  const program = () => {
    if (!nets.length || !when) return
    try { sessionStorage.setItem(DEMO_KEY, JSON.stringify({ nets, when })) } catch { /* stockage indisponible */ }
    run(NETS.map(n => n.p).filter(p => nets.includes(p)), when)
  }
  const again = () => { reset() }

  const ready = nets.length > 0 && when
  const hint = !nets.length ? t('Choisissez au moins un compte.') : !when ? t('Choisissez l’heure.') : ''
  const shown = NETS.filter(n => nets.includes(n.p))

  return (
    <div ref={root} className={`dm${autoOnly ? ' dm-auto' : ''}`} onPointerDownCapture={takeOver} onKeyDownCapture={takeOver}
         role="group" aria-label={t('Démo : programmez une vidéo de démonstration (rien n’est publié)')}>
      <div className={`dm-screen${screen === 'compose' ? ' on' : ''}`} aria-hidden={screen !== 'compose'}>
        <p className="dm-bar">{t('Nouvelle publication')}</p>
        <div className="dm-video">
          <span className="dm-thumb" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 7.5v9l7.5-4.5z" fill="#fff" /></svg></span>
          <span><b>{t(TITLE)}</b><small>{t('0:58 · vidéo verticale')}</small></span>
        </div>
        <p className="dm-label">{t('Sur quels comptes ?')}</p>
        <div className="dm-chips">
          {NETS.map(n => (
            <button key={n.p} type="button" tabIndex={autoOnly ? -1 : 0} aria-pressed={nets.includes(n.p)}
                    className={`dm-chip${tap === n.p ? ' tap' : ''}`} onClick={() => toggle(n.p)}>
              <PlatformLogo platform={n.p} size={16} />{n.label}
            </button>
          ))}
        </div>
        <p className="dm-label">{t('Quand ?')}</p>
        <div className="dm-chips">
          {(Object.keys(WHEN) as When[]).map(k => (
            <button key={k} type="button" tabIndex={autoOnly ? -1 : 0} aria-pressed={when === k}
                    className={`dm-chip${tap === k ? ' tap' : ''}`} onClick={() => setWhen(k)}>
              {t(WHEN[k].label)} · {WHEN[k].time}
            </button>
          ))}
        </div>
        <div className="dm-foot">
          <button type="button" tabIndex={autoOnly ? -1 : 0} className={`dm-go${tap === 'go' ? ' tap' : ''}`} aria-disabled={!ready} onClick={program}>
            {ready ? (nets.length > 1 ? t('Planifier sur {n} comptes', { n: nets.length }) : t('Planifier sur {n} compte', { n: nets.length })) : t('Planifier')}
          </button>
          <p className="dm-hint" aria-live="polite">{user ? hint : ''}</p>
        </div>
      </div>

      <div className={`dm-screen dm-plan${screen === 'planning' ? ' on' : ''}`} aria-hidden={screen !== 'planning'}>
        <p className="dm-bar">{t('Planning')} <span className="dm-clock" aria-hidden="true">{clock}</span></p>
        <p className="dm-day">{when ? t(WHEN[when].label) : ''}</p>
        <ul className="dm-list">
          {shown.map((n, i) => {
            const s = status[n.p] || 'prog'
            return (
              <li key={n.p} style={{ animationDelay: `${i * 120}ms` }}>
                <span className="dm-time">{when ? WHEN[when].time : ''}</span>
                <span className="dm-what"><b>{t(TITLE)}</b><span className="dm-net"><PlatformLogo platform={n.p} size={13} />{n.label}</span></span>
                <span className={`dm-st ${s}`}>{s === 'ok' ? <><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5l4 4 8-9" /></svg>{t('Publiée')}</> : s === 'run' ? t('Envoi…') : t('Programmée')}</span>
              </li>
            )
          })}
        </ul>
        <div className={`dm-toast${done ? ' on' : ''}`} aria-live={user ? 'polite' : 'off'}>
          {done && <>
            <b>{shown.length > 1 ? t('Publié sur {n} comptes, à l’heure.', { n: shown.length }) : t('Publié sur {n} compte, à l’heure.', { n: shown.length })}</b>
            {!autoOnly && user && <button type="button" className="dm-again" onClick={again}>{t('Recommencer')}</button>}
          </>}
        </div>
      </div>
    </div>
  )
}
