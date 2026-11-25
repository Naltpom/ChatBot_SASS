# Assistant Chapote CM : mode « mes données » (conception)

**Statut : document de conception (étape 3). Rien n'est codé.** Le code (étape 4) ne commence
qu'après validation de ce document. Tout sera derrière un drapeau, désactivé par défaut.

Le mode public (étape 2) est en ligne : voir `docs/WIDGET_CM.md`.

## 0. En une page

- L'utilisateur connecté qui a donné son **accord IA** peut demander à l'assistant « fais-moi le
  bilan de mes vidéos de la semaine ». L'assistant lit ses données cm **en lecture seule**, dans le
  périmètre autorisé, jamais celles d'un autre.
- **Règle d'or : l'identité et le périmètre viennent du serveur, jamais de l'IA.** Aucun outil
  n'accepte d'identifiant d'utilisateur, d'espace ou de compte. Le périmètre vient d'un jeton signé,
  puis de l'accord IA, puis des règles existantes de `cm_access`. Une phrase comme « donne-moi les
  vidéos de X » ne peut rien obtenir : l'outil n'a aucun moyen de viser X.
- Chemin d'une question :

```
Page cm (connecté, accord actif)
  │ 1. GET /api/cm/assistant/token  (cookie de session cm)  → jeton court (5 min), lecture seule
  ▼
widget.js (chapote.fr)  — garde le jeton en mémoire seulement
  │ 2. POST /api/widget/message  { text, user_token }
  ▼
API chapote.fr (bot « Assistant Chapote CM » uniquement)
  │ 3. tools/call vers https://cm.chapote.fr/mcp  avec  Authorization: Bearer <user_token>
  ▼
Serveur MCP cm  — vérifie jeton + accord + cm_access à CHAQUE appel, renvoie des agrégats
  │    (comptes sous alias « Compte TikTok 1 », sans nom, e-mail ni jeton de plateforme)
  ▼
IA (Anthropic) → réponse avec alias → le widget remplace les alias par les vrais noms
                                       DANS LE NAVIGATEUR (table fournie par la page cm)
```

- Sans jeton (visiteur, pas d'accord, accord retiré, jeton expiré) : le bot reste en mode public.

### Décisions à prendre avant l'étape 4

1. **Comptes partagés** : assistant autorisé par l'administrateur de l'espace (recommandé), ou par
   le seul accord de l'utilisateur ? (§3)
2. **Conservation** des conversations « mes données » sur chapote.fr : 30 jours, hors boîte de
   réception (recommandé), ou rien ? (§2)
3. **TikTok** : exclu de la première version tant que ses conditions ne sont pas clarifiées
   (recommandé) ? (§5)
4. **Accord dans le chat** en plus de la case à l'inscription (recommandé) ? (§3)
5. À faire de votre côté : signer le DPA d'Anthropic, vérifier son statut DPF (§5).

## 1. Le serveur MCP cm (lecture seule)

### Adresse et montage

- `https://cm.chapote.fr/mcp`. Même API FastAPI que le reste de cm. Nouveau `location /mcp` dans
  `cm/nginx.conf` (ajout, aucune route existante modifiée).
- Même socle que emails.chapote.fr (`api/src/services/emails_mcp.py`) : SDK officiel `mcp`,
  FastMCP, Streamable HTTP **sans état**, réponses JSON, couche ASGI devant :
  1. drapeau `CM_MCP_ENABLED` éteint → 404 ;
  2. jeton Bearer obligatoire (§2), sinon 401 ;
  3. limites de débit (§4) ;
  4. passage au gestionnaire du SDK.
- Différence avec emails.chapote.fr : **pas d'OAuth 2.1 complet**. Le seul client est l'API
  chapote.fr, pour le compte d'un utilisateur déjà connecté à cm. Le jeton court signé suffit et
  évite toute page de connexion supplémentaire.

### Outils (tous en lecture, `readOnlyHint`)

Aucun paramètre ne désigne un utilisateur, un espace ou un compte par identifiant. Le filtre
« compte » se fait par **alias** (« Compte TikTok 1 »), résolu côté serveur dans le périmètre
autorisé ; un alias inconnu renvoie « aucun compte de ce nom dans votre périmètre ».

| Outil | Paramètres | Renvoie | Type de données |
|---|---|---|---|
| `stats_summary` | `period` : `7d` · `30d` · `90d` · `365d` ; `account?` (alias) ; `group?` (alias de groupe) | totaux et par compte : publications, vues, j'aime, partages, enregistrements, taux d'engagement, abonnés et évolution | statistiques |
| `schedule` | `when` : `upcoming` · `published` · `failed` ; `days` (1 à 31) ; `account?` ; `group?` | nombre par jour et par réseau ; pour chaque publication : jour, heure, réseau, alias du compte, statut, motif d'échec en clair | planning et statuts |
| `top_videos` | `period` ; `metric` : `views` · `engagement` · `shares` ; `limit` (1 à 10) ; `account?` | classement : date, réseau, alias du compte, chiffres ; **titre seulement si « titres et légendes » est autorisé** | statistiques (+ titres) |
| `my_accounts` | aucun | comptes et groupes autorisés, sous leurs alias : réseau, nombre de vidéos suivies, date du dernier relevé | comptes (alias) |

Pas d'outil d'écriture (programmer, supprimer, modifier) dans cette version.

### Comment chaque outil décide de ce qu'il renvoie

Dans cet ordre, à chaque appel, sans cache :

1. **Jeton** valide (§2) → `user_id` (jamais lu ailleurs).
2. **Accord IA** actif pour ce `user_id`, à la version courante de la politique IA (§3). Sinon :
   erreur « accord IA absent », rien d'autre.
3. **Périmètre cm** : `cm_access.resolve_scope(db, user, "all")`, exactement comme les routes
   `/api/cm/stats`, `/api/cm/posts`, `/api/cm/videos` : un lecteur limité à des groupes ne voit
   que leurs comptes.
4. **Filtre accord** : on retire les comptes et groupes décochés, puis les espaces partagés dont
   l'administrateur n'a pas autorisé l'assistant (§3, « Comptes partagés »).
5. **Filtre type de données** : sans « statistiques », `stats_summary` et `top_videos` répondent
   « type de données non autorisé » ; sans « planning », `schedule` aussi ; sans « titres et
   légendes », aucun titre ni légende n'est renvoyé (le champ est absent, pas vide).
6. **Pseudonymisation** (§4) puis **bornage** de la réponse.

Les requêtes SQL réutilisent celles des routes existantes (agrégats `func.sum`, `_latest_stats_bulk`).
Elles seront sorties de `routers/cm.py` vers un service partagé, pour qu'une règle d'accès ne
puisse pas diverger entre l'app et l'assistant.

## 2. Le lien avec l'assistant chapote.fr

### Le jeton court (« jeton assistant »)

Délivré par une nouvelle route cm : `GET /api/cm/assistant/token`.
- Authentification : cookie de session cm (comme toutes les routes `/api/cm/*`).
- Refus (204, sans jeton) si le drapeau est éteint ou si l'accord IA n'est pas actif.
- JWT signé HS256 avec une **clé dédiée** `CM_ASSISTANT_TOKEN_KEY` (pas `JWT_SECRET_KEY` : un
  jeton assistant ne doit jamais pouvoir passer pour un jeton de session, et inversement).

| Champ | Valeur | Rôle |
|---|---|---|
| `scope` | `cm_assistant:read` | lecture seule, refusé partout ailleurs |
| `sub` | id de l'utilisateur | le serveur MCP le lit ; l'IA ne le voit jamais |
| `aud` | `https://cm.chapote.fr/mcp` | utilisable seulement par le serveur MCP cm |
| `bot` | clé publique du bot assistant | refusé pour tout autre bot |
| `origin` | `cm.chapote.fr` | domaine de la page qui l'a demandé |
| `crev` | numéro de version de l'accord | retrait ou changement d'accord = jeton périmé |
| `iat` / `exp` | 5 minutes | durée courte |
| `jti` | aléatoire | journal d'audit, sans réutilisation hors délai |

### Widget (`widget/widget.js`)

Ajouts facultatifs, sans effet pour les autres sites :
- `window.ChapoteWidget[clé].setUserTokenProvider(fn)` : la page fournit une fonction qui renvoie
  un jeton frais (ou `null`). Le composant `ChapoteAssistant` de cm l'appelle avec
  `GET /api/cm/assistant/token`.
- Avant chaque message, le widget appelle cette fonction et joint `user_token` au corps de
  `POST /api/widget/message`. **Le jeton reste en mémoire** : jamais dans `localStorage`, jamais
  dans l'adresse, jamais dans les journaux du navigateur.
- `window.ChapoteWidget[clé].setAliases({ "Compte TikTok 1": "@clea", … })` : la page cm fournit
  la table alias → vrai nom (lue avec la session cm). Le widget remplace les alias **à
  l'affichage seulement**. La conversation enregistrée sur chapote.fr ne contient que des alias.
- Sans fournisseur de jeton, rien ne change (mode public).

### Session du widget (JWT `scope=widget`, `core/security.py`)

- Nouveau champ facultatif `uh` : empreinte (HMAC-SHA256, clé serveur) du `sub` du premier jeton
  assistant reçu dans la conversation.
- Un jeton assistant d'un autre utilisateur dans la même conversation (changement de compte sur
  le même navigateur) est refusé : le widget repart sur une nouvelle conversation.
- Conversations « mes données » marquées `data_mode = true` (nouvelle colonne) : voir « Ce que
  chapote.fr garde ».

### Client MCP (`api/src/services/mcp_client.py`)

- Nouveau mode d'authentification par serveur : `auth: "user_token"` (au lieu du jeton fixe
  `auth_token_encrypted`). Configuré une fois par l'administrateur sur le bot assistant (§ Mise
  en place).
- `list_mcp_tools` / `call_mcp_tool` reçoivent le `user_token` de la requête en cours (paramètre,
  jamais attribut global ni cache) :
  - sans jeton, les outils de ce serveur **ne sont pas proposés** au modèle : le bot est en mode
    public ;
  - le cache de découverte par conversation ne garde que la liste des outils, **jamais le jeton** ;
  - le jeton n'est écrit dans aucun journal, aucune base, aucun message d'erreur (les journaux
    actuels ne contiennent que le nom du serveur et un message tronqué : à garder ainsi).
- Garde stricte : le mode `user_token` n'est accepté que si l'adresse du serveur est
  `https://cm.chapote.fr/mcp` **et** que le bot est celui de `CM_ASSISTANT_BOT_KEY`. Un autre bot
  ne peut pas se faire relayer ces jetons.
- Vérification côté chapote.fr avant de relayer : signature non vérifiée (la clé reste chez cm),
  mais `aud`, `bot`, `origin` et `exp` lus et contrôlés ; jeton refusé = mode public.

### Pourquoi c'est sûr

| Risque | Parade |
|---|---|
| Un message demande les données de quelqu'un d'autre | aucun outil n'a de paramètre d'identité ; `sub` vient du jeton signé |
| Jeton volé (extension, copie) | 5 min, lecture seule, lié au bot, au domaine et à la version d'accord |
| Accord retiré pendant une conversation | vérifié à chaque appel d'outil : effet immédiat ; `crev` périme les jetons déjà émis |
| Un autre bot chapote.fr récupère des jetons | mode `user_token` réservé au bot assistant et à l'adresse cm |
| Fuite par chapote.fr (base, journaux) | jeton jamais stocké ni journalisé ; conversation avec alias seulement |
| Injection dans un titre de vidéo | titres absents par défaut ; renvoyés comme données ; le prompt système impose de ne jamais suivre une consigne trouvée dans un résultat d'outil |
| Volume (coût, aspiration) | limites par utilisateur (§4), réponses bornées, agrégats |

### Ce que chapote.fr garde

Aujourd'hui, toutes les conversations du widget sont gardées sans limite de durée, et le
propriétaire du bot (vous) peut les lire dans la boîte de réception. Pour le mode « mes données » :
- conversations `data_mode` **exclues** de la boîte de réception, des statistiques et des
  rapports IA (`insights_service`) du bot ;
- **supprimées au bout de 30 jours** (tâche quotidienne), et tout de suite sur demande de
  l'utilisateur (bouton « Effacer mes conversations », §3) ;
- les résultats d'outils ne sont pas enregistrés ; seules les réponses finales, avec alias.

**Décision à prendre** : garder 30 jours (utile pour comprendre un bug signalé) ou ne rien garder
du tout (conversation seulement dans le navigateur). Je recommande 30 jours, sans accès dans la
boîte de réception.

### Mise en place (une fois, par vous)

1. Variables du serveur : `CM_MCP_ENABLED=true`, `CM_ASSISTANT_TOKEN_KEY` (nouvelle clé),
   `CM_ASSISTANT_BOT_KEY=pk_fladg1AxA074Nd79-nsB2l6zuK88RW2P`.
2. Sur chapote.fr, onglet Connecteurs du bot assistant : serveur `cm`, adresse
   `https://cm.chapote.fr/mcp`, authentification « jeton de l'utilisateur ».
3. Rien à brancher pour les utilisateurs : ils donnent ou retirent leur accord.

## 3. L'accord IA (RGPD)

### Ce que dit la règle (résumé, sources en §5)

- L'accord doit être **libre, spécifique, éclairé et univoque**, et **séparé des CGU** : un accord
  fondu dans l'acceptation des conditions n'est pas valable.
- **Pas de case pré-cochée.** Refuser ne doit rien retirer d'autre.
- **Retirer est aussi simple que donner**, à tout moment, effet immédiat.
- **Granularité** : un accord par finalité distincte.
- **Âge** : en France, 15 ans pour consentir seul ; en dessous, accord conjoint du titulaire de
  l'autorité parentale.

À noter sur l'existant : sur le site, l'inscription dit « En créant un compte, vous acceptez les
conditions… », **sans case à cocher**. L'app mobile enregistre la version des conditions acceptées
(`cm_user_identities`). L'accord IA, lui, sera toujours une case séparée et facultative.

### Inscription (site et app mobile)

- « J'accepte les conditions d'utilisation » : obligatoire, comme aujourd'hui.
- « Activer l'assistant IA sur mes données » : **case séparée, facultative, non cochée**, avec
  une phrase et un lien : « L'assistant peut lire vos statistiques et votre planning pour répondre
  à vos questions. Ces données sont traitées par Anthropic, notre fournisseur d'IA. [Politique IA] »
  (YouTube exige que l'utilisateur approuve expressément le destinataire).
- Refuser ne change rien d'autre dans l'app.
- Moins de 15 ans (date de naissance déjà demandée dans l'app mobile) : case masquée, accord
  impossible.

### Alternative : l'accord dans le chat (recommandée en complément)

La première fois qu'un utilisateur connecté pose une question sur ses données, l'assistant répond :
« Pour lire vos données, j'ai besoin de votre accord. » La réponse contient un bouton qui ouvre, **dans
la page cm**, la même fenêtre que la page « Assistant IA » : texte complet, interrupteurs, lien
vers la politique.
- L'accord est enregistré par cm, de la même façon, jamais par chapote.fr ni par l'IA.
- Avantage : on demande au bon moment, quand la personne en voit l'intérêt.
- Je recommande les deux : la case à l'inscription et la demande dans le chat.

### Profil : nouvelle page « Assistant IA »

- **Interrupteur général** « Assistant IA sur mes données ».
- **Par compte connecté** (TikTok, YouTube, Instagram) et **par groupe** : tous cochés quand
  l'accord général est donné, décochables un à un.
- **Par type de données** :
  - statistiques : activé par défaut ;
  - planning et statuts : activé par défaut ;
  - titres et légendes des vidéos : **désactivé par défaut**, car ils peuvent contenir des noms de
    personnes.
- **Comptes partagés** (vous êtes éditeur ou lecteur dans l'espace de quelqu'un d'autre) : ces
  comptes appartiennent à l'administrateur de l'espace. Ils ne sont proposés que si cet
  administrateur a activé « Autoriser l'assistant IA pour cet espace » (réglage de l'espace,
  désactivé par défaut). **Décision à prendre** : je recommande cette règle ; sans elle, l'accord
  d'un lecteur suffirait à envoyer à l'IA les chiffres d'un compte qui n'est pas le sien.
- Lien vers la **Politique IA**.
- Bouton **« Effacer mes conversations avec l'assistant »** : supprime sur chapote.fr les
  conversations `data_mode` de cet utilisateur (appel serveur à serveur signé, par empreinte `uh`).
- Retirer l'accord : un geste, effet immédiat (jetons périmés par `crev`, vérification à chaque appel).

### Enregistrement

- `cm_ai_consents` : `user_id`, `enabled`, `policy_version`, `rev` (incrémenté à chaque
  changement), `stats`, `planning`, `captions`, `excluded_accounts` (liste `"tiktok:12"`),
  `excluded_groups`, `updated_at`.
- `cm_ai_consent_events` (historique, jamais modifié) : `user_id`, `at`, `source`
  (`inscription` · `profil` · `chat` · `mobile`), `policy_version`, `change` (avant / après), sans
  adresse IP.
- `cm_space_ai_settings` : `organization_id`, `allow_assistant`, `changed_by`, `changed_at`.
- Nouvelle version de la politique IA : l'accord passe « à revoir ». L'assistant redemande l'accord
  et n'utilise pas les données avant.

### Brouillon de la page « Politique IA »

> **Assistant IA de Chapote CM**
>
> **Ce qu'il fait.** Si vous l'activez, l'assistant lit certaines de vos données Chapote CM pour
> répondre à vos questions, par exemple « fais-moi le bilan de mes vidéos de la semaine ». Il ne
> fait que lire : il ne publie, ne modifie et ne supprime rien.
>
> **Quelles données.** Seulement ce que vous autorisez, sur les comptes que vous autorisez :
> - vos statistiques : vues, j'aime, partages, enregistrements, abonnés ;
> - votre planning : publications à venir, publiées, en échec ;
> - les titres et légendes de vos vidéos, seulement si vous cochez cette case.
>
> Vos comptes sont remplacés par des noms comme « Compte TikTok 1 » avant d'être envoyés à l'IA :
> elle ne voit pas vos pseudos. Ne sont **jamais** envoyés : votre nom, votre e-mail, votre
> téléphone, votre date de naissance, vos identifiants de connexion aux réseaux, les commentaires.
>
> **Chez qui.** Les questions et ces données passent par chapote.fr (même éditeur, serveurs OVH en
> France), puis sont traitées par **Anthropic Ireland Limited**, fournisseur du modèle d'IA Claude,
> qui agit pour notre compte, sur des serveurs aux États-Unis. Ce transfert est encadré par les
> clauses contractuelles types de la Commission européenne. Anthropic n'utilise pas ces données pour
> entraîner ses modèles et les supprime sous 30 jours (sauf contenu signalé comme contraire à ses
> règles d'usage, gardé jusqu'à 2 ans).
>
> **Combien de temps.** Les conversations « mes données » sont gardées 30 jours, puis supprimées.
> Si vous déconnectez un compte YouTube, elles sont supprimées sous 7 jours.
> Vous pouvez les effacer à tout moment : Profil → Assistant IA → « Effacer mes conversations ».
>
> **Pourquoi c'est permis.** Uniquement avec votre accord, que vous pouvez retirer à tout moment,
> aussi simplement que vous l'avez donné : Profil → Assistant IA. Refuser ou retirer votre accord
> ne change rien d'autre dans Chapote CM.
>
> **Âge.** Il faut avoir au moins 15 ans pour activer l'assistant.
>
> **Vos droits.** Accès, rectification, effacement, opposition, portabilité, réclamation auprès de
> la CNIL : voir la politique de confidentialité.

## 4. La sécurité

- **Limites de débit par utilisateur** (Redis, partagées entre workers, fail-closed comme le
  quota) : 30 appels d'outil par 10 minutes, 300 par jour. En plus : quota du bot (3000 réponses
  par mois) et plafond journalier du widget, déjà en place.
- **Journal d'audit** de chaque appel, table `cm_assistant_audit` (modèle de `McpAuditLog`) :
  `user_id`, outil, date, durée, statut (`ok` · `denied` · `error`), code d'erreur, nombre
  d'éléments, catégories de données renvoyées (`stats`, `planning`, `captions`, `accounts`),
  empreinte du `jti`. **Jamais de contenu** (ni chiffres, ni titres, ni question).
- **Pseudonymisation des comptes** : alias stables par utilisateur, numérotés par réseau dans
  l'ordre de création des comptes (« Compte TikTok 1 », « Compte YouTube 2 ») ; groupes :
  « Groupe 1 »… La table alias → vrai nom n'est jamais envoyée à chapote.fr : elle est donnée à la
  page cm, qui la passe au widget pour l'affichage.
- **Réponses bornées** : agrégats plutôt que listes ; 10 éléments au plus par liste ; texte limité
  à 2 000 caractères (borne déjà présente dans `mcp_client`) ; dates arrondies au jour ou à l'heure.
- **Champs jamais lus par les outils** : nom, prénom, e-mail, téléphone, date de naissance, jetons
  et identifiants de plateforme (`open_id`, `channel_id`, identifiant Instagram…), pseudo, image,
  commentaires, liens des publications (ils contiennent le pseudo). Liste blanche de colonnes par
  outil : un nouveau champ en base n'est jamais renvoyé par accident.

## 5. Cadre légal et plateformes

Résumé d'une recherche faite le 25 novembre 2026 sur les textes officiels. **Ce n'est pas un avis
juridique.** Les points marqués « à vérifier » n'ont pas pu être confirmés.

### RGPD et CNIL

- **Accord séparé des CGU : obligatoire.** Une demande de consentement doit être « clairement
  distinguée » des autres questions (art. 7(2) RGPD), et un contrat ne peut pas être conditionné à
  un consentement inutile au service (art. 7(4)). La CNIL exige un consentement libre, spécifique,
  éclairé et univoque ; un accord groupé n'est pas univoque.
  Sources : [RGPD](https://eur-lex.europa.eu/eli/reg/2016/679/oj),
  [CNIL, le consentement](https://www.cnil.fr/fr/les-bases-legales/consentement).
- **Granularité** : une finalité = un accord ; d'où l'interrupteur général et la case séparée
  « titres et légendes » (même page CNIL).
- **Retrait** aussi simple que l'accord (art. 7(3)) ; garder la **preuve** : date, version du texte
  (d'où `cm_ai_consent_events`).
- **Âge** : 15 ans en France ; en dessous, accord conjoint avec un parent (art. 8 RGPD, art. 45 loi
  Informatique et Libertés,
  [CNIL, recommandation 4](https://www.cnil.fr/fr/recommandation-4-rechercher-le-consentement-dun-parent-pour-les-mineurs-de-moins-de-15-ans)).
  Choix proposé : réservé aux 15 ans et plus.
- **Base légale** : le « contrat » (art. 6.1.b) serait défendable pour une fonction activée
  volontairement ([CEPD, lignes directrices 2/2019](https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-22019-processing-personal-data-under-article-61b_en)),
  mais Google et Meta parlent de consentement pour ce type de partage : **le consentement est la
  base retenue**.
- **Transfert vers Anthropic (États-Unis)** :
  - contrat avec **Anthropic Ireland, Limited** pour un client européen
    ([Commercial Terms](https://www.anthropic.com/legal/commercial-terms)) ; traitement aux États-Unis ;
  - Anthropic agit en **sous-traitant** ; son avenant de traitement inclut les **clauses
    contractuelles types** de la Commission
    ([DPA Anthropic](https://www.anthropic.com/legal/data-processing-addendum)) ;
  - certification **Data Privacy Framework** d'Anthropic : **à vérifier** sur
    [dataprivacyframework.gov/list](https://www.dataprivacyframework.gov/list) (sources secondaires
    contradictoires) ; les clauses types suffisent comme mécanisme de transfert ;
  - **pas d'entraînement** sur les données clients (Commercial Terms, section B) ;
  - conservation par Anthropic : **30 jours**, jusqu'à 2 ans pour un contenu signalé comme contraire
    à sa politique d'usage
    ([Anthropic, durée de conservation](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)) ;
  - à faire : **signer l'avenant de traitement** (DPA) d'Anthropic pour le compte API utilisé.
- **AIPD** (analyse d'impact) : traitement absent de la
  [liste CNIL](https://www.cnil.fr/sites/default/files/atoms/files/liste-traitements-aipd-requise.pdf) ;
  au plus 1 ou 2 des 9 critères ([CNIL](https://www.cnil.fr/fr/ce-quil-faut-savoir-sur-lanalyse-dimpact-relative-la-protection-des-donnees-aipd)).
  Probablement pas obligatoire ; **documenter cette analyse** en une page.
- **Registre** : ajouter une fiche « Assistant IA » (art. 30).

### YouTube (API Services)

Source : [YouTube API Services, Developer Policies](https://developers.google.com/youtube/terms/developer-policies)
et [conditions](https://developers.google.com/youtube/terms/api-services-terms-of-service).
- Les données d'un utilisateur ne sont accessibles qu'à lui et aux « agents expressly approved by
  that user » (III.E.3.b) : **le texte de l'accord nomme Anthropic**.
- Pas d'usage non annoncé à l'utilisateur (III.D.2.3) : la politique IA le décrit.
- Suppression sous **7 jours** après un retrait d'accès dans l'app ou une demande (III.D.2.3.a,
  III.E.4.g), sous 30 jours après un retrait depuis Google (III.D.2.3.b) : les conversations
  « mes données » d'un utilisateur qui déconnecte YouTube sont **supprimées sous 7 jours** (tâche
  quotidienne), en plus de la limite de 30 jours.
- Politique de confidentialité : lien vers les règles de confidentialité de Google, révocation par
  la page de sécurité Google, description du partage avec un prestataire (III.A.2).
- [Règlement sur les données utilisateur](https://developers.google.com/terms/api-services-user-data-policy) :
  transfert à un tiers permis pour une fonction visible, avec l'accord de l'utilisateur.
- Aucune clause interdisant l'envoi à une IA trouvée pour l'API YouTube.
- **Verdict** : conforme si accord explicite nommant Anthropic, et sans entraînement de modèles.

### TikTok

Sources : [Developer Terms](https://www.tiktok.com/legal/tik-tok-developer-terms-of-service),
[Data Sharing Agreement](https://www.tiktok.com/legal/tiktok-data-sharing-agreement),
[Developer Guidelines](https://developers.tiktok.com/docs/en/our-guidelines-developer-guidelines).
- Vous êtes responsable de traitement indépendant ; traitement limité à l'usage des services TikTok
  (Data Sharing Agreement §3.1(b)) : un résumé IA dans l'app est une **zone grise**.
- Pas de tiers autorisé sans accord écrit de TikTok (Developer Terms III.3(b)) ; divulgation
  complète aux utilisateurs (III.2(c)) ; aucun partage sans consentement (guidelines).
- Aujourd'hui, les statistiques TikTok ne sont pas encore relevées (permission en attente).
- **Recommandation** : **ne pas inclure TikTok** dans le mode « mes données » tant que ce point
  n'est pas clarifié avec TikTok (le déclarer lors d'un prochain échange, sans toucher à l'audit
  en cours). Les outils excluent les comptes TikTok par un réglage serveur
  (`CM_MCP_PLATFORMS=youtube,instagram`).

### Meta (Instagram)

Source : [Meta Platform Terms](https://developers.facebook.com/terms/) (mise à jour du 3 février 2026),
[Developer Policies](https://developers.facebook.com/devpolicy/).
- Partage permis avec un prestataire (3.c.ii.2) sous **accord écrit** : traitement uniquement pour
  vous, jamais pour ses propres fins (5.a.i) ; ou sur **consentement exprès** de l'utilisateur, avec
  preuve (3.c.ii.3).
- **Point de friction à faire valider** : Anthropic garde des données pour faire respecter sa
  politique d'usage. Cumuler les deux voies (prestataire avec DPA + consentement exprès) réduit le
  risque.
- Suppression rapide à la demande ou quand plus nécessaire (3.d) : couverte par les 30 jours et
  « Effacer mes conversations ».
- Aucune clause IA trouvée.

### À ajouter dans la politique de confidentialité de cm (brouillon, pas en ligne)

1. Nouvelle finalité : assistant IA facultatif sur ses propres données.
2. Base légale : consentement, retirable à tout moment, aussi simplement (Profil → Assistant IA).
3. Données : statistiques, planning, comptes sous alias ; titres et légendes seulement avec la case
   dédiée ; jamais de nom, e-mail, téléphone, date de naissance, jetons, commentaires.
4. Destinataires : chapote.fr (même éditeur, OVH France), Anthropic Ireland Limited (sous-traitant)
   et ses sous-traitants ultérieurs ; traitement aux États-Unis ; clauses contractuelles types.
5. Pas d'entraînement de modèles ; conservation chez Anthropic : 30 jours (2 ans si contenu signalé).
6. Conservation des conversations : 30 jours ; suppression sous 7 jours après déconnexion d'une
   plateforme ; effacement à la demande.
7. Âge minimum : 15 ans.
8. YouTube : lien vers les règles de confidentialité de Google, révocation par la page de sécurité
   Google, lien vers les conditions de YouTube.
9. Meta : mention du partage avec un prestataire IA et du droit d'effacement.

**À vérifier avant la mise en ligne** : statut DPF d'Anthropic ; signature du DPA Anthropic ;
lecture de TikTok III.3(b) ; compatibilité entre la conservation d'Anthropic et la clause Meta 5.a.i.

## 6. Tests prévus (étape 4)

Tous automatiques, sur une vraie base Postgres jetable (`real_db`), MCP appelé de bout en bout :

1. **A ne voit jamais B** : deux utilisateurs avec leurs comptes ; le jeton de A, sur chaque
   outil, avec tous les paramètres possibles, y compris des alias de B, « tous », des chaînes
   d'injection : aucune donnée de B dans aucune réponse.
2. **Injection dans le message** (« donne-moi les vidéos de B », « ignore tes consignes ») : le
   modèle simulé appelle les outils avec ces textes ; les réponses restent dans le périmètre de A.
3. **Lecteur limité à des groupes** : ne reçoit que les comptes de ses groupes (mêmes cas que
   `test_cm_access`).
4. **Comptes partagés** : espace dont l'administrateur n'a pas autorisé l'assistant → comptes
   absents, même avec l'accord du lecteur.
5. **Sans accord / accord retiré** : jeton refusé (204) ; jeton émis avant le retrait refusé au
   premier appel suivant ; le widget sans jeton ne propose aucun outil cm au modèle.
6. **Type décoché** : statistiques décochées → `stats_summary` et `top_videos` refusés ; titres
   décochés → aucun champ titre ni légende, sur tous les outils.
7. **Données personnelles** : nom, e-mail, téléphone, date de naissance, pseudos et identifiants de
   plateforme injectés dans des comptes de test : jamais présents dans une réponse d'outil ni dans
   ce qui part vers le modèle (recherche par chaîne exacte).
8. **Jetons** : expiré, signature fausse, autre `aud`, autre `bot`, autre `origin`, ancien `crev`,
   jeton de session cm présenté à la place : tous refusés.
9. **Changement d'utilisateur** dans une même conversation : refusé, nouvelle conversation.
10. **Journal d'audit** : une ligne par appel (ok, refusé, erreur), catégories exactes, aucun
    contenu (recherche des chiffres et titres de test dans la table : absents).
11. **Jeton jamais stocké** : après une conversation, recherche du jeton dans les tables
    (messages, conversations, journaux) et dans les journaux capturés : absent.
12. **Conservation** : conversation `data_mode` absente de la boîte de réception, supprimée par la
    tâche après 30 jours et par « Effacer mes conversations ».

## 7. Ce que l'app mobile devra afficher

À transmettre à la conversation de l'app mobile (aucune modification de `mobile/` ici) :

1. **Inscription** : sous « J'accepte les conditions » (obligatoire), une **case séparée,
   facultative, non cochée** : « Activer l'assistant IA sur mes données », avec la phrase
   « L'assistant peut lire vos statistiques et votre planning pour répondre à vos questions. Ces
   données sont traitées par Anthropic, notre fournisseur d'IA » et un lien « Politique IA ». Masquée si la personne a moins de 15 ans. Envoyer le choix à l'API
   (`PUT /api/cm/assistant/consent`, source `mobile`).
2. **Réglages → « Assistant IA »** : mêmes éléments que la page du site :
   - interrupteur général ;
   - comptes et groupes (alias jamais montrés : l'app affiche les vrais noms) ;
   - trois types de données (statistiques, planning activés ; titres et légendes désactivé) ;
   - lien vers la politique IA ;
   - bouton « Effacer mes conversations avec l'assistant ».
   Retrait en un geste, effet immédiat.
3. **Écran Assistant** (WebView de `docs/WIDGET_CM.md`) : obtenir un jeton par
   `GET /api/cm/assistant/token` juste avant chaque message (jamais stocké), le passer à la page
   de l'assistant ; fournir la table des alias pour l'affichage.
4. **Réglage de l'espace** (administrateurs) : « Autoriser l'assistant IA pour cet espace ».
