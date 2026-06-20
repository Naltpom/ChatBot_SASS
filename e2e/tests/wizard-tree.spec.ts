// Wizard CONVERSATIONNEL Chapote (route /app/bots/new, pages/BotWizard.tsx) :
// Discussion (Q&R enrichie : entreprise + secteur + objectifs + ton + repli) →
// Proposition (preset) → Apparence → Sources (passée) → Arbre (TreeFlow partagé)
// → création RÉELLE → Terminé. Intention conservée : créer un bot en mode ARBRE
// de bout en bout (aucun chemin IA exercé — fallback=human → botMode='tree').
//
// On PASSE l'étape Sources (aucune URL/PDF) : l'arbre vient de l'ébauche locale,
// donc AUCUN appel IA n'est déclenché (pas de dépendance à Gemini/MOCK_AI ici).
// On choisit « Capturer des contacts » (et NON « Suivre les commandes ») pour ne
// pas déclencher la question conditionnelle de suivi de commande.
//
// Auth : token du global-setup (compte entreprise, org active) injecté en
// localStorage avant le 1er chargement.
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

  // ===================== ÉTAPE 1 : DISCUSSION (chat enrichi) =====================
  // Q1 — nom d'entreprise (saisie libre) : sert au nom du bot + message d'accueil.
  await expect(page.getByText(/comment s'appelle votre entreprise/i)).toBeVisible()
  await page.getByPlaceholder('Ex. Maison Léna').fill('Maison Test')
  await page.getByRole('button', { name: 'Valider →' }).click()

  // Q2 — secteur (chips à choix unique)
  await expect(page.getByText(/Quel est votre domaine d'activité/)).toBeVisible()
  await page.getByRole('button', { name: 'E-commerce', exact: true }).click()

  // Q3 — objectifs (multi : chips « + … » puis « Continuer → »)
  await expect(page.getByText(/Que doit-il faire en priorité/)).toBeVisible()
  await page.getByRole('button', { name: '+ Capturer des contacts' }).click()
  await page.getByRole('button', { name: 'Continuer →' }).click()

  // Q4 — ton de voix (pas de branchement conditionnel : 'orders' non coché)
  await expect(page.getByText(/Quel ton de voix/)).toBeVisible()
  await page.getByRole('button', { name: 'Vouvoiement professionnel', exact: true }).click()

  // Q5 (dernière) — repli « Passer à un conseiller » → pas d'IA (botMode='tree')
  await expect(page.getByText(/Quand l'arbre guidé ne suffit pas/)).toBeVisible()
  await page.getByRole('button', { name: 'Passer à un conseiller', exact: true }).click()

  // ===================== ÉTAPE 2 : PROPOSITION (preset) =====================
  await expect(page.getByText("Voici l'assistant de vos rêves")).toBeVisible()
  await expect(page.getByText('Capture de contacts')).toBeVisible()
  await page.getByRole('button', { name: /Personnaliser l'apparence/ }).click()

  // ===================== ÉTAPE 3 : APPARENCE =====================
  await expect(page.getByText("L'apparence de votre widget")).toBeVisible()
  await expect(page.getByText('Couleur principale')).toBeVisible()
  // « Continuer → » mène désormais à l'étape Sources (et non directement à l'arbre).
  await page.getByRole('button', { name: 'Continuer →', exact: true }).click()

  // ===================== ÉTAPE 4 : SOURCES (passée) =====================
  await expect(page.getByText(/Pages à analyser/)).toBeVisible()
  await page.getByRole('button', { name: 'Passer cette étape' }).click()

  // ===================== ÉTAPE 5 : ARBRE (TreeFlow partagé) =====================
  await expect(page.getByText('Votre arbre de conversation')).toBeVisible()
  // Composant TreeFlow monté : le titre éditeur « Arbre de conversation » (exact)
  // vit dans le wrapper TOUJOURS monté ; la carte racine « 🌿 Message d'accueil »
  // (substring) est rendue par le canvas LAZY (chunk dynamique @xyflow) -> le
  // expect auto-attend son chargement.
  await expect(page.getByText('Arbre de conversation', { exact: true })).toBeVisible()
  await expect(page.getByText("Message d'accueil")).toBeVisible()

  // Création RÉELLE du bot (POST /api/orgs/{id}/bots + PATCH) → étape Terminé.
  await page.getByRole('button', { name: /Créer mon chatbot/ }).click()

  // ===================== ÉTAPE 6 : TERMINÉ =====================
  await expect(page.getByText('Votre chatbot est créé')).toBeVisible()

  // Ouvrir l'éditeur → on atterrit sur la page du bot ; l'id sert au nettoyage.
  await page.getByRole('button', { name: /Ouvrir l'éditeur/ }).click()
  await expect(page).toHaveURL(/\/app\/bots\/\d+$/)
  const m = page.url().match(/\/app\/bots\/(\d+)/)
  createdBotId = m ? Number(m[1]) : null
  expect(createdBotId).toBeTruthy()

  // Le nom du bot est dérivé du nom d'entreprise saisi (« Assistant {entreprise} »).
  // Pour un admin d'org, le nom est un <input> éditable (placeholder « Nom du bot »).
  await expect(page.getByPlaceholder('Nom du bot')).toHaveValue('Assistant Maison Test')
})
