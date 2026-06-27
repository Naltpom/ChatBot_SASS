# Modèle de statut d'éligibilité d'un bot (unifié)

> Référence courte du modèle « un bot est-il utilisable / sous quel plan ». Le
> MOTEUR de facturation (modules, quota IA, dépassement, ids Stripe) est séparé et
> inchangé.

## Principe

- **UNE seule colonne** porte le statut : `bot_entitlements.status` (déjà projetée
  par le webhook Stripe). Plus aucune recopie d'éligibilité ailleurs.
- **UN journal** d'audit : `bot_status_history` (qui / quand / comment / pourquoi).
- **UN seul point d'écriture** : `entitlement_service.set_bot_status(...)` écrit le
  statut **et** journalise la transition dans la même transaction → pas de drift
  possible. Tous les chemins passent par lui (webhook, création, override staff,
  blocage admin, grâce move/transfert, mock).
- **UNE seule lecture d'éligibilité** : `entitlement_service.is_usable(ent)`.

## Statuts (`bot_entitlements.status`) — stockés en anglais, affichés en FR

| Statut | Badge | Sens | `is_usable` |
|---|---|---|---|
| `active` | Actif | Payé OU activé par un admin (le « comment » est dans le journal) | ✅ |
| `trialing` | Essai | Essai legacy en cours (non expiré) | ✅ si non expiré |
| `past_due` | Impayé | Échec paiement / grâce après transfert ; se régularise au paiement | ❌ |
| `suspended` | Bloqué | **Blocage admin (abus)** — voir ci-dessous | ❌ |
| `inactive` | Paiement requis | Aucun abonnement : bot neuf, résilié, `canceled` replié | ❌ |

`is_usable(ent) = (status == active) OU (trialing non expiré)`. `canceled` est
replié sur `inactive` à la lecture (pas de migration de données).

## `suspended` (blocage admin) — COLLANT

- Posé par `POST /api/admin/bots/{id}/block` (`actor_kind='staff'`).
- **Collant** : aucun événement Stripe (même un paiement réussi le mois suivant)
  ne le lève — Stripe continue d'encaisser, le bot reste inutilisable. La garde
  est dans `set_bot_status` (un acteur non-`staff` ne peut pas sortir de
  `suspended`).
- **Coupe le widget** : `_assert_bot_servable` renvoie 404 pour un bot suspended
  (seule éligibilité-billing qui coupe réellement le widget ; les autres états
  laissent la politique de paiement au plugin WordPress).
- **Déblocage** = `DELETE /api/admin/bots/{id}/entitlement` (reset) : la baseline
  `staff` lève le verrou, puis la reprojection Stripe **re-dérive** l'état réel
  (jamais un `active` forcé — si l'abo a lapsé pendant la suspension, le bot
  reste gaté).

## Journal `bot_status_history`

Colonnes : `bot_id`, `old_status`, `new_status`, `actor_kind`
(`stripe|staff|owner|system`), `actor_user_id`, `reason`, `stripe_event_id`,
`created_at`. Une ligne **uniquement si le statut change** (genèse = 1 ligne par
entitlement au backfill de migration). Lecture admin :
`GET /api/admin/bots/{id}/status-history`.

## Hors périmètre (axes orthogonaux, inchangés)

- `bot.is_active` (pause widget par l'owner), `organization.is_active` (suspension
  d'org), `user.is_active` (perms) — ne sont PAS de l'éligibilité-billing.
- Le moteur d'essai (`trialing`/`trial_end`/`trial_expired`) est CONSERVÉ tel quel
  (sa dépréciation est un chantier séparé). `source` est conservé en cache compat
  (candidat suppression ; l'audit fait foi via le journal).
