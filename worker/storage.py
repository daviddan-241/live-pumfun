from __future__ import annotations

import logging
import hashlib
import json
import base64
import hashlib
from datetime import UTC, datetime

import asyncpg

from .config import settings
from .models import DetectedCall


def decrypt_secret(value: str, secret: str) -> str:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    raw = base64.b64decode(value)
    nonce, tag, ciphertext = raw[:12], raw[12:28], raw[28:]
    key = hashlib.sha256(secret.encode("utf-8")).digest()
    return AESGCM(key).decrypt(nonce, ciphertext + tag, None).decode("utf-8")

logger = logging.getLogger(__name__)


class Storage:
    def __init__(self) -> None:
        self.pool: asyncpg.Pool | None = None

    async def connect(self) -> None:
        if not settings.database_url:
            logger.warning("DATABASE_URL is not configured; storage is disabled")
            return
        self.pool = await asyncpg.create_pool(settings.database_url, min_size=1, max_size=5)

    async def load_runtime_configuration(self) -> None:
        if not self.pool:
            raise RuntimeError("DATABASE_URL is required for runtime configuration")
        row = await self.pool.fetchrow("select * from arcc_settings order by id limit 1")
        if not row:
            await self.pool.execute(
                """insert into arcc_settings
                (destination_channel, llm_provider, auto_publish, media_repost, minimum_confidence, duplicate_window_hours)
                values ($1, $2, false, false, $3, $4)""",
                settings.destination_channel,
                settings.llm_provider,
                settings.minimum_confidence,
                settings.duplicate_window_hours,
            )
            row = await self.pool.fetchrow("select * from arcc_settings order by id limit 1")
        if not row:
            raise RuntimeError("Unable to initialize ARCC settings")
        sources = await self.pool.fetch(
            "select username from arcc_channels where kind = 'source' and status = 'monitoring' order by id"
        )
        secret = settings.encryption_key
        object.__setattr__(settings, "destination_channel", row["destination_channel"])
        object.__setattr__(settings, "llm_provider", row["llm_provider"].lower())
        object.__setattr__(settings, "auto_publish", row["auto_publish"])
        object.__setattr__(settings, "repost_media", row["media_repost"])
        object.__setattr__(settings, "minimum_confidence", float(row["minimum_confidence"]))
        object.__setattr__(settings, "duplicate_window_hours", int(row["duplicate_window_hours"]))
        object.__setattr__(settings, "source_channels", [item["username"] for item in sources])
        if row["telegram_api_id_encrypted"]:
            object.__setattr__(settings, "telegram_api_id", int(decrypt_secret(row["telegram_api_id_encrypted"], secret)))
        if row["telegram_api_hash_encrypted"]:
            object.__setattr__(settings, "telegram_api_hash", decrypt_secret(row["telegram_api_hash_encrypted"], secret))
        if row["telegram_session_encrypted"]:
            object.__setattr__(settings, "telegram_session_string", decrypt_secret(row["telegram_session_encrypted"], secret))
        if row["telegram_bot_token_encrypted"]:
            object.__setattr__(settings, "telegram_bot_token", decrypt_secret(row["telegram_bot_token_encrypted"], secret))
        if row["gemini_api_key_encrypted"]:
            object.__setattr__(settings, "gemini_api_key", decrypt_secret(row["gemini_api_key_encrypted"], secret))

    async def close(self) -> None:
        if self.pool:
            await self.pool.close()

    async def record_log(self, level: str, service: str, message: str, metadata: dict[str, object] | None = None) -> None:
        if not self.pool:
            return
        await self.pool.execute(
            "insert into arcc_logs (level, service, message, metadata) values ($1, $2, $3, $4::jsonb)",
            level,
            service,
            message,
            json.dumps(metadata or {}),
        )

    async def seen_contract(self, contract: str) -> bool:
        if not self.pool:
            return False
        row = await self.pool.fetchrow("select 1 from arcc_calls where contract = $1 limit 1", contract)
        return row is not None

    async def claim_message(self, source_channel: str, message_id: int, text: str, contract: str | None) -> bool:
        if not self.pool:
            raise RuntimeError("DATABASE_URL is required for durable message deduplication")
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        existing = await self.pool.fetchrow(
            "select text_hash from arcc_messages where source_channel = $1 and telegram_message_id = $2",
            source_channel,
            message_id,
        )
        if existing and existing["text_hash"] == digest:
            return False
        row = await self.pool.fetchrow(
            """insert into arcc_messages (source_channel, telegram_message_id, text_hash, contract)
            values ($1,$2,$3,$4)
            on conflict (source_channel, telegram_message_id) do update
            set text_hash = excluded.text_hash, contract = coalesce(excluded.contract, arcc_messages.contract),
                last_seen_at = now()
            returning 1 as accepted""",
            source_channel, message_id, digest, contract,
        )
        return bool(row and row["accepted"])

    async def save_call(self, call: DetectedCall) -> None:
        if not self.pool:
            logger.info("storage disabled; call retained in memory: %s", call.ticker)
            return
        existing = await self.pool.fetchrow(
            "select source_channels from arcc_calls where contract = $1",
            call.contract,
        )
        source_channels = list(dict.fromkeys(
            (list(existing["source_channels"] or []) if existing else []) + call.source_channels
        ))
        await self.pool.execute(
            """insert into arcc_calls
            (ticker, token_name, chain, contract, status, confidence, risk, narrative, observations, source_channels,
             source_message_id, source_message_url, source_text, detected_at, market)
            values ($1,$2,$3,$4,'pending',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
            on conflict (contract) do update set source_channels = excluded.source_channels,
            observations = excluded.observations, market = excluded.market,
            source_message_id = excluded.source_message_id, source_message_url = excluded.source_message_url,
            source_text = excluded.source_text""",
            call.ticker,
            call.token_name,
            call.chain,
            call.contract,
            call.confidence,
            call.risk,
            call.narrative,
            call.observations,
            source_channels,
            call.source_message_id,
            call.source_message_url,
            call.source_text,
            call.detected_at or datetime.now(UTC),
            json.dumps(call.market.__dict__),
        )

    async def pending_publish_jobs(self) -> list[asyncpg.Record]:
        if not self.pool:
            return []
        return await self.pool.fetch(
            """select * from arcc_calls
            where publish_requested = true and status = 'pending'
            order by detected_at asc limit 25"""
        )

    async def mark_published(self, call_id: int) -> None:
        if not self.pool:
            raise RuntimeError("DATABASE_URL is required for durable publishing")
        await self.pool.execute(
            "update arcc_calls set status = 'published', published_at = now(), publish_requested = false where id = $1",
            call_id,
        )

    async def mark_contract_published(self, contract: str) -> None:
        if not self.pool:
            raise RuntimeError("DATABASE_URL is required for durable publishing")
        await self.pool.execute(
            "update arcc_calls set status = 'published', published_at = now(), publish_requested = false where contract = $1",
            contract,
        )

    async def mark_publish_failed(self, call_id: int, message: str) -> None:
        if not self.pool:
            return
        await self.pool.execute(
            "update arcc_calls set publish_requested = false where id = $1",
            call_id,
        )
        await self.pool.execute(
            "insert into arcc_logs (level, service, message, metadata) values ('error', 'publisher', $1, $2::jsonb)",
            message, json.dumps({"callId": call_id}),
        )