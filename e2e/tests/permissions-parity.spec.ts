// Test anti-divergence : pin le CONTRAT de permissions backend exposé par
// GET /api/meta/permissions. Toute dérive d'une des deux sources canoniques
// (api/src/models/user.py::BOT_PERMS et api/src/routers/bots_helpers.py::
// FIELD_PERMS) casse ce test — c'est le garde-fou demandé.
//
// API-centré, lecture seule, ZÉRO mutation d'état : réutilise le token du
// compte principal du state (auth dashboard requise par le routeur). Aucune
// dépendance UI.
import { expect, test } from '@playwright/test'
import { authHeaders, loadState } from '../helpers'

const state = loadState()

// Ordre EXACT de BOT_PERMS (api/src/models/user.py) — 'inbox' volontairement en
// fin de liste (la matrice de la page Équipe suit cet ordre).
const EXPECTED_BOT_PERMS = ['copy', 'test', 'appearance', 'context', 'security', 'inbox']

// Snapshot littéral : doit refléter bots_helpers.FIELD_PERMS et
// app/src/utils/permissions.ts. Clés ET valeurs strictement identiques à la
// source backend (toute différence — clé ajoutée/retirée, perm changée — fait
// échouer l'assert toEqual ci-dessous).
const EXPECTED_FIELD_PERMS: Record<string, string> = {
  name: 'appearance',
  design_json: 'appearance',
  mode: 'appearance',
  triggers_json: 'appearance',
  tree_json: 'context',
  tree_variant_json: 'context',
  ab_split_pct: 'context',
  actions_json: 'context',
  system_prompt: 'context',
  ai_provider: 'context',
  ai_model: 'context',
  temperature: 'context',
  api_key_mode: 'context',
  byok_key: 'context',
  handoff_webhook_url: 'context',
  allowed_domains: 'security',
  captcha_provider: 'security',
  captcha_site_key: 'security',
  captcha_secret: 'security',
  is_active: 'security',
  mcp_servers_json: 'context',
}

test('GET /api/meta/permissions reflète BOT_PERMS + FIELD_PERMS (parité backend)', async ({ request }) => {
  const res = await request.get(`${state.apiUrl}/api/meta/permissions`, {
    headers: authHeaders(state.token),
  })
  expect(res.status()).toBe(200)

  const body = await res.json()

  // bot_perms : liste + ORDRE exacts (toEqual compare l'ordre des tableaux).
  expect(body.bot_perms).toEqual(EXPECTED_BOT_PERMS)

  // field_perms : clés ET valeurs exactes (toEqual = égalité stricte, donc une
  // clé en trop ou en moins côté backend casse aussi le test).
  expect(body.field_perms).toEqual(EXPECTED_FIELD_PERMS)
})
