from __future__ import annotations

import re
from dataclasses import dataclass

from .models import DetectedCall

SOLANA = re.compile(r"(?<![A-Za-z0-9])[1-9A-HJ-NP-Za-km-z]{32,44}(?![A-Za-z0-9])")
EVM = re.compile(r"0x[a-fA-F0-9]{40}")
TON = re.compile(r"(?:EQ|UQ)[A-Za-z0-9_-]{46}")
SUI = re.compile(r"0x[a-fA-F0-9]{64}")
APTOS = re.compile(r"0x[a-fA-F0-9]{64}")
TICKER = re.compile(r"(?:\$|ticker[:\s]+)([A-Z][A-Z0-9]{1,12})\b", re.IGNORECASE)
BLOCKED_TERMS = {"airdrop", "giveaway", "sponsored", "advertisement", "promo", "join", "dm admin"}


@dataclass(frozen=True)
class Detection:
    contract: str
    chain: str


def detect_contract(text: str) -> Detection | None:
    if match := EVM.search(text):
        chain_hint = "Base" if "base" in text.lower() else "Ethereum"
        if "bsc" in text.lower() or "bnb" in text.lower():
            chain_hint = "BSC"
        return Detection(match.group(0), chain_hint)
    if match := TON.search(text):
        return Detection(match.group(0), "TON")
    if match := SUI.search(text):
        return Detection(match.group(0), "Sui")
    if match := APTOS.search(text):
        return Detection(match.group(0), "Aptos")
    if match := SOLANA.search(text):
        return Detection(match.group(0), "Solana")
    return None


def parse_message(text: str, source_channel: str, message_id: int | None = None) -> DetectedCall | None:
    lowered = text.lower()
    if any(term in lowered for term in BLOCKED_TERMS):
        return None
    detection = detect_contract(text)
    if not detection:
        return None
    ticker_match = TICKER.search(text)
    ticker = ticker_match.group(1).upper() if ticker_match else "UNKNOWN"
    return DetectedCall(
        ticker=ticker,
        token_name=ticker.title(),
        chain=detection.chain,
        contract=detection.contract,
        narrative="A contract was detected in a monitored public source and queued for independent enrichment.",
        observations=["Contract and chain extracted from source text", "Market enrichment pending", "Human review remains enabled by default"],
        source_channels=[source_channel],
        source_message_id=message_id,
    )