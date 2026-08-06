from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass
class MarketSnapshot:
    market_cap: float | None = None
    liquidity: float | None = None
    volume_24h: float | None = None
    holders: int | None = None
    age: str | None = None
    price_change_24h: float | None = None


@dataclass
class DetectedCall:
    ticker: str
    token_name: str
    chain: str
    contract: str
    narrative: str
    observations: list[str] = field(default_factory=list)
    source_channels: list[str] = field(default_factory=list)
    market: MarketSnapshot = field(default_factory=MarketSnapshot)
    confidence: float = 0
    risk: str = "high"
    source_message_id: int | None = None
    source_message_url: str | None = None
    source_text: str | None = None
    media_path: str | None = None
    detected_at: datetime | None = None
    metadata: dict[str, Any] = field(default_factory=dict)