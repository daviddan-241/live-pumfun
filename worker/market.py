from __future__ import annotations

import asyncio
import logging

import httpx

from .models import DetectedCall, MarketSnapshot

logger = logging.getLogger(__name__)


class DexScreenerClient:
    base_url = "https://api.dexscreener.com/latest/dex"

    async def enrich(self, call: DetectedCall) -> DetectedCall:
        url = f"{self.base_url}/tokens/{call.contract}"
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                response = await client.get(url)
                response.raise_for_status()
                pairs = response.json().get("pairs") or []
            if not pairs:
                return call
            pair = max(pairs, key=lambda item: float(item.get("liquidity", {}).get("usd") or 0))
            txns = pair.get("txns", {}).get("h24", {})
            call.market = MarketSnapshot(
                market_cap=float(pair.get("marketCap") or 0) or None,
                liquidity=float(pair.get("liquidity", {}).get("usd") or 0) or None,
                volume_24h=float(pair.get("volume", {}).get("h24") or 0) or None,
                age=None,
                price_change_24h=float(pair.get("priceChange", {}).get("h24") or 0),
            )
            call.metadata["dex_url"] = pair.get("url")
            call.metadata["buys_24h"] = txns.get("buys", 0)
            call.metadata["sells_24h"] = txns.get("sells", 0)
            return call
        except (httpx.HTTPError, ValueError, TypeError) as exc:
            logger.warning("market enrichment failed for %s: %s", call.contract, exc)
            return call


async def enrich_with_retry(call: DetectedCall, attempts: int = 3) -> DetectedCall:
    client = DexScreenerClient()
    for attempt in range(attempts):
        result = await client.enrich(call)
        if result.market.market_cap is not None or attempt == attempts - 1:
            return result
        await asyncio.sleep(2**attempt)
    return call