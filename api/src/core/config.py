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

    # Turnstile par defaut (nos cles)
    TURNSTILE_SITE_KEY: str | None = None
    TURNSTILE_SECRET_KEY: str | None = None

    # --- Auth intranet (meme flux qu'ao_scrapping) ---
    # Les comptes @kertios.com authentifies via l'intranet deviennent
    # superadmins du SaaS (vue sur tous les clients).
    INTRANET_AUTH_URL: str = "https://intranet.kertios.com/main/auth_ret"
    INTRANET_AUTH_ENABLED: bool = True

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

    APP_URL: str = "http://localhost:3001"
    API_URL: str = "http://localhost:8001"

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
    def is_production(self) -> bool:
        return self.ENV.lower() not in ("dev", "development")

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
