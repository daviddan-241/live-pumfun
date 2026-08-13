// @ts-nocheck
import { queueManager, QueueJob } from './queue.js';
import { classifyMessage } from '../classifier/classifier.js';
import { trackSignal } from '../signals/tracker.js';
import { routeMessage } from '../publishing/router.js';
import { handlePumpDetection } from '../publishing/pnl.js';
import { sseManager } from '../dashboard/sse.js';
import { updateMessageStatus, savePublishingLog, savePnlRecord, saveSignal, saveLog } from '../database/repositories.js';
import config from '../config.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('WorkerProcessor');

let isWorkerRunning = false;
let activeWorkerCount = 0;
let loopInterval: NodeJS.Timeout | null = null;

function detectPumpLanguage(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  const pumpKeywords = ['pump', 'ath', 'moon', 'pnl', 'profit', 'up ', 'gain', '2x', '3x', '5x', '10x', '100x', '%'];
  return pumpKeywords.some(keyword => lower.includes(keyword)) || /([0-9]+%)/.test(text);
}

/**
 * Process a single job through the intelligence pipeline
 */
async function processJob(job: QueueJob): Promise<void> {
  logger.info(`Starting processing job ${job.id} for message ${job.messageId}`);
  updateMessageStatus(job.messageId, 'processing');

  try {
    const rawMessage = job.payload.message || job.payload;
    const context = job.payload.context;

    // 1. Classification
    const classifiedMessage = await classifyMessage(rawMessage, context);
    logger.info(`Message ${job.messageId} classified as ${classifiedMessage.classification} (confidence: ${classifiedMessage.confidence})`);
    
    updateMessageStatus(job.messageId, 'classified', classifiedMessage.classification, classifiedMessage.confidence);
    sseManager.broadcast('message:classified', classifiedMessage);

    // 2. Signal Tracker
    const signal = await trackSignal(classifiedMessage);
    if (signal) {
      saveSignal({
        id: signal.id,
        ticker: signal.ticker,
        contract_address: signal.contractAddress,
        status: signal.status,
        source_id: signal.sourceId,
        followup_count: signal.followupCount || 1,
        pnl_percentage: signal.pnlPercentage || 0,
        created_at: signal.createdAt || Date.now(),
      });

      if (classifiedMessage.classification === 'NEW_CALL') {
        sseManager.broadcast('signal:new', signal);
      } else {
        sseManager.broadcast('signal:update', signal);
      }
    }

    // 3. Pump detection check for FOLLOW_UP or PNL_UPDATE
    const isPump = detectPumpLanguage(classifiedMessage.text);
    if (classifiedMessage.classification === 'PNL_UPDATE' || (classifiedMessage.classification === 'FOLLOW_UP' && isPump)) {
      logger.info(`Pump detected for signal ${signal?.ticker || 'UNKNOWN'}. Triggering PNL workflow.`);
      
      const pumpData = {
        ticker: signal?.ticker || classifiedMessage.ticker,
        gain: isPump ? 50 : 20,
        details: `Pump detected via worker pipeline: ${classifiedMessage.text.substring(0, 80)}...`,
      };

      await handlePumpDetection(signal, pumpData);
      
      const pnlRecord = {
        id: `pnl_${Date.now()}`,
        signal_id: signal?.id || 'unknown',
        ticker: pumpData.ticker || 'UNKNOWN',
        gain_percentage: pumpData.gain,
        details: pumpData.details,
        created_at: Date.now(),
      };
      savePnlRecord(pnlRecord);
      sseManager.broadcast('pnl:posted', pnlRecord);
    }

    // 4. Publishing Router
    if (classifiedMessage.classification === 'NEW_CALL') {
      logger.info(`NEW_CALL detected. Immediate routing for job ${job.id}`);
    }

    const routeResult = await routeMessage(classifiedMessage, signal);

    if (routeResult.status === 'published') {
      updateMessageStatus(job.messageId, 'published');
      savePublishingLog({
        id: `pub_${Date.now()}`,
        message_id: job.messageId,
        channel: routeResult.channel || 'PUBLIC_CHANNEL',
        status: 'SUCCESS',
        created_at: Date.now(),
      });
      sseManager.broadcast('message:published', { job, classifiedMessage, routeResult });
    } else if (routeResult.status === 'skipped') {
      updateMessageStatus(job.messageId, 'skipped');
      sseManager.broadcast('message:skipped', { job, classifiedMessage, routeResult });
    } else {
      updateMessageStatus(job.messageId, 'failed');
      savePublishingLog({
        id: `pub_${Date.now()}`,
        message_id: job.messageId,
        channel: routeResult.channel || 'PUBLIC_CHANNEL',
        status: 'FAILED',
        error: routeResult.reason || 'Routing failed',
        created_at: Date.now(),
      });
      sseManager.broadcast('message:failed', { job, classifiedMessage, routeResult });
    }

    queueManager.markComplete(job.id);
    logger.info(`Job ${job.id} processed successfully.`);

  } catch (error: any) {
    logger.error(`Error processing job ${job.id}: ${error.message}`);
    
    saveLog({
      id: `log_${Date.now()}`,
      level: 'ERROR',
      component: 'WorkerProcessor',
      message: `Job ${job.id} failed: ${error.message}`,
      timestamp: Date.now(),
    });

    // Exponential backoff delay before marking failed for retry
    const backoffMs = Math.min(Math.pow(2, job.retryCount) * 1000, 30000);
    await new Promise((resolve) => setTimeout(resolve, backoffMs));

    queueManager.markFailed(job.id, error.message);
  }
}

/**
 * Worker scheduling loop
 */
function runWorkerLoop(): void {
  const maxConcurrency = config.WORKER_CONCURRENCY || 4;

  while (isWorkerRunning && activeWorkerCount < maxConcurrency) {
    const job = queueManager.dequeue();
    if (!job) {
      break;
    }

    activeWorkerCount++;
    processJob(job).finally(() => {
      activeWorkerCount--;
    });
  }
}

export function startWorkers(): void {
  if (isWorkerRunning) {
    logger.info('Workers are already running');
    return;
  }

  isWorkerRunning = true;
  logger.info(`Starting worker pool with concurrency ${config.WORKER_CONCURRENCY || 4}`);

  // Poll queue every 200ms
  loopInterval = setInterval(() => {
    if (isWorkerRunning) {
      runWorkerLoop();
    }
  }, 200);
}

export function stopWorkers(): Promise<void> {
  return new Promise((resolve) => {
    logger.info('Stopping worker pool...');
    isWorkerRunning = false;

    if (loopInterval) {
      clearInterval(loopInterval);
      loopInterval = null;
    }

    const checkDrain = setInterval(() => {
      if (activeWorkerCount === 0) {
        clearInterval(checkDrain);
        logger.info('All active worker jobs completed. Workers stopped.');
        resolve();
      }
    }, 100);

    // Timeout safety after 10s
    setTimeout(() => {
      clearInterval(checkDrain);
      logger.warn('Worker shutdown forced after timeout');
      resolve();
    }, 10000);
  });
}
