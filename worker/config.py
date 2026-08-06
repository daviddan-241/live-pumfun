from __future__ import annotations

import os
from dataclasses import dataclass, field


def _csv(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    app_name: str = os.getenv("APP_NAME", "arcc-signal-hub")
    telegram_api_id: int | None = int(os.environ["TELEGRAM_API_ID"]) if os.getenv("TELEGRAM_API_ID") else None
    telegram_api_hash: str = os.getenv("TELEGRAM_API_HASH", "")
    telegram_session: str = os.getenv("TELEGRAM_SESSION", "arcc-signal-hub")
    telegram_session_string: str = os.getenv("TELEGRAM_SESSION_STRING", "")
    telegram_bot_token: str = os.getenv("TELEGRAM_BOT_TOKEN", "")
    source_channels: list[str] = field(default_factory=lambda: _csv("TELEGRAM_SOURCE_CHANNELS"))
    destination_channel: str = os.getenv("TELEGRAM_DESTINATION_CHANNEL", "@AiresArccpubcaller")
    private_access_channel: str = os.getenv("TELEGRAM_PRIVATE_ACCESS", "@william_ARCC")
    database_url: str = os.getenv("DATABASE_URL", "")
    redis_url: str = os.getenv("REDIS_URL", "")
    llm_provider: str = os.getenv("LLM_PROVIDER", "gemini").lower()
    llm_model: str = os.getenv("LLM_MODEL", "gemini-2.0-flash")
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    minimum_confidence: float = float(os.getenv("MINIMUM_CONFIDENCE", "72"))
    duplicate_window_hours: int = int(os.getenv("DUPLICATE_WINDOW_HOURS", "48"))
    auto_publish: bool = os.getenv("AUTO_PUBLISH", "false").lower() in {"1", "true", "yes"}
    repost_media: bool = os.getenv("REPOST_MEDIA", "true").lower() in {"1", "true", "yes"}
    market_provider: str = os.getenv("MARKET_DATA_PROVIDER", "dexscreener").lower()
    health_host: str = os.getenv("HEALTH_HOST", "0.0.0.0")
    health_port: int = int(os.getenv("HEALTH_PORT", "8080"))
    encryption_key: str = os.getenv("ARCC_ENCRYPTION_KEY", "") or os.getenv("SESSION_SECRET", "")

    @property
    def telegram_configured(self) -> bool:
        return bool(self.telegram_api_id and self.telegram_api_hash and self.telegram_session_string)

    @property
    def bot_configured(self) -> bool:
        return bool(self.telegram_bot_token)

    @property
    def llm_configured(self) -> bool:
        return self.llm_provider == "gemini" and bool(self.gemini_api_key)


settings = Settings()