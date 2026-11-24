// Logique pure de la bibliothèque, des brouillons et de la recette (testée avec Node, sans React Native).
import type { Analysis, Asset, AssetState, DatePattern, Order, Proposal, Recipe, Source } from '../../lib/api'

export const plural = (n: number, word: string, pl = `${word}s`) => `${n} ${n > 1 ? pl : word}`

/** Adresse complète d'un média de l'API (« /api/cm/assets/12/stream »), avec l'espace si besoin. */
export function mediaUrl(base: string, path: string | null | undefined, org: number | null = null): string | null {
  if (!path) return null
  const url = /^https?:\/\//.test(path) ? path : base.replace(/\/$/, '') + (path.startsWith('/') ? path : `/${path}`)
  if (org == null || /[?&]org_id=/.test(url)) return url
  return `${url}${url.includes('?') ? '&' : '?'}org_id=${org}`
}

/** Adresse de lecture d'une vidéo de la bibliothèque (comme le site : `stream`, sinon l'adresse connue). */
export const streamPath = (a: Pick<Asset, 'id' | 'stream'>) => a.stream || `/api/cm/assets/${a.id}/stream`

/** Pastille de la carte vidéo (mêmes règles que le site). */
export function assetBadge(a: Pick<Asset, 'published' | 'scheduled' | 'kind'>): { label: string; fresh: boolean } {
  if (a.published > 0 || a.kind === 'published') return { label: 'Publiée', fresh: false }
  if (a.scheduled > 0 || a.kind === 'routine') return { label: 'Programmée', fresh: false }
  if (a.kind === 'reserve') return { label: 'Réserve', fresh: false }
  if (a.kind === 'waiting') return { label: 'En attente', fresh: false }
  return { label: 'Nouvelle', fresh: true }
}

/** Ligne d'infos d'un dossier Drive (sans la date de dernière lecture, ajoutée par l'écran). */
export function sourceLine(s: Pick<Source, 'videos' | 'new' | 'role' | 'can_upload'>): string {
  const parts = [plural(s.videos, 'vidéo')]
  if (s.new) parts.push(`${s.new} à publier`)
  parts.push(s.role === 'writer' ? 'Éditeur' : 'Lecteur')
  if (s.role === 'writer' && s.can_upload === false) parts.push('dépôt de fichiers refusé par Google')
  if (s.can_upload === true) parts.push('archivage direct')
  return parts.join(' · ')
}

/** Message après l'ajout d'un dossier. */
export function addedFlash(s: Pick<Source, 'name' | 'videos' | 'scan' | 'last_error'>): { kind: 'ok' | 'err'; text: string } {
  if (s.scan?.ok === false || s.last_error)
    return { kind: 'err', text: `Dossier « ${s.name} » relié, mais sa lecture a échoué : ${s.scan?.error || s.last_error}` }
  const v = s.videos > 1 ? 's' : ''
  return { kind: 'ok', text: `Dossier « ${s.name} » relié : ${s.videos} vidéo${v} trouvée${v}.` }
}

export function emptyAssetsText(q: string, state: AssetState): string {
  if (q) return `Aucune vidéo ne correspond à « ${q} ».`
  if (state === 'new') return 'Toutes les vidéos ont déjà été programmées.'
  return 'Aucune vidéo pour le moment.'
}

export function captionHint(from: Asset['caption_from']): string {
  if (from === 'txt') return 'Lue dans le fichier .txt du même nom dans le Drive. Si vous la modifiez ici, le .txt ne l’écrasera plus.'
  if (from === 'user') return 'Modifiée dans Chapote.'
  return 'Astuce : un fichier .txt du même nom que la vidéo, dans le Drive, remplit la légende tout seul.'
}

/** « Publiée 2 fois, dernière le … · 1 à venir » ; `date` met une date en forme. */
export function usageText(a: Pick<Asset, 'published' | 'scheduled' | 'last_published_at'>, date: (iso: string) => string): string {
  let t = a.published ? `Publiée ${a.published} fois${a.last_published_at ? `, dernière le ${date(a.last_published_at)}` : ''}` : 'Jamais publiée'
  if (a.scheduled) t += ` · ${a.scheduled} à venir`
  return t
}

export type AssetSort = 'recent' | 'name' | 'duration' | 'size'
export const ASSET_SORTS: [AssetSort, string][] = [['recent', 'Date d’ajout'], ['name', 'Nom'], ['duration', 'Durée'], ['size', 'Taille']]
export const assetNaturalOrder = (s: AssetSort): Order => (s === 'name' ? 'asc' : 'desc')
export const STATE_OPTIONS: [AssetState, string][] = [['new', 'À publier'], ['used', 'Déjà programmées'], ['all', 'Toutes']]

/** Ajoute une page à la liste sans doublon (une vidéo peut glisser d'une page à l'autre). */
export function mergeById<T extends { id: number }>(prev: T[], next: T[]): T[] {
  const seen = new Set(prev.map(x => x.id))
  return [...prev, ...next.filter(x => !seen.has(x.id))]
}

/** Heure d'un brouillon proposé. */
export function proposalWhen(p: Pick<Proposal, 'scheduled_at' | 'when_from'>, dateTime: (iso: string) => string): { text: string; warn: boolean } {
  if (!p.scheduled_at) return { text: 'Heure à choisir', warn: true }
  return { text: `${dateTime(p.scheduled_at)}${p.when_from === 'date' ? ' (heure par défaut)' : ''}`, warn: false }
}

export const archivedNote = (n: number) => `${n} brouillon${n > 1 ? 's' : ''} rangé${n > 1 ? 's' : ''} en archive.`

// ---------- Recette (« préparer les publications toutes seules ») ----------

export const PATTERNS: DatePattern[] = ['ymd_hm', 'ymd', 'dmy_hm', 'dmy', 'compact', 'none']
export const TITLE_FROM: Record<Recipe['title']['from'], string> = { folder: 'le nom du dossier', file: 'le nom du fichier', txt_first_line: 'la 1re ligne du .txt' }
export const LEVELS: [number, string][] = [[1, 'Directement dans le dossier partagé'], [2, 'Un niveau plus bas'], [3, 'Deux niveaux plus bas']]

type Targets = Pick<Analysis, 'accounts' | 'groups'> | null
export function recipeTargets(an: Targets): { key: string; name: string }[] {
  return [...(an?.groups || []).map(g => ({ ...g, name: `Groupe ${g.name}` })), ...(an?.accounts || [])]
}
const nameOf = (an: Targets, k: string) => recipeTargets(an).find(t => t.key === k)?.name || k
const names = (an: Targets, ks: string[]) =>
  (ks.length > 2 ? `${ks.slice(0, 2).map(k => nameOf(an, k)).join(', ')} +${ks.length - 2}` : ks.map(k => nameOf(an, k)).join(', '))

export function accountSummary(r: Recipe, an: Targets): string {
  if (r.account.from === 'folder') {
    const pairs = Object.entries(r.account.map).filter(([f]) => f !== '*').map(([f, k]) => `${f} → ${names(an, k)}`)
    return `Selon le dossier : ${pairs.join(' · ') || 'à associer'}`
  }
  return `Toujours : ${(r.account.map['*'] || []).map(k => nameOf(an, k)).join(', ') || 'les comptes proposés par défaut pour ce dossier'}`
}
export function whenSummary(r: Recipe, an: Pick<Analysis, 'patterns'> | null): string {
  if (r.when.pattern === 'none') return 'Je choisis l’heure en validant.'
  return `La date écrite dans le nom (comme « ${an?.patterns[r.when.pattern] ?? ''} »). Sans heure : ${r.when.default_time}.`
}
export function textSummary(r: Recipe): string {
  return `Titre : ${TITLE_FROM[r.title.from]}. Légende : ${r.caption.from === 'txt' ? 'le .txt' : 'aucune'}. Couverture : ${r.cover.from === 'image' ? 'l’image' : 'aucune'}.`
}
export const patternLabel = (p: DatePattern, an: Pick<Analysis, 'patterns'> | null) =>
  (p === 'none' ? 'Je choisis l’heure en validant' : `La date est écrite comme « ${an?.patterns[p] ?? ''} »`)

/** Copie modifiable d'une recette (les changements ne touchent jamais l'original). */
export const editRecipe = (r: Recipe, fn: (x: Recipe) => void): Recipe => {
  const x = JSON.parse(JSON.stringify(r)) as Recipe
  fn(x)
  return x
}
/** Associe (ou retire, avec '') un compte / groupe à un dossier, ou à tous (« * »). */
export const setMapping = (r: Recipe, folder: string, key: string) =>
  editRecipe(r, x => { if (key) x.account.map[folder] = [key]; else delete x.account.map[folder] })

/** « 9:5 » → « 09:05 » ; null si l'heure n'est pas valable. */
export function normalizeTime(v: string): string | null {
  const m = /^\s*(\d{1,2})\s*[:hH.]\s*(\d{1,2})?\s*$/.exec(v)
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2] || 0)
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

export function recipeSavedNote(autoDrafts: boolean, proposed: number): string {
  if (!autoDrafts) return 'Préparation automatique désactivée.'
  return `C’est activé${proposed ? ` : ${proposed} publication${proposed > 1 ? 's' : ''} à valider` : ''}.`
}
