// @ts-nocheck
/**
 * Telegram MTProto Client — Real gramjs integration
 * Handles connection, authentication, reconnection, and entity resolution.
 */

import { EventEmitter } from 'events';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Api } from 'telegram';
import config from '../config.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('telegram:client');

export const connectionStatus = new EventEmitter();
let client: TelegramClient | null = null;
let isConnected = false;
const entityCache = new Map<string, any>();

/**
 * Initialize and authenticate the Telegram client using MTProto (user session).
 */
export async function initialize(): Promise<void> {
  const apiId = config.TELEGRAM_API_ID;
  const apiHash = config.TELEGRAM_API_HASH;
  const sessionStr = config.TELEGRAM_SESSION;

  if (!apiId || !apiHash) {
    connectionStatus.emit('status', { status: 'DISCONNECTED', error: 'Missing API credentials' });
    throw new Error(
      'TELEGRAM_API_ID and TELEGRAM_API_HASH are required. Get them from https://my.telegram.org → API development tools'
    );
  }

  if (!sessionStr) {
    connectionStatus.emit('status', { status: 'DISCONNECTED', error: 'Missing session string' });
    throw new Error(
      'TELEGRAM_SESSION is required. Run `npm run generate-session` to create one.'
    );
  }

  logger.info('Connecting to Telegram via MTProto...');

  const session = new StringSession(sessionStr);
  client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
    retryDelay: 2000,
    autoReconnect: true,
    floodSleepThreshold: 60,
  });

  await client.connect();

  if (!(await client.isUserAuthorized())) {
    connectionStatus.emit('status', { status: 'DISCONNECTED', error: 'Session not authorized' });
    throw new Error('Telegram session is not authorized. Generate a new session string.');
  }

  const me = await client.getMe();
  logger.info(`Connected as @${(me as any).username || (me as any).firstName} (ID: ${me.id})`);

  isConnected = true;
  connectionStatus.emit('status', { status: 'CONNECTED', timestamp: Date.now() });

  // Monitor disconnection events
  client.addEventHandler(async (event: any) => {
    if (event.className === 'UpdateClientDisconnected') {
      isConnected = false;
      logger.warn('Telegram client disconnected');
      connectionStatus.emit('status', { status: 'DISCONNECTED', timestamp: Date.now() });
    } else if (event.className === 'UpdateClientConnected') {
      isConnected = true;
      logger.info('Telegram client reconnected');
      connectionStatus.emit('status', { status: 'CONNECTED', timestamp: Date.now() });
    }
  });
}

/**
 * Get the connected Telegram client instance.
 */
export function getClient(): TelegramClient {
  if (!client) {
    throw new Error('Telegram client not initialized. Call initialize() first.');
  }
  return client;
}

/**
 * Resolve a channel username or ID to a usable Telegram entity.
 * Caches results for performance.
 */
export async function resolveEntity(identifier: string | number): Promise<any> {
  const cacheKey = String(identifier);
  if (entityCache.has(cacheKey)) {
    return entityCache.get(cacheKey);
  }

  if (!client) throw new Error('Telegram client not initialized');

  try {
    const entity = await client.getEntity(identifier);
    entityCache.set(cacheKey, entity);
    return entity;
  } catch (err) {
    logger.error(`Failed to resolve entity ${identifier}: ${(err as Error).message}`);
    throw err;
  }
}

/**
 * Check if the client is currently connected.
 */
export function isConnectedToTelegram(): boolean {
  return isConnected && client !== null && client.connected;
}

/**
 * Disconnect gracefully.
 */
export async function disconnect(): Promise<void> {
  if (client) {
    logger.info('Disconnecting from Telegram...');
    await client.disconnect();
    isConnected = false;
    connectionStatus.emit('status', { status: 'DISCONNECTED', timestamp: Date.now() });
    client = null;
  }
}
