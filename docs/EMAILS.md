# Adresses e‑mail Chapote — référentiel

> Source de vérité des adresses `@chapote.fr` : à quoi sert chaque alias, où il est
> référencé dans l'app, et quels e‑mails transactionnels le Service envoie.
> Toutes les adresses ci‑dessous sont des **alias** qui redirigent vers la boîte
> **Email Pro OVH `contact@chapote.fr`** (hébergement mail : `pro2.mail.ovh.net`).

## 1. Boîte principale

| Adresse | Type | Rôle |
|---|---|---|
| `contact@chapote.fr` | **Boîte réelle** (Email Pro OVH) | Reçoit tout. C'est le compte authentifié pour l'**envoi SMTP** applicatif (`SMTP_USER`). |

## 2. Alias (redirigent vers `contact@`)

| Alias | Usage | Référencé dans |
|---|---|---|
| `noreply@chapote.fr` | **Expéditeur** des e‑mails automatiques/transactionnels (champ `From`). Personne ne doit y répondre → `Reply-To: support@`. | `SMTP_FROM` (`.env` local + prod) |
| `support@chapote.fr` | Support client, réclamations, rétractation, `Reply-To` des mails transactionnels. | CGV §9.4 ; futur footer/aide app |
| `postmaster@chapote.fr` | Standard RFC 5321 — supervision mail, NPAI. Boîte technique, non exposée. | — (réputation/délivrabilité) |
| `abuse@chapote.fr` | Standard RFC 2142 — signalement d'abus / contenu illicite. | Mentions légales §Signalement |
| `rgpd@chapote.fr` | Contact RGPD / exercice des droits / DPO. | Politique de confidentialité §1, §7, §10 ; mentions légales §Signalement |
| `legal@chapote.fr` | Questions juridiques / CGU / CGV / mentions. | (réservé — à câbler si besoin) |
| `security@chapote.fr` | Divulgation responsable de vulnérabilités. | `app/public/.well-known/security.txt` ✅ |
| `hello@chapote.fr` | Contact général / commercial / presse (ton chaleureux). | Footer landing — lien « Contact » (`mailto:`) ✅ |

> Sous‑traitant d'envoi e‑mail déclaré dans la politique de confidentialité §6 :
> **OVH SAS (Email Pro, UE)**.

## 3. E‑mails transactionnels envoyés par le Service

Envoi centralisé : `api/src/services/email_service.py` → `send_email(to, subject, body, reply_to=None)`.
`From` = `SMTP_FROM` (→ doit être `noreply@chapote.fr`). La colonne **Reply‑To** indique
où atterrissent les réponses humaines (cf. §4).

### Existants

| E‑mail | Déclencheur | Code | Reply‑To |
|---|---|---|---|
| **Nouveau lead** | Soumission formulaire / action IA `capture_lead` | `email_service.build_lead_email()` ; `routers/widget.py`, `action_executor.py` | e‑mail du visiteur |
| **Demande de conseiller (handoff)** | Visiteur demande un humain | `email_service.build_handoff_email()` ; `routers/widget.py` | `support@` |
| **Nouveau ticket** | Action IA `create_ticket` | `email_service.build_ticket_email()` ; `action_executor.py` | e‑mail du visiteur (sinon aucun) |
| **Prospection** | Envoi manuel superadmin | `routers/admin_prospecting.py` | `hello@` (boîte commerciale) |
| **Confirmation de compte** | Inscription | `email_service.build_verify_email()` ; `routers/auth.py` | `support@` |
| **Mot de passe oublié / réinitialisation** | Demande de reset | `email_service.build_reset_email()` ; `routers/auth.py` | `support@` |
| **Bienvenue** | Transition `email_verified` False→True (confirmation) | `email_service.build_welcome_email()` ; `routers/auth.py` (`confirm_email_verification`) | `support@` |
| **Invitation équipe** | Register entreprise / invite‑member (compte inexistant) | `email_service.build_invite_email()` ; `routers/auth.py`, `routers/orgs.py` | `support@` |
| **Ajout à une équipe** | Compte existant ajouté direct comme membre | `email_service.build_added_to_org_email()` ; `routers/auth.py`, `routers/orgs.py` | `support@` |
| **Sécurité — mot de passe modifié** | `change_password` / `reset_password` | `email_service.build_password_changed_email()` ; `routers/auth.py` | `support@` |
| **Bot suspendu** | Blocage admin (`status='suspended'`) | `email_service.build_bot_suspended_email()` ; `routers/admin_billing.py` | `support@` |
| **Plafond IA atteint** | Bot atteint son `overage_cap` du mois (1 mail/mois/bot) | `email_service.build_overage_cap_email()` ; `routers/widget.py` | `support@` |

> **Délégué à Stripe — aucun code applicatif** : les e‑mails d'**échec de paiement**,
> de **reçu / facture** et de **fin d'essai** sont envoyés automatiquement par Stripe.
> À activer dans **Stripe Dashboard → Settings → Emails** (customer emails). On ne les
> réimplémente pas côté Service pour éviter les doublons.

### À implémenter

| E‑mail | Déclencheur | Statut |
|---|---|---|
| **Sécurité — changement d'e‑mail** | Modification de l'adresse du compte | ❌ optionnel (l'e‑mail n'est pas éditable aujourd'hui) |

## 4. Convention d'expéditeur

- **Tous** les e‑mails automatiques partent de `noreply@chapote.fr` (`SMTP_FROM=Chapote <noreply@chapote.fr>`).
- Ajouter un en‑tête **`Reply-To: support@chapote.fr`** pour que les réponses humaines arrivent quelque part d'utile (pour les leads/handoff, le `Reply-To` peut être l'e‑mail du visiteur).
- ⚠️ Email Pro OVH : l'envoi se fait sous l'identité de la boîte authentifiée (`contact@`). Vérifier qu'OVH **accepte le `From: noreply@`** (alias de `contact@`) sans le réécrire.

## 5. Délivrabilité — état au 2026-06-28

Hébergement mail : **OVH Email Pro** (`pro2.mail.ovh.net`, STARTTLS 587). Zone DNS de
`chapote.fr` gérée chez OVH (`ns109.ovh.net` / `dns109.ovh.net`).

| Mécanisme | État | Détail |
|---|---|---|
| **SPF** | ✅ OK | `v=spf1 include:mx.ovh.com ~all` (référence Zoho retirée). |
| **DKIM** | ✅ ACTIF | Signature **activée** dans Email Pro (onglet *Domaines associés*, badge vert). Clés publiées en CNAME : `ovhemp1241711-selector1._domainkey` et `…-selector2._domainkey`. Les mails partent signés `d=chapote.fr`. |
| **DMARC** | ✅ posé (observation) | `_dmarc` TXT = `v=DMARC1; p=none; rua=mailto:postmaster@chapote.fr; ruf=mailto:postmaster@chapote.fr; fo=1`. Mode `p=none` (aucune sanction, collecte de rapports). |

**Durcissement DMARC** (après ~2–4 semaines de rapports confirmant l'alignement SPF/DKIM
de tous les envois légitimes) : `p=none` → `p=quarantine` → `p=reject`. Rapports agrégés
reçus sur `postmaster@chapote.fr` (fichiers XML, un par serveur/jour).

> Alignement DMARC : envoi authentifié en `contact@chapote.fr`, `From: noreply@chapote.fr`,
> SPF et DKIM en `chapote.fr` → alignés, DMARC passe. OVH **accepte** l'envoi avec
> `From: noreply@` (alias de `contact@`) — vérifié 2026-06-28.
