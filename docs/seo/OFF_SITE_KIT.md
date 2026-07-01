# Kit off-site SEO/GEO — Chapote

Objectif : (1) être **#1 sur Google** pour la requête de marque « chapote » ; (2) **apparaître dans les LLM** (ChatGPT, Perplexity, Gemini, Google AI Overviews) quand on parle de « chapote ».

> **Le diagnostic honnête.** Le code (cette PR) pose les fondations extractibles. Mais ~80 % du résultat se joue **hors du repo** : indexation, entité (Wikidata), profils, avis, citations. Aucune de ces actions ne peut être faite à ta place — elles demandent tes comptes / l'accès au domaine. Ce document te donne le **quoi**, le **où** et le **texte prêt à coller**.
>
> **Deux freins spécifiques à Chapote :**
> 1. **Non-indexé aujourd'hui** : chapote.fr est absent de Google/Bing/DuckDuckGo, même sur son titre exact. → Priorité absolue = indexation.
> 2. **Homonyme établi « Le Chapoté »** (marque de chapeaux, `lechapote.com`, société immatriculée, réseaux actifs). Google fusionne *chapote/chapoté*. → Il faut des signaux d'entité forts + une orthographe/contexte constants (« Chapote — le chatbot hybride français »).

---

## Étape 0 — Indexation (à faire EN PREMIER, ~30 min)

Sans ça, rien ne rank et aucun LLM ne peut citer le site.

1. **Google Search Console** — https://search.google.com/search-console
   - Ajouter la propriété `chapote.fr` (idéalement en **propriété de domaine**, vérif par enregistrement **TXT DNS**).
   - Sitemaps → soumettre `sitemap.xml`.
   - **Inspection de l'URL** → `https://chapote.fr/` → **Demander l'indexation**. Répéter pour `https://chapote.fr/a-propos` et `https://chapote.fr/showcase`.
   - ⚠️ Le message « Impossible de récupérer le sitemap / Inconnu » juste après soumission est **normal** sur une propriété neuve (le sitemap est bien servi — vérifié). Il se résout en quelques heures à ~2 jours. Ne pas re-soumettre en boucle.

2. **Bing Webmaster Tools** — https://www.bing.com/webmasters
   - Vérifier `chapote.fr`, soumettre `sitemap.xml`, activer **IndexNow**.
   - Pourquoi c'est stratégique : **≈ 87 % des citations de ChatGPT Search** correspondent à l'index **Bing**. Être dans Bing = condition mécanique pour être cité par ChatGPT.
   - Surveiller ensuite le tableau de bord « AI Performance » de Bing.

---

## Étape 1 — Entité machine : Wikidata (levier #1 pour les LLM)

Wikidata alimente le Knowledge Graph de Google **et** sert de source structurée aux LLM. Seuil de notoriété bien plus bas que Wikipedia.

- **Compte** : https://www.wikidata.org → créer un compte, faire **10-15 éditions utiles** d'abord (corrections mineures) pour gagner en crédibilité, puis créer l'item.
- ⚠️ **Créer un item DISTINCT** — l'item `Q29631279` « Chapote » existe déjà mais désigne un **lieu** (Wikipedia cebuano), sans rapport.

**Item à créer :**
- **Label (fr)** : `Chapote`
- **Description (fr)** : `logiciel de chatbot hybride français (SaaS)`
- **Description (en)** : `French hybrid chatbot software (SaaS)`
- **Alias** : `Chapote chatbot`, `Chapote Bot Manager`

**Déclarations (statements) :**
| Propriété | Valeur |
|---|---|
| `instance of` (P31) | `software as a service` (Q1254596) ou `chatbot` (Q1067347) |
| `official website` (P856) | `https://chapote.fr` |
| `country` (P17) | `France` (Q142) |
| `inception` (P571) | `[année de création — à compléter]` |
| `developer`/`publisher` (P178) | `[raison sociale — à compléter]` |
| `programmed in` / `platform` | `Web` |

Ajouter une propriété `sameAs`/`described at URL` vers chaque profil créé (étape 2) au fur et à mesure.

---

## Étape 2 — Profils officiels (occupent les positions 2-8 du SERP « chapote » + cibles `sameAs`)

Créer chaque profil avec **le même nom exact** « Chapote », le **même logo** (`https://chapote.fr/brand/logo-horizontal.svg`), la **même description**, le **même lien** `https://chapote.fr`.

⚠️ **Handles** : l'homonyme chapeaux occupe `@lechapote_fr`. Prends des handles **distincts et sans ambiguïté**, p. ex. `@chapote_fr`, `chapote.fr`, `chapotechat`, `getchapote`. Choisis-en un et garde-le identique partout.

**Bio courte (≤160 caractères), prête à coller :**
```
Chapote — le chatbot hybride français : arbre guidé + IA plafonnée + relais humain, en une balise. RGPD, hébergement FR. https://chapote.fr
```

**Description longue (LinkedIn / Crunchbase / annuaires), prête à coller :**
```
Chapote est un chatbot hybride français pour sites web. Il combine un arbre de décision guidé illimité, une IA plafonnée (aux coûts maîtrisés) et un relais vers un conseiller humain — installable en une seule balise à copier-coller ou via le plugin WordPress « Chapote Bot Manager ». Conçu RGPD par défaut, hébergé en France, avec une tarification modulaire (socle dès 9 €/mois, sans engagement). Chapote s'adresse aux e-commerces, sites de services, commerces locaux et éditeurs SaaS qui veulent un support automatisé efficace sans coûts qui s'emballent.
```

À créer, par ordre d'impact :
1. **LinkedIn** (page entreprise) — le plus autoritaire ; rank quasi systématiquement sur une requête de marque. Poster régulièrement (produit, cas d'usage, coulisses).
2. **Crunchbase** (profil organisation) — fortement ingéré par les LLM sur les startups/éditeurs.
3. **X / Twitter**, **Facebook**, **Instagram**, **YouTube** — occupent le SERP, cibles `sameAs`.
4. **GitHub** (organisation publique) — même si le produit reste privé, publie un repo utile : snippets d'intégration (balise, WordPress), exemples, docs. Ancre le nom « Chapote » côté développeurs.

---

## Étape 3 — Câbler `sameAs` dans le site (à faire quand les profils existent)

Dans `app/index.html`, nœud `Organization` du JSON-LD (`@id` `…#organization`), ajouter le tableau `sameAs` — **uniquement des URLs de profils qui existent réellement** :

```json
"sameAs": [
  "https://www.wikidata.org/wiki/QXXXXXX",
  "https://www.linkedin.com/company/chapote",
  "https://www.crunchbase.com/organization/chapote",
  "https://twitter.com/chapote_fr",
  "https://github.com/chapote"
]
```
C'est le signal on-site le plus direct pour que Google relie ces profils à l'entité « Chapote » et amorce un **Knowledge Panel**. (Me le donner → je l'ajoute et j'ouvre la PR.)

---

## Étape 4 — Preuve sociale (débloque les recommandations LLM sur requêtes logicielles)

**≈ 99-100 %** des outils cités par ChatGPT sur des requêtes logicielles ont une fiche **G2** ou **Capterra**. C'est la **présence** qui débloque la citation, pas la note moyenne.

- **G2** — https://www.g2.com/products/new — créer la fiche produit « Chapote » (catégorie *Live Chat / Chatbots*). Objectif : **≥ 10 avis**.
- **Capterra (FR)** — https://www.capterra.fr — réclamer/créer la fiche. Objectif : **≥ 5 avis**.
- **Trustpilot** — https://business.trustpilot.com — 5e domaine le plus cité par ChatGPT ; poser le widget d'avis.

**E-mail de demande d'avis (prêt à coller), à envoyer aux premiers clients / testeurs :**
```
Objet : 2 minutes pour aider Chapote ? 🙏

Bonjour [Prénom],

Merci d'utiliser Chapote ! Pour aider d'autres entreprises françaises à nous
découvrir, votre retour compte énormément. Auriez-vous 2 minutes pour laisser
un avis honnête sur votre expérience ?

👉 [lien G2 / Capterra / Trustpilot]

Quelques mots sur ce que Chapote vous apporte au quotidien suffisent. Un immense
merci pour votre soutien.

[Signature]
```

> ⚠️ **NAP cohérent** : Nom (Chapote), adresse (siège FR une fois les mentions légales complétées) et URL (`https://chapote.fr`) **strictement identiques** sur toutes les fiches. Les incohérences retardent le Knowledge Panel.

---

## Étape 5 — Annuaires & marketplaces (citations FR de confiance)

- **WordPress.org / Plugins** — https://wordpress.org/plugins/developers/add/ — publier « Chapote Bot Manager » au répertoire officiel (en plus de la distribution auto-hébergée). **Backlink d'autorité + citation LLM sur les intégrations WordPress + canal d'acquisition.** Aligné avec la cible principale. Aujourd'hui « nothing matched » sur wordpress.org/plugins pour « chapote ».
  - Prérequis : peaufiner `integrations/wordpress/chapote-bot-manager/readme.txt` (en-tête `Stable tag` / `Tested up to` / `Requires at least` / `Requires PHP`, description longue avec mots-clés « chatbot hybride français RGPD », tags, capture, lien `https://chapote.fr`).
- **appvizer** — https://www.appvizer.fr — annuaire SaaS FR de référence (catégorie *chat-chatbot*). Rank sur « <marque> avis ».
- **Crunchbase** (déjà en étape 2).
- **France Num** (https://www.francenum.gouv.fr) et **Bpifrance Création** — renforcent le positionnement « solution française RGPD / souveraine ».

---

## Étape 6 — Lancement Product Hunt (pic de citations tierces)

https://www.producthunt.com — backlink autoritaire + page produit durable + avis, fortement repris par les LLM et bien indexé.

- **Tagline (≤60 car.)** : `The French hybrid chatbot: guided tree + capped AI + human`
- **Description** :
```
Chapote is a French hybrid chatbot for websites. It blends an unlimited guided
decision tree, capped AI (predictable costs) and human handoff — installed with
a single copy-paste tag or the "Chapote Bot Manager" WordPress plugin.
GDPR-first, hosted in France, modular pricing from €9/mo.
```
- **1er commentaire (maker)** : expliquer le « pourquoi » (coûts d'IA imprévisibles + RGPD/hébergement FR), inviter aux retours.

---

## Étape 7 — Mentions « earned » & backlinks (autorité + diversité de sources)

- **Reddit** (= ≈ 46,7 % des citations Perplexity) : participer **honnêtement** (pas de spam) sur r/webdev, r/wordpress, r/entrepreneur_fr autour de « chatbot RGPD », « alternative française à Crisp/Intercom ».
- **Quora FR**, forums **WPFR**, **Indie Hackers**.
- **Digital PR** : pitcher des listicles « meilleur chatbot français / RGPD / WordPress » et des articles (Blog du Modérateur, Journal du Net, FrenchWeb, Maddyness). Chaque mention forte = un slot organique sur « chapote » **et** une source que les AI Overviews/ChatGPT/Perplexity paraphrasent.
- **Google Business Profile** (si adresse légale FR) : peut déclencher un Knowledge Panel de marque et sécuriser le SERP face à « Le Chapoté ».
- Surveiller les **mentions non liées** de « Chapote » et demander l'ajout du lien.

---

## Ce qui bloque encore côté toi (hors indexation)

- **Compléter les mentions légales** (`app/src/legal/MENTIONS_LEGALES.md` est un modèle `[À COMPLÉTER]` : raison sociale, SIREN, adresse, hébergeur). Nécessaire pour : (a) la **conformité** d'un site qui vend déjà, (b) débloquer l'ajout de l'**adresse/éditeur/date de création** dans le schema `Organization` et l'item Wikidata.
- **Incohérence d'e-mail** repérée : le pied de page utilise `hello@chapote.fr`, les mentions légales `contact@chapote.fr`. Choisir **une** adresse de contact et l'uniformiser partout (site, schema, fiches).

---

## Mesure (à partir de la semaine ~8)

- **AI Share-of-Voice** : tester 50-100 prompts (« meilleur chatbot RGPD français », « chatbot WordPress hybride », « alternative française à Intercom ») sur ChatGPT / Perplexity / Gemini / Claude, compter les citations de Chapote. Répéter chaque mois.
- **Brand SERP** : suivre « chapote », « chapote chatbot », « chapote avis ». Objectif : contrôler/influencer **≥ 6 des 10** résultats organiques + déclencher un Knowledge Panel.

**Attendu réaliste** : `chapote chatbot` / `chapote wordpress` = #1 quasi immédiat une fois indexé ; le littéral `chapote` = montée sur ~2-4 mois à mesure que l'entité (Wikidata + `sameAs` + avis + backlinks) se consolide face à « Le Chapoté ». Premières citations LLM en modes retrieval (ChatGPT Search / AI Overviews / Perplexity) une fois indexé + entité posée.
