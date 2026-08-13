// @ts-nocheck
/**
 * PNL Workflow Handler — REAL /pnl CA → forward workflow.
 * 
 * On pump/upside detection:
 * 1. Post "/pnl REAL_CA" to private group FIRST
 * 2. Forward the /pnl message to public channel @Aires_Insider
 * 3. Forward the original call if not already forwarded
 * 4. Log everything with real message IDs
 * 
 * NEVER invent CAs. NEVER post /pnl without a real CA from the signal.
 */

import { EventEmitter } from 'events';
import { sendMessage, forwardMessage } from '../telegram/publisher.js';
import { createMapping, updateMapping, logPublish, insertPNL } from '../database/repositories.js';
import { formatPNLCommand } from '../utils/ca.js';
import config from '../config.js';
import { createLogger } from '../utils/logger.js';
import { randomUUID } from 'crypto';
import type { Signal, ClassifiedMessage } from '../types.js';

const logger = createLogger('publishing:pnl');

class PnlRouter extends EventEmitter {}

export const pnlRouter = new PnlRouter();

/**
 * Handle pump detection on a tracked signal.
 * Executes the full /pnl CA → forward workflow.
 */
export async function handlePumpDetection(
  signal: Signal,
  pumpData: { multiplier?: string; percentage?: string; rawText?: string }
): Promise<void> {
  logger.info(`Pump detected on signal ${signal.id} (ticker: ${signal.ticker || 'unknown'})`);

  // CRITICAL: We need a real CA. Never invent one.
  const ca = signal.contract_address || signal.contractAddress || signal.ca;
  if (!ca) {
    logger.warn(`Signal ${signal.id} has no contract address — cannot post /pnl. Skipping PNL workflow.`);
    pnlRouter.emit('pnl:skipped', { signalId: signal.id, reason: 'No contract address' });
    return;
  }

  const privateGroupId = config.PRIVATE_GROUP_ID;
  const publicChannel = config.PUBLIC_CHANNEL_USERNAME;

  if (!privateGroupId) {
    logger.error('PRIVATE_GROUP_ID not configured — cannot post /pnl to private group');
    pnlRouter.emit('pnl:failed', { signalId: signal.id, error: 'No private group configured' });
    return;
  }

  // Step 1: Post "/pnl REAL_CA" to the private group FIRST
  const pnlCommand = formatPNLCommand(ca);
  logger.info(`Posting PNL command to private group: ${pnlCommand}`);

  const privateResult = await sendMessage(privateGroupId, pnlCommand, {
    parseMode: 'html',
    linkPreview: false,
  });

  if (!privateResult.success || !privateResult.messageId) {
    logger.error(`Failed to post /pnl to private group: ${privateResult.error}`);
    pnlRouter.emit('pnl:failed', { signalId: signal.id, error: privateResult.error });
    return;
  }

  const privateMsgId = privateResult.messageId;
  logger.info(`/pnl posted to private group: msgId=${privateMsgId}`);

  // Log to publishing log
  await logPublish({
    id: randomUUID(),
    source_message_id: String(signal.source_message_id || ''),
    destination_chat_id: privateGroupId,
    destination_message_id: privateMsgId,
    action: 'published',
    mode: 'SMART',
    success: 1,
    error: null,
    timestamp: new Date().toISOString(),
  });

  // Record PNL in database
  await insertPNL({
    id: randomUUID(),
    signal_id: signal.id,
    message_id: String(signal.source_message_id || ''),
    multiplier: pumpData.multiplier || null,
    percentage: pumpData.percentage || null,
    contract_address: ca,
    raw_text: pumpData.rawText || '',
    detected_at: new Date().toISOString(),
  });

  pnlRouter.emit('pnl:posted', {
    signalId: signal.id,
    privateMsgId,
    command: pnlCommand,
    ca,
  });

  // Step 2: Forward the /pnl message to the public channel
  if (publicChannel) {
    logger.info(`Forwarding /pnl to public channel @${publicChannel}`);

    const forwardResults = await forwardMessage(
      privateGroupId,
      privateMsgId,
      publicChannel
    );

    const forwardSuccess = forwardResults.length > 0 && forwardResults[0].success;
    const publicMsgId = forwardResults[0]?.messageId;

    await logPublish({
      id: randomUUID(),
      source_message_id: String(privateMsgId),
      destination_chat_id: publicChannel,
      destination_message_id: publicMsgId || 0,
      action: 'forwarded',
      mode: 'SMART',
      success: forwardSuccess ? 1 : 0,
      error: forwardSuccess ? null : forwardResults[0]?.error || 'Unknown error',
      timestamp: new Date().toISOString(),
    });

    if (forwardSuccess) {
      logger.info(`/pnl forwarded to public channel: msgId=${publicMsgId}`);
      pnlRouter.emit('pnl:forwarded', {
        signalId: signal.id,
        publicMsgId,
        privateMsgId,
      });
    } else {
      logger.error(`Failed to forward /pnl to public channel: ${forwardResults[0]?.error}`);
    }
  }

  // Step 3: If the original call hasn't been forwarded to public yet, do it now
  const publicMsgIdAlready = signal.public_message_id || signal.destination_message_id;
  if (!publicMsgIdAlready && signal.source_chat_id && signal.source_message_id) {
    logger.info(`Forwarding original call to public channel`);

    const callForward = await forwardMessage(
      signal.source_chat_id,
      Number(signal.source_message_id),
      publicChannel
    );

    if (callForward.length > 0 && callForward[0].success) {
      logger.info(`Original call forwarded to public channel: msgId=${callForward[0].messageId}`);
      // Update signal with public message ID
      await updateMapping(
        signal.id,
        { public_message_id: callForward[0].messageId }
      );
    }
  }

  logger.info(`PNL workflow complete for signal ${signal.id}`);
}

/**
 * Listen for pump detection events and trigger the workflow.
 * Call this during system initialization.
 */
export function initializePnlHandler(signalTrackerEmitter: EventEmitter): void {
  signalTrackerEmitter.on('signal:pnl', async (data: { signal: Signal; pumpData: any }) => {
    try {
      await handlePumpDetection(data.signal, data.pumpData);
    } catch (err) {
      logger.error(`PNL workflow error: ${(err as Error).message}`);
      pnlRouter.emit('pnl:failed', { error: (err as Error).message });
    }
  });

  logger.info('PNL handler initialized and listening for pump events');
}
