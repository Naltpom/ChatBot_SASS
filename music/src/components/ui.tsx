import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useCart } from '../cart'
import { useI18n } from '../i18n'

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden="true">
      <path d="M17 3c-6.6 0-11 4.8-11 11.2V31l3.7-2.6 3.6 2.6 3.7-2.6 3.7 2.6 3.6-2.6L28 31V14.2C28 7.8 23.6 3 17 3z" fill="#1D1D1F" />
      <circle cx="13" cy="15" r="2" fill="#fff" /><circle cx="21" cy="15" r="2" fill="#fff" />
    </svg>
  )
}

export const Icon = {
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
  return (
    <header className="top">
      <div className="wrap top-row">
        <Link to="/" className="brand"><Logo />Ghost Hands <small>{t.brandSub}</small></Link>
        <div className="top-actions">
          <button type="button" className="icon-btn" onClick={() => setLang(lang === 'en' ? 'fr' : 'en')}
                  aria-label={lang === 'en' ? 'Passer en français' : 'Switch to English'}>{t.langSwitch}</button>
          <button type="button" className="icon-btn" onClick={() => cart.openSheet()} aria-label={`${t.cart} (${cart.lines.length})`}>
            {Icon.bag}
            {cart.lines.length > 0 && <span className="badge">{cart.lines.length}</span>}
          </button>
        </div>
      </div>
    </header>
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
            <a href="mailto:support@chapote.fr">{t.contact}</a>
          </nav>
        </div>
      </div>
    </footer>
  )
}

export function Center({ children }: { children: ReactNode }) {
  return <div className="center">{children}</div>
}
