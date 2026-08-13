// @ts-nocheck
/**
 * Contract Address (CA) & Ticker Detection Engine.
 *
 * Scans message text for smart contract addresses across Solana, Pump.fun,
 * Ethereum, and EVM chains using precise regex patterns and conservative heuristics.
 * Extracts ticker symbols, formats group output strings, and identifies blockchain networks.
 */

import { DetectedCA } from '../types.js';

// Base58 character set excludes 0, O, I, l
const BASE58_CHAR_REGEX = /^[1-9A-HJ-NP-Za-km-z]+$/;
const EVM_HEX_REGEX = /^0x[a-fA-F0-9]{40}$/i;

// Common non-ticker words to filter out when searching for tickers
const RESERVED_WORDS = new Set([
  'BUY', 'SELL', 'CALL', 'CALLING', 'ENTRY', 'EXIT', 'LONG', 'SHORT',
  'PUMP', 'DUMP', 'MOON', 'SOL', 'ETH', 'BSC', 'BASE', 'EVM', 'PNL',
  'ATH', 'CA', 'TOKEN', 'TICKER', 'COIN', 'PRICE', 'STOP', 'LOSS',
  'TARGET', 'PROFIT', 'GAIN', 'UPDATE', 'NEWS', 'INFO', 'LINK',
  'JOIN', 'GROUP', 'FREE', 'THIS', 'THAT', 'WITH', 'FROM', 'THE',
  'AND', 'FOR', 'NOT', 'YOU', 'ALL', 'ARE', 'WAS', 'HER', 'HIS',
]);

/**
 * Validates whether a candidate string is a plausible Base58 Solana address with sufficient entropy.
 */
function isValidSolanaBase58(candidate: string): boolean {
  if (candidate.length < 32 || candidate.length > 44) {
    return false;
  }
  if (!BASE58_CHAR_REGEX.test(candidate)) {
    return false;
  }
  // Check that candidate has mixed character types (not all digits or all lowercase/uppercase)
  const hasDigits = /\d/.test(candidate);
  const hasUpper = /[A-Z]/.test(candidate);
  const hasLower = /[a-z]/.test(candidate);
  const typeCount = (hasDigits ? 1 : 0) + (hasUpper ? 1 : 0) + (hasLower ? 1 : 0);
  
  // High-confidence Solana keys typically have a mix of digits and casing or are 43-44 chars long
  if (candidate.length >= 40) {
    return typeCount >= 2;
  }
  return typeCount >= 3;
}

/**
 * Scans message text for smart contract addresses using regex patterns.
 * Conservative: avoids false positives. Never invents, alters, or truncates CAs.
 *
 * @param text - Raw message text to scan
 * @returns Array of detected contract address records with chain and confidence score
 */
export function detectContractAddresses(text: string): DetectedCA[] {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const results: DetectedCA[] = [];
  const seenAddresses = new Set<string>();

  // 1. Ethereum / EVM Detection (0x + 40 hex chars)
  const evmMatches = text.match(/\b(0x[a-fA-F0-9]{40})\b/gi);
  if (evmMatches) {
    for (const match of evmMatches) {
      if (!seenAddresses.has(match)) {
        seenAddresses.add(match);
        results.push({
          address: match,
          chain: 'ethereum',
          confidence: 0.98,
        });
      }
    }
  }

  // 2. Pump.fun Specific Address Detection (Solana Base58 ending with "pump")
  const pumpMatches = text.match(/\b([1-9A-HJ-NP-Za-km-z]{30,40}pump)\b/gi);
  if (pumpMatches) {
    for (const match of pumpMatches) {
      if (!seenAddresses.has(match) && BASE58_CHAR_REGEX.test(match)) {
        seenAddresses.add(match);
        results.push({
          address: match,
          chain: 'solana',
          confidence: 0.99,
        });
      }
    }
  }

  // 3. General Solana Base58 Address Detection (32-44 base58 chars)
  const solanaMatches = text.match(/\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/g);
  if (solanaMatches) {
    for (const match of solanaMatches) {
      if (seenAddresses.has(match)) {
        continue;
      }
      // Verify Base58 constraints and entropy
      if (isValidSolanaBase58(match)) {
        seenAddresses.add(match);
        const confidence = match.length >= 40 ? 0.95 : 0.85;
        results.push({
          address: match,
          chain: 'solana',
          confidence,
        });
      }
    }
  }

  return results;
}

/**
 * Extracts cryptocurrency ticker/symbol mentions from message text.
 * Looks for patterns like $TICKER, "calling TICKER", "TICKER call", etc.
 *
 * @param text - Raw message text
 * @returns Primary extracted ticker string in uppercase, or null if not found
 */
export function extractTicker(text: string): string | null {
  if (!text || typeof text !== 'string') {
    return null;
  }

  // Pattern 1: $TICKER (e.g. $WIF, $PEPE, $SOL)
  const dollarMatch = text.match(/\$([A-Za-z0-9_]{2,10})\b/);
  if (dollarMatch) {
    const candidate = dollarMatch[1].toUpperCase();
    if (!RESERVED_WORDS.has(candidate)) {
      return candidate;
    }
  }

  // Pattern 2: Contextual phrases like "calling WIF", "buy WIF", "entry WIF", "token WIF"
  const contextMatch = text.match(/(?:calling|call|buy|buying|entry|ticker|token|coin|long|short)\s+\$?([A-Za-z0-9_]{2,10})\b/i);
  if (contextMatch) {
    const candidate = contextMatch[1].toUpperCase();
    if (!RESERVED_WORDS.has(candidate)) {
      return candidate;
    }
  }

  // Pattern 3: Phrase like "WIF call", "WIF entry"
  const postContextMatch = text.match(/\b([A-Za-z0-9_]{2,10})\s+(?:call|entry|buy|long|ca:)/i);
  if (postContextMatch) {
    const candidate = postContextMatch[1].toUpperCase();
    if (!RESERVED_WORDS.has(candidate)) {
      return candidate;
    }
  }

  // Pattern 4: Ticker immediately preceding or following a Contract Address or "CA:"
  const caContextMatch = text.match(/(?:ca:?\s*|contract:?\s*)?\$?([A-Z0-9]{2,10})\b[\s\S]{0,30}(?:0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})/i);
  if (caContextMatch) {
    const candidate = caContextMatch[1].toUpperCase();
    if (!RESERVED_WORDS.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Guesses blockchain network from contract address format.
 *
 * @param ca - Contract address string
 * @returns Chain name ('solana', 'ethereum', or 'unknown')
 */
export function detectChain(ca: string): string {
  if (!ca || typeof ca !== 'string') {
    return 'unknown';
  }

  const clean = ca.trim();

  if (EVM_HEX_REGEX.test(clean)) {
    return 'ethereum';
  }

  if (clean.toLowerCase().endsWith('pump') && BASE58_CHAR_REGEX.test(clean)) {
    return 'solana';
  }

  if (BASE58_CHAR_REGEX.test(clean) && clean.length >= 32 && clean.length <= 44) {
    return 'solana';
  }

  return 'unknown';
}

/**
 * Formats a contract address for group publishing.
 *
 * @param ca - Contract address
 * @returns Formatted CA string, e.g. 'CA: REAL_CONTRACT_ADDRESS' or empty string
 */
export function formatCAForGroup(ca: string): string {
  if (!ca || typeof ca !== 'string') {
    return '';
  }
  const clean = ca.trim();
  if (!clean) {
    return '';
  }
  return `CA: ${clean}`;
}

/**
 * Formats a contract address as a bot command string for PnL tracking.
 *
 * @param ca - Contract address
 * @returns Formatted command string, e.g. '/pnl REAL_CONTRACT_ADDRESS' or empty string
 */
export function formatPNLCommand(ca: string): string {
  if (!ca || typeof ca !== 'string') {
    return '';
  }
  const clean = ca.trim();
  if (!clean) {
    return '';
  }
  return `/pnl ${clean}`;
}
