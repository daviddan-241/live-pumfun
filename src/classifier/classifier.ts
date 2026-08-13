// @ts-nocheck
/**
 * AI & Heuristic Message Classification Pipeline.
 *
 * Classifies incoming messages into trading categories (NEW_CALL, FOLLOW_UP, PNL_UPDATE, etc.)
 * based on content filters, context lookup against active signals, and regex extraction.
 */

import { getActiveSignals, getMessageBySource } from '../database/repositories.js';
import {
  ClassifierContext,
  ClassifiedMessage,
  IncomingMessage,
  MessageClassification,
  MessageType,
  Signal,
} from '../types.js';
import {
  detectChain,
  detectContractAddresses,
  extractTicker,
} from '../utils/ca.js';
import {
  detectPumpLanguage,
  isCall,
  isDuplicate,
  isPNLUpdate,
  scoreMessage,
} from '../utils/filters.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Classifier');

const ANNOUNCEMENT_KEYWORDS = /\b(announcement|important|pinned|official notice|scheduled maintenance|airdrop update)\b/i;
const NEWS_KEYWORDS = /\b(market news|partnership|listing|binance|coinbase|bybit|gate\.io|okx|mainnet|press release)\b/i;

/**
 * Finds an active signal matching the message's ticker, CA, or reply ID.
 */
async function findMatchingActiveSignal(
  message: IncomingMessage,
  ticker: string | null,
  caList: string[],
  activeSignals: Signal[]
): Promise<Signal | null> {
  // 1. Check reply message ID match
  const replyId = message.replyToMessageId || message.reply_to_msg_id;
  if (replyId && message.sourceChannelId) {
    const parentMsg = await getMessageBySource(message.sourceChannelId, replyId);
    if (parentMsg) {
      const parentTicker = extractTicker(parentMsg.text);
      if (parentTicker) {
        const match = activeSignals.find(
          (s) => s.ticker?.toUpperCase() === parentTicker.toUpperCase()
        );
        if (match) return match;
      }
    }
  }

  // 2. Check contract address match
  for (const ca of caList) {
    const cleanCa = ca.toLowerCase();
    const match = activeSignals.find((s) => {
      const signalCa = (s.contract_address || s.contractAddress || s.ca || '').toLowerCase();
      return signalCa === cleanCa;
    });
    if (match) return match;
  }

  // 3. Check ticker match
  if (ticker) {
    const cleanTicker = ticker.toUpperCase();
    const match = activeSignals.find(
      (s) => s.ticker?.toUpperCase() === cleanTicker || s.tokenSymbol?.toUpperCase() === cleanTicker
    );
    if (match) return match;
  }

  return null;
}

/**
 * Pipeline entry point for classifying an incoming message.
 *
 * @param message - The raw/ingested incoming message
 * @param context - Classifier context containing active signals or recent message history
 * @returns Fully typed ClassifiedMessage with category, confidence, extracted data, and reasoning
 */
export async function classifyMessage(
  message: IncomingMessage,
  context?: ClassifierContext
): Promise<ClassifiedMessage> {
  logger.debug(`Classifying message ID: ${message.id || message.telegramMessageId}`);

  const text = message.text || '';
  const lower = text.toLowerCase().trim();

  // Extract CAs and Ticker
  const detectedCAs = detectContractAddresses(text);
  const caStrings = detectedCAs.map((c) => c.address);
  const ticker = extractTicker(text);
  const pumpInfo = detectPumpLanguage(text);

  // Active signals lookup
  const activeSignals = context?.activeSignals || (await getActiveSignals());
  const matchedSignal = await findMatchingActiveSignal(message, ticker, caStrings, activeSignals);

  // Calculate quality confidence score
  const filterContext = {
    activeSignals,
    recentMessages: context?.recentMessages || [],
  };
  const confidence = scoreMessage(message, filterContext);

  let classification: MessageClassification = MessageClassification.IRRELEVANT;
  let reasoning = 'Default fallback category';

  const replyId = message.replyToMessageId || message.reply_to_msg_id;
  const quotedId = message.quoted_msg_id;
  const isDup = isDuplicate(message, context?.recentMessages || []);

  // Priority classification evaluation
  if (isDup) {
    classification = MessageClassification.DUPLICATE;
    reasoning = 'Message matches recently processed message text or ID';
  } else if (isPNLUpdate(text) && matchedSignal) {
    classification = MessageClassification.PNL_UPDATE;
    reasoning = `Message contains profit/loss update language matched to active signal ${matchedSignal.ticker}`;
  } else if (caStrings.length > 0 && matchedSignal && !isCall(text)) {
    classification = MessageClassification.CA_UPDATE;
    reasoning = `Contains contract address ${caStrings[0]} updating existing signal ${matchedSignal.ticker}`;
  } else if (isCall(text) || (ticker && caStrings.length > 0)) {
    classification = MessageClassification.NEW_CALL;
    reasoning = `Structured trading call with ticker (${ticker || 'N/A'}) and CA (${caStrings[0] || 'N/A'})`;
  } else if (matchedSignal) {
    classification = MessageClassification.FOLLOW_UP;
    reasoning = `Follow-up commentary referencing active signal ${matchedSignal.ticker}`;
  } else if (replyId) {
    classification = MessageClassification.REPLY;
    reasoning = `Direct reply to message ID ${replyId}`;
  } else if (quotedId) {
    classification = MessageClassification.QUOTED_MESSAGE;
    reasoning = `Quoted message referencing message ID ${quotedId}`;
  } else if (
    (message.messageType === MessageType.PHOTO ||
      message.messageType === MessageType.VIDEO ||
      message.messageType === MessageType.ALBUM ||
      message.media_url) &&
    lower.length < 20
  ) {
    classification = MessageClassification.MEDIA_POST;
    reasoning = 'Primarily media attachment without signal call structure';
  } else if (ANNOUNCEMENT_KEYWORDS.test(lower)) {
    classification = MessageClassification.ANNOUNCEMENT;
    reasoning = 'Contains channel or system announcement keywords';
  } else if (NEWS_KEYWORDS.test(lower)) {
    classification = MessageClassification.NEWS;
    reasoning = 'Contains crypto market news or exchange listing keywords';
  } else if (/^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\s]+$/u.test(lower) || lower.includes('meme')) {
    classification = MessageClassification.MEME;
    reasoning = 'Emoji heavy or meme content';
  } else if (ticker || lower.length > 10) {
    classification = MessageClassification.CHATTER;
    reasoning = 'General chatter or low-confidence token reference without signal parameters';
  } else {
    classification = MessageClassification.IRRELEVANT;
    reasoning = 'Unrelated or low-quality message';
  }

  const primaryCA = caStrings[0] || '';
  const primaryChain = detectedCAs[0]?.chain || detectChain(primaryCA);

  const classifiedMessage: ClassifiedMessage = {
    ...message,
    message,
    classification,
    confidence,
    extracted: {
      ticker: ticker || undefined,
      tokenSymbol: ticker || undefined,
      contract_addresses: detectedCAs,
      contractAddress: primaryCA || undefined,
      chain: primaryChain,
      multiplier: pumpInfo.multiplier,
      percentage: pumpInfo.percentage,
      has_pump_language: pumpInfo.hasPumpLanguage,
      hasPumpLanguage: pumpInfo.hasPumpLanguage,
    },
    tokenSymbol: ticker || undefined,
    contractAddress: primaryCA || undefined,
    chain: primaryChain,
    reasoning,
    classifiedAt: new Date(),
  };

  logger.info(
    `Classified message as [${classification}] (Confidence: ${confidence}) - ${reasoning}`
  );

  return classifiedMessage;
}
