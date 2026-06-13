// Helpers partagés par les specs : lecture de l'état du global-setup,
// injection d'auth AVANT le premier chargement de page (addInitScript) et
// fabrique de données jetables via l'API (orgs/bots — endpoints NON
// rate-limités, contrairement à login/register/password).
import * as fs from 'fs'
import * as path from 'path'
import type { APIRequestContext, Page } from '@playwright/test'
import type { E2EState } from './global-setup'

// Source unique : flushRedis (purge des rate-limits) et STATE_PASSWORD
// (mot de passe des comptes du state) vivent dans global-setup.
export { STATE_PASSWORD, authHeaders, flushRedis } from './global-setup'
import { authHeaders } from './global-setup'

const STATE_PATH = path.join(__dirname, '.state.json')

export function loadState(): E2EState {
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'))
}

// Neutralise l'auto-login superadmin dev (AUTO_LOGIN_ADMIN_DEV) : AuthContext
// ignore le dev-login quand la clé kc_no_autologin est présente.
export async function blockAutoLogin(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('kc_no_autologin', '1')
  })
}

// Connecte un token arbitraire sans consommer d'appel login : posé en
// localStorage avant le chargement de l'app. orgId optionnel = org active.
export async function authenticateWithToken(page: Page, token: string, orgId?: number) {
  await page.addInitScript(
    ({ token, orgId }) => {
      window.localStorage.setItem('kc_no_autologin', '1')
      window.localStorage.setItem('cbsaas_token', token)
      if (orgId !== null) window.localStorage.setItem('cbsaas_org', String(orgId))
    },
    { token, orgId: orgId ?? null },
  )
}

// Connecte le compte du global-setup (org partagée active).
export async function authenticate(page: Page, state: E2EState) {
  await authenticateWithToken(page, state.token, state.orgId)
}

// Token superadmin via POST /api/auth/dev-login (dev only, NON rate-limité,
// pas de cache : gratuit à chaque appel).
export async function devLoginToken(request: APIRequestContext, apiUrl: string): Promise<string> {
  const res = await request.post(`${apiUrl}/api/auth/dev-login`)
  if (!res.ok()) {
    throw new Error(`POST /api/auth/dev-login : HTTP ${res.status()} ${await res.text().catch(() => '')}`)
  }
  return (await res.json()).access_token
}

// Org jetable (POST /api/orgs, non rate-limité, plan free) au nom du compte
// principal du state. Préfixer les noms par « E2E » (pas de DELETE /orgs :
// accumulation en DB dev acceptée, reset via docker compose down -v).
export async function createOrg(
  request: APIRequestContext,
  state: E2EState,
  name: string,
  type: 'perso' | 'entreprise' = 'entreprise',
): Promise<{ id: number; name: string }> {
  const res = await request.post(`${state.apiUrl}/api/orgs`, {
    headers: authHeaders(state.token),
    data: { name, type },
  })
  if (!res.ok()) {
    throw new Error(`POST /api/orgs (${name}) : HTTP ${res.status()} ${await res.text().catch(() => '')}`)
  }
  const body = await res.json()
  return { id: body.id, name: body.name }
}

// Bot jetable : création + PATCH (captcha désactivé, localhost whitelisté).
// JAMAIS mode 'ai' (MOCK_AI=false en dev : aucun chemin IA ne doit être
// exercé) — les bots de test restent en tree (ou hybrid SANS exercer l'IA).
export async function createBot(
  request: APIRequestContext,
  state: E2EState,
  opts: { name: string; mode?: 'tree' | 'hybrid'; tree?: object; design?: object; orgId?: number },
): Promise<{ id: number; publicKey: string }> {
  const headers = authHeaders(state.token)
  const orgId = opts.orgId ?? state.orgId
  const created = await request.post(`${state.apiUrl}/api/orgs/${orgId}/bots`, {
    headers,
    data: { name: opts.name, mode: opts.mode ?? 'tree' },
  })
  if (!created.ok()) {
    throw new Error(`POST /api/orgs/${orgId}/bots (${opts.name}) : HTTP ${created.status()} ${await created.text().catch(() => '')}`)
  }
  const bot = await created.json()
  const patched = await request.patch(`${state.apiUrl}/api/bots/${bot.id}`, {
    headers,
    data: {
      captcha_provider: 'disabled',
      allowed_domains: ['localhost'],
      ...(opts.tree ? { tree_json: opts.tree } : {}),
      ...(opts.design ? { design_json: opts.design } : {}),
    },
  })
  if (!patched.ok()) {
    throw new Error(`PATCH /api/bots/${bot.id} (${opts.name}) : HTTP ${patched.status()} ${await patched.text().catch(() => '')}`)
  }
  return { id: bot.id, publicKey: bot.public_key }
}

// Suppression d'un bot jetable (afterAll des specs des lots v4) : DELETE
// /api/bots/{id} (admins d'org). Best-effort : un échec (worker tué, bot déjà
// purgé) ne doit jamais faire échouer la suite — le tryReuse du global-setup
// purge de toute façon les bots id !== state.botId au run suivant.
export async function deleteBot(request: APIRequestContext, state: E2EState, id: number): Promise<void> {
  try {
    await request.delete(`${state.apiUrl}/api/bots/${id}`, { headers: authHeaders(state.token) })
  } catch {
    /* best-effort : tryReuse nettoiera au run suivant */
  }
}
