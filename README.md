# ARCC Telegram Intelligence & Publishing System

Production-grade multi-source Telegram monitoring, intelligence, and publishing platform.

## Features

- **Real Telegram MTProto integration** (user account via gramjs)
- **Multi-source monitoring** — Alpha_Circle1, Maestrosdegen, BRUCECALL0
- **Smart message classification** — calls, follow-ups, PNL updates, replies, media
- **Signal tracking engine** — tracks calls → follow-ups → PNL lifecycle
- **Immediate call drop** — publishes new calls instantly to private group + public channel
- **Pump → /pnl CA workflow** — posts `/pnl REAL_CA` to private group first, then forwards to public channel
- **Real media handling** — downloads and re-uploads actual photos, videos, documents
- **Reply/quote preservation** — maintains message relationships
- **Real-time dashboard** — Live Monitor, Signals, PNL Tracker, Publishing Log, Health
- **24/7 operation** — auto-reconnect, retries, health monitoring, graceful shutdown

## Sources (Monitor Only — Never Post To)

1. https://t.me/Alpha_Circle1
2. @Maestrosdegen
3. @BRUCECALL0

## Destinations (Publish Here Only)

- **Private group:** https://t.me/+NxFFO4JXdF8zMWU0
- **Public channel:** @Aires_Insider

## Setup

### 1. Get Telegram API Credentials

Go to https://my.telegram.org → API development tools → Create application

Save your **API ID** and **API Hash**.

### 2. Generate a Session String

```bash
npm run generate-session
```

Follow the prompts to authenticate your Telegram account. Save the output session string.

### 3. Configure Environment Variables

Create a `.env` file (or set in Render dashboard):

```env
TELEGRAM_API_ID=your_api_id
TELEGRAM_API_HASH=your_api_hash
TELEGRAM_SESSION=your_session_string
SOURCE_CHANNELS=["Alpha_Circle1","Maestrosdegen","BRUCECALL0"]
PRIVATE_GROUP_ID=-100xxxxxxxxxx
PUBLIC_CHANNEL_USERNAME=Aires_Insider
ARCC_CONTACT=@William_ARCC
PRIVATE_GROUP_LINK=https://t.me/+NxFFO4JXdF8zMWU0
CONFIDENCE_THRESHOLD=0.6
DASHBOARD_PORT=3000
ENABLE_DASHBOARD=true
DB_PATH=/data/arcc.db
```

### 4. Run Locally

```bash
npm install
npm run build
npm start
```

Or with Docker:

```bash
docker build -t arcc-telegram .
docker run -p 3000:3000 --env-file .env arcc-telegram
```

### 5. Deploy on Render

The `render.yaml` file is pre-configured. Connect your GitHub repo to Render and it will:
- Build the Docker image
- Deploy as a web service
- Mount a persistent disk at `/data` for the SQLite database
- Expose the dashboard on port 3000

Set your environment variables in the Render dashboard (especially `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION`, and `PRIVATE_GROUP_ID`).

## Architecture

```
Telegram Listener → Event Queue → Classifier → Signal Matcher → Media Processor → Publishing Worker → Delivery Verification → Database
```

### Components

- `src/telegram/` — MTProto client, listener, publisher, media engine
- `src/classifier/` — Message classification pipeline
- `src/signals/` — Signal tracking with lifecycle management
- `src/publishing/` — Routing, /pnl workflow, ARCC formatting
- `src/database/` — SQLite schema, migrations, repositories
- `src/dashboard/` — Express API + SSE + real-time UI
- `src/workers/` — Queue, processor, health monitor

## PNL Workflow (Critical)

When a pump/upside is detected on a tracked signal:

1. Post `/pnl REAL_CONTRACT_ADDRESS` to the **private group** first
2. Forward the /pnl message to **@Aires_Insider** (public channel)
3. Forward the original call to the public channel if not already there
4. Log all message IDs and delivery status

**Never** invent or substitute contract addresses.

## Contact

- **Primary:** @William_ARCC
- **Private group:** https://t.me/+NxFFO4JXdF8zMWU0

## Disclaimer

See: https://t.me/Aires_Insider/6
