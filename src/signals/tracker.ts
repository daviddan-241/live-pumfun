// @ts-nocheck
/**
 * Signal Tracking & Lifecycle Engine.
 *
 * Manages active signal states, updates follow-ups and PnL records, links
 * cross-source trading calls, emits real-time events, and syncs with DB repositories.
 */

import { EventEmitter } from 'events';
import {
  addFollowUp,
  addPNL,
  createSignal,
  getActiveSignals,
  getMessageBySource,
  getSignalByCA,
  getSignalById,
  getSignalByTicker,
  updateSignal,
  updateSignalStatus,
} from '../database/repositories.js';
import {
  ClassifiedMessage,
  FollowUpRecord,
  LinkedSignalsResult,
  MessageClassification,
  PNLRecord,
  Signal,
  SignalLifecycle,
  SignalStatus,
} from '../types.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Tracker');

/**
 * Signal Tracker EventEmitter class for emitting real-time signal life-cycle events.
 */
export class SignalTracker extends EventEmitter {}

export const signalTracker = new SignalTracker();

// Fast in-memory lookup cache for active signals
const activeSignalsCache = new Map<string, Signal>();

/**
 * Synchronizes in-memory cache with database repository.
 */
export async function syncActiveSignalsCache(): Promise<void> {
  try {
    const active = await getActiveSignals();
    activeSignalsCache.clear();
    for (const signal of active) {
      activeSignalsCache.set(signal.id, signal);
    }
    logger.debug(`Synced ${activeSignalsCache.size} active signals into memory cache.`);
  } catch (err: any) {
    logger.error(`Error syncing active signals cache: ${err.message}`);
  }
}

/**
 * Finds an active signal matching ticker, CA, or source chat.
 *
 * @param ticker - Symbol ticker (case-insensitive)
 * @param ca - Smart contract address
 * @param sourceChatId - Source channel or chat ID
 * @returns Matching Signal or null
 */
export async function findMatchingSignal(
  ticker?: string,
  ca?: string,
  sourceChatId?: string
): Promise<Signal | null> {
  // 1. Search by Contract Address
  if (ca) {
    const cleanCa = ca.trim().toLowerCase();
    for (const signal of activeSignalsCache.values()) {
      const signalCa = (signal.contract_address || signal.contractAddress || signal.ca || '').toLowerCase();
      if (signalCa === cleanCa && signal.status !== SignalStatus.CLOSED) {
        return signal;
      }
    }
    const dbSignal = await getSignalByCA(ca);
    if (dbSignal && dbSignal.status !== SignalStatus.CLOSED) {
      activeSignalsCache.set(dbSignal.id, dbSignal);
      return dbSignal;
    }
  }

  // 2. Search by Ticker
  if (ticker) {
    const cleanTicker = ticker.trim().toUpperCase();
    for (const signal of activeSignalsCache.values()) {
      const signalTicker = (signal.ticker || signal.tokenSymbol || '').toUpperCase();
      if (signalTicker === cleanTicker && signal.status !== SignalStatus.CLOSED) {
        if (!sourceChatId || signal.source_chat_id === sourceChatId || signal.sourceChannelId === sourceChatId) {
          return signal;
        }
      }
    }
    const dbSignal = await getSignalByTicker(ticker);
    if (dbSignal && dbSignal.status !== SignalStatus.CLOSED) {
      activeSignalsCache.set(dbSignal.id, dbSignal);
      return dbSignal;
    }
  }

  return null;
}

/**
 * Main handler to create or update signals based on a classified message.
 *
 * @param classifiedMessage - Result from classification pipeline
 * @returns Created or updated Signal object, or null
 */
export async function trackSignal(classifiedMessage: ClassifiedMessage): Promise<Signal | null> {
  if (!classifiedMessage) return null;

  const msg = classifiedMessage.message || classifiedMessage;
  const classification = classifiedMessage.classification;
  const extracted = classifiedMessage.extracted || {};
  const ticker = extracted.ticker || classifiedMessage.tokenSymbol || 'UNKNOWN';
  const caList = extracted.contract_addresses || [];
  const primaryCA = caList[0]?.address || classifiedMessage.contractAddress || extracted.contractAddress || '';
  const sourceChatId = String(msg.source_chat_id || msg.sourceChannelId || '');
  const msgId = msg.telegramMessageId || msg.message_id || msg.id;

  logger.info(`Tracking signal for message classification: ${classification}`);

  switch (classification) {
    case MessageClassification.NEW_CALL: {
      const newSignal = await createSignal({
        ticker,
        tokenSymbol: ticker,
        contract_address: primaryCA,
        contractAddress: primaryCA,
        ca: primaryCA,
        chain: extracted.chain || classifiedMessage.chain || 'solana',
        status: SignalStatus.NEW,
        source_chat_id: sourceChatId,
        sourceChannelId: sourceChatId,
        source_chat_name: msg.source_chat_title || msg.sourceChannelName || '',
        initial_message_id: msgId,
        initialMessageId: String(msgId),
        initial_message_text: msg.text,
        follow_up_count: 0,
        reply_chain: [msgId],
        pnl_records: [],
        follow_ups: [],
        entryPrice: extracted.entryPrice,
        targetPrices: extracted.targetPrices,
        stopLoss: extracted.stopLoss,
      });

      activeSignalsCache.set(newSignal.id, newSignal);
      signalTracker.emit('signal:new', newSignal, classifiedMessage);
      logger.info(`[SIGNAL:NEW] Created signal ${newSignal.id} for ticker ${ticker}`);
      return newSignal;
    }

    case MessageClassification.FOLLOW_UP: {
      const match = await findMatchingSignal(ticker, primaryCA, sourceChatId);
      if (!match) {
        logger.warn(`Follow-up message received but no matching signal found for ${ticker}`);
        return null;
      }

      const followUp: FollowUpRecord = {
        signal_id: match.id,
        signalId: match.id,
        message_id: msgId,
        text: msg.text,
        author_username: msg.author_username || msg.senderId,
        timestamp: new Date().toISOString(),
      };

      const updated = await addFollowUp(match.id, followUp);
      if (updated) {
        activeSignalsCache.set(updated.id, updated);
        signalTracker.emit('signal:followup', updated, classifiedMessage);
        logger.info(`[SIGNAL:FOLLOWUP] Updated signal ${updated.id} follow-up count to ${updated.follow_up_count}`);
        return updated;
      }
      return match;
    }

    case MessageClassification.PNL_UPDATE: {
      const match = await findMatchingSignal(ticker, primaryCA, sourceChatId);
      if (!match) {
        logger.warn(`PNL update received but no matching signal found for ${ticker}`);
        return null;
      }

      const pnlRecord: PNLRecord = {
        signal_id: match.id,
        signalId: match.id,
        tokenSymbol: match.ticker,
        multiplier: extracted.multiplier,
        percentage: extracted.percentage,
        text: msg.text,
        message_id: msgId,
        timestamp: new Date().toISOString(),
        isRealized: true,
      };

      const updated = await addPNL(match.id, pnlRecord);
      if (updated) {
        activeSignalsCache.set(updated.id, updated);
        signalTracker.emit('signal:pnl', updated, classifiedMessage);
        logger.info(`[SIGNAL:PNL] Updated PnL for signal ${updated.id}`);
        return updated;
      }
      return match;
    }

    case MessageClassification.CA_UPDATE: {
      const match = await findMatchingSignal(ticker, undefined, sourceChatId);
      if (!match) return null;

      const updated = await updateSignal(match.id, {
        contract_address: primaryCA,
        contractAddress: primaryCA,
        ca: primaryCA,
      });

      if (updated) {
        activeSignalsCache.set(updated.id, updated);
        signalTracker.emit('signal:update', updated, classifiedMessage);
        logger.info(`[SIGNAL:UPDATE] Updated CA for signal ${updated.id} to ${primaryCA}`);
        return updated;
      }
      return match;
    }

    default:
      return null;
  }
}

/**
 * Marks a signal as CLOSED and removes it from active in-memory lookups.
 *
 * @param signalId - ID of signal to close
 * @returns Updated closed Signal object
 */
export async function closeSignal(signalId: string): Promise<Signal | null> {
  const updated = await updateSignalStatus(signalId, SignalStatus.CLOSED);
  if (updated) {
    activeSignalsCache.delete(signalId);
    logger.info(`Closed signal ${signalId}`);
  }
  return updated;
}

/**
 * Fetches complete signal lifecycle history (initial call, messages, follow-ups, PnL records).
 *
 * @param signalId - Signal ID
 * @returns SignalLifecycle record or null
 */
export async function getSignalLifecycle(signalId: string): Promise<SignalLifecycle | null> {
  const signal = await getSignalById(signalId);
  if (!signal) return null;

  const initialMsg = await getMessageBySource(signal.source_chat_id, signal.initial_message_id);

  return {
    signal,
    initialMessage: initialMsg,
    messages: initialMsg ? [initialMsg] : [],
    followUps: signal.follow_ups || [],
    pnlRecords: signal.pnl_records || [],
  };
}

/**
 * Identifies duplicate trading signals across different source channels and links them together.
 *
 * @returns LinkedSignalsResult summary with counts and mapping dictionary
 */
export async function linkCrossSourceSignals(): Promise<LinkedSignalsResult> {
  const active = await getActiveSignals();
  const grouped = new Map<string, Signal[]>();

  // Group active signals by combination of Ticker + Contract Address
  for (const sig of active) {
    const key = `${sig.ticker.toUpperCase()}:${(sig.contract_address || sig.ca || '').toLowerCase()}`;
    const group = grouped.get(key) || [];
    group.push(sig);
    grouped.set(key, group);
  }

  let linkedGroupsCount = 0;
  const linkedSignalMap: Record<string, string[]> = {};

  for (const [key, group] of grouped.entries()) {
    if (group.length > 1) {
      linkedGroupsCount++;
      const groupIds = group.map((s) => s.id);
      linkedSignalMap[key] = groupIds;

      for (const sig of group) {
        await updateSignal(sig.id, { linked_signal_ids: groupIds });
        sig.linked_signal_ids = groupIds;
        if (activeSignalsCache.has(sig.id)) {
          activeSignalsCache.get(sig.id)!.linked_signal_ids = groupIds;
        }
      }
    }
  }

  logger.info(`Linked ${linkedGroupsCount} cross-source signal groups.`);
  return {
    linkedGroupsCount,
    linkedSignalMap,
  };
}

export default signalTracker;
