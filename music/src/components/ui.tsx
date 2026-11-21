import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useCart } from '../cart'
import { useAuth } from '../auth'
import { LANGS, useI18n, type Lang } from '../i18n'
import { consentState, setConsent, track, trackCode } from '../track'

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden="true">
      <path d="M17 3c-6.6 0-11 4.8-11 11.2V31l3.7-2.6 3.6 2.6 3.7-2.6 3.7 2.6 3.6-2.6L28 31V14.2C28 7.8 23.6 3 17 3z" fill="currentColor" />
      <circle cx="13" cy="15" r="2" fill="var(--bg)" /><circle cx="21" cy="15" r="2" fill="var(--bg)" />
    </svg>
  )
}

export const Icon = {
  heart: <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.2 0 3.9 1.3 5.2 3 1.3-1.7 3-3 5.2-3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z" /></svg>,
  star: <svg width="13" height="13" viewBox="0 0 24 24" fill="#F5A623" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z" /></svg>,
  bag: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 7h14l-1.2 12.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8z" /><path d="M9 7V6a3 3 0 0 1 6 0v1" /></svg>,
  close: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>,
  down: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 4v11" /><path d="M7 10l5 5 5-5" /><path d="M5 20h14" /></svg>,
  dl: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M4 19h16" /></svg>,
  note: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></svg>,
  lock: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>,
  eye: <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>,
  ok: <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#1D8A3A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M7.5 12.5l3 3 6-6.5" /></svg>,
}

/** Une feuille de partition : l'aperçu réel s'il existe, sinon une portée dessinée. */
export function Paper({ src, title, alt = '' }: { src?: string | null; title?: string; alt?: string }) {
  const [broken, setBroken] = useState(false)
  if (src && !broken) {
    return <div className="paper"><img src={src} alt={alt} loading="lazy" onError={() => setBroken(true)} /></div>
  }
  return (
    <div className="paper paper-drawn" aria-hidden="true">
      {title && <div className="pt">{title}</div>}
      {[0, 1, 2, 3, 4].map(i => <div key={i} className="staff" />)}
    </div>
  )
}

export function Header() {
  const { t, lang, setLang } = useI18n()
  const cart = useCart()
  const { me } = useAuth()
  return (
    <header className="top">
      <div className="wrap top-row">
        <Link to="/" className="brand"><Logo />Ghost Hands <small>{t.brandSub}</small></Link>
        <div className="top-actions">
          <LangMenu lang={lang} setLang={setLang} label={t.language} />
          <Link to="/account" className="icon-btn" aria-label={me ? `${t.account} : ${me.name}` : t.signIn}>
            {me ? <span className="avatar">{(me.name || me.email).slice(0, 1).toUpperCase()}</span>
                : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>}
          </Link>
          <button type="button" className="icon-btn" onClick={() => cart.openSheet()} aria-label={`${t.cart} (${cart.lines.length})`}>
            {Icon.bag}
            {cart.lines.length > 0 && <span className="badge">{cart.lines.length}</span>}
          </button>
        </div>
      </div>
    </header>
  )
}

/** Drapeaux en SVG (les drapeaux emoji ne s'affichent pas sous Windows). */
export function Flag({ code, size = 20 }: { code: Lang; size?: number }) {
  const h = Math.round(size * 0.7)
  const box = { width: size, height: h, borderRadius: 3, display: 'block', boxShadow: '0 0 0 1px rgba(0,0,0,0.12)' } as const
  if (code === 'fr') return <svg viewBox="0 0 3 2" style={box} aria-hidden="true"><rect width="1" height="2" fill="#002654" /><rect x="1" width="1" height="2" fill="#fff" /><rect x="2" width="1" height="2" fill="#CE1126" /></svg>
  if (code === 'es') return <svg viewBox="0 0 3 2" style={box} aria-hidden="true"><rect width="3" height="2" fill="#AA151B" /><rect y="0.5" width="3" height="1" fill="#F1BF00" /></svg>
  if (code === 'ru') return <svg viewBox="0 0 3 2" style={box} aria-hidden="true"><rect width="3" height="2" fill="#fff" /><rect y="0.667" width="3" height="0.667" fill="#0039A6" /><rect y="1.333" width="3" height="0.667" fill="#D52B1E" /></svg>
  return (
    <svg viewBox="0 0 60 30" style={box} aria-hidden="true" preserveAspectRatio="none">
      <rect width="60" height="30" fill="#012169" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#C8102E" strokeWidth="2.4" />
      <path d="M30,0 V30 M0,15 H60" stroke="#fff" strokeWidth="10" />
      <path d="M30,0 V30 M0,15 H60" stroke="#C8102E" strokeWidth="6" />
    </svg>
  )
}

/** Menu de langue : montre la langue COURANTE (drapeau + code), la liste s'ouvre au clic. */
function LangMenu({ lang, setLang, label }: { lang: Lang; setLang: (l: Lang) => void; label: string }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [open])
  const current = LANGS.find(l => l.code === lang)!
  return (
    <div className="lang" ref={box}>
      <button type="button" className="icon-btn" aria-haspopup="listbox" aria-expanded={open}
              aria-label={`${label} : ${current.name}`} onClick={() => setOpen(o => !o)}>
        <Flag code={lang} /><span className="lang-code">{lang.toUpperCase()}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <ul className="lang-list" role="listbox" aria-label={label}>
          {LANGS.map(l => (
            <li key={l.code}>
              <button type="button" role="option" aria-selected={l.code === lang}
                      onClick={() => { track('lang', { to: l.code }); setLang(l.code); setOpen(false) }}>
                <Flag code={l.code} /><span>{l.name}</span>
                {l.code === lang && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function Footer() {
  const { t } = useI18n()
  return (
    <footer className="foot">
      <div className="wrap">
        <p>{t.footerPrices}</p>
        <div className="foot-row">
          <span>{t.footerService}</span>
          <nav aria-label="Legal">
            <Link to="/legal/terms">{t.terms}</Link>
            <Link to="/legal/use">{t.use}</Link>
            <Link to="/legal/privacy">{t.privacy}</Link>
            <Link to="/legal/notice">{t.notice}</Link>
            {trackCode() && <button type="button" className="linkish" onClick={() => window.dispatchEvent(new Event('gh-track-manage'))}>{t.trackManage}</button>}
            <a href="mailto:music@chapote.fr">{t.contact}</a>
          </nav>
        </div>
      </div>
    </footer>
  )
}

/** Étoiles (note moyenne ou saisie). `onPick` = étoiles cliquables. */
export function Stars({ value, small, label, onPick }: { value: number; small?: boolean; label?: string; onPick?: (n: number) => void }) {
  const size = small ? 13 : 22
  return (
    <span className={`stars${small ? ' small' : ''}`} role={onPick ? 'radiogroup' : 'img'} aria-label={label}>
      {[1, 2, 3, 4, 5].map(i => {
        const fill = Math.max(0, Math.min(1, value - (i - 1)))
        const star = (
          <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <defs><linearGradient id={`st${i}-${Math.round(fill * 100)}`}><stop offset={`${fill * 100}%`} stopColor="#F5A623" /><stop offset={`${fill * 100}%`} stopColor="var(--line)" /></linearGradient></defs>
            <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z" fill={`url(#st${i}-${Math.round(fill * 100)})`} />
          </svg>
        )
        return onPick
          ? <button key={i} type="button" role="radio" aria-checked={Math.round(value) === i} aria-label={`${i}`} onClick={() => onPick(i)}>{star}</button>
          : <span key={i}>{star}</span>
      })}
    </span>
  )
}

export function Center({ children }: { children: ReactNode }) {
  return <div className="center">{children}</div>
}


/** Bannière d'accord du suivi : seulement pour un visiteur arrivé par un lien suivi (?b=…), tant qu'il n'a pas choisi. */
export function TrackBanner() {
  const { t } = useI18n()
  const [open, setOpen] = useState(() => !!trackCode() && consentState() === null)
  useEffect(() => {
    const show = () => setOpen(true)
    window.addEventListener('gh-track-manage', show)
    return () => window.removeEventListener('gh-track-manage', show)
  }, [])
  if (!open || !trackCode()) return null
  const choose = (yes: boolean) => { setConsent(yes); setOpen(false) }
  return (
    <div className="track-banner" role="dialog" aria-live="polite" aria-label={t.trackManage}>
      <button type="button" className="track-close" aria-label={t.trackNo} onClick={() => choose(false)}>{Icon.close}</button>
      <p>{t.trackText} <Link to="/legal/privacy">{t.trackManage}</Link></p>
      <button type="button" className="btn small block" onClick={() => choose(true)}>{t.trackYes}</button>
    </div>
  )
}
