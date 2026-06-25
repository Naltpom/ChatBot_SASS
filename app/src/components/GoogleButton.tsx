import { useEffect, useRef } from 'react'

// Client ID public (= audience des tokens Google). Vide => SSO non configuré :
// le composant ne rend rien (et Login masque le séparateur « ou »).
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

export const GOOGLE_ENABLED = !!CLIENT_ID

declare global {
  interface Window {
    google?: any
  }
}

// Chargement unique du SDK Google Identity Services (partagé entre montages).
let gisPromise: Promise<void> | null = null
function loadGis(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.google?.accounts?.id) return Promise.resolve()
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://accounts.google.com/gsi/client'
      s.async = true
      s.defer = true
      s.onload = () => resolve()
      s.onerror = () => reject(new Error('Chargement de Google indisponible'))
      document.head.appendChild(s)
    })
  }
  return gisPromise
}

/**
 * Bouton officiel « Continuer avec Google » (flux ID token). Récupère un JWT
 * signé par Google et le remonte via `onCredential` ; le back le vérifie.
 * On utilise le bouton rendu par Google (et non un bouton maison) car c'est le
 * seul moyen fiable d'obtenir un ID token, et il est reconnu des utilisateurs.
 */
export default function GoogleButton({
  onCredential,
  onError,
}: {
  onCredential: (credential: string) => void
  onError?: (msg: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  // Le callback GIS est figé à l'initialisation : on passe par une ref pour
  // toujours appeler le dernier handler fourni.
  const cbRef = useRef(onCredential)
  cbRef.current = onCredential

  useEffect(() => {
    if (!CLIENT_ID) return
    let cancelled = false
    loadGis()
      .then(() => {
        if (cancelled || !ref.current || !window.google) return
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: (resp: { credential?: string }) => {
            if (resp?.credential) cbRef.current(resp.credential)
          },
        })
        window.google.accounts.id.renderButton(ref.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          logo_alignment: 'left',
          width: ref.current.offsetWidth || 360,
        })
      })
      .catch((e: Error) => onError?.(e.message))
    return () => {
      cancelled = true
    }
  }, [])

  if (!CLIENT_ID) return null
  return <div ref={ref} style={{ display: 'flex', justifyContent: 'center' }} />
}
