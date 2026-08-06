# ARCC AI Crypto Signal Hub

ARCC Signal Hub monitors configured public Telegram sources, extracts token calls, enriches them with market data, produces original research-focused analysis, queues calls for review, and tracks published performance.

## Product surfaces

- React dashboard at the root preview: live summary, activity, confidence history, calls, channels, settings, logs, and health.
- Express API under `/api`: persistent PostgreSQL-backed dashboard data and review/configuration actions.
- Python worker: Telethon listener, message edits, contract/chain detection, duplicate merge, DexScreener enrichment, configurable LLM gateway, original ARCC captions, milestone-ready tracking, JSON logs, retries, health checks, and graceful shutdown.

## Run locally

1. Copy `.env.example` to `.env`.
2. Set `DATABASE_URL`, `ARCC_DASHBOARD_PASSWORD`, and `ARCC_ENCRYPTION_KEY`.
3. Start the dashboard and log in with `ARCC_DASHBOARD_PASSWORD`.
4. Enter Telegram API ID/hash, a Telethon user session string, optional bot token, Gemini API key, source channels, and destination channel in Settings. These integration values are encrypted into PostgreSQL by the dashboard and are not required as environment variables.
5. Keep automatic publishing disabled until you have verified the first live detections and destination permissions.

## Safety and originality

The worker does not copy source captions or source branding. It extracts factual token and market inputs, writes an independent ARCC analysis, filters promotional/off-topic messages, merges duplicate contracts, and defaults to human review. Media reposting must comply with the source channel’s permissions and applicable platform rules.

## Configuration

The live worker uses Gemini through the official Generative Language REST API. Telegram API credentials and the Telethon user session are encrypted before they are stored in PostgreSQL. The dashboard never returns credential values. `ARCC_ENCRYPTION_KEY` must remain stable for the lifetime of the installation.

## Deployment

The included `Dockerfile`, `docker-compose.yml`, and `render.yaml` provide a Render-compatible deployment. Render must provide a persistent PostgreSQL database and stable `ARCC_ENCRYPTION_KEY`; a Telegram user session string is required because a bot token cannot read arbitrary source channels. The API/worker reports degraded status instead of fabricating a connected state when credentials or the live Telegram session are unavailable.