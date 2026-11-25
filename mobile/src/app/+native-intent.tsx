// Liens système :
// - partage depuis la galerie (« chapotecm://dataUrl=… ») → nouvelle publication ;
// - retour d'une connexion TikTok / YouTube / Instagram / Drive (lien Android sur
//   cm.chapote.fr/<plateforme>/callback ou chapote.fr/<plateforme>/callback) → écran de l'app qui
//   termine la connexion avec la session de l'app.
const CALLBACK = /^(?:https:\/\/(?:cm\.)?chapote\.fr)?\/(tiktok|youtube|instagram|drive)\/callback\/?(\?.*)?$/

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    if (path.includes('dataUrl=')) return '/new?shared=1'
    const m = CALLBACK.exec(path)
    if (m) {
      const q = new URLSearchParams((m[2] || '').slice(1))
      q.set('platform', m[1])
      q.set('url', path.startsWith('http') ? path.split('?')[0] : '')
      return `/oauth-return?${q.toString()}`
    }
    return path
  } catch {
    return '/'
  }
}
