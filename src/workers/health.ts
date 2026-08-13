// @ts-nocheck
import { saveHealthStatus, getHealthStatuses, DBHealthStatus } from '../database/repositories.js';
import { getClient, initialize } from '../telegram/client.js';
import { listener } from '../telegram/listener.js';
import { queueManager } from './queue.js';
import { sseManager } from '../dashboard/sse.js';
import config from '../config.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('HealthMonitor');

let timer: NodeJS.Timeout | null = null;
let lastMessageTimestamp: number = Date.now();
let disconnectedSince: number | null = null;

export function recordLastMessageReceived(): void {
  lastMessageTimestamp = Date.now();
}

export function getHealthSummary(): {
  telegram: { status: string; last_check: number; details?: string };
  monitoring: { status: string; last_check: number; details?: string };
  worker: { status: string; last_check: number; details?: string };
  queue: { size: number; oldest_job_age: number; failed_count: number; processing_count: number };
  last_message_received: number;
} {
  const telegramClient = getClient();
  const isConnected = telegramClient.isConnected();
  const isListening = listener.isListening();
  const queueHealth = queueManager.getQueueHealth();

  let workerStatus = 'HEALTHY';
  let workerDetails = 'Worker functioning normally';

  if (queueHealth.size > 100) {
    workerStatus = 'DEGRADED';
    workerDetails = `Queue backlog high (${queueHealth.size} jobs)`;
  } else if (queueHealth.failed_count > 20) {
    workerStatus = 'DEGRADED';
    workerDetails = `High failure count (${queueHealth.failed_count} jobs)`;
  }

  return {
    telegram: {
      status: isConnected ? 'CONNECTED' : 'DISCONNECTED',
      last_check: Date.now(),
      details: isConnected ? 'Active session' : 'Disconnected from Telegram API',
    },
    monitoring: {
      status: isListening ? 'ACTIVE' : 'STOPPED',
      last_check: Date.now(),
      details: `Listening to ${config.SOURCE_CHANNELS.length} channels`,
    },
    worker: {
      status: workerStatus,
      last_check: Date.now(),
      details: workerDetails,
    },
    queue: queueHealth,
    last_message_received: lastMessageTimestamp,
  };
}

async function runHealthCheck(): Promise<void> {
  const now = Date.now();
  const summary = getHealthSummary();

  // 1. Telegram Connection & Reconnect Logic
  const telegramStatus = summary.telegram.status;
  if (telegramStatus === 'DISCONNECTED') {
    if (!disconnectedSince) {
      disconnectedSince = now;
    } else if (now - disconnectedSince > 60000) {
      logger.warn('Telegram client has been disconnected for > 60 seconds. Attempting automatic reconnect...');
      try {
        await initialize();
        logger.info('Telegram client successfully reconnected');
        disconnectedSince = null;
      } catch (err: any) {
        logger.error('Failed reconnect attempt to Telegram:', err.message);
      }
    }
  } else {
    disconnectedSince = null;
  }

  // 2. Persist to health_status table
  saveHealthStatus({
    component: 'telegram',
    status: summary.telegram.status,
    last_check: now,
    details: summary.telegram.details,
  });

  saveHealthStatus({
    component: 'monitoring',
    status: summary.monitoring.status,
    last_check: now,
    details: summary.monitoring.details,
  });

  saveHealthStatus({
    component: 'worker',
    status: summary.worker.status,
    last_check: now,
    details: summary.worker.details,
  });

  saveHealthStatus({
    component: 'queue',
    status: summary.queue.size > 100 ? 'BACKLOGGED' : 'HEALTHY',
    last_check: now,
    details: JSON.stringify(summary.queue),
  });

  // 3. Emit SSE update for real-time dashboard
  sseManager.broadcast('health:update', summary);
  logger.info(`Health check passed. Telegram=${summary.telegram.status}, Queue=${summary.queue.size}, Worker=${summary.worker.status}`);
}

export function startHealthMonitor(): void {
  if (timer) return;
  const interval = config.HEARTBEAT_INTERVAL || 30000;
  logger.info(`Starting health monitor with interval ${interval}ms`);

  // Run immediate initial check
  runHealthCheck().catch((err) => logger.error('Initial health check failed:', err.message));

  timer = setInterval(() => {
    runHealthCheck().catch((err) => logger.error('Periodic health check failed:', err.message));
  }, interval);
}

export function stopHealthMonitor(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info('Health monitor stopped');
  }
}
