from __future__ import annotations

import asyncio
import logging
import signal
from datetime import UTC, datetime

from aiohttp import web
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from .analysis import analyze
from .config import settings
from .detection import parse_message
from .logging_setup import configure_logging
from .market import enrich_with_retry
from .publisher import publish
from .storage import Storage

logger = logging.getLogger(__name__)
storage = Storage()
stop_event = asyncio.Event()


async def health(_request: web.Request) -> web.Response:
    return web.json_response({
        "status": "ok" if telegram_client else "degraded",
        "service": settings.app_name,
        "telegram": bool(telegram_client),
        "bot": bool(bot),
        "gemini": settings.llm_configured,
    }, status=200 if telegram_client and settings.llm_configured else 503)


telegram_client: object | None = None
bot: object | None = None


def call_from_row(row: object) -> object:
    from .models import DetectedCall, MarketSnapshot

    market = row["market"] if isinstance(row["market"], dict) else {}
    return DetectedCall(
        ticker=row["ticker"],
        token_name=row["token_name"],
        chain=row["chain"],
        contract=row["contract"],
        narrative=row["narrative"],
        observations=list(row["observations"] or []),
        source_channels=list(row["source_channels"] or []),
        market=MarketSnapshot(
            market_cap=market.get("marketCap"),
            liquidity=market.get("liquidity"),
            volume_24h=market.get("volume24h"),
            holders=market.get("holders"),
            age=market.get("age"),
            price_change_24h=market.get("priceChange24h"),
        ),
        confidence=float(row["confidence"]),
        risk=row["risk"],
        source_message_id=row["source_message_id"],
        source_message_url=row["source_message_url"],
        source_text=row["source_text"],
        detected_at=row["detected_at"],
    )


async def process_message(text: str, channel: str, message_id: int | None = None, media_path: str | None = None, message_url: str | None = None) -> None:
    call = parse_message(text, channel, message_id)
    if not call:
        return
    if message_id is None:
        raise RuntimeError("Telegram message id is required for live processing")
    if not await storage.claim_message(channel, message_id, text, call.contract):
        logger.info("duplicate Telegram message ignored: %s/%s", channel, message_id)
        return
    call.media_path = media_path
    call.source_message_url = message_url
    call.source_text = text[:12000]
    call.detected_at = datetime.now(UTC)
    call = await enrich_with_retry(call)
    call = await analyze(call)
    await storage.save_call(call)
    await publish(
        call,
        telegram_client,
        destination_channel=settings.destination_channel,
    )
    if settings.auto_publish and call.confidence >= settings.minimum_confidence:
        await storage.mark_contract_published(call.contract)


async def publish_approved_jobs() -> None:
    if not telegram_client:
        return
    for row in await storage.pending_publish_jobs():
        try:
            call = call_from_row(row)
            await publish(
                call,
                telegram_client,
                destination_channel=settings.destination_channel,
                force=True,
            )
            await storage.mark_published(row["id"])
            logger.info("published approved ARCC signal %s", row["id"])
        except Exception as exc:
            logger.exception("approved publish failed for %s", row["id"])
            await storage.mark_publish_failed(row["id"], str(exc))


async def heartbeat() -> None:
    logger.info("worker heartbeat; sources=%s destination=%s", settings.source_channels, settings.destination_channel)
    await storage.record_log(
        "info",
        "worker",
        "heartbeat",
        {
            "telegram": telegram_client is not None,
            "bot": bot is not None,
            "gemini": settings.llm_configured,
        },
    )


async def run() -> None:
    global telegram_client, bot
    configure_logging()
    await storage.connect()
    await storage.load_runtime_configuration()
    health_app = web.Application()
    health_app.router.add_get("/healthz", health)
    runner = web.AppRunner(health_app)
    await runner.setup()
    await web.TCPSite(runner, settings.health_host, settings.health_port).start()

    scheduler = AsyncIOScheduler()
    scheduler.add_job(heartbeat, "interval", seconds=30, max_instances=1)
    scheduler.add_job(publish_approved_jobs, "interval", seconds=5, max_instances=1)
    scheduler.start()

    if settings.telegram_configured:
        from telethon import TelegramClient, events
        from telethon.sessions import StringSession

        session = StringSession(settings.telegram_session_string) if settings.telegram_session_string else settings.telegram_session
        telegram_client = TelegramClient(session, settings.telegram_api_id, settings.telegram_api_hash)

        configured_sources = {item.lower() for item in settings.source_channels}

        @telegram_client.on(events.NewMessage())
        async def on_new_message(event: object) -> None:
            text = getattr(event, "raw_text", "")
            chat = getattr(getattr(event, "chat", None), "username", None) or "unknown"
            channel = f"@{chat}" if not str(chat).startswith("@") else str(chat)
            if channel.lower() not in configured_sources:
                return
            await process_message(text, channel, getattr(event, "id", None), message_url=getattr(event, "message", None) and getattr(event.message, "url", None))

        @telegram_client.on(events.MessageEdited())
        async def on_edited_message(event: object) -> None:
            text = getattr(event, "raw_text", "")
            chat = getattr(getattr(event, "chat", None), "username", None) or "unknown"
            channel = f"@{chat}" if not str(chat).startswith("@") else str(chat)
            if channel.lower() not in configured_sources:
                return
            await process_message(text, channel, getattr(event, "id", None), message_url=getattr(event, "message", None) and getattr(event.message, "url", None))

        await telegram_client.start()
        logger.info("telegram listener connected")
    else:
        logger.warning("Telegram credentials not configured; listener is waiting in health-only mode")

    if settings.bot_configured and settings.telegram_api_id and settings.telegram_api_hash:
        from telethon import events
        bot = TelegramClient("arcc-bot", settings.telegram_api_id, settings.telegram_api_hash)
        await bot.start(bot_token=settings.telegram_bot_token)

        @bot.on(events.NewMessage(pattern=r"/status"))
        async def status_command(event: object) -> None:
            await event.respond(f"ARCC live worker\nTelegram listener: {'connected' if settings.telegram_configured else 'not configured'}\nGemini: {'configured' if settings.llm_configured else 'not configured'}\nSources: {', '.join(settings.source_channels) or 'none'}")

        @bot.on(events.NewMessage(pattern=r"/help"))
        async def help_command(event: object) -> None:
            await event.respond("/status — show live connection status\n/help — show this help")
        logger.info("telegram bot connected")

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop_event.set)
    await stop_event.wait()
    scheduler.shutdown(wait=False)
    if telegram_client:
        await telegram_client.disconnect()
    if bot:
        await bot.disconnect()
    await storage.close()
    await runner.cleanup()
    logger.info("worker shutdown complete")


if __name__ == "__main__":
    asyncio.run(run())