/*
 * Générateur des assets WordPress.org du plugin Chapote Bot Manager :
 *   - screenshot-1..5.png : le PARCOURS DE CRÉATION guidé depuis WordPress
 *     (accueil → analyse du site → arbre généré → offre conseillée → gestion),
 *     rendu par la VRAIE SPA du plugin avec le réseau stubé (données fake neutres).
 *   - banner-772x250.png + banner-1544x500.png (retina) : bannière de la fiche.
 *
 * Prérequis : dépendances Playwright de e2e/ (chromium déjà installé).
 * Usage     : depuis e2e/  ->  node ../integrations/wordpress/wporg-screenshots/shoot.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
// Playwright vit dans e2e/node_modules (pas ici) : on résout depuis e2e/.
const require = createRequire(resolve(HERE, '..', '..', '..', 'e2e') + '/');
const { chromium } = require('@playwright/test');

const HARNESS = pathToFileURL(resolve(HERE, 'harness.html')).href;
const BANNER = pathToFileURL(resolve(HERE, 'banner.html')).href;
const ASSET = (name) => resolve(HERE, '..', 'wporg-assets', name);
const WRAP = '.chapote-bo-wrap';

// Ordre = narration de la fiche. `ready` : texte à attendre avant capture.
const SCENES = [
  { n: 1, scene: 'welcome', ready: 'Créons votre chatbot' },
  { n: 2, scene: 'pick',    ready: 'Quelles pages décrivent votre activité' },
  { n: 3, scene: 'tree',    ready: 'Votre arbre de conversation' },
  // Coche le consentement pour montrer le bouton « Souscrire et activer » actif.
  { n: 4, scene: 'offer',   ready: 'offre conseillée',
    prep: async (page) => { await page.locator('.cbo-consent input[type=checkbox]').check(); } },
  { n: 5, scene: 'bots',    ready: 'Assistant boutique' },
];

const run = async () => {
  const browser = await chromium.launch();
  const errors = [];

  // --- Screenshots (2× pour la netteté) ---
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 1000 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  for (const s of SCENES) {
    await page.goto(`${HARNESS}?scene=${s.scene}`, { waitUntil: 'networkidle' });
    await page.getByText(s.ready, { exact: false }).first().waitFor();
    if (s.prep) await s.prep(page);
    await page.waitForTimeout(300); // stabilise polices/rendu
    await page.locator(WRAP).screenshot({ path: ASSET(`screenshot-${s.n}.png`) });
    console.log(`✓ screenshot-${s.n}.png (${s.scene})`);
  }
  await ctx.close();

  // --- Bannières : 772×250 (1×) et 1544×500 (2×), depuis le même banner.html ---
  for (const [scale, name] of [[1, 'banner-772x250.png'], [2, 'banner-1544x500.png']]) {
    const bctx = await browser.newContext({ viewport: { width: 772, height: 250 }, deviceScaleFactor: scale });
    const bp = await bctx.newPage();
    bp.on('pageerror', (e) => errors.push(String(e)));
    await bp.goto(BANNER, { waitUntil: 'networkidle' });
    await bp.waitForTimeout(200);
    await bp.locator('.banner').screenshot({ path: ASSET(name) });
    console.log(`✓ ${name}`);
    await bctx.close();
  }

  await browser.close();

  if (errors.length) {
    console.error('\n⚠ Erreurs page détectées :\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('\nTerminé — 5 captures + 2 bannières régénérées.');
};

run().catch((e) => { console.error(e); process.exit(1); });
