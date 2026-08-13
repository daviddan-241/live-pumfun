// @ts-nocheck
import config from './config.js';
import { runMigrations } from './database/schema.js';
import { closeDb, db } from './database/db.js';
import { saveMessage, saveMapping, saveLog } from './database/repositories.js';
import { initialize as initTelegram, disconnect as disconnectTelegram, connectionStatus } from './telegram/client.js';
import { startListening, stopListening, listener } from './telegram/listener.js';
import { queueManager } from './workers/queue.js';
import { startWorkers, stopWorkers } from './workers/processor.js';
import { startHealthMonitor, stopHealthMonitor, recordLastMessageReceived } from './workers/health.js';
import { startServer, stopServer } from './dashboard/server.js';
import { sseManager } from './dashboard/sse.js';
import { signalTracker } from './signals/tracker.js';
import { publishingRouter } from './publishing/router.js';
import { pnlRouter } from './publishing/pnl.js';
import { createLogger } from './utils/logger.js';

const logger = createLogger('MainApp');

async function main() {
  logger.info('=== Starting ARCC Telegram Intelligence & Publishing System ===');

  // 1. Verify Telegram Credentials
  if (!config.TELEGRAM_API_ID || !config.TELEGRAM_API_HASH) {
    logger.error('CRITICAL ERROR: Telegram credentials missing!');
    logger.error('Please configure TELEGRAM_API_ID and TELEGRAM_API_HASH in your .env file.');
    logger.error('You can obtain API credentials at https://my.telegram.org');
    process.exit(1);
  }

  // 2. Database Initialization
  try {
    logger.info(`Initializing SQLite database at ${config.DB_PATH}...`);
    runMigrations();
    logger.info('Database migrations completed successfully.');
  } catch (err: any) {
    logger.error('Database initialization failed:', err.message);
    process.exit(1);
  }

  // 3. Telegram Client Initialization
  try {
    logger.info('Connecting to Telegram Client...');
    await initTelegram();
    logger.info('Telegram client connected and authenticated.');
  } catch (err: any) {
    logger.error('Failed to initialize Telegram client:', err.message);
    logger.error('Please check your TELEGRAM_SESSION token and API credentials.');
    process.exit(1);
  }

  // Forward Telegram Connection status events to SSE and Logs
  connectionStatus.on('status', (statusData) => {
    logger.info(`Telegram Connection Status Event: ${JSON.stringify(statusData)}`);
    sseManager.broadcast('connection:status', statusData);
  });

  // 4. Resolve Source Channels & Setup Listener Pipeline
  const sources = config.SOURCE_CHANNELS;
  logger.info(`Configured source channels (${sources.length}): ${sources.join(', ')}`);

  listener.on('message', (incomingMsg: any) => {
    recordLastMessageReceived();

    const msgId = incomingMsg.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const sourceId = incomingMsg.sourceId || incomingMsg.source_id || sources[0];

    logger.info(`Received new message ${msgId} from source ${sourceId}`);

    // Persist raw message
    saveMessage({
      id: msgId,
      source_id: sourceId,
      source_message_id: incomingMsg.sourceMessageId || Date.now(),
      text: incomingMsg.text || '',
      status: 'pending',
      created_at: Date.now(),
    });

    sseManager.broadcast('message:received', { id: msgId, sourceId, text: incomingMsg.text, timestamp: Date.now() });

    // Priority mapping: higher priority sources processed first
    const isPrioritySource = sourceId === sources[0];
    const priority = isPrioritySource ? 10 : 5;

    queueManager.enqueue({
      messageId: msgId,
      sourceId: sourceId,
      priority: priority,
      type: 'message',
      payload: { message: incomingMsg, sourceId },
      maxRetries: 3,
    });
  });

  listener.on('edit', (editData: any) => {
    logger.info(`Message edit received: ${JSON.stringify(editData)}`);
    sseManager.broadcast('message:edit', editData);
  });

  listener.on('album', (albumData: any) => {
    logger.info(`Media album received: ${JSON.stringify(albumData)}`);
    sseManager.broadcast('message:album', albumData);
  });

  // 5. Connect Signal Tracker & Publishing Events to SSE
  signalTracker.on('signal:new', (sig) => {
    logger.info(`Signal Tracker emitted signal:new for $${sig.ticker}`);
    sseManager.broadcast('signal:new', sig);
  });

  signalTracker.on('signal:followup', (sig) => {
    logger.info(`Signal Tracker emitted signal:followup for $${sig.ticker}`);
    sseManager.broadcast('signal:update', sig);
  });

  signalTracker.on('signal:pnl', (sig) => {
    logger.info(`Signal Tracker emitted signal:pnl for $${sig.ticker}`);
    sseManager.broadcast('signal:pnl', sig);
  });

  publishingRouter.on('message:published', (pubEvent) => {
    logger.info(`Router published message: ${pubEvent.result?.messageId || pubEvent.sourceMessageId}`);

    if (pubEvent.message && pubEvent.result?.messageId) {
      saveMapping({
        id: `map_${Date.now()}`,
        source_message_id: pubEvent.message.id,
        dest_channel: pubEvent.result.channel || 'PUBLIC_CHANNEL',
        dest_message_id: pubEvent.result.messageId,
        created_at: Date.now(),
      });
    }

    sseManager.broadcast('message:published', pubEvent);
  });

  publishingRouter.on('message:skipped', (pubEvent) => {
    logger.info(`Router skipped message: ${pubEvent.message?.id}`);
    sseManager.broadcast('message:skipped', pubEvent);
  });

  publishingRouter.on('message:failed', (pubEvent) => {
    logger.warn(`Router failed to publish message: ${pubEvent.message?.id}`);
    sseManager.broadcast('message:failed', pubEvent);
  });

  pnlRouter.on('pnl:posted', (pnlData) => {
    logger.info(`PNL Router posted record for $${pnlData.ticker} (+${pnlData.gainPercentage}%)`);
    sseManager.broadcast('pnl:posted', pnlData);
  });

  pnlRouter.on('pnl:forwarded', (pnlData) => {
    logger.info(`PNL Router forwarded record for $${pnlData.ticker}`);
    sseManager.broadcast('pnl:forwarded', pnlData);
  });

  // 6. Start Dashboard Server
  if (config.ENABLE_DASHBOARD) {
    logger.info(`Starting Dashboard Server on port ${config.DASHBOARD_PORT || 3000}...`);
    await startServer(config.DASHBOARD_PORT || 3000);
  } else {
    logger.info('Dashboard server disabled in configuration');
  }

  // 7. Start Background Workers & Health Monitor
  startWorkers();
  startHealthMonitor();

  // 8. Start Listening to Sources
  startListening(sources);
  logger.info('=== ARCC System Initialized & Actively Listening ===');

  // 9. Graceful Shutdown Setup
  const shutdown = async (signalName: string) => {
    logger.info(`Received ${signalName}. Initiating graceful shutdown...`);

    try {
      // Step 1: Stop Listener (no new incoming messages)
      logger.info('Step 1: Stopping Telegram listener...');
      stopListening();

      // Step 2: Drain Queue
      logger.info('Step 2: Draining worker queue...');
      const queueDrainTimeout = setTimeout(() => {
        logger.warn('Queue drain timeout reached (15s). Proceeding with shutdown.');
      }, 15000);

      while (queueManager.getQueueSize() > 0) {
        await new Promise((r) => setTimeout(r, 200));
      }
      clearTimeout(queueDrainTimeout);
      logger.info('Queue fully drained.');

      // Step 3: Stop Workers
      logger.info('Step 3: Stopping workers...');
      await stopWorkers();

      // Step 4: Stop Health Monitor
      logger.info('Step 4: Stopping health monitor...');
      stopHealthMonitor();

      // Step 5: Disconnect Telegram Client
      logger.info('Step 5: Disconnecting Telegram client...');
      await disconnectTelegram();

      // Step 6: Close Database
      logger.info('Step 6: Closing database connection...');
      closeDb();

      // Step 7: Stop Dashboard Server
      if (config.ENABLE_DASHBOARD) {
        logger.info('Step 7: Stopping dashboard server...');
        await stopServer();
      }

      logger.info('=== Graceful Shutdown Complete ===');
      process.exit(0);
    } catch (err: any) {
      logger.error('Error during shutdown sequence:', err.message);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('Unhandled fatal error in main execution:', err);
  process.exit(1);
});
