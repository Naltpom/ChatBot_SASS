// « Donner mon avis » sans compte (/avis, visiteur non connecté). Anti-robot : Cloudflare Turnstile (chargé
// seulement sur cette page), champ piège invisible, délai minimum de saisie ; l'API limite aussi par IP.
// Formulaire fermé (pas de clé Turnstile en production) : on propose de se connecter à la place.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, getContactConfig, sendContact } from '../api'
import { Msg } from '../components/ui'
import AuthLayout from './auth/AuthLayout'

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const TURNSTILE_JS = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

type Turnstile = { render: (el: HTMLElement, o: Record<string, unknown>) => string; reset: (id?: string) => void; remove: (id: string) => void }
declare global { interface Window { turnstile?: Turnstile } }

function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  return new Promise((resolve, reject) => {
    let s = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_JS}"]`)
    if (!s) { s = document.createElement('script'); s.src = TURNSTILE_JS; s.async = true; s.defer = true; document.head.appendChild(s) }
    s.addEventListener('load', () => window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')))
    s.addEventListener('error', () => reject(new Error('turnstile')))
  })
}

export default function Contact() {
  const [cfg, setCfg] = useState<{ enabled: boolean; turnstile_site_key: string | null } | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [emailErr, setEmailErr] = useState('')
  const [message, setMessage] = useState('')
  const [website, setWebsite] = useState('')          // champ piège
  const [token, setToken] = useState<string | null>(null)
  const [captchaErr, setCaptchaErr] = useState(false)
  const [err, setErr] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const started = useRef(Date.now())
  const box = useRef<HTMLDivElement>(null)
  const widget = useRef<string | null>(null)

  useEffect(() => { getContactConfig().then(setCfg).catch(() => setCfg({ enabled: false, turnstile_site_key: null })) }, [])

  useEffect(() => {
    const key = cfg?.turnstile_site_key
    if (!cfg?.enabled || !key || !box.current) return
    let cancelled = false
    loadTurnstile().then(t => {
      if (cancelled || !box.current || widget.current) return
      widget.current = t.render(box.current, {
        sitekey: key, language: 'fr', theme: 'auto', action: 'cm-contact',
        callback: (v: string) => { setToken(v); setCaptchaErr(false) },
        'expired-callback': () => setToken(null),
        'error-callback': () => { setToken(null); setCaptchaErr(true) },
      })
    }).catch(() => setCaptchaErr(true))
    return () => { cancelled = true; if (widget.current) { window.turnstile?.remove(widget.current); widget.current = null } }
  }, [cfg])

  const needCaptcha = !!cfg?.turnstile_site_key
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('')
    if (!EMAIL_OK.test(email.trim())) { setEmailErr('Adresse incomplète (ex. vous@exemple.fr).'); document.getElementById('c-email')?.focus(); return }
    if (message.trim().length < 5) { setErr('Écrivez votre message.'); return }
    if (needCaptcha && !token) { setErr('Cochez la vérification « Je suis humain » juste au-dessus.'); return }
    setState('busy')
    try {
      await sendContact({ name: name.trim(), email: email.trim(), message: message.trim(), website, elapsed_ms: Date.now() - started.current, turnstile_token: token })
      setState('done')
    } catch (e) {
      setErr((e as ApiError).message || 'L’envoi n’a pas marché. Réessayez.')
      setState('idle'); setToken(null)
      if (widget.current) window.turnstile?.reset(widget.current)
    }
  }

  return (
    <AuthLayout aside={<h2>Votre avis<br /><span className="em">décide de la suite.</span></h2>}>
      <div className="col" style={{ gap: 6 }}>
        <h1>Donner mon avis</h1>
        <p className="muted">Nathan lit chaque message et répond par e-mail.</p>
      </div>
      {state === 'done' ? (
        <div className="col" style={{ gap: 14 }}>
          <Msg kind="ok">Merci ! Votre message est bien parti. Vous aurez une réponse à l’adresse indiquée.</Msg>
          <Link to="/" className="btn btn-ghost btn-block">Retour à l’accueil</Link>
        </div>
      ) : cfg && !cfg.enabled ? (
        <div className="col" style={{ gap: 14 }}>
          <Msg kind="info">Pour donner votre avis, connectez-vous ou créez un compte gratuit.</Msg>
          <Link to="/connexion?suite=%2Favis" className="btn btn-primary btn-block">Se connecter</Link>
          <Link to="/inscription?suite=%2Favis" className="btn btn-ghost btn-block">Créer un compte</Link>
        </div>
      ) : (
        <form className="col" style={{ gap: 16 }} onSubmit={submit} noValidate>
          <label className="field" htmlFor="c-name">Votre prénom (facultatif)
            <input id="c-name" className="input" value={name} onChange={e => setName(e.target.value)} maxLength={80} autoComplete="given-name" />
          </label>
          <label className="field" htmlFor="c-email">E-mail, pour vous répondre
            <input id="c-email" className="input" type="email" value={email} required aria-invalid={!!emailErr} aria-describedby={emailErr ? 'c-email-err' : undefined}
                   onChange={e => { setEmail(e.target.value); if (emailErr && EMAIL_OK.test(e.target.value.trim())) setEmailErr('') }}
                   onBlur={() => email && setEmailErr(EMAIL_OK.test(email.trim()) ? '' : 'Adresse incomplète (ex. vous@exemple.fr).')}
                   autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} placeholder="vous@exemple.fr" />
            {emailErr && <span id="c-email-err" className="field-err" role="alert">{emailErr}</span>}
          </label>
          <label className="field" htmlFor="c-msg">Votre message
            <textarea id="c-msg" className="input" rows={6} maxLength={2000} required value={message} onChange={e => setMessage(e.target.value)}
                      placeholder={'Comment publiez-vous vos vidéos aujourd’hui ?\nQu’est-ce qui vous bloque, ou vous manque ?'} />
          </label>
          {/* Piège à robots : invisible et hors du parcours clavier ; un humain ne le remplit jamais. */}
          <div className="hp" aria-hidden="true">
            <label htmlFor="c-website">Site web</label>
            <input id="c-website" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} />
          </div>
          {needCaptcha && <div ref={box} className="captcha" />}
          {captchaErr && <Msg kind="err">La vérification anti-robot ne s’est pas chargée. Rechargez la page, ou <Link to="/connexion?suite=%2Favis">connectez-vous</Link> pour donner votre avis.</Msg>}
          {err && <Msg kind="err">{err}</Msg>}
          <button className="btn btn-primary btn-lg btn-block" disabled={state === 'busy' || !cfg}>
            {state === 'busy' ? <><span className="spin" aria-hidden="true" />Envoi…</> : 'Envoyer mon avis'}
          </button>
          <p className="muted small" style={{ textAlign: 'center' }}>
            Vous avez un compte ? <Link to="/connexion?suite=%2Favis" style={{ fontWeight: 600 }}>Connectez-vous</Link> pour envoyer votre avis depuis l’app.
          </p>
        </form>
      )}
    </AuthLayout>
  )
}
