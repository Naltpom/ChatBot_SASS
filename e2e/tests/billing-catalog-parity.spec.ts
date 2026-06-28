// Test anti-divergence : pin le CONTRAT FIGÉ de la facturation modulaire exposé
// par GET /api/meta/billing-catalog (spec §7.2). Calque de
// permissions-parity.spec.ts : source canonique = api/src/core/constants.py
// (MODULE_KEYS + MODULE_AI). Toute dérive d'une des sources casse ce test.
//
// Ce ne sont PAS les prix (variables, en base billing_products, servis par
// GET /api/billing/catalog) mais les CLÉS (modules, axes métrés, formats de
// facture). Ordre STRICT (toEqual compare l'ordre des tableaux). Indépendant de
// billing_enabled : /meta/* est en lecture seule, auth dashboard requise (comme
// /meta/permissions), aucun effet sur l'enforcement — le test tourne donc même
// clés Stripe absentes (CI).
//
// VOLET CROSS-SURFACE (audit §3.1, source unique) : depuis la suppression des
// catalogues codés en dur (front FALLBACK_CATALOG, PHP catalog()), seules les
// CLÉS de module subsistent en copie côté front (typage) et côté plugin
// (allowlist de sanitisation). Ce test LIT ces fichiers réels et exige qu'ils
// reflètent EXACTEMENT MODULE_KEYS du backend — impossible d'ajouter/retirer un
// module sans synchroniser les trois surfaces (sinon échec ici). Le conteneur
// api n'ayant pas accès à app/ ni integrations/, cette vérification vit côté e2e
// (hôte, accès dépôt complet) ; le volet backend interne est dans
// api/tests/test_billing_catalog_parity.py.
//
// API-centré, lecture seule, ZÉRO mutation d'état : réutilise le token du compte
// principal du state. Aucune dépendance UI.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { authHeaders, loadState } from '../helpers'

const state = loadState()

// Ordre EXACT de MODULE_KEYS (api/src/core/constants.py) :
//   MODULE_KEYS = (MODULE_AI, MODULE_INBOX, MODULE_RAG, MODULE_ACTIONS,
//                  MODULE_MCP, MODULE_AB, MODULE_WHITELABEL)
const EXPECTED_MODULES = ['ai', 'inbox', 'rag', 'actions', 'mcp', 'ab', 'white_label']

// Axe métré (D1 : v1 = blocage, une seule dimension « réponse IA ») ; BYOK exclut
// le métré (RÈGLE 3) ; formats de facture (User.billing_grouping).
const EXPECTED_METERED_AXES = ['ai']
const EXPECTED_GROUPING_OPTIONS = ['per_bot', 'total', 'per_org']

// Racine du dépôt depuis e2e/tests/.
const REPO = resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(resolve(REPO, rel), 'utf8')

// Extrait toutes les chaînes simple-quote d'un segment de source (ordre conservé).
const singleQuoted = (segment: string): string[] =>
  (segment.match(/'([^']+)'/g) || []).map(s => s.slice(1, -1))

test('GET /api/meta/billing-catalog reflète MODULE_KEYS + axes métrés + formats (parité figée)', async ({ request }) => {
  const res = await request.get(`${state.apiUrl}/api/meta/billing-catalog`, {
    headers: authHeaders(state.token),
  })
  expect(res.status()).toBe(200)

  const body = await res.json()

  // Égalité STRICTE de l'objet entier : une clé en trop/en moins côté backend
  // (ou un module réordonné) fait échouer le test.
  expect(body).toEqual({
    modules: EXPECTED_MODULES,
    metered_axes: EXPECTED_METERED_AXES,
    byok_excludes_metering: true,
    billing_grouping_options: EXPECTED_GROUPING_OPTIONS,
  })
})

test('parité cross-surface : front (MODULE_KEYS + type ModuleKey) et PHP (allowlist) == backend', async ({ request }) => {
  // Source de vérité = backend (endpoint canonique), pas la constante locale du
  // test : on compare TOUTES les copies à la liste réellement servie.
  const res = await request.get(`${state.apiUrl}/api/meta/billing-catalog`, {
    headers: authHeaders(state.token),
  })
  expect(res.status()).toBe(200)
  const backendModules: string[] = (await res.json()).modules

  // 1) Front — tableau ordonné app/src/utils/billing.ts::MODULE_KEYS.
  const billingTs = read('app/src/utils/billing.ts')
  const keysBlock = billingTs.match(/MODULE_KEYS:\s*readonly ModuleKey\[\]\s*=\s*\[([\s\S]*?)\]/)
  expect(keysBlock, 'MODULE_KEYS introuvable dans app/src/utils/billing.ts').not.toBeNull()
  const frontKeys = singleQuoted(keysBlock![1])
  // Ordre EXACT (le front documente que l'ordre suit le backend).
  expect(frontKeys).toEqual(backendModules)

  // 2) Front — union de type app/src/types/billing.ts::ModuleKey.
  const typesTs = read('app/src/types/billing.ts')
  const unionBlock = typesTs.match(/export type ModuleKey\s*=\s*([^\n]+)/)
  expect(unionBlock, 'type ModuleKey introuvable dans app/src/types/billing.ts').not.toBeNull()
  const frontUnion = singleQuoted(unionBlock![1])
  expect(frontUnion).toEqual(backendModules)

  // 3) PHP — allowlist de sanitisation (clés, ordre indifférent -> comparaison
  //    d'ensembles triés). class-chapote-bo-rest.php::sanitize_billing_config.
  const restPhp = read('integrations/wordpress/chapote-chatbot/includes/class-chapote-bo-rest.php')
  const allowBlock = restPhp.match(/\$allowed_modules\s*=\s*array\(([\s\S]*?)\)/)
  expect(allowBlock, '$allowed_modules introuvable dans class-chapote-bo-rest.php').not.toBeNull()
  const phpKeys = singleQuoted(allowBlock![1])
  expect([...phpKeys].sort()).toEqual([...backendModules].sort())
})
