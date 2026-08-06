from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from .config import settings
from .models import DetectedCall

logger = logging.getLogger(__name__)


def _score(call: DetectedCall) -> tuple[float, str]:
    liquidity = call.market.liquidity or 0
    volume = call.market.volume_24h or 0
    if liquidity >= 150_000 and volume >= liquidity * 2:
        return 84, "medium"
    if liquidity >= 50_000:
        return 74, "high"
    return 62, "critical"


def local_analysis(call: DetectedCall) -> DetectedCall:
    score, risk = _score(call)
    call.confidence = score
    call.risk = risk
    call.observations.extend(
        [
            f"Liquidity read: {call.market.liquidity or 'unavailable'}",
            f"24h volume read: {call.market.volume_24h or 'unavailable'}",
            "Score is an analytical aid, not a promise of performance",
        ]
    )
    return call


async def analyze(call: DetectedCall) -> DetectedCall:
    if settings.llm_provider != "gemini":
        raise RuntimeError("LLM_PROVIDER must be gemini for live research analysis")
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is required for live research analysis")
    try:
        prompt = f"""You are the ARCC crypto research analyst. Analyze this detected public Telegram token mention using only the supplied facts. Do not claim you browsed or verified facts that are absent. Be skeptical, identify missing data, and never give financial advice.
Return ONLY valid JSON matching:
{{"confidence": number 0-100, "risk": "low|medium|high|critical", "narrative": string, "observations": string[]}}
Token: {call.ticker}; chain: {call.chain}; contract: {call.contract}
Market data: {json.dumps(call.market.__dict__)}
Source channel: {call.source_channels}
Source text: {call.source_text or "(unavailable)"}"""
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{settings.llm_model}:generateContent"
        body = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.2,
                "responseMimeType": "application/json",
            },
        }
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(url, params={"key": settings.gemini_api_key}, json=body)
            response.raise_for_status()
            payload: dict[str, Any] = response.json()
        text = payload["candidates"][0]["content"]["parts"][0]["text"]
        data: dict[str, Any] = json.loads(text)
        call.confidence = max(0, min(100, float(data["confidence"])))
        call.risk = str(data["risk"])
        call.narrative = str(data["narrative"])
        call.observations = [str(item) for item in data["observations"]]
        call.metadata["analysis_provider"] = "gemini"
        call.metadata["analysis_model"] = settings.llm_model
        return call
    except (httpx.HTTPError, KeyError, ValueError, TypeError, json.JSONDecodeError) as exc:
        logger.exception("Gemini analysis failed for %s", call.contract)
        raise RuntimeError(f"Gemini analysis failed: {exc}") from exc