// Démo publique « 1 URL -> chatbot » (route /demo, SANS auth). Un visiteur colle
// l'adresse de son site, on génère un arbre de décision via /api/public/demo-tree
// (cache DB + anti-abus côté serveur : captcha Turnstile, limite IP/jour, plafond
// global) et on l'affiche en LIVE grâce à WidgetPreview (rendu 100 % local du
// tree_json, aucun appel IA supplémentaire). CTA d'inscription en sortie de tunnel.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import { api, ApiError } from '../api'
import { Header } from '../components/landing/Header'
import { Footer } from '../components/landing/Footer'
import { useChapoteAssets } from '../components/landing/assets'
import WidgetPreview from '../components/WidgetPreview'
import type { DesignJson, Tree } from '../types/bot'

// Palette de marque (mêmes tokens que la landing).
const NAVY = '#1C3F5C'
const MINT = '#2F9E79'
const INK = '#1E2A32'
const MUT = '#6B7B8D'
const BG = '#F9F9FB'

// Clé publique Turnstile bakée au build. Absente => pas de captcha affiché (et le
// serveur ignore la vérification tant que TURNSTILE_SECRET_KEY est vide).
const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) || ''

const EXAMPLES = ['https://www.service-public.fr', 'https://www.bpifrance.fr']

function hostOf(url: string): string {
  try { return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '') }
  catch { return 'votre-site.fr' }
}

export default function Demo() {
  const { user } = useAuth()
  // Header/Footer partagés s'appuient sur les classes globales de la landing
  // (.ch-navlink, .ch-flink, .ch-menu-btn, .ch-footer-grid…) injectées par ce
  // hook : sans lui, les liens du footer héritent de la couleur de lien par
  // défaut (invisibles sur le bleu foncé) et le burger s'affiche en desktop.
  useChapoteAssets()
  const [enabled, setEnabled] = useState(true)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tree, setTree] = useState<Tree | null>(null)
  const [cached, setCached] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)  // = url_hash, pour le chat IA
  const [chatToken, setChatToken] = useState<string | null>(null)  // jeton (captcha) débloquant le chat
  const [token, setToken] = useState<string | null>(null)
  const widgetRef = useRef<HTMLDivElement | null>(null)
  const rendered = useRef(false)

  // Design stable passé à l'aperçu (évite un reset à chaque render). useMemo
  // TYPÉ pour que 'right'/'md' restent des littéraux (DesignJson), pas des string.
  const design = useMemo<DesignJson>(() => ({
    primaryColor: NAVY, secondaryColor: MINT, position: 'right', size: 'md',
    poweredBy: true, welcomeMessage: 'Bonjour 👋 Comment puis-je vous aider ?',
  }), [])
  const botName = useMemo(() => hostOf(url) || 'Assistant', [tree]) // figé à la génération

  // État de la démo (peut être coupée via DEMO_ENABLED côté serveur).
  useEffect(() => {
    let alive = true
    api<{ enabled: boolean }>('/api/public/demo-config')
      .then(c => { if (alive) setEnabled(c.enabled) })
      .catch(() => { /* indisponible -> on suppose actif, le POST tranchera */ })
    return () => { alive = false }
  }, [])

  // Widget Turnstile (rendu explicite). Sans clé publique : rien (dev).
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return
    const w = window as any
    function render() {
      if (!w.turnstile || !widgetRef.current || rendered.current) return
      rendered.current = true
      w.turnstile.render(widgetRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (t: string) => setToken(t),
        'error-callback': () => setToken(null),
        'expired-callback': () => setToken(null),
      })
    }
    if (w.turnstile) { render(); return }
    const id = 'cf-turnstile-script'
    let s = document.getElementById(id) as HTMLScriptElement | null
    if (!s) {
      s = document.createElement('script')
      s.id = id
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      s.async = true; s.defer = true
      document.head.appendChild(s)
    }
    s.addEventListener('load', render)
    return () => { s?.removeEventListener('load', render) }
  }, [])

  const captchaPending = !!TURNSTILE_SITE_KEY && !token

  async function generate() {
    const value = url.trim()
    if (!value || busy || captchaPending) return
    setBusy(true); setError(''); setTree(null)
    try {
      const res = await api<{ tree_json: Tree; cached: boolean; session_id: string; chat_token: string | null }>('/api/public/demo-tree', {
        method: 'POST', body: { url: value, turnstile_token: token },
      })
      setTree(res.tree_json); setCached(res.cached); setSessionId(res.session_id); setChatToken(res.chat_token)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Génération impossible, réessayez dans un instant.')
    } finally {
      setBusy(false)
      // Un token Turnstile est à USAGE UNIQUE : le serveur le consomme dès la
      // vérification, AVANT les éventuels 429/503/422. On réarme donc un challenge
      // frais à CHAQUE tentative (succès comme échec), sinon un nouveau clic
      // renverrait un token déjà consommé -> boucle 403.
      const w = window as any
      if (TURNSTILE_SITE_KEY && w.turnstile && widgetRef.current) {
        try { w.turnstile.reset(widgetRef.current) } catch { /* noop */ }
        setToken(null)
      }
    }
  }

  return (
    <div style={{ fontFamily: "'Inter',system-ui,sans-serif", background: BG, color: INK, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header user={user} ctaTo={user ? '/app' : '/register'} />

      <main style={{ flex: 1, maxWidth: 920, margin: '0 auto', padding: '48px 24px 72px', width: '100%' }}>
        <div style={{ textAlign: 'center' }}>
          <span style={{ display: 'inline-block', fontSize: 13, fontWeight: 600, color: MINT, background: 'rgba(47,158,121,.1)', border: '1px solid rgba(47,158,121,.25)', borderRadius: 999, padding: '5px 14px', marginBottom: 18 }}>
            Démo gratuite · sans inscription
          </span>
          <h1 style={{ fontSize: 'clamp(28px,5vw,44px)', lineHeight: 1.1, letterSpacing: '-.02em', margin: '0 0 14px' }}>
            Votre chatbot, généré depuis<br />l'adresse de votre site
          </h1>
          <p style={{ fontSize: 17, color: MUT, maxWidth: 560, margin: '0 auto 30px', lineHeight: 1.6 }}>
            Collez l'URL de votre site : on lit votre page et on construit un
            assistant prêt à l'emploi en quelques secondes.
          </p>
        </div>

        {!enabled ? (
          <div style={{ textAlign: 'center', color: MUT, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: '28px 22px', maxWidth: 520, margin: '0 auto' }}>
            La démo est momentanément indisponible. Revenez bientôt — ou{' '}
            <Link to="/register" style={{ color: NAVY, fontWeight: 600 }}>créez votre bot directement</Link>.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 620, margin: '0 auto' }}>
              <input
                value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') generate() }}
                placeholder="https://votre-site.fr"
                inputMode="url"
                autoFocus
                style={{ flex: '1 1 320px', minWidth: 0, fontSize: 16, padding: '14px 16px', borderRadius: 12, border: '1px solid #D4DEE6', background: '#fff', color: INK, outline: 'none' }}
              />
              <button
                onClick={generate}
                disabled={busy || !url.trim() || captchaPending}
                style={{ flex: '0 0 auto', fontSize: 15.5, fontWeight: 600, padding: '14px 24px', borderRadius: 12, border: 'none', cursor: busy || !url.trim() || captchaPending ? 'default' : 'pointer', color: '#fff', background: busy || !url.trim() || captchaPending ? '#9AAAB7' : NAVY, boxShadow: '0 6px 16px -8px rgba(28,63,92,.6)', transition: 'background .15s' }}
              >
                {busy ? 'Génération…' : 'Générer mon chatbot'}
              </button>
            </div>

            {/* Widget captcha (invisible/managed) — rendu seulement si clé publique. */}
            <div ref={widgetRef} style={{ display: 'flex', justifyContent: 'center', marginTop: TURNSTILE_SITE_KEY ? 16 : 0 }} />

            {/* Exemples cliquables */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 16 }}>
              <span style={{ fontSize: 13, color: MUT }}>Pas d'idée ?</span>
              {EXAMPLES.map(ex => (
                <button key={ex} onClick={() => setUrl(ex)} style={{ fontSize: 13, color: NAVY, background: 'transparent', border: '1px solid #D4DEE6', borderRadius: 999, padding: '4px 12px', cursor: 'pointer' }}>
                  {hostOf(ex)}
                </button>
              ))}
            </div>

            {error && (
              <div role="alert" style={{ marginTop: 20, maxWidth: 560, marginLeft: 'auto', marginRight: 'auto', fontSize: 14, color: '#9A2A2A', background: 'rgba(214,69,69,.08)', border: '1px solid rgba(214,69,69,.25)', borderRadius: 12, padding: '12px 16px', textAlign: 'center' }}>
                {error}
              </div>
            )}

            {busy && (
              <div style={{ marginTop: 28, textAlign: 'center', color: MUT, fontSize: 14 }}>
                Lecture de votre site et construction de l'arbre…
              </div>
            )}

            {tree && !busy && (
              <div style={{ marginTop: 32, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 18, padding: '26px 24px', textAlign: 'center', maxWidth: 620, margin: '32px auto 0', boxShadow: '0 18px 40px -28px rgba(28,63,92,.45)' }}>
                <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
                  Votre chatbot est prêt 🎉
                </div>
                <p style={{ color: MUT, fontSize: 14.5, lineHeight: 1.6, margin: '0 0 18px' }}>
                  Il est ouvert en bas à droite de l'écran — cliquez sur les
                  options pour l'essayer.{cached ? ' (servi depuis le cache)' : ''}
                </p>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <Link to="/register" style={{ fontSize: 15, fontWeight: 600, padding: '12px 22px', borderRadius: 12, background: NAVY, color: '#fff', textDecoration: 'none', boxShadow: '0 6px 16px -8px rgba(28,63,92,.6)' }}>
                    Créer mon compte pour l'installer →
                  </Link>
                  <button onClick={() => { setTree(null); setError('') }} style={{ fontSize: 15, fontWeight: 600, padding: '12px 20px', borderRadius: 12, background: 'transparent', color: NAVY, border: '1px solid #D4DEE6', cursor: 'pointer' }}>
                    Essayer une autre URL
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      <Footer />

      {/* Aperçu live : overlay plein écran (calque transparent), lanceur ouvert. */}
      {tree && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 70, pointerEvents: 'none' }}>
          <div style={{ pointerEvents: 'auto' }}>
            {/* mode hybrid : le menu généré + bascule « Autre question » -> IA.
                onAiMessage = VRAIE réponse IA bornée au contenu scrapé du site
                (POST /api/public/demo-chat), via session_id = url_hash. */}
            <WidgetPreview design={design} mode="hybrid" tree={tree} botName={botName} defaultOpen
              onAiMessage={sessionId ? async (text, history) => {
                try {
                  const res = await api<{ reply: string }>('/api/public/demo-chat', {
                    method: 'POST',
                    body: { session_id: sessionId, chat_token: chatToken, message: text, history: history.slice(-6) },
                  })
                  return res.reply
                } catch (e) {
                  // Remonte le message FR précis (409 session / 429 quota / 503 capacité).
                  return e instanceof ApiError ? e.message : 'Désolé, je ne peux pas répondre pour le moment.'
                }
              } : undefined} />
          </div>
        </div>
      )}
    </div>
  )
}
