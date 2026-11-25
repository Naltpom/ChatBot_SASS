from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    ENV: str = "dev"

    DATABASE_URL: str = "postgresql+asyncpg://chatbot:chatbot_secret@localhost:5433/chatbot_saas"

    # JWT : auth dashboard (24h) et sessions widget (30 min, scope restreint)
    JWT_SECRET_KEY: str = "change-me-minimum-32-caracteres-en-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440
    WIDGET_SESSION_EXPIRE_MINUTES: int = 30

    # Fernet : chiffre les secrets clients en base (BYOK, secret reCAPTCHA).
    # Vide en dev -> une cle ephemere est generee au demarrage (les secrets
    # stockes deviennent illisibles au restart, acceptable en dev uniquement).
    ENCRYPTION_KEY: str | None = None

    # Cles "managed" : utilisees quand le bot est en api_key_mode=managed
    ANTHROPIC_API_KEY: str | None = None
    OPENAI_API_KEY: str | None = None
    GEMINI_API_KEY: str | None = None

    # true = aucune API IA appelee, reponses simulees (dev / demo)
    MOCK_AI: bool = True

    # --- Outil de prospection commerciale (back-office superadmin) ---
    # API publique gratuite recherche-entreprises (base SIRENE) : aucune cle
    # requise. Sert a trouver des entreprises candidates par secteur/localisation.
    RECHERCHE_ENTREPRISES_URL: str = "https://recherche-entreprises.api.gouv.fr/search"
    PROSPECTING_ENABLED: bool = True
    # Plafonds du crawl d'enrichissement (par prospect) : nombre de pages clés
    # crawlees, redirections suivies par page, et taille lue par page.
    PROSPECT_CRAWL_MAX_PAGES: int = 6
    PROSPECT_CRAWL_MAX_REDIRECTS: int = 4
    PROSPECT_FETCH_MAX_BYTES: int = 300_000
    # Brave Search (decouverte web a la demande : trouver le vrai site d'une
    # entreprise). Cle gratuite ; vide => decouverte web off, repli SIRENE.
    BRAVE_SEARCH_API_KEY: str | None = None
    BRAVE_SEARCH_URL: str = "https://api.search.brave.com/res/v1/web/search"
    # Plafond du nombre de prospects decouverts/scores par appel /discover.
    PROSPECT_DISCOVER_MAX: int = 10
    # Retention RGPD des PII de prospects (cold email B2B) : au-dela, la purge
    # anonymise les donnees personnelles (email/nom/site/enrichissement scrape).
    # Les prospects opt_out=True sont purgeables des la prochaine purge.
    RGPD_PROSPECT_RETENTION_DAYS: int = 365

    # Turnstile par defaut (nos cles)
    TURNSTILE_SITE_KEY: str | None = None
    TURNSTILE_SECRET_KEY: str | None = None

    # --- Demo publique « 1 URL -> chatbot » (page /demo, SANS auth) ---
    # Genere un arbre de demo depuis UNE seule URL. Anti-abus en couches :
    #  - captcha Turnstile (cles TURNSTILE_* ci-dessus ; vides => verification
    #    ignoree, pratique en dev) ;
    #  - limite PAR IP / 24h (fenetre glissante, fail-open) ;
    #  - plafond GLOBAL / 24h (coupe-circuit de depense Gemini, fenetre glissante).
    # Cache DB url->arbre (TTL) : une URL deja vue ne rappelle PAS l'IA. Mettre
    # DEMO_ENABLED=false coupe la fonctionnalite (l'endpoint repond 404).
    DEMO_ENABLED: bool = True
    DEMO_IP_PER_DAY: int = 5          # generations REELLES / IP / 24h (cache hit non compte)
    DEMO_GLOBAL_PER_DAY: int = 300    # plafond global de generations IA / 24h (coupe-circuit cout)
    DEMO_CACHE_TTL_DAYS: int = 14     # au-dela, on regenere (les sites evoluent)
    # Chat IA de la demo (V2) : vraies reponses bornees au contenu scrape. Quotas
    # PAR MESSAGE (le captcha one-shot de la generation d'arbre fait office
    # d'ouverture de session -> pas de captcha par message).
    DEMO_CHAT_IP_PER_DAY: int = 30        # messages IA / IP / 24h
    DEMO_CHAT_GLOBAL_PER_DAY: int = 2000  # plafond global messages IA / 24h (coupe-circuit cout)

    # --- SSO Google (Sign in with Google, flux ID token) ---
    # Client ID OAuth (valeur PUBLIQUE, = audience attendue des tokens Google).
    # Vide => endpoint /api/auth/google désactivé (401) et bouton masqué côté
    # front. Aucun client secret requis pour le flux ID token.
    GOOGLE_CLIENT_ID: str | None = None

    # --- Auto-login admin en dev ---
    # Si actif (et ENV=dev uniquement), /api/auth/dev-login renvoie un token
    # superadmin sans credentials, et le frontend se connecte tout seul.
    AUTO_LOGIN_ADMIN_DEV: bool = False
    ADMIN_EMAIL: str = "admin@kertios.com"
    ADMIN_PASSWORD: str = "Admin123!"

    # --- Fetch d'URLs privées/localhost en DEV uniquement ---
    # ⚠ JAMAIS en production (laissé à False). Si actif, fetch_user_url emprunte
    # une voie de secours qui CONTOURNE l'anti-SSRF (autorise http + IP privées)
    # et réécrit localhost/127.0.0.1 -> host.docker.internal (le conteneur API ne
    # joint pas son propre localhost). Sert UNIQUEMENT à tester l'onboarding/démo
    # contre un WordPress local. Le chemin prod (safe_get_follow) reste intact.
    ALLOW_PRIVATE_FETCH: bool = False

    # --- Module TikTok « Chapote Publisher » (Espace client, /app/tiktok) ---
    # Clés de l'app TikTok (Login Kit + Content Posting API). Clé vide =>
    # module désactivé (503). Le secret ne quitte jamais l'API ; les jetons des
    # comptes connectés vivent chiffrés en base (tiktok_accounts).
    TIKTOK_CLIENT_KEY: str | None = None
    TIKTOK_CLIENT_SECRET: str | None = None
    TIKTOK_REDIRECT_URI: str = "https://chapote.fr/tiktok/callback"
    TIKTOK_API_BASE: str = "https://open.tiktokapis.com"
    # Taille max d'une vidéo envoyée à Chapote (Mo). Plafonnée par la limite
    # TikTok (4 Go) dans tiktok_service.
    TIKTOK_MAX_UPLOAD_MB: int = 1024
    # Fichiers vidéo temporaires (le temps de la publication). JAMAIS sous
    # UPLOAD_DIR, qui est servi publiquement (/uploads).
    TIKTOK_TMP_DIR: str = "/tmp/chapote_tiktok"
    # Jeton de service (Bearer) : la chaîne de production (claude-cloud) publie
    # sans cookie de session, AU NOM de l'utilisateur TIKTOK_SERVICE_USER_EMAIL
    # (mêmes règles de tenant que lui). Ne couvre que la publication (comptes,
    # creator-info, posts) : jamais la connexion ni la déconnexion d'un compte.
    # Vide (l'un ou l'autre) = Bearer refusé (503).
    TIKTOK_SERVICE_TOKEN: str | None = None
    TIKTOK_SERVICE_USER_EMAIL: str | None = None

    # --- Module YouTube « Chapote Publisher » (Shorts, Espace client /app/youtube) ---
    # Client OAuth Google (type « Application Web ») du projet Google Cloud où
    # l'API YouTube Data v3 est activée. Vide => module désactivé (503). Les
    # jetons des chaînes connectées vivent chiffrés en base (youtube_accounts).
    YOUTUBE_CLIENT_ID: str | None = None
    YOUTUBE_CLIENT_SECRET: str | None = None
    YOUTUBE_REDIRECT_URI: str = "https://chapote.fr/youtube/callback"
    YOUTUBE_API_BASE: str = "https://www.googleapis.com"
    YOUTUBE_OAUTH_BASE: str = "https://oauth2.googleapis.com"
    YOUTUBE_MAX_UPLOAD_MB: int = 1024
    # Fichiers vidéo temporaires. JAMAIS sous UPLOAD_DIR (servi publiquement).
    YOUTUBE_TMP_DIR: str = "/tmp/chapote_youtube"
    # Envois par espace et par 24 h. Google compte les envois à part (« Video
    # uploads per day » : 100 / jour pour tout le projet) ; le quota de 10 000
    # unités ne sert presque qu'aux lectures (constaté dans la console, 24/11/2026).
    YOUTUBE_DAILY_POSTS: int = 50
    # cm : publications créées par espace et par 24 h glissantes (garde-fou ; comptées en base).
    CM_DAILY_POSTS: int = 150
    # cm : un Google Drive connecté est obligatoire pour créer une publication (stockage des vidéos).
    CM_STORAGE_REQUIRED: bool = True
    # Âge minimum pour utiliser cm (majorité numérique en France : 15 ans, loi du 7 juillet 2023).
    CM_MIN_AGE: int = 15
    # Version des conditions (CGU, CGV, confidentialité) à accepter dans l'app mobile.
    CM_TERMS_VERSION: str = "2026-11"
    # Jeton de service (Bearer) de la chaîne de production (claude-cloud),
    # au nom de YOUTUBE_SERVICE_USER_EMAIL. Publication seulement (chaînes,
    # posts) : jamais la connexion ni la déconnexion d'une chaîne.
    YOUTUBE_SERVICE_TOKEN: str | None = None
    YOUTUBE_SERVICE_USER_EMAIL: str | None = None

    # --- Gestion des réseaux sociaux (cm.chapote.fr) ---
    # URL publique du site (retours OAuth TikTok/YouTube/Instagram, liens des vidéos
    # envoyées à Instagram). Même compte que chapote.fr : le cookie de session est
    # posé sur le domaine parent commun d'APP_URL et MUSIC_URL (chapote.fr).
    CM_URL: str = "http://localhost:3003"
    # Jeton Bearer de la routine Claude (claude-cloud), au nom de CM_SERVICE_USER_EMAIL :
    # publications, planning, publications Instagram « gérées par la routine », statistiques.
    CM_SERVICE_TOKEN: str | None = None
    CM_SERVICE_USER_EMAIL: str | None = None
    # Clé partagée nginx de cm <-> API : vraie IP du visiteur (X-Cm-Client-IP).
    CM_PROXY_KEY: str | None = None
    # Vidéos programmées : gardées jusqu'à leur publication. PRIVÉ (volume Docker),
    # servi seulement à Instagram par un lien signé et temporaire.
    CM_MEDIA_DIR: str = "/app/cm_media"
    CM_MEDIA_MAX_GB: int = 50
    CM_MAX_UPLOAD_MB: int = 1024
    # Relevé des statistiques de chaque compte (heures).
    CM_STATS_EVERY_HOURS: int = 1
    # Autorisations TikTok supplémentaires, à poser SEULEMENT une fois validées par
    # TikTok (sinon la connexion échoue) : « user.info.stats,video.list ».
    TIKTOK_EXTRA_SCOPES: str = ""
    # Retour OAuth DIRECT sur cm.chapote.fr (ex. https://cm.chapote.fr/tiktok/callback), à poser
    # seulement si l'URI est déclarée chez TikTok / Google. Vide = la connexion lancée depuis cm
    # revient par l'URI déjà déclarée (chapote.fr/…/callback), dont la page renvoie vers cm.
    # --- Assistant Chapote CM, mode « mes données » (docs/CM_MCP.md) ---
    # Désactivé par défaut. Il faut les trois : drapeau, clé de signature des jetons assistant
    # (dédiée, jamais JWT_SECRET_KEY) et clé publique du bot assistant sur chapote.fr.
    CM_MCP_ENABLED: bool = False
    CM_ASSISTANT_TOKEN_KEY: str | None = None
    CM_ASSISTANT_BOT_KEY: str | None = None
    # Version de la politique IA : la changer fait repasser les accords « à revoir ».
    CM_AI_POLICY_VERSION: str = "2026-11"
    # Plateformes dont les données peuvent partir vers l'IA (toutes par défaut).
    CM_MCP_PLATFORMS: str = "tiktok,youtube,instagram"
    # Conservation des conversations « mes données » sur chapote.fr (jours).
    CM_ASSISTANT_RETENTION_DAYS: int = 30
    TIKTOK_CM_REDIRECT_URI: str = ""
    YOUTUBE_CM_REDIRECT_URI: str = ""

    # --- Bibliothèque Google Drive de cm (robot = compte de service Google) ---
    # Clé JSON du compte de service, encodée en base64 (base64 -w0 cle.json). Vide = bibliothèque
    # désactivée. Le robot ne voit que les dossiers que les utilisateurs lui partagent.
    GDRIVE_SA_KEY_B64: str | None = None
    # Relecture des dossiers reliés (minutes).
    GDRIVE_SCAN_MINUTES: int = 5
    GDRIVE_API_BASE: str = "https://www.googleapis.com"
    GDRIVE_TOKEN_URL: str = "https://oauth2.googleapis.com/token"
    # Archivage des publications (cm_archive) quand le robot ne peut pas déposer de fichiers : connexion
    # Google de l'utilisateur, droit « drive.file » seulement, client OAuth d'un projet séparé de YouTube.
    GOOGLE_DRIVE_CLIENT_ID: str | None = None       # noms recommandés
    GOOGLE_DRIVE_CLIENT_SECRET: str | None = None
    GDRIVE_OAUTH_CLIENT_ID: str | None = None       # anciens noms, toujours lus
    GDRIVE_OAUTH_CLIENT_SECRET: str | None = None
    GDRIVE_OAUTH_REDIRECT_URI: str = ""            # défaut : {CM_URL}/drive/callback
    GDRIVE_ARCHIVE_ROOT_NAME: str = "cm.chapote.fr"

    # --- Instagram (API Instagram avec connexion Instagram, Meta) ---
    # Vides = connexion officielle désactivée (comptes « gérés par la routine » seulement).
    # Permissions demandées en plus (vides tant que Meta ne les a pas validées) :
    # instagram_business_manage_comments, instagram_business_manage_messages.
    INSTAGRAM_EXTRA_SCOPES: str = ""
    # Google : https://www.googleapis.com/auth/youtube.force-ssl (répondre / modérer les commentaires).
    YOUTUBE_EXTRA_SCOPES: str = ""
    # Lecture des commentaires YouTube (scope readonly déjà accordé) : activée après la vérification Google.
    YOUTUBE_COMMENTS_ENABLED: bool = False
    INSTAGRAM_CLIENT_ID: str | None = None
    INSTAGRAM_CLIENT_SECRET: str | None = None
    INSTAGRAM_REDIRECT_URI: str = "https://cm.chapote.fr/instagram/callback"
    INSTAGRAM_AUTHORIZE_URL: str = "https://www.instagram.com/oauth/authorize"
    INSTAGRAM_OAUTH_BASE: str = "https://api.instagram.com"
    INSTAGRAM_GRAPH_BASE: str = "https://graph.instagram.com"
    INSTAGRAM_API_VERSION: str = "v23.0"

    # --- Boîtes mail pour Claude (emails.chapote.fr) ---
    # Serveur MCP distant (connecteur personnalisé claude.ai) + interface d'administration,
    # réservés au superadmin (2FA obligatoire en prod). Désactivé par défaut : routes en 404.
    EMAILS_ENABLED: bool = False
    # URL publique : identifiant de la ressource MCP ({EMAILS_URL}/mcp), émetteur OAuth,
    # origine WebAuthn supplémentaire (passkeys de chapote.fr valables sur le sous-domaine).
    EMAILS_URL: str = "http://localhost:3004"
    # Clé partagée nginx d'emails <-> API : vraie IP du visiteur (X-Emails-Client-IP).
    EMAILS_PROXY_KEY: str | None = None
    # Clé Fernet DÉDIÉE aux mots de passe des boîtes (jamais ENCRYPTION_KEY) : une fuite de
    # l'une ne donne pas l'autre. Obligatoire en prod si EMAILS_ENABLED. Vide en dev = clé
    # éphémère (mots de passe illisibles au redémarrage).
    MAILBOX_ENCRYPTION_KEY: str | None = None
    # Hôtes autorisés pour les redirect_uri des clients OAuth (inscription dynamique) : seul
    # Claude par défaut. Un client inconnu ne peut donc pas se faire envoyer un code.
    EMAILS_OAUTH_REDIRECT_HOSTS: str = "claude.ai,claude.com"
    # Délais réseau IMAP / SMTP (secondes) : une boîte lente ne bloque pas l'appel MCP.
    EMAILS_IMAP_TIMEOUT: int = 20

    APP_URL: str = "http://localhost:3001"
    API_URL: str = "http://localhost:8001"

    # --- Boutique de partitions (music.chapote.fr) ---
    # URL publique du site (liens des e-mails, retour de Stripe Checkout).
    MUSIC_URL: str = "http://localhost:3002"
    # Jeton Bearer de l'envoi des partitions par la chaîne de production
    # (POST /api/music/ingest). Vide = envoi refusé (503).
    MUSIC_INGEST_TOKEN: str | None = None
    # Secret de signature du webhook Stripe DÉDIÉ à la boutique (endpoint
    # /api/music/stripe/webhook, distinct de celui de l'abonnement Chapote).
    STRIPE_MUSIC_WEBHOOK_SECRET: str | None = None
    # Fichiers des partitions (PDF complets, aperçus) : PRIVÉS, jamais sous
    # UPLOAD_DIR (servi publiquement). Volume Docker en production.
    MUSIC_DIR: str = "/app/music_files"
    # Durée de validité des liens de téléchargement après paiement (jours).
    MUSIC_DOWNLOAD_DAYS: int = 365
    # Adaptive Pricing de Stripe (prix payé dans la devise de l'acheteur, reçu en euros).
    MUSIC_ADAPTIVE_PRICING: bool = True
    # Abonnement (test A/B) : part des liens « SHEET » qui le proposent, et PDF téléchargeables pendant l'essai.
    MUSIC_SUB_AB_SHARE: float = 0.5
    MUSIC_TRIAL_DOWNLOADS: int = 3
    # Expéditeur et adresse de réponse des e-mails de la boutique (alias de contact@).
    MUSIC_EMAIL_FROM: str = "Ghost Hands Sheets <music@chapote.fr>"
    MUSIC_REPLY_TO: str = "music@chapote.fr"
    # Domaine du cookie de session, partagé par les sous-domaines (chapote.fr ->
    # chapote.fr, music.chapote.fr…). Vide = en production, domaine parent commun
    # d'APP_URL et MUSIC_URL ; en dev, cookie limité à l'hôte.
    AUTH_COOKIE_DOMAIN: str | None = None

    # Uploads (images avatar/lanceur) — volume Docker
    UPLOAD_DIR: str = "/app/uploads"
    MAX_UPLOAD_BYTES: int = 1_000_000  # 1 Mo

    # Redis : backend partage des rate-limiters (prerequis multi-worker).
    # Vide = limiteurs en memoire process -> 1 seul worker uvicorn obligatoire.
    REDIS_URL: str | None = None

    # --- Embeddings locaux (RAG base de connaissances) ---
    # Modele fastembed ONNX (CPU), multilingue, 384 dims = vector(384) en base.
    # NB : intfloat/multilingual-e5-small (choix initial) n'est PAS dans le
    # registre fastembed 0.8 -> fallback MiniLM multilingue 384 dims (verifie
    # via TextEmbedding.list_supported_models()). Changer de modele = changer
    # de dimension potentielle : verifier vector(384) ET re-ingerer les sources.
    # Cache hors de /app : zero interaction avec le watcher --reload.
    FASTEMBED_CACHE_PATH: str = "/var/cache/fastembed"
    EMBEDDINGS_MODEL: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"

    # --- SMTP (notification email des leads). SMTP_HOST absent => fallback
    # log, l'envoi n'est jamais bloquant. Noms prefixes SMTP_ (le piege
    # $USER/$PASSWORD sous Linux est ainsi evite).
    SMTP_HOST: str | None = None
    SMTP_PORT: int = 587
    SMTP_USER: str | None = None
    SMTP_PASSWORD: str | None = None
    SMTP_FROM: str | None = None

    # --- Stripe / facturation modulaire (spec §6.1) ---
    # billing_enabled() = bool(SECRET && WEBHOOK) : sortie du « tout-ou-rien
    # 5 vars ». Les price IDs vivent désormais dans la table `billing_products`
    # (catalogue seedé), plus en .env. Clés absentes => billing désactivé =>
    # resolver ALL_UNLOCKED (invariant D0 : app 100 % gratuite, 0 gating).
    STRIPE_SECRET_KEY: str | None = None
    STRIPE_WEBHOOK_SECRET: str | None = None
    # MOCK_BILLING (spec §2.3) : stripe_service n'émet AUCUN appel sortant
    # (URLs locales, entitlement appliqué directement) => e2e sans Stripe.
    # Interdit en production (validate_production) => défaut FALSE (sûr en prod :
    # un déploiement sans var MOCK_BILLING démarre normalement). Dev/CI/tests le
    # passent explicitement à True quand ils veulent mocker Stripe.
    MOCK_BILLING: bool = False
    # Axe IA métré (Stripe Billing Meters) : la feature est « mise en place » par
    # défaut (True). Reste INOFFENSIVE sans billing : metering_enabled() ANDe
    # billing_enabled(), donc clés Stripe absentes => métrage INERTE (overage
    # dormant, comportement strictement identique à aujourd'hui, invariant D0).
    BILLING_METERING_ENABLED: bool = True
    # Enforcement actif par défaut (env-overridable). SÛR : l'enforcement est un
    # no-op tant que le billing est OFF — billing_enabled()==False => resolve()
    # renvoie ALL_UNLOCKED => chaque gate() passe (invariant D0, app 100 %
    # gratuite). Default-ON ne mord donc QUE quand le billing est réellement
    # activé (clés Stripe présentes). Mettre BILLING_ENFORCE=false pour repasser
    # en mode observe (gating log-only, R1).
    BILLING_ENFORCE: bool = True

    # Garde-fous widget
    MAX_MESSAGE_CHARS: int = 4000
    MAX_HISTORY_MESSAGES: int = 20          # historique max envoye au modele
    RATE_SESSION_MESSAGES: int = 20         # messages par session...
    RATE_SESSION_WINDOW_SECONDS: int = 600  # ...par fenetre de 10 min
    RATE_IP_REQUESTS: int = 100             # anti-flood IP...
    RATE_IP_WINDOW_SECONDS: int = 60        # ...par minute
    # Aperçu owner (preview_token) : plafond de tours IA par conversation d'aperçu
    # (les appels modèle ne sont ni comptés ni facturés -> borne anti-abus).
    PREVIEW_MAX_AI_TURNS: int = 20

    # --- 2FA (TOTP authenticator + WebAuthn / passkeys) ---
    # Émetteur affiché dans l'app authenticator + RP name WebAuthn.
    TWOFA_ISSUER: str = "Chapote"
    # Obligatoire pour les superadmins (staff) : en PROD, un superadmin sans 2FA
    # configurée se voit refuser l'accès aux routes /api/admin/* (HTTP 403 avec
    # le code `twofa_setup_required`). Recommandée mais optionnelle pour les
    # autres utilisateurs. Désactivable via env si besoin.
    TWOFA_ENFORCE_ADMIN: bool = True
    # Relying Party WebAuthn. Par défaut dérivés de APP_URL (host = RP ID,
    # origin = APP_URL sans slash final). Surchargeable en prod multi-domaine.
    WEBAUTHN_RP_ID: str | None = None
    WEBAUTHN_RP_NAME: str = "Chapote"

    @property
    def webauthn_rp_id(self) -> str:
        if self.WEBAUTHN_RP_ID:
            return self.WEBAUTHN_RP_ID
        from urllib.parse import urlparse
        return urlparse(self.APP_URL).hostname or "localhost"

    @property
    def webauthn_origin(self) -> str:
        return self.APP_URL.rstrip("/")

    @property
    def webauthn_origins(self) -> list[str]:
        """Origines acceptées pour une cérémonie WebAuthn : chapote.fr, plus emails.chapote.fr
        si le module est actif. Le RP ID (chapote.fr) ne change pas : une passkey enregistrée
        sur chapote.fr vaut sur tous ses sous-domaines (règle WebAuthn du suffixe de domaine)."""
        origins = [self.webauthn_origin]
        if self.EMAILS_ENABLED and self.EMAILS_URL:
            origins.append(self.EMAILS_URL.rstrip("/"))
        return origins

    @property
    def emails_resource(self) -> str:
        """Identifiant canonique de la ressource MCP (RFC 8707 / RFC 9728)."""
        return f"{self.EMAILS_URL.rstrip('/')}/mcp"

    @property
    def cookie_domain(self) -> str | None:
        """Domaine du cookie de session. Explicite (AUTH_COOKIE_DOMAIN) ou, en
        production, suffixe commun des hôtes d'APP_URL et MUSIC_URL (au moins
        deux labels : « chapote.fr »). None = cookie limité à l'hôte (dev)."""
        if self.AUTH_COOKIE_DOMAIN:
            return self.AUTH_COOKIE_DOMAIN.lstrip(".")
        if not self.is_production:
            return None
        from urllib.parse import urlparse
        hosts = [(urlparse(u).hostname or "").split(".") for u in (self.APP_URL, self.MUSIC_URL)]
        common: list[str] = []
        for a, b in zip(reversed(hosts[0]), reversed(hosts[1])):
            if a != b or not a:
                break
            common.insert(0, a)
        return ".".join(common) if len(common) >= 2 else None

    @property
    def is_production(self) -> bool:
        return self.ENV.lower() not in ("dev", "development")

    @property
    def demo_active(self) -> bool:
        """La démo publique /demo est-elle réellement servie ?

        En PRODUCTION elle EXIGE une clé Turnstile : l'endpoint est public et
        dépense de l'IA, le captcha en est la vraie barrière anti-coût/anti-DoS.
        Sans TURNSTILE_SECRET_KEY en prod -> démo DÉSACTIVÉE (404) plutôt
        qu'exposée sans captcha (gate SOUPLE : ne coupe QUE la démo, jamais le
        reste de l'API). En dev, le captcha est optionnel (verify_turnstile_token
        laisse passer si la clé est absente)."""
        if not self.DEMO_ENABLED:
            return False
        if self.is_production and not self.TURNSTILE_SECRET_KEY:
            return False
        return True

    def validate_production(self) -> None:
        """Garde-fous : refuse de demarrer en prod avec des secrets par defaut
        (JWT forgeables) ou sans cle de chiffrement (secrets BYOK perdus)."""
        if not self.is_production:
            return
        if self.JWT_SECRET_KEY == "change-me-minimum-32-caracteres-en-production" or not self.ENCRYPTION_KEY:
            raise RuntimeError(
                "JWT_SECRET_KEY/ENCRYPTION_KEY doivent être définies en production "
                "(secret JWT par défaut ou clé de chiffrement absente)"
            )
        # Stripe / facturation modulaire (spec §6.1, corrige A3/F4). Sortie du
        # « tout-ou-rien 5 vars » : billing_enabled() = SECRET && WEBHOOK. On
        # garde des garde-fous ciblés contre les configs semi-actives.
        if self.STRIPE_SECRET_KEY and not self.STRIPE_WEBHOOK_SECRET:
            raise RuntimeError(
                "STRIPE_WEBHOOK_SECRET requis dès que STRIPE_SECRET_KEY est défini"
            )
        # PAS de garde-fou « BILLING_METERING_ENABLED sans billing » : le flag est
        # ON par défaut (feature mise en place) et INOFFENSIF sans Stripe —
        # metering_enabled() exige déjà billing_enabled() (clés Stripe présentes),
        # donc un prod 100 % gratuit (sans Stripe) garde un métrage INERTE et doit
        # démarrer normalement (invariant D0). L'exiger casserait ce déploiement.
        # BILLING_ENFORCE est ON par défaut et INOFFENSIF sans billing (no-op :
        # billing_enabled()==False => resolve() ALL_UNLOCKED => gate() passe,
        # invariant D0). On n'exige donc PAS de clé Stripe : un déploiement
        # prod 100 % gratuit (sans Stripe) doit démarrer normalement. Le métrage
        # ci-dessus, lui, n'a aucun sens sans billing et reste donc gardé.
        if self.MOCK_BILLING:
            raise RuntimeError("MOCK_BILLING interdit en production")
        # emails.chapote.fr : les mots de passe des boîtes exigent leur propre clé, valide et
        # distincte d'ENCRYPTION_KEY (sinon une seule fuite ouvrirait les deux coffres).
        if self.EMAILS_ENABLED:
            if not self.MAILBOX_ENCRYPTION_KEY:
                raise RuntimeError("MAILBOX_ENCRYPTION_KEY obligatoire en production quand EMAILS_ENABLED=true")
            if self.MAILBOX_ENCRYPTION_KEY == self.ENCRYPTION_KEY:
                raise RuntimeError("MAILBOX_ENCRYPTION_KEY doit être distincte d'ENCRYPTION_KEY")
            from cryptography.fernet import Fernet
            try:
                Fernet(self.MAILBOX_ENCRYPTION_KEY.encode())
            except Exception:
                raise RuntimeError("MAILBOX_ENCRYPTION_KEY n'est pas une clé Fernet valide")
            if not self.EMAILS_URL.startswith("https://"):
                raise RuntimeError("EMAILS_URL doit être en https:// en production")
        if (self.STRIPE_SECRET_KEY or "").startswith("sk_live"):
            raise RuntimeError(
                "Utiliser une Restricted API Key rk_live en production (A3)"
            )

    # extra="ignore" : une variable d'env inconnue (typo) est silencieusement
    # ignoree plutot que d'etre absorbee en attribut fantome ("allow"), ce qui
    # masquait les fautes de frappe de config.
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
settings.validate_production()
