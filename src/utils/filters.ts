// @ts-nocheck
/**
 * Content Filtering & Anti-Rubbish Utilities.
 *
 * Evaluates message relevance, calculates confidence scores, identifies duplicates,
 * detects pump/profit language, and determines if a message meets publishing thresholds.
 */

import { FilterContext, IncomingMessage } from '../types.js';
import { detectContractAddresses, extractTicker } from './ca.js';

export interface PumpLanguageResult {
  hasPumpLanguage: boolean;
  multiplier?: number;
  percentage?: number;
}

const GREETING_PATTERNS = /\b(hi|hello|gm|gn|good morning|good night|hey|yo|sup|wagmi)\b/i;
const CHATTER_PATTERNS = /\b(lol|haha|lmao|wdyt|who|what|why|yeah|nah|agree|thoughts|bro|dude|fyi)\b/i;
const SPAM_PATTERNS = /\b(guaranteed|airdrop|claim now|1000x easy|free money|presale|click here|t.me\/|\.site|\.xyz)\b/i;
const PUMP_KEYWORDS = [
  '2x', '3x', '5x', '10x', '100x', '+180%', 'looking strong',
  'ath', 'off dip', 'multiplier', 'moon', 'pump', 'up only',
  'sent it', 'raging', 'flying', 'sending', 'gains', 'running',
];

/**
 * Detects pump, profit, or upside language in text and extracts multipliers or percentages.
 *
 * @param text - Raw message text to analyze
 * @returns Object with hasPumpLanguage boolean and optional multiplier/percentage values
 */
export function detectPumpLanguage(text: string): PumpLanguageResult {
  if (!text || typeof text !== 'string') {
    return { hasPumpLanguage: false };
  }

  const lower = text.toLowerCase();
  let multiplier: number | undefined;
  let percentage: number | undefined;
  let hasPumpLanguage = false;

  // Check for multiplier language like "2x", "3.5x", "10x"
  const multMatch = text.match(/(\d+(?:\.\d+)?)\s*x\b/i);
  if (multMatch) {
    multiplier = parseFloat(multMatch[1]);
    if (multiplier >= 1.2) {
      hasPumpLanguage = true;
    }
  }

  // Check for percentage gains like "+180%", "50% up", "+50%"
  const pctMatch = text.match(/(?:\+|\b)(\d+(?:\.\d+)?)\s*%/);
  if (pctMatch) {
    percentage = parseFloat(pctMatch[1]);
    if (percentage >= 15) {
      hasPumpLanguage = true;
    }
  }

  // Check explicit pump keywords
  for (const kw of PUMP_KEYWORDS) {
    if (lower.includes(kw)) {
      hasPumpLanguage = true;
      break;
    }
  }

  return {
    hasPumpLanguage,
    multiplier,
    percentage,
  };
}

/**
 * Detects if a message represents a PNL (Profit & Loss) or profit update.
 *
 * @param text - Message text to check
 * @returns True if message contains PNL update indicators
 */
export function isPNLUpdate(text: string): boolean {
  if (!text || typeof text !== 'string') {
    return false;
  }

  const lower = text.toLowerCase();

  // Explicit PNL terms
  if (/\b(pnl|profit|gains|result|results|realized|unrealized|x off entry|up big)\b/i.test(lower)) {
    return true;
  }

  // Pump language with extracted multiplier or percentage
  const pumpInfo = detectPumpLanguage(text);
  if (pumpInfo.hasPumpLanguage && (pumpInfo.multiplier || pumpInfo.percentage)) {
    return true;
  }

  return false;
}

/**
 * Detects if a message is a new trading call/signal.
 *
 * @param text - Message text to evaluate
 * @returns True if message fits a call structure
 */
export function isCall(text: string): boolean {
  if (!text || typeof text !== 'string') {
    return false;
  }

  const lower = text.toLowerCase();

  // Call action terms
  const hasCallKeywords = /\b(calling|new call|entry|buy|long|ca:|contract address|target|stop loss)\b/i.test(lower);

  // Check if text has both a ticker and contract address
  const hasTicker = extractTicker(text) !== null;
  const hasCA = detectContractAddresses(text).length > 0;

  if (hasCallKeywords && (hasTicker || hasCA)) {
    return true;
  }

  if (hasTicker && hasCA) {
    return true;
  }

  return false;
}

/**
 * Checks if a message is a duplicate of a recently processed message.
 *
 * @param message - Message to check
 * @param recentMessages - Array of recent incoming messages
 * @returns True if message is a duplicate
 */
export function isDuplicate(message: IncomingMessage, recentMessages: IncomingMessage[] = []): boolean {
  if (!message || !recentMessages || recentMessages.length === 0) {
    return false;
  }

  const normText = message.text ? message.text.trim().toLowerCase().replace(/\s+/g, ' ') : '';
  const msgId = message.telegramMessageId || message.message_id || message.id;

  for (const recent of recentMessages) {
    // Skip comparing message against itself
    const recentId = recent.telegramMessageId || recent.message_id || recent.id;
    if (recentId && msgId && String(recentId) === String(msgId)) {
      continue;
    }

    if (recent.text) {
      const recentNorm = recent.text.trim().toLowerCase().replace(/\s+/g, ' ');
      if (normText && normText === recentNorm) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Calculates a confidence score (0.0 to 1.0) for an incoming message based on quality signals.
 *
 * @param message - Message to score
 * @param context - Optional context including active signals and recent messages
 * @returns Confidence score normalized between 0.0 and 1.0
 */
export function scoreMessage(message: IncomingMessage, context?: FilterContext): number {
  if (!message || !message.text) {
    return 0.0;
  }

  let score = 0.5; // Base starting score
  const text = message.text;
  const lower = text.toLowerCase().trim();

  // 1. Positive Signals
  const ticker = extractTicker(text);
  const cas = detectContractAddresses(text);
  const isCallStruct = isCall(text);
  const pnlUpdate = isPNLUpdate(text);
  const isReply = Boolean(message.replyToMessageId || message.reply_to_msg_id || message.quoted_msg_id);
  const hasMedia = Boolean((message.media && message.media.length > 0) || message.media_url);

  // Clear call structure (ticker + CA together)
  if (ticker && cas.length > 0) {
    score += 0.35;
  } else if (isCallStruct) {
    score += 0.25;
  }

  // Follow-up to known signal
  if (context?.activeSignals && context.activeSignals.length > 0) {
    const isKnownTicker = ticker && context.activeSignals.some((s) => s.ticker?.toUpperCase() === ticker);
    const isKnownCA = cas.some((c) => context.activeSignals?.some((s) => (s.contract_address || s.ca || '').toLowerCase() === c.address.toLowerCase()));
    if (isKnownTicker || isKnownCA) {
      score += 0.25;
    }
  }

  // PNL update language
  if (pnlUpdate) {
    score += 0.25;
  }

  // Relevant media attached
  if (hasMedia) {
    score += 0.10;
  }

  // Reply to previous signal
  if (isReply) {
    score += 0.20;
  }

  // 2. Negative Signals
  // Greetings
  if (GREETING_PATTERNS.test(lower)) {
    score -= 0.30;
  }

  // Random chatter
  if (CHATTER_PATTERNS.test(lower)) {
    score -= 0.20;
  }

  // Spam patterns
  if (SPAM_PATTERNS.test(lower)) {
    score -= 0.40;
  }

  // Low confidence ticker mention without context
  if (ticker && cas.length === 0 && !isCallStruct && !pnlUpdate && lower.length < 30) {
    score -= 0.20;
  }

  // Duplicate check
  if (context?.recentMessages && isDuplicate(message, context.recentMessages)) {
    score -= 0.50;
  }

  // Unrelated links (http link without crypto context)
  if (/https?:\/\//i.test(lower) && !/dexscreener|dextools|solscan|etherscan|pump\.fun/i.test(lower)) {
    score -= 0.20;
  }

  // Single emoji
  if (/^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}]$/u.test(lower)) {
    score -= 0.40;
  }

  // Very short messages
  if (lower.length < 5) {
    score -= 0.30;
  }

  // Clamp score between 0.0 and 1.0
  return Math.max(0.0, Math.min(1.0, Math.round(score * 100) / 100));
}

/**
 * Determines whether a message meets the confidence threshold required for publishing.
 *
 * @param score - Calculated message score
 * @param threshold - Configured minimum score threshold (default: 0.6)
 * @returns True if score meets or exceeds threshold
 */
export function shouldPublish(score: number, threshold = 0.6): boolean {
  return typeof score === 'number' && score >= threshold;
}
