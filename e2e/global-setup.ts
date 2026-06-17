// Global setup : prépare via l'API (PAS via l'UI) les données partagées par
// les specs, pour économiser le rate-limit auth (10 login+register / 15 min / IP) :
// - FLUSHALL Redis en tête (les rate-limits y sont persistants — seule donnée
//   stockée dans Redis, purge sans effet de bord)
// - 1 compte ENTREPRISE (register API = 1 appel d'auth par run frais)
//   (plus aucune notion de plan : toute org est « tout ouvert » par défaut)
// - 1 bot mode arbre avec un tree_json simple à 3 nœuds, captcha désactivé
// - 1 compte MEMBER local jetable (« Membre E2E »), membre de l'org partagée,
//   permissions remises à {} à chaque run (déterminisme team-permissions.spec)
// Le tout est écrit dans e2e/.state.json (gitignoré).
//
// Si un .state.json valide existe déjà (itérations locales), il est réutilisé
// tel quel — aucune inscription supplémentaire n'est consommée. Les bots créés
// par les runs précédents (specs wizard et lots dédiés) sont alors purgés et
// l'arbre du bot partagé est remis à plat.
import { request, type APIRequestContext, type FullConfig } from '@playwright/test'
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

const API_URL = process.env.E2E_API_URL || 'http://localhost:8001'
const STATE_PATH = path.join(__dirname, '.state.json')

// Mot de passe commun aux comptes du state (principal + member). profile.spec
// s'en sert pour le parcours « changement de mot de passe » (happy + revert).
export const STATE_PASSWORD = 'MotDePasseE2E-1'

export interface E2EState {
  apiUrl: string
  token: string
  email: string
  orgId: number
  orgName: string
  botId: number
  publicKey: string
  // Compte member jetable (optionnels : un vieux .state.json reste lisible,
  // le setup complète les champs manquants)
  memberEmail?: string
  memberToken?: string
  memberUserId?: number
  memberName?: string
}

// RÈGLE DURE : purge des rate-limits Redis (persistants entre restarts api).
// Appelée EN TÊTE du setup — et ré-appelée par profile.spec.beforeAll en
// assurance budget (POST /api/auth/password partage le limiteur auth).
// Redis ne contient QUE des rate-limits (cf. CLAUDE.md) : purge sans effet
// de bord. L'échec n'est PAS bloquant : le chemin reuse ne consomme aucun
// appel d'auth.
export function flushRedis() {
  try {
    execFileSync('docker', ['compose', 'exec', '-T', 'redis', 'redis-cli', 'FLUSHALL'], {
      cwd: path.join(__dirname, '..'),
      stdio: 'pipe',
      timeout: 30_000,
    })
    console.log('[e2e] Redis FLUSHALL — rate-limits purgés.')
  } catch {
    console.warn(
      '[e2e] FLUSHALL Redis impossible (docker indisponible ?) — '
      + 'le rate-limit auth peut être encore chargé ; un 429 reste possible.',
    )
  }
}

// Design du bot partagé : titre explicite (le widget affiche design.title,
// pas le nom du bot) ; le reste reprend les défauts du produit.
export const SHARED_DESIGN = {
  title: 'Bot partagé E2E',
  primaryColor: '#0d9488',
  secondaryColor: null,
  position: 'right',
  size: 'md',
  borderRadius: 16,
  icon: 'chat',
  avatarImage: '',
  bordered: false,
  welcomeMessage: '',
  placeholder: 'Écrivez votre message…',
  loadingAnimation: 'dots',
  poweredBy: true,
}

// Arbre partagé : 3 nœuds (root + 2 réponses), AUCUNE option "__ai__".
export const SHARED_TREE = {
  start: 'root',
  nodes: {
    root: {
      message: 'Bonjour ! Comment puis-je vous aider ?',
      options: [
        { label: 'Nos services', next: 'services' },
        { label: 'Nos horaires', next: 'horaires' },
      ],
    },
    services: {
      message: "Nous proposons des prestations de conseil et d'accompagnement sur mesure.",
      options: [{ label: 'Menu principal', next: 'root' }],
    },
    horaires: {
      message: 'Nous sommes ouverts du lundi au vendredi, de 9h à 18h.',
      options: [{ label: 'Menu principal', next: 'root' }],
    },
  },
}

export function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` }
}

async function fail(label: string, res: { status(): number; text(): Promise<string> }): Promise<never> {
  const body = await res.text().catch(() => '')
  if (res.status() === 429) {
    throw new Error(
      `${label} : 429 rate-limit auth atteint. ` +
      'Exécutez `docker compose exec redis redis-cli FLUSHALL` puis relancez.',
    )
  }
  throw new Error(`${label} : HTTP ${res.status()} ${body}`)
}

// Garantit le compte member « Membre E2E » (local, jetable) et sa membership
// dans l'org partagée. Au plus 1 register (couvert par le FLUSHALL) ; les
// runs suivants réutilisent memberToken (JWT stateless : il survit même au
// changement de mot de passe joué par profile.spec). Les permissions du
// member sont remises à {} à CHAQUE run (déterminisme team-permissions.spec).
async function ensureMember(ctx: APIRequestContext, state: E2EState): Promise<void> {
  const mainHeaders = authHeaders(state.token)
  const wantedName = 'Membre E2E'

  // 1. Token member encore valide ? (GET /me, gratuit)
  let valid = false
  if (state.memberToken && state.memberUserId && state.memberEmail) {
    const me = await ctx.get('/api/auth/me', { headers: authHeaders(state.memberToken) })
    if (me.ok()) {
      valid = true
      const u = await me.json()
      state.memberUserId = u.id
      state.memberEmail = u.email
      // Run précédent crashé au milieu du renommage de profile.spec : on
      // renormalise le nom (PATCH /me, non rate-limité).
      if (u.name !== wantedName) {
        await ctx.patch('/api/auth/me', {
          headers: authHeaders(state.memberToken),
          data: { name: wantedName },
        })
      }
    }
  }

  // 2. Sinon : register d'un compte perso jetable (1 SEUL register)
  if (!valid) {
    const stamp = Date.now()
    const email = `e2e.member.${stamp}@e2e-chapote.fr`
    const reg = await ctx.post('/api/auth/register', {
      data: {
        email,
        password: STATE_PASSWORD,
        name: wantedName,
        account_type: 'perso',
        invites: [],
      },
    })
    if (!reg.ok()) await fail('POST /api/auth/register (member E2E)', reg)
    const body = await reg.json()
    state.memberToken = body.access_token
    state.memberUserId = body.user.id
    state.memberEmail = email
  }
  state.memberName = wantedName

  // 3. Membership dans l'org partagée (POST members : non rate-limité,
  // joined:true car le compte existe)
  const list = await ctx.get(`/api/orgs/${state.orgId}/members`, { headers: mainHeaders })
  if (!list.ok()) await fail('GET /api/orgs/{id}/members', list)
  const { members } = await list.json()
  if (!members.some((m: { email: string }) => m.email === state.memberEmail)) {
    const add = await ctx.post(`/api/orgs/${state.orgId}/members`, {
      headers: mainHeaders,
      data: { email: state.memberEmail, role: 'member' },
    })
    if (!add.ok()) await fail('POST /api/orgs/{id}/members (member E2E)', add)
  }

  // 4. Rôle member + permissions remises à zéro
  const patch = await ctx.patch(`/api/orgs/${state.orgId}/members/${state.memberUserId}`, {
    headers: mainHeaders,
    data: { role: 'member', permissions: {} },
  })
  if (!patch.ok()) await fail('PATCH /api/orgs/{id}/members/{uid} (reset permissions)', patch)
}

// Réutilise un état existant encore valide (économise le rate-limit pendant
// les itérations). Nettoie les résidus des runs précédents.
async function tryReuse(ctx: APIRequestContext): Promise<boolean> {
  if (!fs.existsSync(STATE_PATH)) return false
  let state: E2EState
  try {
    state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'))
  } catch {
    return false
  }
  if (!state?.token || !state?.botId || !state?.orgId) return false

  const headers = authHeaders(state.token)
  const me = await ctx.get('/api/auth/me', { headers })
  if (!me.ok()) return false
  const botRes = await ctx.get(`/api/bots/${state.botId}`, { headers })
  if (!botRes.ok()) return false
  const bot = await botRes.json()
  if (bot.public_key !== state.publicKey) return false
  // Le GET /api/bots/{id} ci-dessus (200) suffit à valider l'état : plus de
  // notion de plan à vérifier (toute org est « tout ouvert » par défaut).

  // Remise à plat du bot partagé (l'arbre a pu être modifié par botpage.spec,
  // les domaines par savebar.spec)
  const patch = await ctx.patch(`/api/bots/${state.botId}`, {
    headers,
    data: {
      mode: 'tree',
      is_active: true,
      tree_json: SHARED_TREE,
      design_json: SHARED_DESIGN,
      captcha_provider: 'disabled',
      allowed_domains: ['localhost'],
    },
  })
  if (!patch.ok()) return false

  // Purge des bots dédiés créés par les specs lors des runs précédents
  // (wizard-tree et lots e2e : tout sauf le bot partagé)
  const list = await ctx.get(`/api/orgs/${state.orgId}/bots`, { headers })
  if (list.ok()) {
    for (const b of await list.json()) {
      if (b.id !== state.botId) await ctx.delete(`/api/bots/${b.id}`, { headers })
    }
  }

  // Compte member : re-validé/recréé à chaque run, permissions remises à {}.
  // Le .state.json est RÉ-ÉCRIT (les champs member peuvent changer).
  await ensureMember(ctx, state)
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))

  console.log(`[e2e] État réutilisé (${state.email} + member ${state.memberEmail}, bot #${state.botId}) — aucune inscription du compte principal consommée.`)
  return true
}

export default async function globalSetup(_config: FullConfig) {
  // RÈGLE DURE : purge des rate-limits AVANT tout appel d'auth (rejouabilité)
  flushRedis()

  const ctx = await request.newContext({ baseURL: API_URL })
  try {
    const health = await ctx.get('/health')
    if (!health.ok()) await fail('GET /health (stack docker compose lancée ?)', health)

    if (await tryReuse(ctx)) return

    // --- 1. Compte entreprise (1er des 2 seuls appels d'auth du setup) ---
    const stamp = Date.now()
    const email = `e2e.setup.${stamp}@e2e-chapote.fr`
    const reg = await ctx.post('/api/auth/register', {
      data: {
        email,
        password: STATE_PASSWORD,
        name: 'Setup E2E',
        account_type: 'entreprise',
        organization_name: `E2E Corp ${stamp}`,
        invites: [],
      },
    })
    if (!reg.ok()) await fail('POST /api/auth/register', reg)
    const { access_token: token, user } = await reg.json()
    const org = user.organizations[0]
    const headers = authHeaders(token)

    // (Plus aucune étape de plan : toute org est « tout ouvert » par défaut —
    // pas de tree_only, pas de limite de bots, IA disponible selon le mode.)

    // --- 2. Bot partagé : mode arbre, captcha désactivé (clés Turnstile
    // absentes en dev), arbre à 3 nœuds ---
    const created = await ctx.post(`/api/orgs/${org.id}/bots`, {
      headers,
      data: { name: 'Bot partagé E2E', mode: 'tree' },
    })
    if (!created.ok()) await fail('POST /api/orgs/{id}/bots', created)
    const bot = await created.json()

    const patched = await ctx.patch(`/api/bots/${bot.id}`, {
      headers,
      data: {
        tree_json: SHARED_TREE,
        design_json: SHARED_DESIGN,
        captcha_provider: 'disabled',
        allowed_domains: ['localhost'],
      },
    })
    if (!patched.ok()) await fail('PATCH /api/bots/{id}', patched)

    const state: E2EState = {
      apiUrl: API_URL,
      token,
      email,
      orgId: org.id,
      orgName: org.name,
      botId: bot.id,
      publicKey: bot.public_key,
    }

    // --- 3. Compte member « Membre E2E » (2e et DERNIER appel d'auth) ---
    await ensureMember(ctx, state)

    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
    console.log(`[e2e] Compte ${email} créé (org #${org.id}, bot #${bot.id}, member ${state.memberEmail}).`)
  } finally {
    await ctx.dispose()
  }
}
