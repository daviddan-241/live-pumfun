// @ts-nocheck
/**
 * Main Publishing Router for ARCC Telegram Intelligence & Publishing System
 */

import { EventEmitter } from 'events';
import {
  ClassifiedMessage,
  MessageClassification,
  MessageMapping,
  PublishingLog,
  Signal
} from '../types.js';
import { config } from '../config.js';
import {
  sendMessage,
  sendMedia,
  editMessage,
  pinMessage,
  TelegramPublishOptions
} from '../telegram/publisher.js';
import {
  createMapping,
  getMappingBySourceMessageId,
  logPublish,
  saveSignal,
  getSignalByCA
} from '../database/repositories.js';
import { formatForPublication, stripSourceBranding } from './formatter.js';
import { handlePumpDetection } from './pnl.js';

export const routerEventEmitter = new EventEmitter();

/**
 * Result structure returned by routing operations
 */
export interface RouteResult {
  status: 'published' | 'skipped' | 'failed';
  sourceMessageId?: string | number;
  privateMessageId?: number;
  publicMessageId?: number;
  reason?: string;
  error?: string;
  mapping?: MessageMapping;
}

/**
 * Retries an asynchronous function with backoff
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = config.MAX_RETRIES || 3,
  delayMs = config.RETRY_BACKOFF_MS || 1000
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt >= maxRetries) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs * Math.pow(2, attempt - 1)));
    }
  }
}

/**
 * Helper to determine source message ID from classified message
 */
function getSourceId(classifiedMessage: ClassifiedMessage): string | number {
  return classifiedMessage.sourceMessageId ?? classifiedMessage.id;
}

/**
 * Main publishing router function. Decides what to publish and where.
 *
 * Routing Rules:
 * 1. NEW_CALL: Publish immediately to private group (formatted with CA). Then publish to public channel.
 * 2. FOLLOW_UP: Publish to private group. Forward/publish to public channel if relevant.
 * 3. PNL_UPDATE: Trigger PNL workflow handler (/pnl to private first, then forward to public).
 * 4. REPLY: Publish to private group preserving reply relationship. Forward to public if part of active signal.
 * 5. MEDIA_POST: Download + re-upload media to private group. Forward to public if relevant.
 * 6. ANNOUNCEMENT/NEWS: Publish to both private and public.
 * 7. CHATTER/IRRELEVANT/DUPLICATE: Skip (don't publish).
 *
 * @param classifiedMessage Classified message structure
 * @param signal Optional associated signal
 * @returns RouteResult containing publishing outcome and message IDs
 */
export async function routeMessage(
  classifiedMessage: ClassifiedMessage,
  signal?: Signal
): Promise<RouteResult> {
  if (!classifiedMessage) {
    const error = 'routeMessage called with empty classifiedMessage';
    console.error(`[Router] ${error}`);
    return { status: 'failed', error };
  }

  const sourceMsgId = getSourceId(classifiedMessage);

  // Idempotency check: avoid duplicate publishing
  const existingMapping = await getMappingBySourceMessageId(sourceMsgId);
  if (existingMapping && (existingMapping.privateMessageId || existingMapping.publicMessageId)) {
    const reason = `Message ${sourceMsgId} already published (privateMsgId: ${existingMapping.privateMessageId}, publicMsgId: ${existingMapping.publicMessageId})`;
    console.log(`[Router Idempotency] ${reason}`);

    await logPublish({
      action: 'route_message_skip',
      sourceMessageId: sourceMsgId,
      classification: classifiedMessage.classification,
      status: 'skipped',
      details: { reason: 'duplicate', existingMapping },
      timestamp: new Date().toISOString()
    });

    const skipPayload = {
      messageId: sourceMsgId,
      classification: classifiedMessage.classification,
      reason: 'duplicate',
      timestamp: new Date().toISOString()
    };
    routerEventEmitter.emit('message:skipped', skipPayload);

    return {
      status: 'skipped',
      sourceMessageId: sourceMsgId,
      reason: 'duplicate',
      mapping: existingMapping
    };
  }

  const classification = classifiedMessage.classification;

  // Resolve signal if not explicitly passed but contract address is present
  let activeSignal = signal;
  if (!activeSignal && classifiedMessage.ca) {
    activeSignal = (await getSignalByCA(classifiedMessage.ca)) || undefined;
  }

  switch (classification) {
    case MessageClassification.NEW_CALL:
      return await publishCall(classifiedMessage, activeSignal);

    case MessageClassification.PNL_UPDATE: {
      let targetSignal = activeSignal;
      if (!targetSignal && classifiedMessage.ca) {
        targetSignal = { id: `sig_${Date.now()}`, ca: classifiedMessage.ca } as Signal;
      }
      if (!targetSignal) {
        const error = 'PNL_UPDATE received without signal or CA';
        console.warn(`[Router] ${error}`);
        await logPublish({
          action: 'route_pnl_skip',
          sourceMessageId: sourceMsgId,
          classification,
          status: 'skipped',
          error,
          timestamp: new Date().toISOString()
        });
        routerEventEmitter.emit('message:skipped', {
          messageId: sourceMsgId,
          classification,
          reason: 'missing_signal_ca',
          timestamp: new Date().toISOString()
        });
        return { status: 'skipped', sourceMessageId: sourceMsgId, reason: 'missing_signal_ca' };
      }

      const pnlResult = await handlePumpDetection(targetSignal, { isPump: true });
      if (pnlResult.success) {
        const mapping = await createMapping({
          sourceMessageId: sourceMsgId,
          privateMessageId: pnlResult.privateMessageId,
          publicMessageId: pnlResult.publicMessageId,
          signalId: targetSignal.id
        });
        routerEventEmitter.emit('message:published', {
          messageId: sourceMsgId,
          classification,
          privateMessageId: pnlResult.privateMessageId,
          publicMessageId: pnlResult.publicMessageId,
          signalId: targetSignal.id,
          timestamp: new Date().toISOString()
        });
        return {
          status: 'published',
          sourceMessageId: sourceMsgId,
          privateMessageId: pnlResult.privateMessageId,
          publicMessageId: pnlResult.publicMessageId,
          mapping
        };
      } else {
        routerEventEmitter.emit('message:failed', {
          messageId: sourceMsgId,
          classification,
          error: pnlResult.error,
          timestamp: new Date().toISOString()
        });
        return { status: 'failed', sourceMessageId: sourceMsgId, error: pnlResult.error };
      }
    }

    case MessageClassification.FOLLOW_UP:
    case MessageClassification.REPLY:
    case MessageClassification.MEDIA_POST:
    case MessageClassification.ANNOUNCEMENT:
    case MessageClassification.NEWS:
      return await forwardToDestinations(classifiedMessage, activeSignal);

    case MessageClassification.CHATTER:
    case MessageClassification.IRRELEVANT:
    case MessageClassification.DUPLICATE:
    default: {
      const reason = `Skipping non-publishable classification: ${classification}`;
      console.log(`[Router] ${reason}`);
      await logPublish({
        action: 'route_message_skip',
        sourceMessageId: sourceMsgId,
        classification,
        status: 'skipped',
        details: { reason: 'filtered_classification' },
        timestamp: new Date().toISOString()
      });
      routerEventEmitter.emit('message:skipped', {
        messageId: sourceMsgId,
        classification,
        reason: 'filtered_classification',
        timestamp: new Date().toISOString()
      });
      return { status: 'skipped', sourceMessageId: sourceMsgId, reason };
    }
  }
}

/**
 * Immediate call drop workflow for NEW_CALL messages.
 * Formats message with ARCC branding, posts to private group and public channel immediately.
 *
 * @param classifiedMessage Classified NEW_CALL message
 * @param signal Associated signal object if available
 * @returns RouteResult with published message IDs
 */
export async function publishCall(
  classifiedMessage: ClassifiedMessage,
  signal?: Signal
): Promise<RouteResult> {
  const sourceMsgId = getSourceId(classifiedMessage);
  const formattedText = formatForPublication(classifiedMessage, signal, 'HTML');

  const privateGroupId = config.PRIVATE_GROUP_ID;
  const publicChannelUsername = config.PUBLIC_CHANNEL_USERNAME;

  let privateMessageId: number | undefined;
  let publicMessageId: number | undefined;
  let hasError = false;
  let errorMessage: string | undefined;

  // 1. Send to private group immediately
  try {
    const opts: TelegramPublishOptions = { parse_mode: 'HTML' };
    let privateRes;
    if (classifiedMessage.media?.buffer) {
      privateRes = await withRetry(async () => {
        return await sendMedia(privateGroupId, classifiedMessage.media!.buffer!, {
          ...opts,
          caption: formattedText
        });
      });
    } else {
      privateRes = await withRetry(async () => {
        return await sendMessage(privateGroupId, formattedText, opts);
      });
    }
    privateMessageId = privateRes.message_id;
  } catch (err: any) {
    hasError = true;
    errorMessage = `Failed to publish call to private group: ${err.message || String(err)}`;
    console.error(`[PublishCall Error] ${errorMessage}`);
  }

  // 2. Send to public channel immediately
  try {
    const opts: TelegramPublishOptions = { parse_mode: 'HTML' };
    let publicRes;
    if (classifiedMessage.media?.buffer) {
      publicRes = await withRetry(async () => {
        return await sendMedia(publicChannelUsername, classifiedMessage.media!.buffer!, {
          ...opts,
          caption: formattedText
        });
      });
    } else {
      publicRes = await withRetry(async () => {
        return await sendMessage(publicChannelUsername, formattedText, opts);
      });
    }
    publicMessageId = publicRes.message_id;
  } catch (err: any) {
    hasError = true;
    const pubErr = `Failed to publish call to public channel: ${err.message || String(err)}`;
    console.error(`[PublishCall Error] ${pubErr}`);
    if (!errorMessage) errorMessage = pubErr;
  }

  if (!privateMessageId && !publicMessageId) {
    await logPublish({
      action: 'publish_call',
      sourceMessageId: sourceMsgId,
      classification: MessageClassification.NEW_CALL,
      status: 'failed',
      error: errorMessage,
      timestamp: new Date().toISOString()
    });
    routerEventEmitter.emit('message:failed', {
      messageId: sourceMsgId,
      classification: MessageClassification.NEW_CALL,
      error: errorMessage,
      timestamp: new Date().toISOString()
    });
    return { status: 'failed', sourceMessageId: sourceMsgId, error: errorMessage };
  }

  // 3. Create message mapping for both destinations
  const mapping = await createMapping({
    sourceMessageId: sourceMsgId,
    privateMessageId,
    publicMessageId,
    signalId: signal?.id
  });

  // 4. Update signal if exists
  if (signal) {
    await saveSignal({
      ...signal,
      privateCallMessageId: privateMessageId || signal.privateCallMessageId,
      publicCallMessageId: publicMessageId || signal.publicCallMessageId,
      initialCallMessageId: privateMessageId || signal.initialCallMessageId
    });
  }

  const overallStatus = hasError ? 'partial' : 'success';

  await logPublish({
    action: 'publish_call',
    sourceMessageId: sourceMsgId,
    classification: MessageClassification.NEW_CALL,
    destination: 'both',
    privateMessageId,
    publicMessageId,
    status: overallStatus,
    error: errorMessage,
    timestamp: new Date().toISOString()
  });

  routerEventEmitter.emit('message:published', {
    messageId: sourceMsgId,
    classification: MessageClassification.NEW_CALL,
    privateMessageId,
    publicMessageId,
    signalId: signal?.id,
    timestamp: new Date().toISOString()
  });

  return {
    status: 'published',
    sourceMessageId: sourceMsgId,
    privateMessageId,
    publicMessageId,
    mapping
  };
}

/**
 * General forwarding/publishing for non-call content (FOLLOW_UP, REPLY, MEDIA_POST, ANNOUNCEMENT, NEWS).
 *
 * @param classifiedMessage Classified message
 * @param signal Optional active signal
 * @returns RouteResult
 */
export async function forwardToDestinations(
  classifiedMessage: ClassifiedMessage,
  signal?: Signal
): Promise<RouteResult> {
  const sourceMsgId = getSourceId(classifiedMessage);
  const classification = classifiedMessage.classification;
  const formattedText = formatForPublication(classifiedMessage, signal, 'HTML');

  // Determine target destinations
  const sendToPrivate = true; // Always send relevant non-call content to private group
  let sendToPublic = false;

  if (
    classification === MessageClassification.ANNOUNCEMENT ||
    classification === MessageClassification.NEWS ||
    classifiedMessage.isHighValue ||
    classifiedMessage.isVIPContent ||
    classifiedMessage.isProof ||
    (signal && signal.status === 'ACTIVE')
  ) {
    sendToPublic = true;
  }

  // Reply mapping lookup
  let replyToPrivateMsgId: number | undefined;
  let replyToPublicMsgId: number | undefined;

  if (classifiedMessage.replyToMessageId) {
    const replyMapping = await getMappingBySourceMessageId(classifiedMessage.replyToMessageId);
    if (replyMapping) {
      replyToPrivateMsgId = replyMapping.privateMessageId;
      replyToPublicMsgId = replyMapping.publicMessageId;
    }
  }

  const privateGroupId = config.PRIVATE_GROUP_ID;
  const publicChannelUsername = config.PUBLIC_CHANNEL_USERNAME;

  let privateMessageId: number | undefined;
  let publicMessageId: number | undefined;
  let lastError: string | undefined;

  // Publish to Private Group
  if (sendToPrivate) {
    try {
      const opts: TelegramPublishOptions = {
        parse_mode: 'HTML',
        reply_to_message_id: replyToPrivateMsgId
      };

      let res;
      if (classifiedMessage.media?.buffer) {
        res = await withRetry(async () => {
          return await sendMedia(privateGroupId, classifiedMessage.media!.buffer!, {
            ...opts,
            caption: formattedText
          });
        });
      } else {
        res = await withRetry(async () => {
          return await sendMessage(privateGroupId, formattedText, opts);
        });
      }
      privateMessageId = res.message_id;
    } catch (err: any) {
      lastError = `Failed to publish to private group: ${err.message || String(err)}`;
      console.error(`[ForwardToDestinations Error] ${lastError}`);
    }
  }

  // Publish to Public Channel
  if (sendToPublic) {
    try {
      const opts: TelegramPublishOptions = {
        parse_mode: 'HTML',
        reply_to_message_id: replyToPublicMsgId
      };

      let res;
      if (classifiedMessage.media?.buffer) {
        res = await withRetry(async () => {
          return await sendMedia(publicChannelUsername, classifiedMessage.media!.buffer!, {
            ...opts,
            caption: formattedText
          });
        });
      } else {
        res = await withRetry(async () => {
          return await sendMessage(publicChannelUsername, formattedText, opts);
        });
      }
      publicMessageId = res.message_id;
    } catch (err: any) {
      const pubErr = `Failed to publish to public channel: ${err.message || String(err)}`;
      console.error(`[ForwardToDestinations Error] ${pubErr}`);
      if (!lastError) lastError = pubErr;
    }
  }

  if (!privateMessageId && !publicMessageId) {
    await logPublish({
      action: 'forward_destinations',
      sourceMessageId: sourceMsgId,
      classification,
      status: 'failed',
      error: lastError,
      timestamp: new Date().toISOString()
    });
    routerEventEmitter.emit('message:failed', {
      messageId: sourceMsgId,
      classification,
      error: lastError,
      timestamp: new Date().toISOString()
    });
    return { status: 'failed', sourceMessageId: sourceMsgId, error: lastError };
  }

  const mapping = await createMapping({
    sourceMessageId: sourceMsgId,
    privateMessageId,
    publicMessageId,
    signalId: signal?.id
  });

  await logPublish({
    action: 'forward_destinations',
    sourceMessageId: sourceMsgId,
    classification,
    destination: sendToPublic ? 'both' : 'private',
    privateMessageId,
    publicMessageId,
    status: lastError ? 'partial' : 'success',
    error: lastError,
    timestamp: new Date().toISOString()
  });

  routerEventEmitter.emit('message:published', {
    messageId: sourceMsgId,
    classification,
    privateMessageId,
    publicMessageId,
    signalId: signal?.id,
    timestamp: new Date().toISOString()
  });

  return {
    status: 'published',
    sourceMessageId: sourceMsgId,
    privateMessageId,
    publicMessageId,
    mapping
  };
}

/**
 * Handles message edit event from source channel.
 * Finds mapped destination messages and updates them with edited text.
 *
 * @param sourceMessageId ID of edited message in source
 * @param newText Updated raw text content
 * @returns Result object
 */
export async function handleEdit(
  sourceMessageId: number | string,
  newText: string
): Promise<{ success: boolean; editedPrivate?: boolean; editedPublic?: boolean; error?: string }> {
  const mapping = await getMappingBySourceMessageId(sourceMessageId);

  if (!mapping) {
    const error = `No mapping found for edited source message ${sourceMessageId}`;
    console.warn(`[HandleEdit] ${error}`);
    await logPublish({
      action: 'edit_message_skip',
      sourceMessageId,
      status: 'skipped',
      error,
      timestamp: new Date().toISOString()
    });
    return { success: false, error };
  }

  const cleanedText = stripSourceBranding(newText);
  let editedPrivate = false;
  let editedPublic = false;
  let lastError: string | undefined;

  if (mapping.privateMessageId) {
    try {
      await editMessage(config.PRIVATE_GROUP_ID, mapping.privateMessageId, cleanedText, { parse_mode: 'HTML' });
      editedPrivate = true;
    } catch (err: any) {
      lastError = `Failed to edit private message ${mapping.privateMessageId}: ${err.message || String(err)}`;
      console.error(`[HandleEdit Error] ${lastError}`);
    }
  }

  if (mapping.publicMessageId) {
    try {
      await editMessage(config.PUBLIC_CHANNEL_USERNAME, mapping.publicMessageId, cleanedText, { parse_mode: 'HTML' });
      editedPublic = true;
    } catch (err: any) {
      const errStr = `Failed to edit public message ${mapping.publicMessageId}: ${err.message || String(err)}`;
      console.error(`[HandleEdit Error] ${errStr}`);
      if (!lastError) lastError = errStr;
    }
  }

  const success = editedPrivate || editedPublic;

  await logPublish({
    action: 'handle_edit',
    sourceMessageId,
    privateMessageId: mapping.privateMessageId,
    publicMessageId: mapping.publicMessageId,
    status: success ? 'success' : 'failed',
    error: lastError,
    details: { editedPrivate, editedPublic },
    timestamp: new Date().toISOString()
  });

  return { success, editedPrivate, editedPublic, error: lastError };
}

/**
 * Handles message pin event from source channel.
 * Finds mapped destination messages and pins them in destination channels.
 *
 * @param sourceMessageId ID of pinned message in source
 * @returns Result object
 */
export async function handlePin(
  sourceMessageId: number | string
): Promise<{ success: boolean; pinnedPrivate?: boolean; pinnedPublic?: boolean; error?: string }> {
  const mapping = await getMappingBySourceMessageId(sourceMessageId);

  if (!mapping) {
    const error = `No mapping found for pinned source message ${sourceMessageId}`;
    console.warn(`[HandlePin] ${error}`);
    await logPublish({
      action: 'pin_message_skip',
      sourceMessageId,
      status: 'skipped',
      error,
      timestamp: new Date().toISOString()
    });
    return { success: false, error };
  }

  let pinnedPrivate = false;
  let pinnedPublic = false;
  let lastError: string | undefined;

  if (mapping.privateMessageId) {
    try {
      await pinMessage(config.PRIVATE_GROUP_ID, mapping.privateMessageId);
      pinnedPrivate = true;
    } catch (err: any) {
      lastError = `Failed to pin private message ${mapping.privateMessageId}: ${err.message || String(err)}`;
      console.error(`[HandlePin Error] ${lastError}`);
    }
  }

  if (mapping.publicMessageId) {
    try {
      await pinMessage(config.PUBLIC_CHANNEL_USERNAME, mapping.publicMessageId);
      pinnedPublic = true;
    } catch (err: any) {
      const errStr = `Failed to pin public message ${mapping.publicMessageId}: ${err.message || String(err)}`;
      console.error(`[HandlePin Error] ${errStr}`);
      if (!lastError) lastError = errStr;
    }
  }

  const success = pinnedPrivate || pinnedPublic;

  await logPublish({
    action: 'handle_pin',
    sourceMessageId,
    privateMessageId: mapping.privateMessageId,
    publicMessageId: mapping.publicMessageId,
    status: success ? 'success' : 'failed',
    error: lastError,
    details: { pinnedPrivate, pinnedPublic },
    timestamp: new Date().toISOString()
  });

  return { success, pinnedPrivate, pinnedPublic, error: lastError };
}
