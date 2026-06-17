# Rapport d'audit « Simplification » — ChatBot SaaS (Chapote)

## 1. Verdict global

Le code est **sain et bien dimensionné**. Les refactos récents NE sont PAS sur-abstraits — c'est le point le plus important de cet audit, car c'était la lentille de premier plan.

- **Landing éclatée en `components/landing/*`** : composition de vraies sections, avec `data.tsx`/`assets.ts` qui centralisent le contenu statique. Pas de fragmentation gratuite.
- **`widget-preview/*`, `stats-panel/*`, `bot-tabs/*`** : présentationnels au bon niveau ; `PreviewStyle` évite explicitement la repropagation d'une quinzaine de props ; les cards stats sont autonomes avec un `types.ts` partagé.
- **`useBotEditor`, `useApiResource`, `BotSelector`, `LeadsSection`, `ErrorRetry`** : factorisent du vrai boilerplate réutilisé par ≥2 pages/sites.
- **Backend `core/anthropic`, `ai_actions`, `stats_service`/`org_service`, `bots_helpers`/`widget_helpers`** : centralisations réelles. Les helpers backend extraits cassent même des cycles d'import documentés.

Aucune indirection à défaire, aucun fichier « trop petit pour exister », aucune prop qui ne fait que passer sans justification. Deux pistes de « simplification » ont d'ailleurs été **rejetées en vérification** car elles auraient SUR-abstrait (un `_resolve_membership` commun dans `security.py` dont les contrats de retour divergent) ou cassé du comportement (`scope="team"` par défaut de `BotOut`, support réel de `model_validate`).

Le résiduel est donc **mince et localisé** : micro-duplication (mêmes enveloppes JSON, mêmes blocs de champs, `errMsg` recodé inline), quelques verbosités (double-close, double appel horloge, gardes mortes) et un seul vrai chantier de lisibilité (extraction du bloc MOCK_AI). **Aucun problème d'efficiency notable** hors une double requête `Membership`.

**Δ LOC total réaliste estimé : environ −180 lignes** (dont ~−40 sur le seul chantier de fusion des `_build_tools`).

---

## 2. Quick wins (risque faible, behavior-preserving)

Triés par impact puis par gain.

| Emplacement | Lentille | Actuel → Proposé | Δ LOC | Impact |
|---|---|---|---|---|
| `ai_service.py:255-289` (`_build_*_tools`) | SIMPLIFY | Deux coroutines structurellement identiques (mêmes gardes KB/MCP, import lazy dupliqué) → une seule `_build_tools(bot, has_kb, conversation_id, fmt)`, `fmt` appliqué à chaque entrée y compris MCP | −20 | medium |
| `ai_service.py:138-203` (bloc MOCK_AI) | ALTITUDE | ~65 lignes de simulation inline noient le dispatch réel → extraire `_mock_reply(...)`, `generate_reply` devient `if settings.MOCK_AI: return await _mock_reply(...)` puis dispatch | 0 | medium |
| `ActionsTab.tsx:145-150, 232-237, 312-317` | REUSE | Handler password write-only par-index recodé 3× → exposer `setActionSecretAt(i,v)`/`setMcpTokenAt(i,v)` depuis `useBotEditor` | −10 | medium |
| `ai_actions.py:76-100,146-164` | REUSE | 4 fonctions encodent les mêmes enveloppes Anthropic/OpenAI → 2 helpers `_anthropic_tool`/`_openai_tool`, `build_tools_*` en list-comp | −10 | low |
| `bots.py:78-93` (`list_my_bots`) | EFFICIENCY | DEUX requêtes `Membership` pour le même user → une seule, dériver `my_org_ids` + `by_org` du résultat | −4 | low |
| `landing/{Piliers,Temoignages,Comparatif,Install,Pricing}` | REUSE | Style titre de section inline identique ×5 → `export const sectionH2` dans `data.tsx` | −4 | low |
| `BotPage`/`useBotEditor`/`StatsPanel` (6 sites) + `Analytics/Login/Register/Profile/BotWizard` (11 sites) | REUSE | `err instanceof Error ? err.message : 'X'` recodé inline → `errMsg(err,'X')` (déjà dispo dans `utils/errors`) | 0 / 0 | low |
| `database.py:21-26` (`get_db`) | SIMPLIFY | `async with` + try/finally `session.close()` redondant (double-close no-op) → garder le seul `async with` | −3 | low |
| `Analytics.tsx:8,77,147` | SIMPLIFY | `useMemo` `selectedBot` + garde toujours-vraie dans la branche `detail` → rendu direct, retirer l'import `useMemo` | −3 | low |
| `auth.ts:28-36,51` | ALTITUDE | `interface Organization` + alias mort `type Org` → renommer en `Org`, MAJ `organizations: Org[]`, supprimer l'alias | −3 | low |
| `useApiResource.ts:22,37-40` | SIMPLIFY | Param `deps` jamais passé par les 6 call sites → le supprimer, `[path, tick]`, retirer l'`eslint-disable` | −4 | low |
| `IntegrationTab.tsx:46-50` | ALTITUDE | clipboard + flag + timeout inlinés dans le JSX → handler nommé `copySnippet()` dans BotPage, passé en prop | −2 | low |
| `ui.tsx:150 (+ styles.css:291)` | SIMPLIFY | Branche `h5` du `Meter` + règle `.meter.h5` mortes (aucun call site `height=5`) → ternaire réduit à `h6`, retirer le CSS | −2 | low |
| `security.py:39-45` (`_encode`) | SIMPLIFY | `datetime.now(utc)` appelé 2× (exp/iat décalés) → un seul `now`, `exp = now + delta`, `iat = now` | 0 | low |
| `action_executor.py:127-129,205-207` | REUSE | Closure `_trunc` identique dans `_capture_lead` et `_create_ticket` → un `_trunc(args,key,maxlen)` module-level | −6 | low |
| `widget.js:539,1064-1066` | REUSE | Calcul taille d'icône bulle recopié build/toggle → `bubbleIconSize(d)` | −6 | low |
| `widget.js:413-415` | SIMPLIFY | `.kc-ai-tag` et `.kc-human-tag` byte-identiques → sélecteur groupé `.kc-ai-tag,.kc-human-tag{…}` | −1 | low |
| `widget.js:676` (`setTyping`) | SIMPLIFY | `const t` masque le helper global `t()` → renommer en `typing` | 0 | low |
| `bots.py:347-351` (`import_config`) | REUSE | Boucle de permission par champ recodée → `_enforce_field_perms(user, membership, bot, {f:config[f] …})` | −5 | low |
| `bots.py:216-231` (`_validate_trees`) | SIMPLIFY | Deux blocs try/`validate_tree`/422 quasi identiques → helper interne `_vt(value)` | −6 | low |
| `bots.py:352-356` (`import_config`) | REUSE | Validation `tree_json` réinlinée → réutiliser `_vt` (⚠ pas de garde None interne, voir §5) | −3 | low |
| `TreeFlow.tsx:278-289` | SIMPLIFY | `typeOptions`/`subTypeOptions` quasi identiques (libellé 1re option) → `typeOpts(qLabel)` paramétré | −8 | low |
| `AppearanceTab.tsx:81-100` | SIMPLIFY | Blocs `time_on_page`/`scroll_depth` identiques (3 littéraux près) → `numTriggerField(label,min,max,range)` | −9 | low |
| `BotList.tsx:76` | REUSE | Initiales recalculées → `orgInitials(bot.name)` (strict équivalent ici) | −1 | low |
| `BotWizard.tsx:241-242,535,545` | SIMPLIFY | `PRIMARY_SWATCHES`/`SECONDARY_SWATCHES` byte-identiques → un seul `SWATCHES` | −1 | low |
| `AbTestCard.tsx:32-33,55` | SIMPLIFY | `tot=up+down` recalculé + double-garde `Meter` morte → `tot=satisfaction.total`, `<Meter pct={pct}/>` | −1 | low |
| `ChapoteWidget.tsx:31` | SIMPLIFY | `(p+1)%3` magic number → `% WIDGET_PHASES.length` | 0 | low |
| `Login/Register/BotWizard` (icône chapeau) | REUSE | Tracé SVG du chapeau redéfini en 3 composants locaux → un `HatIcon` partagé `{size?,color?}` (défaut `currentColor`) | −14 | low |
| `security.py:74` | REUSE | Seuil `600` codé en dur (refresh widget) → constante nommée `WIDGET_REFRESH_THRESHOLD_SECONDS` | +1 | low |
| `SatisfactionCard.tsx:8` & `AbTestCard.tsx:33` | REUSE | Conversion satisfaction→% écrite 2× (équivalentes) → helper `satPct(s)` dans `stats-panel/types.ts` | −1 | low |

---

## 3. Simplifications plus profondes (chantiers)

| Emplacement | Lentille | Actuel → Proposé | Δ LOC | Risque | Impact |
|---|---|---|---|---|---|
| `WidgetPreview.tsx:269-278,317-326` | SIMPLIFY | Branchement lead / appointment-https / défaut dupliqué entre `pick` (delay 700) et `backToTree` (delay 450) → `enterNode(node, delay)`, `pick` délègue (handoff reste à part), `backToTree` appelle `enterNode(root,450)` | −14 | medium | medium |
| `ActionsTab.tsx:141-156,227-243` | SIMPLIFY | `<Field>` secret HMAC et clé Cal.com partagent input password + bloc `renameWarn` mot-pour-mot → sous-composant `ActionSecretField({label,hint,placeholder,i,…})` (recouvre F1 sur l'onChange) | −12 | low | low |
| `widget_helpers.py:70-78 vs 145-150` | SIMPLIFY | Même garde `is_active`+org 404 dans `_get_active_bot` et `_session_active_bot` → `_assert_bot_servable(db, bot)` appelé après résolution (`_check_session_origin` reste après) | −7 | low | medium |
| `widget_helpers.py:294-302 (+ bots_helpers.py:309-317)` | REUSE | Bornes par type de trigger + constantes `_TRIGGER_TYPES`/`_MAX_TRIGGERS` dupliquées dans les 2 modules → prédicat pur `_trigger_value_valid(ttype,value)` + constantes dans un **nouveau** module util commun (sens d'import sans cycle) ; raise vs silent restent chez l'appelant | −10 | medium | low |
| `insights_service.py:54-85` (`_validate_report`) | SIMPLIFY | 7 gardes levant le même `InsightsError(_INVALID_MSG)` → helper `_require(cond)` puis une ligne par contrainte (lisibilité seule) | −6 | low | low |
| `ai_service.py:52-56,70-74` (`MANAGED_KEYS`) | SIMPLIFY | `lambda: settings.X` + `getter()` → mapping nom→nom d'attribut + `getattr(settings, attr, None)` au call-time (⚠ garder lecture paresseuse, voir §5) | −2 | medium | low |

---

## 4. Synthèse par lentille

**REUSE** — Motif dominant et le plus rentable. Deux familles : (1) des **enveloppes/encodages répétés** (tool-schemas Anthropic/OpenAI ×4, bornes de triggers dans 2 modules backend, tracé SVG du chapeau ×3, initiales/palettes) ; (2) un **helper existant ignoré** au profit d'un recode inline — surtout `errMsg(err, fb)` réinventé ~17 fois alors qu'il est déjà importé ailleurs, et `orgInitials`/`pathnameOf` qui ont des jumeaux locaux. Gain souvent en cohérence plus qu'en LOC, mais réel et sans risque.

**SIMPLIFY** — Verbosité résiduelle classique : **blocs de champs/options quasi identiques** factorisables par un seul paramètre (`typeOptions`/`subTypeOptions`, déclencheurs numériques, `_validate_trees`, blocs de garde 404 widget), **état dérivé/gardes mortes** (`useMemo` Analytics toujours-vrai, double-garde `Meter`, branche `h5`, double requête déguisée), et **micro-redondances** (double-close session, double appel horloge, `tot` recalculé). Le plus profond est la fusion des deux `_build_*_tools`.

**EFFICIENCY** — **Quasi rien à signaler**, ce qui confirme la bonne santé. Un seul vrai point : `list_my_bots` exécute deux requêtes `Membership` pour le même user là où une seule suffit (un aller-retour DB par `GET /api/bots`). Pas de N+1, pas de re-render notable, pas de recalcul coûteux détecté.

**ALTITUDE** — Le verdict clé : **pas de sur-abstraction** dans les refactos récents (vérifié frontalement). Le seul résiduel est de la **sous-abstraction ponctuelle** : le bloc MOCK_AI (~65 lignes inline qui méritent un nom `_mock_reply`) et le handler clipboard inliné dans le JSX d'`IntegrationTab`. À l'inverse, deux dédoublonnages côté `security.py` (`_resolve_membership`) ont été écartés car ils auraient ajouté de l'indirection sans gain.

---

## 5. À NE PAS toucher (intentionnel / risqué)

- **Stripe dormant** (parking-lot) : ne pas « nettoyer » le code de facturation en sommeil.
- **`stats.py` accès simplifié**, **modèle tree/insights fixe**, **`key=index` sur secrets indexés**, **double validation tree**, **double CORS** : intentionnels et documentés.
- **`scope="team"` par défaut de `BotOut`** : NON cosmétique — `BotOut.model_validate(bot)` en dépend (le modèle `Bot` n'a pas de colonne `scope`). Le retirer casse la validation.
- **`_resolve_membership` commun dans `security.py`** : NE PAS factoriser `require_org_access`/`require_org_admin` — contrats de retour divergents (superadmin renvoie la membership côté access mais `None` côté admin) ; un helper commun complique.
- **`MANAGED_KEYS` (`ai_service.py`)** : si on retire la lambda, **garder impérativement la lecture au call-time** (`getattr(settings, attr, None)`), sinon le monkeypatch des tests casse. Ne PAS proposer la variante `if/elif` (augmente le LOC).
- **`_vt` partagé dans `bots.py`** : ne DOIT PAS contenir de garde `None` interne — `import_config` valide `tree_json` même quand `null` (lève 422), contrairement à `_validate_trees`. La garde `is not None` reste chez chaque appelant.
- **Triggers raise vs silent** (`_check_triggers` 422 vs `_sanitize_triggers` continue) : divergence voulue ; factoriser uniquement le **prédicat**, pas le traitement.
- **`hostnameOf`** déplacé vers `utils/time.ts` : garder sa signature `(url: string)` — ne PAS la fusionner avec `pathnameOf` qui accepte `null|undefined`.
- **Bordures `.infobox.*`** (`styles.css:296-303) et **espace de séparation i18n** (`tag_ai`/`tag_advisor`) : écartés — substitution à régression visuelle pour l'un, no-op pour l'autre.
- **`Team.tsx:161-162`** (initiales) : NE PAS déduire vers `orgInitials` — sa logique diffère (pas de `.filter(Boolean)`, repli email).
- **Header widget `34:19`** (`widget.js:486`) et **`Hero h1`/`CtaFinal`** (titres divergents) : littéraux distincts légitimes, restent inline.