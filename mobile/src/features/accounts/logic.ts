// Logique pure des comptes, groupes, transferts et du partage (testée avec Node, sans React Native).
import type { Account, CmRole, Config, Group, GroupColor, Order, Person, Platform, Space } from '../../lib/api'

export const akey = (p: Platform, id: number) => `${p}:${id}`
export function parseKey(k: string): { platform: Platform; account_id: number } {
  const [platform, id] = k.split(':')
  return { platform: platform as Platform, account_id: Number(id) }
}

export type Tone = 'ok' | 'warn' | 'danger' | 'muted'
/** État d'un compte (comme l'accueil du site). */
export function accountState(a: Pick<Account, 'needs_reconnect' | 'mode' | 'stats'>): { label: string; tone: Tone } {
  if (a.needs_reconnect) return { label: 'À reconnecter', tone: 'danger' }
  if (a.mode === 'routine') return { label: 'Routine', tone: 'muted' }
  if (a.stats?.error) return { label: 'Relevé en échec', tone: 'warn' }
  return { label: 'Connecté', tone: 'ok' }
}

export const COLOR_LABEL: Record<GroupColor, string> = {
  blue: 'Bleu', orange: 'Orange', green: 'Vert', purple: 'Violet', pink: 'Rose', teal: 'Turquoise', amber: 'Ambre', slate: 'Gris',
  red: 'Rouge', indigo: 'Indigo', cyan: 'Cyan', lime: 'Citron vert', rose: 'Framboise', sky: 'Ciel', emerald: 'Émeraude', brown: 'Marron',
}

export const CONNECT_HINT: Record<Platform, string> = {
  tiktok: 'Pour connecter un autre compte, connectez-vous d’abord à ce compte sur tiktok.com dans le navigateur du téléphone.',
  youtube: 'Pour une chaîne de marque, choisissez-la sur l’écran Google qui s’ouvre.',
  instagram: 'Compte professionnel (Créateur ou Entreprise) seulement.',
}
export const BROWSER_HINT = 'Si cm.chapote.fr vous demande de vous connecter, connectez-vous puis relancez la connexion.'

export function connectEnabled(config: Pick<Config, 'tiktok' | 'youtube' | 'instagram_api'> | null, p: Platform): boolean {
  return (p === 'tiktok' ? config?.tiktok : p === 'youtube' ? config?.youtube : config?.instagram_api) ?? false
}

export const groupsOf = (groups: Group[], a: Pick<Account, 'platform' | 'id'>) =>
  groups.filter(g => g.accounts.some(x => x.platform === a.platform && x.id === a.id))

export function groupMembers<A extends Pick<Account, 'platform' | 'id'>>(g: Group, accounts: A[]): A[] {
  const byKey = new Map(accounts.map(a => [akey(a.platform, a.id), a]))
  return g.accounts.map(x => byKey.get(akey(x.platform, x.id))).filter((a): a is A => !!a)
}
export const followersSum = (list: Pick<Account, 'stats'>[]) => list.reduce((s, a) => s + (a.stats?.followers || 0), 0)

export const toggleIn = <T>(list: T[], v: T): T[] => (list.includes(v) ? list.filter(x => x !== v) : [...list, v])

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
/** Filtre d'une liste déjà chargée (choix des comptes d'un groupe ou d'un accès). */
export function filterAccounts<A extends Pick<Account, 'name' | 'platform'> & { username?: string; handle?: string | null }>(list: A[], q: string): A[] {
  const t = fold(q.trim())
  if (!t) return list
  return list.filter(a => fold(`${a.name || ''} ${a.username || ''} ${a.handle || ''} ${a.platform}`).includes(t))
}

export type GroupBody = { name: string; color: GroupColor; accounts: { platform: Platform; account_id: number }[] }
export const groupBody = (name: string, color: GroupColor, picked: string[]): GroupBody =>
  ({ name: name.trim(), color, accounts: picked.map(parseKey) })

// ---------- Transferts ----------

const spaceKey = (s: Pick<Space, 'org_id'>) => String(s.org_id ?? 'perso')
/** Mes autres espaces (où je suis admin) vers lesquels transférer, puis « une autre personne ». */
export function transferChoices(spaces: Space[], org: number | null): [string, string][] {
  const mine = spaces.filter(s => s.org_id !== org && (s.cm_role || 'admin') === 'admin')
  return [...mine.map(s => [spaceKey(s), s.name] as [string, string]), ['email', 'Une autre personne']]
}
export function transferBody(to: string, email: string): { to_email?: string; to_perso?: boolean; to_org_id?: number } {
  if (to === 'email') return { to_email: email.trim() }
  if (to === 'perso') return { to_perso: true }
  return { to_org_id: Number(to) }
}
export function transferDoneText(r: { pending?: boolean; message?: string; moved_targets?: number }, name: string | null, dest: string | undefined): string {
  if (r.pending) return r.message || 'Transfert proposé.'
  const n = r.moved_targets || 0
  return `${name} est maintenant dans « ${dest} »${n ? `, avec ${n} publication${n > 1 ? 's' : ''} à venir` : ''}.`
}
/** Espaces où accepter un transfert reçu. */
export const adminSpaceChoices = (spaces: Space[]): [string, string][] =>
  spaces.filter(s => (s.cm_role || 'admin') === 'admin').map(s => [spaceKey(s), s.name])
export const orgFromKey = (k: string | undefined): number | null => (!k || k === 'perso' ? null : Number(k))

/** Jeton de reprise quand le compte est déjà relié à un autre espace (erreur `account_taken`). */
export function claimToken(e: unknown): string | null {
  const d = (e as { data?: Record<string, unknown> } | null)?.data
  return d && d.code === 'account_taken' && typeof d.claim_token === 'string' ? d.claim_token : null
}
export const claimDoneText = (space: string, moved: number) =>
  `Compte repris dans « ${space} »${moved ? `, avec ${moved} publication${moved > 1 ? 's' : ''} à venir` : ''}.`

export type AccountSort = 'connected' | 'name' | 'followers' | 'views'
export const ACCOUNT_SORTS: [AccountSort, string][] = [['connected', 'Date de connexion'], ['name', 'Nom'], ['followers', 'Abonnés'], ['views', 'Vues']]
export const accountNaturalOrder = (s: AccountSort): Order => (s === 'name' || s === 'connected' ? 'asc' : 'desc')

// ---------- Personnes et partage ----------

export const ROLE_CHOICES: [CmRole, string, string][] = [
  ['editor', 'Peut publier', 'Programme, modifie et annule les publications.'],
  ['viewer', 'Lecture seule', 'Voit le planning et les statistiques.'],
  ['admin', 'Admin', 'Tout l’espace : comptes, groupes, personnes.'],
]
export const ROLE_NAME: Record<CmRole, string> = { admin: 'Admin', editor: 'Peut publier', viewer: 'Lecture seule' }
export type PeopleSort = 'added' | 'name' | 'role'
export const PEOPLE_SORTS: [PeopleSort, string][] = [['added', 'Ajout'], ['name', 'Nom'], ['role', 'Accès']]

export function scopeText(p: Pick<Person, 'role' | 'scope'>, groupName: (id: number) => string | undefined, accountName: (k: string) => string | undefined): string {
  if (p.role === 'admin' || p.scope.all) return 'Tous les comptes'
  const parts = [...p.scope.groups.map(groupName), ...p.scope.accounts.map(accountName)].filter(Boolean)
  return parts.length ? parts.join(', ') : 'Aucun compte'
}
export function personLine(p: Pick<Person, 'pending' | 'owner' | 'role' | 'scope'>, scope: string): string {
  return `${p.pending ? 'Invitation envoyée · ' : ''}${p.owner ? 'Propriétaire · ' : ''}${scope}`
}
export function shareDoneText(r: { invited?: boolean; message?: string }, email: string, label: string): string {
  if (r.message) return r.message
  return r.invited ? `Invitation envoyée à ${email} : l’accès s’ouvrira à son inscription.` : `${email} a maintenant accès à ${label}.`
}
export const roleHint = (role: CmRole, desc: string, label: string) => (role === 'admin' ? desc : `${desc} Seulement ${label}.`)
export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())
