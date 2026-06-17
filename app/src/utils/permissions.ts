// Permissions centralisées par bot — source unique de vérité pour « ai-je le
// droit X sur ce bot ? » côté dashboard, partagée par Inbox, BotList et BotPage.
//
// Modèle d'appartenance : un bot est SOIT perso (owner_user_id, scope
// 'personal', pas d'organization_id) SOIT d'équipe (organization_id, scope
// 'team'). La règle d'enforcement ci-dessous est garde-fou par e2e
// (team-permissions.spec, strict) — NE PAS la réécrire.
//
// La LISTE des permissions reconnues est figée côté backend
// (api/src/models/user.py::BOT_PERMS) et exposée par GET /api/meta/permissions.
// Le front n'a pas à la consommer au runtime : la non-dérive entre ce miroir
// (BOT_PERMS ci-dessous) et la source backend est vérifiée par le test de
// parité permissions-parity.spec.
import type { User } from '../AuthContext'
import type { BotPerm } from '../types/auth'

// Miroir front (lisibilité) des permissions par bot. Source canonique =
// backend BOT_PERMS ; parité garantie par permissions-parity.spec.
export const BOT_PERMS: readonly BotPerm[] = ['copy', 'test', 'appearance', 'context', 'security', 'inbox']

// Forme minimale d'un bot attendue par ces helpers — compatible BotSummary
// (BotList) et l'objet bot détaillé de BotPage.
export interface BotLike {
  id: number
  owner_user_id?: number | null
  organization_id?: number | null
  scope?: 'personal' | 'team'
}

// Un bot est-il perso ? (owner_user_id sans organization_id, ou scope explicite)
export function isPersonalBot(bot: BotLike): boolean {
  return bot.scope === 'personal' || (bot.owner_user_id != null && bot.organization_id == null)
}

// L'utilisateur a-t-il la permission `perm` sur ce bot ?
// - superadmin : toujours ;
// - bot perso : son propriétaire a TOUS les droits ;
// - bot d'équipe : admin de l'équipe → tout, sinon perm explicite par bot.
export function canAccessBotPerm(user: User | null | undefined, bot: BotLike, perm: string): boolean {
  if (!user) return false
  if (user.is_superadmin) return true
  if (isPersonalBot(bot)) return bot.owner_user_id === user.id
  const org = user.organizations.find(o => o.id === bot.organization_id)
  if (!org) return false
  return org.role === 'admin' || (org.permissions[String(bot.id)] || []).includes(perm)
}

// Badge d'appartenance : « Perso » pour un bot perso, sinon le nom de l'équipe
// propriétaire (fallback « Équipe » si l'org n'est pas dans la liste de
// l'utilisateur, p. ex. superadmin éditant le bot d'un client).
export function botOwnerLabel(user: User | null | undefined, bot: BotLike): string {
  if (isPersonalBot(bot)) return 'Perso'
  const org = user?.organizations.find(o => o.id === bot.organization_id)
  return org?.name || 'Équipe'
}
