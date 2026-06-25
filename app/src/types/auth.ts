// Contrat de types partagé pour l'authentification / multi-tenant — fidèle aux
// clés JSON réelles renvoyées par l'API. Source de vérité :
//   - api/src/models/user.py     (UserOut, OrgOut, BOT_PERMS, TokenOut, UserRegister)
//   - api/src/routers/auth.py    (login/register/dev-login -> TokenOut ; me -> UserOut)
//   - app/src/AuthContext.tsx    (formes Org/User/RegisterPayload déjà utilisées)
//
// Ces types ne modifient aucun comportement : ils décrivent la forme exacte des
// réponses. snake_case côté API ; les clés conservent leur casse réelle.

// ============================================================================
// Permissions par bot. En SORTIE (OrgOut.permissions), c'est une table indexée
// par bot_id (sérialisé en string dans le JSON : { "<bot_id>": ["copy", ...] }).
// BOT_PERMS = ["copy", "test", "appearance", "context", "security", "inbox"].
// On garde string[] (et non un littéral) car le JSON peut théoriquement porter
// d'anciennes valeurs ; la map est indexée par string (clé JSON).
// ============================================================================

import type { BillingGrouping } from './billing'

export type BotPerm = 'copy' | 'test' | 'appearance' | 'context' | 'security' | 'inbox'

// Telle que renvoyée : clés = bot_id stringifié (JSON object), valeurs = perms.
export type BotPermissions = Record<string, string[]>

// ============================================================================
// Org (OrgOut) : une organisation = une ÉQUIPE. `role`/`permissions` décrivent
// la position du user COURANT dans cette org.
// ============================================================================

export interface Org {
  id: number
  name: string
  role: string // admin | member (role du user courant)
  permissions: BotPermissions // perms par bot (pertinent pour un member)
  // True si le user courant est l'OWNER de l'org (org.owner_user_id == user.id).
  // Seul l'owner gère la facturation des bots d'équipe (un admin non-owner ne paie pas).
  is_owner: boolean
}

// ============================================================================
// User (UserOut) — forme renvoyée par GET /api/auth/me et imbriquée dans
// TokenOut.user (login/register/dev-login).
// ============================================================================

export interface User {
  id: number
  email: string
  name: string
  avatar_url?: string | null // photo de profil (SSO Google) ou null -> initiales
  auth_source: string // local | intranet | google
  is_superadmin: boolean
  created_at?: string | null
  last_login?: string | null
  organizations: Org[]
  // --- Facturation (UserOut, calculés serveur) ---
  // Format de facture choisi : per_bot | total | per_org (défaut 'total').
  billing_grouping: BillingGrouping
  // True si le billing est actif côté serveur (clés Stripe posées). Pilote
  // l'affichage front : à false, on reste 100% gratuit, aucun gating.
  is_billing_enabled: boolean
  // Ids des orgs dont CE user est owner (org.owner_user_id == user.id). Dérivable
  // aussi de organizations[].is_owner ; exposé explicitement pour le gating billing.
  owned_org_ids: number[]
}

// ============================================================================
// AuthResponse — réponse de /api/auth/login | register | dev-login (TokenOut).
// /api/auth/me renvoie directement un User (pas d'enveloppe token).
// ============================================================================

export interface AuthResponse {
  access_token: string
  token_type: string // "bearer"
  user: User
}

// ============================================================================
// RegisterPayload — corps de POST /api/auth/register (UserRegister).
// ============================================================================

export interface InvitePayload {
  email: string
  role: string // admin | member
}

export interface RegisterPayload {
  email: string
  password: string
  name: string
  account_type: 'perso' | 'entreprise'
  organization_name?: string // requis si entreprise
  invites?: InvitePayload[] // entreprise uniquement
}
