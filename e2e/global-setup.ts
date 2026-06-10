// Global setup : prépare via l'API (PAS via l'UI) les données partagées par
// les specs, pour économiser le rate-limit auth (10 login+register / 15 min / IP) :
// - 1 compte ENTREPRISE (register API = 1 seul appel d'auth par run)
// - plan « agence » (self-serve, non rate-limité) : pas de tree_only, marge de bots
// - 1 bot mode arbre avec un tree_json simple à 3 nœuds, captcha désactivé
// Le tout est écrit dans e2e/.state.json (gitignoré).
//
// Si un .state.json valide existe déjà (itérations locales), il est réutilisé
// tel quel — aucune inscription supplémentaire n'est consommée. Les bots créés
// par les runs précédents (spec wizard) sont alors purgés et l'arbre du bot
// partagé est remis à plat.
import { request, type APIRequestContext, type FullConfig } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

const API_URL = process.env.E2E_API_URL || 'http://localhost:8001'
const STATE_PATH = path.join(__dirname, '.state.json')

export interface E2EState {
  apiUrl: string
  token: string
  email: string
  orgId: number
  orgName: string
  botId: number
  publicKey: string
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

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` }
}

async function fail(label: string, res: { status(): number; text(): Promise<string> }): Promise<never> {
  const body = await res.text().catch(() => '')
  if (res.status() === 429) {
    throw new Error(
      `${label} : 429 rate-limit auth atteint. ` +
      'Exécutez `docker compose restart api`, attendez que http://localhost:8001/docs réponde, puis relancez.',
    )
  }
  throw new Error(`${label} : HTTP ${res.status()} ${body}`)
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

  // Remise à plat du bot partagé (l'arbre a pu être modifié par botpage.spec)
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

  // Purge des bots créés par wizard-tree.spec lors des runs précédents
  const list = await ctx.get(`/api/orgs/${state.orgId}/bots`, { headers })
  if (list.ok()) {
    for (const b of await list.json()) {
      if (b.id !== state.botId) await ctx.delete(`/api/bots/${b.id}`, { headers })
    }
  }
  console.log(`[e2e] État réutilisé (${state.email}, bot #${state.botId}) — aucune inscription consommée.`)
  return true
}

export default async function globalSetup(_config: FullConfig) {
  const ctx = await request.newContext({ baseURL: API_URL })
  try {
    const health = await ctx.get('/health')
    if (!health.ok()) await fail('GET /health (stack docker compose lancée ?)', health)

    if (await tryReuse(ctx)) return

    // --- 1. Compte entreprise (SEUL appel d'auth du setup) ---
    const stamp = Date.now()
    const email = `e2e.setup.${stamp}@e2e-kertios.fr`
    const reg = await ctx.post('/api/auth/register', {
      data: {
        email,
        password: 'MotDePasseE2E-1',
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

    // --- 2. Plan agence (self-serve org admin, non rate-limité) :
    // pas de tree_only et 10 bots max -> marge pour la spec wizard ---
    const plan = await ctx.post(`/api/orgs/${org.id}/plan`, { headers, data: { plan: 'agence' } })
    if (!plan.ok()) await fail('POST /api/orgs/{id}/plan', plan)

    // --- 3. Bot partagé : mode arbre, captcha désactivé (clés Turnstile
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
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
    console.log(`[e2e] Compte ${email} créé (org #${org.id}, bot #${bot.id}).`)
  } finally {
    await ctx.dispose()
  }
}
