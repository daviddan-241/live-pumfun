// @ts-nocheck
/**
 * ARCC Branding & Formatting Module
 */

import { ClassifiedMessage, MessageClassification, Signal } from '../types.js';
import { config } from '../config.js';
import { formatCAForGroup } from '../utils/ca.js';

export type ParseMode = 'HTML' | 'Markdown' | 'plain';

/**
 * Returns the disclaimer text with proper link formatting per parse mode.
 * - HTML: <a href="https://t.me/Aires_Insider/6">Disclaimer</a>
 * - Markdown: [Disclaimer](https://t.me/Aires_Insider/6)
 * - Plain: Disclaimer: https://t.me/Aires_Insider/6
 *
 * @param parseMode Output parse mode format ('HTML' | 'Markdown' | 'plain')
 * @returns Formatted disclaimer string
 */
export function formatDisclaimer(parseMode: ParseMode = 'HTML'): string {
  const disclaimerUrl = 'https://t.me/Aires_Insider/6';
  switch (parseMode) {
    case 'HTML':
      return `<a href="${disclaimerUrl}">Disclaimer</a>`;
    case 'Markdown':
      return `[Disclaimer](${disclaimerUrl})`;
    case 'plain':
    default:
      return `Disclaimer: ${disclaimerUrl}`;
  }
}

/**
 * Determines whether the @William_ARCC contact CTA should be appended.
 * Only added for high-value calls, PNL results, VIP content, selected proofs, or high-value follow-ups.
 *
 * @param classifiedMessage The message object to check
 * @returns True if CTA should be added, false otherwise
 */
export function shouldAddCTA(classifiedMessage: ClassifiedMessage): boolean {
  if (!classifiedMessage) return false;

  const { classification, isHighValue, isVIPContent, isProof, isFollowUp } = classifiedMessage;

  if (isVIPContent || isProof) return true;
  if (classification === MessageClassification.PNL_UPDATE) return true;
  if (classification === MessageClassification.NEW_CALL && isHighValue) return true;
  if (classification === MessageClassification.FOLLOW_UP && (isHighValue || isProof)) return true;

  return false;
}

/**
 * Removes source channel mentions/attributions from raw text.
 * Replaces or cleans attributions without falsely claiming original creation under ARCC's name.
 *
 * @param text Raw text content from source
 * @returns Cleaned text
 */
export function stripSourceBranding(text: string): string {
  if (!text) return '';

  let cleaned = text;

  // Remove Telegram t.me links to other channels
  cleaned = cleaned.replace(/https?:\/\/t\.me\/[a-zA-Z0-9_+/]+/gi, '');

  // Remove source attributions e.g., "Forwarded from @somechannel", "Source: Channel Name"
  cleaned = cleaned.replace(/(?:Forwarded\s+from|Source|Via|From|Credit):\s*@[a-zA-Z0-9_]+/gi, '');
  cleaned = cleaned.replace(/(?:Forwarded\s+from|Source|Via|From|Credit):\s*[^\n]+/gi, '');

  // Remove external channel handle tags (e.g., @other_channel) preserving ARCC tags
  cleaned = cleaned.replace(/@(?!(?:William_ARCC|Aires_Insider)\b)[a-zA-Z0-9_]+/gi, '');

  // Normalize excessive blank lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
}

/**
 * Transforms a message for publication with ARCC branding.
 *
 * @param classifiedMessage Classified message structure
 * @param signal Associated signal object if available
 * @param parseMode Output parse mode (HTML, Markdown, plain)
 * @returns Formatted message text
 */
export function formatForPublication(
  classifiedMessage: ClassifiedMessage,
  signal?: Signal,
  parseMode: ParseMode = 'HTML'
): string {
  const classification = classifiedMessage.classification;

  // PNL_UPDATE: don't add extra formatting, the /pnl command is the format
  if (classification === MessageClassification.PNL_UPDATE) {
    const ca = classifiedMessage.ca || signal?.ca;
    if (ca) {
      return `/pnl ${ca.trim()}`;
    }
    return classifiedMessage.text || '';
  }

  const rawText = classifiedMessage.text || '';
  const cleanedText = stripSourceBranding(rawText);
  const ca = classifiedMessage.ca || signal?.ca;
  const ticker = classifiedMessage.ticker || signal?.ticker;
  const contactText = config.ARCC_CONTACT || '@William_ARCC';
  const addCTA = shouldAddCTA(classifiedMessage);

  let formatted = '';

  if (classification === MessageClassification.NEW_CALL) {
    const header = parseMode === 'HTML'
      ? '🎯 <b>ARCC Signal Alert</b>'
      : parseMode === 'Markdown'
      ? '🎯 **ARCC Signal Alert**'
      : '🎯 ARCC Signal Alert';

    const parts: string[] = [header];

    if (ticker) {
      const cleanTicker = ticker.toUpperCase().replace('$', '');
      const tickerFormatted = parseMode === 'HTML'
        ? `<b>Ticker:</b> $${cleanTicker}`
        : parseMode === 'Markdown'
        ? `**Ticker:** $${cleanTicker}`
        : `Ticker: $${cleanTicker}`;
      parts.push(tickerFormatted);
    }

    if (cleanedText) {
      parts.push(cleanedText);
    }

    if (ca) {
      parts.push(formatCAForGroup(ca));
    }

    formatted = parts.join('\n\n');

  } else if (classification === MessageClassification.FOLLOW_UP) {
    formatted = cleanedText;
  } else {
    formatted = cleanedText;
  }

  if (addCTA) {
    const ctaLine = parseMode === 'HTML'
      ? `\n\n📩 VIP Access / Inquiry: <b>${contactText}</b>`
      : parseMode === 'Markdown'
      ? `\n\n📩 VIP Access / Inquiry: **${contactText}**`
      : `\n\n📩 VIP Access / Inquiry: ${contactText}`;
    formatted += ctaLine;
  }

  if (classification === MessageClassification.NEW_CALL || classification === MessageClassification.ANNOUNCEMENT) {
    formatted += `\n\n${formatDisclaimer(parseMode)}`;
  }

  return formatted;
}
