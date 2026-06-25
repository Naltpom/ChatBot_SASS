// Test anti-divergence : pin le CONTRAT FIGÉ de la facturation modulaire exposé
// par GET /api/meta/billing-catalog (spec §7.2). Calque exact de
// permissions-parity.spec.ts : source canonique = api/src/core/constants.py
// (MODULE_KEYS + MODULE_AI) ; miroir front = app/src/utils/billing.ts
// (MODULE_KEYS). Toute dérive d'une des deux sources casse ce test.
//
// Ce ne sont PAS les prix (variables, en base billing_products) mais les CLÉS
// (modules, axes métrés, formats de facture). Ordre STRICT (toEqual compare
// l'ordre des tableaux). Indépendant de billing_enabled : /meta/* est en
// lecture seule, auth dashboard requise (comme /meta/permissions), aucun effet
// sur l'enforcement — le test tourne donc même clés Stripe absentes (CI).
//
// API-centré, lecture seule, ZÉRO mutation d'état : réutilise le token du compte
// principal du state. Aucune dépendance UI.
import { expect, test } from '@playwright/test'
import { authHeaders, loadState } from '../helpers'

const state = loadState()

// Ordre EXACT de MODULE_KEYS (api/src/core/constants.py) :
//   MODULE_KEYS = (MODULE_AI, MODULE_INBOX, MODULE_RAG, MODULE_ACTIONS,
//                  MODULE_MCP, MODULE_AB, MODULE_WHITELABEL)
// Le miroir front (app/src/utils/billing.ts::MODULE_KEYS) DOIT être identique.
const EXPECTED_MODULES = ['ai', 'inbox', 'rag', 'actions', 'mcp', 'ab', 'white_label']

// Axe métré (D1 : v1 = blocage, une seule dimension « réponse IA ») ; BYOK exclut
// le métré (RÈGLE 3) ; formats de facture (User.billing_grouping).
const EXPECTED_METERED_AXES = ['ai']
const EXPECTED_GROUPING_OPTIONS = ['per_bot', 'total', 'per_org']

test('GET /api/meta/billing-catalog reflète MODULE_KEYS + axes métrés + formats (parité figée)', async ({ request }) => {
  const res = await request.get(`${state.apiUrl}/api/meta/billing-catalog`, {
    headers: authHeaders(state.token),
  })
  expect(res.status()).toBe(200)

  const body = await res.json()

  // Égalité STRICTE de l'objet entier : une clé en trop/en moins côté backend
  // (ou un module réordonné) fait échouer le test. Reflète exactement le retour
  // de bots.py::billing_catalog_meta et le contrat de la spec §7.2.
  expect(body).toEqual({
    modules: EXPECTED_MODULES,
    metered_axes: EXPECTED_METERED_AXES,
    byok_excludes_metering: true,
    billing_grouping_options: EXPECTED_GROUPING_OPTIONS,
  })
})
