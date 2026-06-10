from pydantic_settings import BaseSettings
from typing import Optional


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
    ENCRYPTION_KEY: Optional[str] = None

    # Cles "managed" : utilisees quand le bot est en api_key_mode=managed
    ANTHROPIC_API_KEY: Optional[str] = None
    OPENAI_API_KEY: Optional[str] = None
    GEMINI_API_KEY: Optional[str] = None

    # true = aucune API IA appelee, reponses simulees (dev / demo)
    MOCK_AI: bool = True

    # Turnstile par defaut (nos cles, incluses dans les plans)
    TURNSTILE_SITE_KEY: Optional[str] = None
    TURNSTILE_SECRET_KEY: Optional[str] = None

    # --- Auth intranet Kertios (meme flux qu'ao_scrapping) ---
    # Les comptes @kertios.com authentifies via l'intranet deviennent
    # superadmins du SaaS (vue sur tous les clients).
    INTRANET_AUTH_URL: str = "https://intranet.kertios.com/main/auth_ret"
    INTRANET_AUTH_ENABLED: bool = True

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
    REDIS_URL: Optional[str] = None

    # Garde-fous widget
    MAX_MESSAGE_CHARS: int = 4000
    MAX_HISTORY_MESSAGES: int = 20          # historique max envoye au modele
    RATE_SESSION_MESSAGES: int = 20         # messages par session...
    RATE_SESSION_WINDOW_SECONDS: int = 600  # ...par fenetre de 10 min
    RATE_IP_REQUESTS: int = 100             # anti-flood IP...
    RATE_IP_WINDOW_SECONDS: int = 60        # ...par minute

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

    class Config:
        env_file = ".env"
        extra = "allow"


settings = Settings()
settings.validate_production()
