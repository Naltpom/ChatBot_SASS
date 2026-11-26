// Bouton « Continuer avec Google » (Google Identity Services, flux ID token).
// Le bouton est dessiné par Google dans un cadre : on lui donne la largeur réelle du conteneur
// (400 px au plus, limite de Google), le thème de l'appareil (clair / sombre), une forme arrondie
// comme nos boutons, et une place réservée pendant le chargement pour éviter tout saut.
import { useEffect, useRef, useState } from 'react'
import { googleLogin } from '../api'
import { Msg } from './ui'
import { getLang, t } from '../i18n'

declare global {
  interface Window { google?: any; __gsiLoading?: Promise<void> }
}

function loadGsi(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve()
  if (!window.__gsiLoading) {
    window.__gsiLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://accounts.google.com/gsi/client'
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => { window.__gsiLoading = undefined; reject(new Error('gsi')) }
      document.head.appendChild(s)
    })
  }
  return window.__gsiLoading
}

const dark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches

export default function GoogleButton({ clientId, onResult, onCredential, text = 'continue_with' }:
  { clientId: string; onResult?: (r: unknown) => void | Promise<void>
    /** Mode « preuve » : reçoit l'ID token Google au lieu de connecter le compte. */
    onCredential?: (credential: string) => void | Promise<void>
    text?: 'continue_with' | 'signup_with' | 'signin_with' }) {
  const wrap = useRef<HTMLDivElement>(null)
  const slot = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [err, setErr] = useState('')
  const cb = useRef(onResult)
  cb.current = onResult
  const credCb = useRef(onCredential)
  credCb.current = onCredential

  useEffect(() => {
    let alive = true
    let lastWidth = 0
    const render = () => {
      if (!alive || !window.google?.accounts?.id || !slot.current || !wrap.current) return
      const width = Math.max(220, Math.min(400, Math.floor(wrap.current.clientWidth)))
      if (width === lastWidth) return
      lastWidth = width
      slot.current.innerHTML = ''
      window.google.accounts.id.renderButton(slot.current, {
        type: 'standard', theme: dark() ? 'filled_black' : 'outline', size: 'large', text,
        shape: 'pill', logo_alignment: 'center', width, locale: getLang(),
      })
      setReady(true)
    }
    loadGsi().then(() => {
      if (!alive) return
      window.google.accounts.id.initialize({
        client_id: clientId,
        ux_mode: 'popup',
        cancel_on_tap_outside: true,
        itp_support: true,
        callback: async (r: { credential: string }) => {
          setErr('')
          try {
            if (credCb.current) await credCb.current(r.credential)
            else await cb.current?.(await googleLogin(r.credential))
          } catch (e) { setErr((e as Error).message) }
        },
      })
      render()
    }).catch(() => alive && setErr(t('Connexion Google indisponible pour le moment : utilisez votre e-mail.')))
    const ro = new ResizeObserver(() => render())
    if (wrap.current) ro.observe(wrap.current)
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    const onScheme = () => { lastWidth = 0; render() }
    mq?.addEventListener?.('change', onScheme)
    return () => { alive = false; ro.disconnect(); mq?.removeEventListener?.('change', onScheme) }
  }, [clientId, text])

  return (
    <div className="col" style={{ gap: 8 }}>
      <div ref={wrap} className={`gbtn${ready ? '' : ' loading'}`} aria-busy={!ready}>
        <div ref={slot} style={{ display: 'flex', justifyContent: 'center', width: '100%', colorScheme: 'normal' }} />
      </div>
      {err && <Msg kind="err">{err}</Msg>}
    </div>
  )
}
