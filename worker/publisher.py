from __future__ import annotations

import logging

from .config import settings
from .models import DetectedCall

logger = logging.getLogger(__name__)


def format_caption(call: DetectedCall) -> str:
    market = call.market
    return "\n".join(
        [
            "ARCC SIGNAL",
            f"Ticker: {call.ticker}",
            f"Chain: {call.chain}",
            f"Contract: {call.contract}",
            f"Narrative: {call.narrative}",
            "Observations:",
            *[f"• {item}" for item in call.observations[:3]],
            "Market Snapshot:",
            f"• MC: {market.market_cap or 'n/a'}",
            f"• Liquidity: {market.liquidity or 'n/a'}",
            f"• Volume: {market.volume_24h or 'n/a'}",
            f"My Confidence: {call.confidence:.0f}/100",
            f"Risk: {call.risk.title()}",
            "Always manage risk and do your own research.",
            settings.destination_channel,
        ]
    )


async def publish(
    call: DetectedCall,
    client: object | None = None,
    *,
    destination_channel: str | None = None,
    force: bool = False,
) -> bool:
    if not destination_channel:
        raise RuntimeError("TELEGRAM_DESTINATION_CHANNEL is required for publishing")
    if (not force and not settings.auto_publish) or call.confidence < settings.minimum_confidence:
        logger.info("call held for review: %s confidence=%s", call.ticker, call.confidence)
        return False
    if client is None:
        raise RuntimeError("Telegram publisher client is not connected")
    await client.send_message(destination_channel, format_caption(call))  # type: ignore[attr-defined]
    logger.info("published original ARCC analysis for %s", call.ticker)
    return True