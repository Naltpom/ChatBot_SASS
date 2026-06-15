// Wizard CONVERSATIONNEL Chapote (route /app/bots/new, pages/BotWizard.tsx) :
// Discussion (chat à chips) → Proposition (preset) → Apparence → Arbre (TreeFlow
// partagé) → création RÉELLE → Terminé. Intention conservée : créer un bot en
// mode ARBRE de bout en bout (aucun chemin IA exercé — MOCK_AI=false).
//
// Parcours sans IA : on choisit le secteur, un objectif, puis « Passer à un
// conseiller » comme repli (fallback=human) — ce qui SAUTE la question budget et
// force botMode='tree' (wantsAI=false). La création appelle l'API réelle ; on
// récupère l'id du bot créé via l'URL de l'éditeur pour le supprimer (afterAll).
//
// Auth : token du global-setup (compte entreprise, plan agence, org active)
// injecté en localStorage avant le 1er chargement.
import { expect, test } from '@playwright/test'
import { authenticate, deleteBot, loadState } from '../helpers'

const state = loadState()

// Bot créé pendant le test (la création est réelle) → suppression best-effort.
let createdBotId: number | null = null

test.afterAll(async ({ request }) => {
  if (createdBotId) await deleteBot(request, state, createdBotId)
})

test.beforeEach(async ({ page }) => {
  await authenticate(page, state)
})

test('wizard conversationnel : création d\'un bot en mode arbre de bout en bout', async ({ page }) => {
  await page.goto('/app/bots/new')
  await expect(page.getByText('Nouveau chatbot')).toBeVisible()

  // ===================== ÉTAPE 1 : DISCUSSION (chat) =====================
  // Q1 — secteur (chips à choix unique)
  await expect(page.getByText(/Quel est votre domaine d'activité/)).toBeVisible()
  await page.getByRole('button', { name: 'E-commerce', exact: true }).click()

  // Q2 — objectifs (multi : chips « + … » puis « Continuer → »)
  await expect(page.getByText(/Que doit-il faire en priorité/)).toBeVisible()
  await page.getByRole('button', { name: '+ Capturer des contacts' }).click()
  await page.getByRole('button', { name: 'Continuer →' }).click()

  // Q3 — repli : « Passer à un conseiller » → pas d'IA, saute la question budget,
  // file directement à l'étape Proposition (botMode='tree').
  await expect(page.getByText(/Quand l'arbre guidé ne suffit pas/)).toBeVisible()
  await page.getByRole('button', { name: 'Passer à un conseiller', exact: true }).click()

  // ===================== ÉTAPE 2 : PROPOSITION (preset) =====================
  await expect(page.getByText("Voici l'assistant de vos rêves")).toBeVisible()
  // L'objectif « contacts » apparaît dans les capacités proposées.
  await expect(page.getByText('Capture de contacts')).toBeVisible()
  await page.getByRole('button', { name: /Personnaliser l'apparence/ }).click()

  // ===================== ÉTAPE 3 : APPARENCE =====================
  await expect(page.getByText("L'apparence de votre widget")).toBeVisible()
  await expect(page.getByText('Couleur principale')).toBeVisible()
  await page.getByRole('button', { name: /Continuer vers l'arbre/ }).click()

  // ===================== ÉTAPE 4 : ARBRE (TreeFlow partagé) =====================
  await expect(page.getByText('Votre arbre de conversation')).toBeVisible()
  // Composant TreeFlow monté : carte racine « 🌿 Message d'accueil » (substring,
  // l'emoji préfixe le libellé) + carte éditeur « Arbre de conversation »
  // (titre exact, distinct du heading « Votre arbre de conversation »).
  await expect(page.getByText("Message d'accueil")).toBeVisible()
  await expect(page.getByText('Arbre de conversation', { exact: true })).toBeVisible()

  // Création RÉELLE du bot (POST /api/orgs/{id}/bots + PATCH) → étape Terminé.
  await page.getByRole('button', { name: /Créer mon chatbot/ }).click()

  // ===================== ÉTAPE 5 : TERMINÉ =====================
  await expect(page.getByText('Votre chatbot est créé')).toBeVisible()

  // Ouvrir l'éditeur → on atterrit sur la page du bot ; l'id sert au nettoyage.
  await page.getByRole('button', { name: /Ouvrir l'éditeur/ }).click()
  await expect(page).toHaveURL(/\/app\/bots\/\d+$/)
  const m = page.url().match(/\/app\/bots\/(\d+)/)
  createdBotId = m ? Number(m[1]) : null
  expect(createdBotId).toBeTruthy()

  // L'éditeur du bot créé est bien chargé (nom dérivé du secteur ecom). Pour un
  // admin d'org, le nom est rendu dans un <input> éditable (placeholder « Nom du
  // bot ») ; on vérifie donc sa VALEUR plutôt qu'un texte visible.
  await expect(page.getByPlaceholder('Nom du bot')).toHaveValue('Assistant boutique')
})
