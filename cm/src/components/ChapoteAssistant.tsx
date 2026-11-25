// Assistant Chapote CM : le chatbot de chapote.fr (widget.js), embarqué sur cm.chapote.fr.
//
// DÉSACTIVÉ par défaut et branché sur AUCUNE page : rien ne change tant que le drapeau
// VITE_CM_ASSISTANT=on et la clé publique VITE_CM_ASSISTANT_KEY ne sont pas fournis au build
// (voir docs/WIDGET_CM.md), ET que le composant n'est pas placé dans une page.
//
// Performance : aucun octet du widget au premier affichage. Une bulle légère (même place,
// même taille que celle du widget) est dessinée par React ; widget.js n'est chargé qu'une fois
// la page affichée et le navigateur au repos, ou tout de suite au clic sur la bulle.
//
// Couleur : suit la couleur choisie dans cm (orange, bleu océan, vert forêt : variables CSS
// --primary / --on-primary posées par <html data-palette>) et le mode clair ou sombre de
// l'appareil, y compris quand ils changent pendant la visite.
//
// Données : le widget n'envoie que le chemin de la page (data-url-mode="path" : jamais les
// paramètres ni le fragment) et le parcours sur le site (chemins seulement). Aucune donnée de compte (nom, e-mail, téléphone, jetons) n'est transmise.
import { useEffect, useRef, useState } from 'react'

const ENABLED = import.meta.env.VITE_CM_ASSISTANT === 'on'
const BOT_KEY: string = import.meta.env.VITE_CM_ASSISTANT_KEY || ''
const WIDGET_SRC: string = import.meta.env.VITE_CM_ASSISTANT_SRC || 'https://chapote.fr/widget.js'

// Valeurs de secours si les variables CSS ne sont pas lisibles (mêmes valeurs que styles.css).
const FALLBACK: Record<string, { light: [string, string]; dark: [string, string] }> = {
  warm: { light: ['#C93F17', '#ffffff'], dark: ['#FF6A3D', '#1a0e08'] },
  ocean: { light: ['#0066cc', '#ffffff'], dark: ['#2997ff', '#00101f'] },
  forest: { light: ['#1f6b4a', '#ffffff'], dark: ['#5cc495', '#062014'] },
}

type Look = { color: string; colorText: string; theme: 'light' | 'dark' }

const HEX = /^#[0-9a-fA-F]{6}$/

function readLook(): Look {
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  const palette = document.documentElement.dataset.palette || 'warm'
  const fb = (FALLBACK[palette] || FALLBACK.warm)[dark ? 'dark' : 'light']
  const css = getComputedStyle(document.documentElement)
  const color = css.getPropertyValue('--primary').trim()
  const colorText = css.getPropertyValue('--on-primary').trim()
  return {
    color: HEX.test(color) ? color : fb[0],
    colorText: HEX.test(colorText) ? colorText : fb[1],
    theme: dark ? 'dark' : 'light',
  }
}

type WidgetApi = { open: () => void; close: () => void; setAppearance: (l: Look) => void }
declare global {
  interface Window { ChapoteWidget?: Record<string, WidgetApi> }
}

// Le widget ne peut pas s'afficher (bot désactivé, réseau, CSP) : la bulle d'attente disparaît.
function failed() { window.dispatchEvent(new CustomEvent('chapote-widget-error', { detail: { key: BOT_KEY } })) }

function injectWidget(look: Look, openNow: boolean) {
  if (document.querySelector(`script[data-bot-key="${BOT_KEY}"]`)) {
    if (openNow) window.ChapoteWidget?.[BOT_KEY]?.open()
    return
  }
  const s = document.createElement('script')
  s.src = WIDGET_SRC
  s.async = true
  s.dataset.botKey = BOT_KEY
  s.dataset.color = look.color
  s.dataset.colorText = look.colorText
  s.dataset.theme = look.theme
  // Adresse de la page sans paramètres (?account=…, codes de connexion) : seul le chemin part.
  s.dataset.urlMode = 'path'
  if (openNow) s.dataset.open = 'true'
  s.onerror = failed
  document.body.appendChild(s)
}

/** Bulle de l'assistant (secondaire). `loadOn="click"` : rien n'est chargé avant le clic. */
export default function ChapoteAssistant({ loadOn = 'idle' }: { loadOn?: 'idle' | 'click' }) {
  const active = ENABLED && /^pk_[A-Za-z0-9_-]{10,64}$/.test(BOT_KEY)
  const [look, setLook] = useState<Look | null>(null)
  const [ready, setReady] = useState(false)   // widget.js prêt : sa propre bulle remplace la nôtre
  const [broken, setBroken] = useState(false) // widget indisponible : plus de bulle du tout
  const [loading, setLoading] = useState(false)
  const requested = useRef(false)

  // Couleur et thème : lecture au montage, puis suivi des changements.
  useEffect(() => {
    if (!active) return
    const update = () => {
      const l = readLook()
      setLook(l)
      window.ChapoteWidget?.[BOT_KEY]?.setAppearance(l)
    }
    update()
    const mo = new MutationObserver(update)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-palette'] })
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    mq?.addEventListener?.('change', update)
    return () => { mo.disconnect(); mq?.removeEventListener?.('change', update) }
  }, [active])

  // Le widget signale qu'il est prêt (il dessine alors sa bulle à la même place).
  useEffect(() => {
    if (!active) return
    const onReady = (e: Event) => {
      if ((e as CustomEvent).detail?.key !== BOT_KEY) return
      setReady(true)
      window.ChapoteWidget?.[BOT_KEY]?.setAppearance(readLook())
    }
    const onError = (e: Event) => { if ((e as CustomEvent).detail?.key === BOT_KEY) setBroken(true) }
    window.addEventListener('chapote-widget-ready', onReady)
    window.addEventListener('chapote-widget-error', onError)
    if (window.ChapoteWidget?.[BOT_KEY]) setReady(true)
    return () => {
      window.removeEventListener('chapote-widget-ready', onReady)
      window.removeEventListener('chapote-widget-error', onError)
    }
  }, [active])

  // Chargement différé : après le premier affichage complet, quand le navigateur est au repos.
  useEffect(() => {
    if (!active || loadOn !== 'idle') return
    let idle: number | undefined
    let timer: number | undefined
    const go = () => {
      if (requested.current) return
      requested.current = true
      injectWidget(readLook(), false)
    }
    const schedule = () => {
      if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(go, { timeout: 5000 })
      else timer = setTimeout(go, 2500) as unknown as number
    }
    if (document.readyState === 'complete') schedule()
    else window.addEventListener('load', schedule, { once: true })
    return () => {
      window.removeEventListener('load', schedule)
      if (idle !== undefined) window.cancelIdleCallback?.(idle)
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [active, loadOn])

  if (!active || ready || broken || !look) return null

  const onClick = () => {
    setLoading(true)
    if (!requested.current) {
      requested.current = true
      injectWidget(readLook(), true)
    } else {
      // Déjà demandé (chargement en cours) : ouvrir dès que prêt.
      const open = () => window.ChapoteWidget?.[BOT_KEY]?.open()
      if (window.ChapoteWidget?.[BOT_KEY]) open()
      else window.addEventListener('chapote-widget-ready', open, { once: true })
    }
  }

  return (
    <button
      type="button"
      className="cm-assistant-bubble"
      onClick={onClick}
      aria-label="Poser une question à l’assistant"
      aria-busy={loading || undefined}
      style={{ background: look.color, color: look.colorText }}
    >
      {/* Même icône « ? » que la bulle du widget (icon: help). */}
      <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9.2" /><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.9c-.8.35-1 .9-1 1.7" />
        <circle cx="12" cy="16.8" r="1.15" fill="currentColor" stroke="none" />
      </svg>
    </button>
  )
}
