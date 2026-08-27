from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "sqlite:///./content_studio.db"
    SUPABASE_URL: str = ""
    SUPABASE_ANON_KEY: str = ""
    SUPABASE_SERVICE_KEY: str = ""
    SUPABASE_JWT_AUD: str = "authenticated"
    STORAGE_BUCKET: str = "content-studio"

    # Generate once:
    # python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    CREDENTIAL_KEY: str = ""

    # Shared volume the open-design container also mounts. PRD 7.2.
    SHARED_VOLUME_ROOT: str = "/data/open-design"
    OPEN_DESIGN_BASE_URL: str = "http://open-design:3000"
    OPEN_DESIGN_TIMEOUT_SECONDS: int = 900

    RESEARCH_AGENT_BASE_URL: str = ""

    # PRD 7.1: a single daemon serialises. Raise only with more daemons.
    MAX_CONCURRENT_GENERATIONS: int = 1

    QA_RASTER_DPI: int = 100
    QA_MIN_FILL_RATIO: float = 0.35
    QA_PALETTE_TOLERANCE: int = 12


settings = Settings()
