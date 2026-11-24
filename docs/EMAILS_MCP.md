# Boîtes mail pour Claude — emails.chapote.fr

Serveur **MCP distant** qui donne à Claude (connecteur personnalisé claude.ai) l'accès aux boîtes mail de
Chapote — l'Email Pro OVH `contact@chapote.fr` (voir [EMAILS.md](EMAILS.md)) et une dizaine de comptes Gmail —
plus une **interface d'administration**. Réservé au **superadmin**, double authentification obligatoire.
Même compte que chapote.fr (cookie de session sur `chapote.fr`, `X-Chapote-App: emails`).

- Interface : `https://emails.chapote.fr/`
- Serveur MCP : `https://emails.chapote.fr/mcp` (Streamable HTTP, OAuth 2.1)

## Architecture

```
Claude (cloud Anthropic) ──HTTPS 443──▶ reverse proxy de l'hôte (TLS emails.chapote.fr)
                                              │
                                              ▼
                              127.0.0.1:${EMAILS_PORT:-3004}  conteneur `emails` (nginx)
                               ├─ /                    bundle statique (interface React)
                               ├─ /api/emails/         ┐
                               ├─ /api/auth/(login|google|logout|me|2fa/login/*)
                               ├─ /mcp                 ├──▶ api:8000 (FastAPI)
                               ├─ /oauth/*             │      ├─ routers/emails.py        (/api/emails/*)
                               └─ /.well-known/oauth-* ┘      ├─ routers/emails_oauth.py  (OAuth 2.1)
                                                              ├─ services/emails_mcp.py   (/mcp, FastMCP)
                                                              └─ services/mail_client.py  ──▶ IMAP / SMTP
```

- **Front** `emails/` (Vite + React + TS), calqué sur `cm/` : Dockerfile, `nginx.conf` modèle (envsubst de
  `${EMAILS_PROXY_KEY}`), service compose `emails` (container `chatbot-emails`). Journal nginx **sans
  paramètres d'URL** (state, code_challenge, demande de consentement signée).
- **Clé proxy** `EMAILS_PROXY_KEY` : comme `CM_PROXY_KEY`, le nginx transmet la vraie IP du visiteur
  (`X-Emails-Client-IP`) signée par cette clé ; l'API ne la croit que si la clé correspond (`user_apps.client_ip`).
- **API** : `models/emails.py` (migration `c4e6a8b0d2f4`), `services/{mail_client,mailboxes,mailbox_crypto,
  emails_access,emails_oauth,emails_mcp}.py`, `routers/{emails,emails_oauth}.py`. Tests :
  `api/tests/test_emails_mcp.py` (+ faux IMAP/SMTP `tests/emails_fakes.py`).
- **MCP** : SDK officiel `mcp` (FastMCP, outils typés), transport Streamable HTTP **sans état**
  (`stateless=True`, réponses JSON) monté sur `/mcp` par une couche ASGI qui vérifie le jeton. Aucune session
  MCP en mémoire : chaque requête peut être servie par n'importe quel worker uvicorn (multi-worker en place,
  pas d'affinité de session) ; l'en-tête `Mcp-Session-Id` est relayé mais inutilisé.
- **IMAP / SMTP** : `imaplib` / `smtplib` exécutés dans un thread (`anyio.to_thread`), jamais dans la boucle
  async ; délai par socket `EMAILS_IMAP_TIMEOUT` (20 s) et plafond global par opération ; une connexion par
  appel (ouverte, utilisée, fermée). TLS vérifié (certificat + nom d'hôte).

## Sécurité

| Sujet | Mesure |
|---|---|
| Qui | Superadmin seulement (interface, consentement OAuth, jetons : vérifié à **chaque** appel MCP). |
| 2FA | Mécanisme `TWOFA_ENFORCE_ADMIN` existant (prod) **plus strict** : la session doit avoir franchi le 2nd facteur (claim `mfa` du cookie, posé par `/api/auth/2fa/login/*`). Session ouverte avant l'enrôlement → `twofa_session_required` (se reconnecter). |
| OAuth | OAuth 2.1 / spec d'autorisation MCP : PKCE **S256 obligatoire**, code à usage unique (5 min, prise atomique), jetons **opaques hachés** SHA-256, accès 1 h, rafraîchissement 30 j **à rotation** ; rejeu d'un code ou d'un rafraîchissement = révocation de toute la famille de jetons (journalisée). Jeton lié à la ressource `https://emails.chapote.fr/mcp` (RFC 8707). |
| Inscription dynamique | Ouverte (exigée par Claude), mais `redirect_uri` limités aux hôtes `EMAILS_OAUTH_REDIRECT_HOSTS` (claude.ai, claude.com) : un tiers ne peut pas se faire envoyer un code. 50 clients actifs au plus. |
| Consentement | Écran explicite (client, hôte de retour, boîtes et droits) ; POST avec en-tête `X-Chapote-App: emails` (anti-CSRF en plus de SameSite=Lax), page non intégrable (`frame-ancestors 'none'`). |
| Mots de passe des boîtes | Fernet avec une clé **dédiée** `MAILBOX_ENCRYPTION_KEY` (≠ `ENCRYPTION_KEY`, vérifié au démarrage), jamais renvoyés par l'API (`has_password` seulement), jamais journalisés. |
| Droits par boîte | `allow_send` (sinon brouillons seulement), `allow_delete` (corbeille, **faux par défaut**, jamais de suppression définitive ; `move` vers la corbeille soumis au même droit). |
| Audit | `mcp_audit_log` : date, client, outil, boîte, statut (`ok` / `error` / `denied`), code d'erreur, durée, nombre d'éléments. **Jamais de contenu** (requête, objet, corps, destinataire). Étapes OAuth journalisées aussi (`oauth.consent`, `oauth.token`, `oauth.revoke`, `oauth.*_replay`, `admin.revoke_*`). |
| Refus SMTP | Code et réponse du serveur journalisés (`emails smtp : refus …`), adresses masquées (`***`) ; le code est repris dans le message renvoyé à Claude. |
| Erreurs | Messages rédigés côté serveur (`MailError`) : ni réponse brute du serveur mail, ni secret, ni trace ; erreur inattendue = message générique, type seul dans le journal applicatif. |
| Limites | Redis (partagé entre workers) : inscription 10/h/IP, autorisation et jeton 30/min/IP, MCP 300/min par connexion, requêtes sans jeton 60/min/IP. Tailles : 50 résultats, 100 UID par action, corps 20 000 car. (100 000 max), pièce jointe en base64 ≤ 2 Mo (texte extrait sinon, PDF compris), message lu ≤ 20 Mo. |

## Variables

| Variable | Rôle |
|---|---|
| `EMAILS_ENABLED` | `false` par défaut : toutes les routes du module répondent 404. |
| `EMAILS_URL` | `https://emails.chapote.fr` : émetteur OAuth, ressource MCP (`{EMAILS_URL}/mcp`), origine WebAuthn supplémentaire. https obligatoire en prod. |
| `EMAILS_PORT` | Port loopback du conteneur `emails` (3004). |
| `EMAILS_PROXY_KEY` | Clé partagée nginx ↔ API (`openssl rand -hex 32`). |
| `MAILBOX_ENCRYPTION_KEY` | Clé Fernet dédiée, **obligatoire en prod** si le module est actif. `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`. La changer rend les mots de passe enregistrés illisibles (les ressaisir). |
| `EMAILS_OAUTH_REDIRECT_HOSTS` | `claude.ai,claude.com` (hôtes de retour OAuth autorisés). |
| `EMAILS_IMAP_TIMEOUT` | Délai réseau IMAP/SMTP en secondes (20). |

## Mise en service

1. `.env` : `EMAILS_ENABLED=true`, `EMAILS_URL=https://emails.chapote.fr`, `EMAILS_PROXY_KEY`,
   `MAILBOX_ENCRYPTION_KEY` (voir ci-dessus).
2. DNS : `emails.chapote.fr` → le VPS. Reverse proxy de l'hôte : même schéma que cm.chapote.fr, TLS sur le
   port **443** (les appels MCP arrivent du cloud d'Anthropic), tout vers `127.0.0.1:3004`. Ne pas mettre en
   mémoire tampon ni couper trop tôt `/mcp`, et transmettre les en-têtes tels quels. Exemple nginx :

   ```nginx
   server {
       listen 443 ssl;  http2 on;
       server_name emails.chapote.fr;
       # ssl_certificate … (certbot)
       location / {
           proxy_pass http://127.0.0.1:3004;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto https;
           proxy_buffering off;
           proxy_read_timeout 600s;
       }
   }
   ```
3. Google Cloud (client OAuth du SSO, `GOOGLE_CLIENT_ID`) : ajouter l'origine JavaScript
   `https://emails.chapote.fr`.
4. `./deploy.sh` (build de l'image `emails`, migration `c4e6a8b0d2f4`, `up -d`).
5. Se connecter sur `https://emails.chapote.fr` avec le compte superadmin (2FA déjà activée sur chapote.fr,
   Profil → Sécurité) et ajouter les boîtes.

### Passkeys sur le sous-domaine

Le RP ID WebAuthn est `chapote.fr` (dérivé d'`APP_URL`, ou `WEBAUTHN_RP_ID=chapote.fr`). Une passkey
enregistrée sur chapote.fr est liée à ce RP ID ; WebAuthn autorise son usage depuis tout sous-domaine dont
`chapote.fr` est un suffixe enregistrable, donc depuis `emails.chapote.fr`. Côté serveur, l'origine signée par
le navigateur doit être attendue : quand `EMAILS_ENABLED=true`, `settings.webauthn_origins` vaut
`[APP_URL, EMAILS_URL]` et les vérifications (connexion et enregistrement) acceptent les deux. Conséquences :

- l'écran de 2nd facteur d'emails.chapote.fr propose « Utiliser ma passkey » (même cérémonie que chapote.fr,
  routes `/api/auth/2fa/login/webauthn/*` relayées par le nginx d'emails) ;
- ne **pas** poser `WEBAUTHN_RP_ID=emails.chapote.fr` : les passkeys existantes ne seraient plus reconnues ;
- l'enrôlement des passkeys reste sur chapote.fr (Profil → Sécurité) ; emails.chapote.fr ne fait que les utiliser.

## Ajouter les boîtes

Interface → **Boîtes mail** → « Ajouter une boîte ». Identifiant pour Claude (`slug`, ex. `contact`, `perso`) :
c'est le paramètre `account` des outils. « Tester la connexion » essaie IMAP puis SMTP et affiche les dossiers
Envoyés / Brouillons / Corbeille détectés.

| Préréglage | IMAP | SMTP | Copie dans Envoyés |
|---|---|---|---|
| `ovh-email-pro` (contact@chapote.fr) | `pro2.mail.ovh.net:993` SSL | `pro2.mail.ovh.net:587` STARTTLS | oui (APPEND) |
| `gmail` | `imap.gmail.com:993` SSL | `smtp.gmail.com:465` SSL | non (Gmail la fait lui-même) |

**Gmail — mot de passe d'application** (un par compte) :
1. Le compte doit avoir la **validation en 2 étapes** activée.
2. <https://myaccount.google.com/apppasswords> → nom « Chapote Emails » → copier les 16 lettres (les espaces
   sont retirés automatiquement).
3. Gmail → Paramètres → Transfert et POP/IMAP : IMAP activé (c'est le cas par défaut sur les comptes récents).
4. Dans l'interface : préréglage Gmail, adresse, mot de passe d'application. Identifiant de connexion = adresse.

Droits : « Claude peut envoyer » (sinon `send_message` est refusé et Claude doit passer par `create_draft`),
« Claude peut mettre à la corbeille » (désactivé par défaut). Les dossiers OVH (« Éléments envoyés »,
« Brouillons », « Éléments supprimés ») sont reconnus par leur nom quand le serveur n'annonce pas SPECIAL-USE.

## Ajouter le connecteur dans Claude

1. claude.ai → **Customize → Connectors → Add custom connector**.
2. Nom : « Chapote Emails » ; URL : `https://emails.chapote.fr/mcp`. Laisser les champs OAuth avancés vides
   (Claude s'inscrit tout seul par inscription dynamique).
3. « Connect » : Claude ouvre `https://emails.chapote.fr/oauth/authorize` → connexion (Google ou e-mail) +
   2nd facteur → écran de consentement → « Autoriser ». Retour automatique dans Claude.
4. Activer le connecteur dans une conversation. Claude commence par `list_accounts`.

## Outils MCP

| Outil | Rôle | Droit |
|---|---|---|
| `list_accounts` | Boîtes actives, adresse, fournisseur, droits | — |
| `list_folders(account)` | Dossiers et rôle (inbox, sent, drafts, trash, junk, all, archive) | — |
| `search_messages(account, query?, from?, to?, subject?, since?, before?, unseen?, folder="INBOX", limit=20)` | Recherche dans un dossier (Gmail : `query` en syntaxe Gmail via X-GM-RAW) | — |
| `search_all(query, since?, limit)` | Recherche dans toutes les boîtes en parallèle (« Tous les messages » sur Gmail) ; une boîte en panne figure dans `errors` | — |
| `get_message(account, uid, folder, max_chars)` | En-têtes, corps texte (HTML converti), pièces jointes ; ne marque pas comme lu | — |
| `get_thread(account, uid, folder)` | Conversation (fil Gmail, ou References / In-Reply-To + Envoyés) | — |
| `get_attachment(account, uid, index, folder)` | Texte extrait (texte, CSV, JSON, HTML, PDF), sinon base64 ≤ 2 Mo | — |
| `create_draft(account, to, subject, body, cc?, bcc?, html?, reply_to_uid?, reply_folder?)` | APPEND dans Brouillons, en-têtes de réponse (In-Reply-To, References, « Re: ») | — |
| `send_message(…mêmes paramètres)` | Envoi SMTP + copie dans Envoyés. Refus partiel : succès avec `refused` (adresse + code) et `warning` (ne pas renvoyer aux autres) ; refus total : erreur avec le code SMTP | `allow_send` |
| `mark(account, uids, read?, flagged?, folder)` | Lu / non lu, suivi | — |
| `move(account, uids, destination, folder)` | Déplacement (corbeille seulement avec `allow_delete`) | — |
| `trash(account, uids, folder)` | Corbeille (jamais de suppression définitive) | `allow_delete` |

Un message est identifié par `(account, folder, uid)`, valeurs renvoyées par les recherches.

## Révocation

- **Une connexion** : interface → Accès Claude → « Connexions actives » → Révoquer (coupe aussitôt jeton
  d'accès et de rafraîchissement ; Claude devra refaire « Connect »).
- **Un client** (ex. ancien connecteur) : « Clients OAuth inscrits » → Révoquer (client et toutes ses connexions ;
  une nouvelle inscription sera nécessaire).
- **Tout** : « Tout révoquer » (toutes les connexions), ou en urgence `EMAILS_ENABLED=false` + redémarrage de
  l'api (module en 404, jetons inutilisables).
- **Une boîte** : la désactiver (« Boîte active ») ou la supprimer ; côté fournisseur, révoquer le mot de passe
  d'application Gmail (myaccount.google.com/apppasswords) ou changer le mot de passe Email Pro.
- **Côté Claude** : Customize → Connectors → déconnecter / supprimer le connecteur (n'invalide pas les jetons
  côté serveur : révoquer aussi ici).
- **Clé compromise** : nouvelle `MAILBOX_ENCRYPTION_KEY`, redémarrage, ressaisie des mots de passe, et
  rotation des mots de passe chez les fournisseurs.
- Retrait automatique : un compte qui perd le rôle superadmin (ou sa 2FA en prod) perd l'accès MCP au prochain appel.

## Dev

`cd emails && npm install && npm run dev` (port 3004, proxy `/api`, `/oauth`, `/mcp`, `/.well-known/oauth-*`
vers `localhost:8001`), API avec `EMAILS_ENABLED=true` et `EMAILS_URL=http://localhost:3004` ; ou le service
compose `emails` (`docker compose up -d --build`). En dev, la 2FA n'est pas exigée (comme `/api/admin/*`) et
`http://localhost` est accepté comme `redirect_uri`. Tests : `cd api && python -m pytest tests/test_emails_mcp.py`.
