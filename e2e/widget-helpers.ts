// Helpers spécifiques aux specs WIDGET du lot 2 — volontairement séparés de
// helpers.ts (qui appartient au lot 1) : zéro chevauchement de fichiers.
//
// RÈGLE ABSOLUE (MOCK_AI=false, vraies clés IA) : les bots exercés ici sont en
// mode tree (input masqué, aucun chemin IA possible) et AUCUNE requête réelle
// ne part vers Calendly — interceptCalendly stubbe tout l'hôte avant la
// moindre navigation.
import type { Page, Route } from '@playwright/test'
import type { E2EState } from './global-setup'

// Arbre à nœuds typés, conforme à tree_engine.validate_tree :
// - appointment : 'url' https:// obligatoire (rendue en overlay par widget.js)
// - lead : 'email' obligatoire dans fields (formulaire dans le widget)
// L'URL Calendly n'est JAMAIS résolue en vrai : voir interceptCalendly.
export const NODES_TREE = {
  start: 'root',
  nodes: {
    root: {
      message: 'Bonjour ! Que souhaitez-vous ?',
      options: [
        { label: 'Rendez-vous', next: 'rdv' },
        { label: 'Contact', next: 'contact' },
      ],
    },
    rdv: {
      type: 'appointment',
      url: 'https://calendly.com/e2e-demo/intro',
      message: 'Choisissez un créneau :',
      options: [{ label: 'Menu principal', next: 'root' }],
    },
    contact: {
      type: 'lead',
      fields: ['email', 'message'],
      message: 'Laissez-nous vos coordonnées :',
      options: [{ label: 'Menu principal', next: 'root' }],
    },
  },
}

// Stub de TOUT le trafic Calendly (domaine racine + sous-domaines) : l'iframe
// de l'overlay RDV ne charge RIEN de réel. page.route s'applique aussi aux
// sous-frames en Chromium. À poser AVANT toute navigation du test.
export async function interceptCalendly(page: Page) {
  const stub = (route: Route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub e2e</title>' })
  await page.route('https://calendly.com/**', stub)
  await page.route('https://*.calendly.com/**', stub)
}

// Widget réel en mode iframe (pattern de widget.spec) : /widget-frame est
// servi par l'API ; allowed_domains ['localhost'] + ENV=dev couvrent l'origin.
export async function openFrame(page: Page, state: E2EState, publicKey: string) {
  await page.goto(`${state.apiUrl}/widget-frame?key=${publicKey}`)
}
