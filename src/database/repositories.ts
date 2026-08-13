// @ts-nocheck
import crypto from 'node:crypto';
import { db } from './db.js';
import {
  IncomingMessage,
  Signal,
  MessageMapping,
  PNLRecord,
  PublishingLogEntry,
  MediaCacheRecord,
  SourceConfig,
  HealthStatusRecord,
  LogEntry,
} from '../types.js';

// Re-export type alias for dashboard compatibility
export type DBSourceConfig = SourceConfig;

// Helper utilities for JSON and Type conversions
function parseJson<T>(val: any): T | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'object') return val as T;
  try {
    return JSON.parse(val) as T;
  } catch {
    return null;
  }
}

function stringifyJson(val: any): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}

function toBool(val: any): boolean {
  return val === 1 || val === true || val === '1';
}

function toIntBool(val: any): number {
  return val ? 1 : 0;
}

// Hydration functions for DB records to TS models
function hydrateMessage(row: any): IncomingMessage | null {
  if (!row) return null;
  return {
    ...row,
    has_media: toBool(row.has_media),
    is_edit: toBool(row.is_edit),
    media_info: parseJson(row.media_info),
    // Aliases
    telegramMessageId: row.source_message_id,
    sourceChannelId: row.source_chat_id,
    senderId: row.sender_id,
    messageType: row.message_type,
    timestamp: row.received_at,
  };
}

function hydrateSignal(row: any): Signal | null {
  if (!row) return null;
  return {
    ...row,
    cross_source: toBool(row.cross_source),
    pnl_history: parseJson(row.pnl_history) || [],
    media_refs: parseJson(row.media_refs) || [],
    reply_chain: parseJson(row.reply_chain) || [],
    // Aliases
    tokenSymbol: row.ticker,
    contractAddress: row.contract_address,
    sourceChannelId: row.source_chat_id,
    createdAt: row.first_seen_at,
    updatedAt: row.last_updated_at,
    closedAt: row.closed_at,
  };
}

function hydrateMapping(row: any): MessageMapping | null {
  if (!row) return null;
  return {
    ...row,
    media_ids: parseJson(row.media_ids) || [],
    // Aliases
    sourceMessageId: row.source_message_id,
    sourceChannelId: row.source_chat_id,
    destinationMessageId: row.destination_message_id,
    destinationChannelId: row.destination_chat_id,
    signalId: row.signal_id,
  };
}

function hydratePublishLog(row: any): PublishingLogEntry | null {
  if (!row) return null;
  return {
    ...row,
    success: toBool(row.success),
    sourceMessageId: row.source_message_id,
    status: toBool(row.success) ? 'success' : 'failed',
  };
}

function hydrateSource(row: any): SourceConfig | null {
  if (!row) return null;
  return {
    ...row,
    media_enabled: toBool(row.media_enabled),
    reply_enabled: toBool(row.reply_enabled),
    enabled: toBool(row.enabled),
    formatting_rules: parseJson(row.formatting_rules),
    // Aliases
    usernameOrId: row.channel,
    name: row.channel,
    autoPublish: row.mode === 'auto' || row.mode === 'SMART',
  };
}

function hydrateHealth(row: any): HealthStatusRecord | null {
  if (!row) return null;
  return {
    ...row,
    details: parseJson(row.details),
    timestamp: row.last_check,
  };
}

function hydrateLog(row: any): LogEntry | null {
  if (!row) return null;
  return {
    ...row,
    details: parseJson(row.details),
    context: parseJson(row.details) as any,
    source: row.component,
  };
}

// ==========================================
// 1. MESSAGES REPOSITORY
// ==========================================

export function insertMessage(msg: Partial<IncomingMessage>): IncomingMessage {
  const database = db();
  const id = msg.id || crypto.randomUUID();
  const nowISO = new Date().toISOString();

  const sourceChatId = msg.source_chat_id || msg.sourceChannelId || '';
  const sourceMessageId = msg.source_message_id ?? msg.telegramMessageId ?? 0;

  const record = {
    id,
    source_chat_id: sourceChatId,
    source_message_id: sourceMessageId,
    text: msg.text ?? null,
    raw_text: msg.raw_text ?? null,
    message_type: msg.message_type || msg.messageType || null,
    has_media: msg.has_media !== undefined ? toIntBool(msg.has_media) : 0,
    media_info: stringifyJson(msg.media_info || msg.media),
    reply_to_msg_id: msg.reply_to_msg_id ?? msg.replyToMessageId ?? null,
    quoted_msg_id: msg.quoted_msg_id ?? null,
    sender_id: msg.sender_id || msg.senderId || null,
    sender_name: msg.sender_name || msg.sourceChannelName || null,
    is_edit: msg.is_edit !== undefined ? toIntBool(msg.is_edit) : 0,
    edit_date: msg.edit_date ?? null,
    edit_version: msg.edit_version ?? 0,
    received_at: msg.received_at ?? (typeof msg.timestamp === 'number' ? msg.timestamp : Date.now()),
    processed_at: msg.processed_at ?? null,
    processing_status: msg.processing_status ?? 'PENDING',
    classification: msg.classification ?? null,
    confidence: msg.confidence ?? null,
    signal_id: msg.signal_id ?? null,
    created_at: msg.created_at ?? nowISO,
    updated_at: msg.updated_at ?? nowISO,
  };

  const stmt = database.prepare(`
    INSERT INTO messages (
      id, source_chat_id, source_message_id, text, raw_text, message_type,
      has_media, media_info, reply_to_msg_id, quoted_msg_id, sender_id,
      sender_name, is_edit, edit_date, edit_version, received_at,
      processed_at, processing_status, classification, confidence,
      signal_id, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?
    )
  `);

  stmt.run(
    record.id,
    record.source_chat_id,
    record.source_message_id,
    record.text,
    record.raw_text,
    record.message_type,
    record.has_media,
    record.media_info,
    record.reply_to_msg_id,
    record.quoted_msg_id,
    record.sender_id,
    record.sender_name,
    record.is_edit,
    record.edit_date,
    record.edit_version,
    record.received_at,
    record.processed_at,
    record.processing_status,
    record.classification,
    record.confidence,
    record.signal_id,
    record.created_at,
    record.updated_at
  );

  return getMessage(id)!;
}

export function updateMessage(id: string, updates: Partial<IncomingMessage>): IncomingMessage | null {
  const database = db();
  const allowedKeys = [
    'text', 'raw_text', 'message_type', 'has_media', 'media_info',
    'reply_to_msg_id', 'quoted_msg_id', 'sender_id', 'sender_name',
    'is_edit', 'edit_date', 'edit_version', 'received_at', 'processed_at',
    'processing_status', 'classification', 'confidence', 'signal_id'
  ];

  const setClauses: string[] = [];
  const params: any[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (!allowedKeys.includes(key) || value === undefined) continue;

    setClauses.push(`${key} = ?`);
    if (key === 'has_media' || key === 'is_edit') {
      params.push(toIntBool(value));
    } else if (key === 'media_info') {
      params.push(stringifyJson(value));
    } else {
      params.push(value);
    }
  }

  if (setClauses.length === 0) {
    return getMessage(id);
  }

  setClauses.push('updated_at = ?');
  params.push(new Date().toISOString());

  params.push(id);

  const stmt = database.prepare(`
    UPDATE messages
    SET ${setClauses.join(', ')}
    WHERE id = ?
  `);

  stmt.run(...params);
  return getMessage(id);
}

export function getMessage(id: string): IncomingMessage | null {
  const database = db();
  const stmt = database.prepare('SELECT * FROM messages WHERE id = ?');
  const row = stmt.get(id);
  return hydrateMessage(row);
}

export function getMessageBySource(
  sourceChatId: string,
  sourceMessageId: number,
  editVersion?: number
): IncomingMessage | null {
  const database = db();
  if (editVersion !== undefined) {
    const stmt = database.prepare(`
      SELECT * FROM messages
      WHERE source_chat_id = ? AND source_message_id = ? AND edit_version = ?
    `);
    const row = stmt.get(sourceChatId, sourceMessageId, editVersion);
    return hydrateMessage(row);
  } else {
    const stmt = database.prepare(`
      SELECT * FROM messages
      WHERE source_chat_id = ? AND source_message_id = ?
      ORDER BY edit_version DESC
      LIMIT 1
    `);
    const row = stmt.get(sourceChatId, sourceMessageId);
    return hydrateMessage(row);
  }
}

export function getUnprocessed(limit = 50): IncomingMessage[] {
  const database = db();
  const stmt = database.prepare(`
    SELECT * FROM messages
    WHERE processing_status = 'PENDING'
    ORDER BY received_at ASC
    LIMIT ?
  `);
  const rows = stmt.all(limit);
  return rows.map(hydrateMessage).filter((m): m is IncomingMessage => m !== null);
}

export function updateProcessingStatus(
  id: string,
  status: string,
  classification?: string,
  confidence?: number,
  signalId?: string
): IncomingMessage | null {
  const database = db();
  const nowISO = new Date().toISOString();
  const processedAt = Date.now();

  const stmt = database.prepare(`
    UPDATE messages
    SET processing_status = ?,
        processed_at = ?,
        classification = COALESCE(?, classification),
        confidence = COALESCE(?, confidence),
        signal_id = COALESCE(?, signal_id),
        updated_at = ?
    WHERE id = ?
  `);

  stmt.run(status, processedAt, classification ?? null, confidence ?? null, signalId ?? null, nowISO, id);
  return getMessage(id);
}

export function getMessages(options?: {
  classification?: string;
  source?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): IncomingMessage[] {
  const database = db();
  const conditions: string[] = [];
  const params: any[] = [];

  if (options?.classification) {
    conditions.push('classification = ?');
    params.push(options.classification);
  }
  if (options?.source) {
    conditions.push('source_chat_id = ?');
    params.push(options.source);
  }
  if (options?.status) {
    conditions.push('processing_status = ?');
    params.push(options.status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  params.push(limit, offset);

  const stmt = database.prepare(`
    SELECT * FROM messages
    ${whereClause}
    ORDER BY received_at DESC
    LIMIT ? OFFSET ?
  `);

  const rows = stmt.all(...params);
  return rows.map(hydrateMessage).filter((m): m is IncomingMessage => m !== null);
}

// ==========================================
// 2. SIGNALS REPOSITORY
// ==========================================

export function createSignal(signal: Partial<Signal>): Signal {
  const database = db();
  const id = signal.id || crypto.randomUUID();
  const nowISO = new Date().toISOString();

  const ticker = signal.ticker || signal.tokenSymbol || null;
  const contractAddress = signal.contract_address || signal.contractAddress || signal.ca || null;
  const sourceChatId = signal.source_chat_id || signal.sourceChannelId || null;

  const record = {
    id,
    ticker,
    contract_address: contractAddress,
    chain: signal.chain ?? null,
    source_chat_id: sourceChatId,
    source_message_id: signal.source_message_id ?? null,
    destination_chat_id: signal.destination_chat_id ?? null,
    destination_message_id: signal.destination_message_id ?? null,
    public_message_id: signal.public_message_id ?? null,
    status: signal.status ?? 'NEW',
    follow_up_count: signal.follow_up_count ?? 0,
    pnl_history: stringifyJson(signal.pnl_history || []),
    media_refs: stringifyJson(signal.media_refs || []),
    reply_chain: stringifyJson(signal.reply_chain || []),
    cross_source: signal.cross_source !== undefined ? toIntBool(signal.cross_source) : 0,
    first_seen_at: signal.first_seen_at || (typeof signal.createdAt === 'string' ? signal.createdAt : nowISO),
    last_updated_at: signal.last_updated_at || signal.updated_at || (typeof signal.updatedAt === 'string' ? signal.updatedAt : nowISO),
    closed_at: signal.closed_at || (typeof signal.closedAt === 'string' ? signal.closedAt : null),
  };

  const stmt = database.prepare(`
    INSERT INTO signals (
      id, ticker, contract_address, chain, source_chat_id, source_message_id,
      destination_chat_id, destination_message_id, public_message_id, status,
      follow_up_count, pnl_history, media_refs, reply_chain, cross_source,
      first_seen_at, last_updated_at, closed_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?
    )
  `);

  stmt.run(
    record.id,
    record.ticker,
    record.contract_address,
    record.chain,
    record.source_chat_id,
    record.source_message_id,
    record.destination_chat_id,
    record.destination_message_id,
    record.public_message_id,
    record.status,
    record.follow_up_count,
    record.pnl_history,
    record.media_refs,
    record.reply_chain,
    record.cross_source,
    record.first_seen_at,
    record.last_updated_at,
    record.closed_at
  );

  return getSignal(id)!;
}

export function updateSignal(id: string, updates: Partial<Signal>): Signal | null {
  const database = db();
  const allowedKeys = [
    'ticker', 'contract_address', 'chain', 'source_chat_id', 'source_message_id',
    'destination_chat_id', 'destination_message_id', 'public_message_id', 'status',
    'follow_up_count', 'pnl_history', 'media_refs', 'reply_chain', 'cross_source', 'closed_at'
  ];

  const mappedUpdates: Record<string, any> = { ...updates };
  if (updates.ticker || updates.tokenSymbol) mappedUpdates.ticker = updates.ticker || updates.tokenSymbol;
  if (updates.contract_address || updates.contractAddress || updates.ca) {
    mappedUpdates.contract_address = updates.contract_address || updates.contractAddress || updates.ca;
  }
  if (updates.source_chat_id || updates.sourceChannelId) {
    mappedUpdates.source_chat_id = updates.source_chat_id || updates.sourceChannelId;
  }

  const setClauses: string[] = [];
  const params: any[] = [];

  for (const [key, value] of Object.entries(mappedUpdates)) {
    if (!allowedKeys.includes(key) || value === undefined) continue;

    setClauses.push(`${key} = ?`);
    if (key === 'cross_source') {
      params.push(toIntBool(value));
    } else if (key === 'pnl_history' || key === 'media_refs' || key === 'reply_chain') {
      params.push(stringifyJson(value));
    } else {
      params.push(value);
    }
  }

  if (setClauses.length === 0) {
    return getSignal(id);
  }

  setClauses.push('last_updated_at = ?');
  params.push(new Date().toISOString());

  params.push(id);

  const stmt = database.prepare(`
    UPDATE signals
    SET ${setClauses.join(', ')}
    WHERE id = ?
  `);

  stmt.run(...params);
  return getSignal(id);
}

export function getSignal(id: string): Signal | null {
  const database = db();
  const stmt = database.prepare('SELECT * FROM signals WHERE id = ?');
  const row = stmt.get(id);
  return hydrateSignal(row);
}

export function getSignalById(id: string): Signal | null {
  return getSignal(id);
}

export function getSignalByTicker(ticker: string): Signal[] {
  const database = db();
  const stmt = database.prepare('SELECT * FROM signals WHERE UPPER(ticker) = UPPER(?) ORDER BY first_seen_at DESC');
  const rows = stmt.all(ticker);
  return rows.map(hydrateSignal).filter((s): s is Signal => s !== null);
}

export function getSignalByCA(contractAddress: string): Signal | null {
  const database = db();
  const stmt = database.prepare(`
    SELECT * FROM signals
    WHERE LOWER(contract_address) = LOWER(?)
    ORDER BY first_seen_at DESC
    LIMIT 1
  `);
  const row = stmt.get(contractAddress);
  return hydrateSignal(row);
}

export function getActiveSignals(): Signal[] {
  const database = db();
  const stmt = database.prepare(`
    SELECT * FROM signals
    WHERE status NOT IN ('CLOSED', 'CANCELLED')
    ORDER BY first_seen_at DESC
  `);
  const rows = stmt.all();
  return rows.map(hydrateSignal).filter((s): s is Signal => s !== null);
}

export function getSignals(options?: {
  limit?: number;
  offset?: number;
  status?: string;
  search?: string;
}): Signal[] {
  const database = db();
  const conditions: string[] = [];
  const params: any[] = [];

  if (options?.status) {
    conditions.push('status = ?');
    params.push(options.status);
  }

  if (options?.search) {
    conditions.push('(ticker LIKE ? OR contract_address LIKE ?)');
    params.push(`%${options.search}%`, `%${options.search}%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  params.push(limit, offset);

  const stmt = database.prepare(`
    SELECT * FROM signals
    ${whereClause}
    ORDER BY first_seen_at DESC
    LIMIT ? OFFSET ?
  `);

  const rows = stmt.all(...params);
  return rows.map(hydrateSignal).filter((s): s is Signal => s !== null);
}

export function updateSignalStatus(id: string, status: string): Signal | null {
  const database = db();
  const nowISO = new Date().toISOString();

  if (status === 'CLOSED') {
    const stmt = database.prepare(`
      UPDATE signals
      SET status = ?, last_updated_at = ?, closed_at = ?
      WHERE id = ?
    `);
    stmt.run(status, nowISO, nowISO, id);
  } else {
    const stmt = database.prepare(`
      UPDATE signals
      SET status = ?, last_updated_at = ?
      WHERE id = ?
    `);
    stmt.run(status, nowISO, id);
  }

  return getSignal(id);
}

export function addFollowUp(id: string, followUpData?: any): Signal | null {
  const existing = getSignal(id);
  if (!existing) return null;

  const newCount = (existing.follow_up_count || 0) + 1;
  const replyChain = Array.isArray(existing.reply_chain) ? [...existing.reply_chain] : [];

  if (followUpData !== undefined && followUpData !== null) {
    replyChain.push(followUpData);
  }

  return updateSignal(id, {
    follow_up_count: newCount,
    reply_chain: replyChain,
  });
}

export function addPNL(signalId: string, pnl: PNLRecord | any): Signal | null {
  const existing = getSignal(signalId);
  if (!existing) return null;

  const pnlHistory = Array.isArray(existing.pnl_history) ? [...existing.pnl_history] : [];
  pnlHistory.push(pnl);

  if (pnl && (pnl.multiplier || pnl.percentage || pnl.contract_address || pnl.raw_text || pnl.pnlPercentage)) {
    insertPNL({
      signal_id: signalId,
      message_id: pnl.message_id || pnl.sourceMessageId || null,
      multiplier: pnl.multiplier || null,
      percentage: pnl.percentage || (pnl.pnlPercentage ? `${pnl.pnlPercentage}%` : null),
      contract_address: pnl.contract_address || pnl.contractAddress || existing.contract_address || null,
      raw_text: pnl.raw_text || pnl.notes || null,
      detected_at: pnl.detected_at || new Date().toISOString(),
    });
  }

  return updateSignal(signalId, {
    pnl_history: pnlHistory,
  });
}

// ==========================================
// 3. MAPPINGS REPOSITORY
// ==========================================

export function createMapping(mapping: Partial<MessageMapping>): MessageMapping {
  const database = db();
  const id = mapping.id || crypto.randomUUID();
  const nowISO = new Date().toISOString();

  const sourceChatId = mapping.source_chat_id || (mapping.sourceChatId !== undefined ? String(mapping.sourceChatId) : (mapping.sourceChannelId || ''));
  const sourceMessageId = mapping.source_message_id ?? Number(mapping.sourceMessageId || 0);

  const record = {
    id,
    source_chat_id: sourceChatId,
    source_message_id: sourceMessageId,
    destination_chat_id: mapping.destination_chat_id || (mapping.destinationChatId !== undefined ? String(mapping.destinationChatId) : (mapping.destinationChannelId || null)),
    destination_message_id: mapping.destination_message_id ?? mapping.destinationMessageId ?? null,
    signal_id: mapping.signal_id || mapping.signalId || null,
    parent_source_msg_id: mapping.parent_source_msg_id ?? null,
    parent_dest_msg_id: mapping.parent_dest_msg_id ?? null,
    media_ids: stringifyJson(mapping.media_ids || []),
    processing_status: mapping.processing_status ?? null,
    delivery_status: mapping.delivery_status ?? null,
    published_at: mapping.published_at || (typeof mapping.publishedAt === 'string' ? mapping.publishedAt : null),
    created_at: mapping.created_at || (typeof mapping.created_at === 'string' ? mapping.created_at : nowISO),
  };

  const stmt = database.prepare(`
    INSERT INTO message_mappings (
      id, source_chat_id, source_message_id, destination_chat_id, destination_message_id,
      signal_id, parent_source_msg_id, parent_dest_msg_id, media_ids, processing_status,
      delivery_status, published_at, created_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?
    )
  `);

  stmt.run(
    record.id,
    record.source_chat_id,
    record.source_message_id,
    record.destination_chat_id,
    record.destination_message_id,
    record.signal_id,
    record.parent_source_msg_id,
    record.parent_dest_msg_id,
    record.media_ids,
    record.processing_status,
    record.delivery_status,
    record.published_at,
    record.created_at
  );

  return getMapping(id)!;
}

export function getMapping(id: string): MessageMapping | null {
  const database = db();
  const stmt = database.prepare('SELECT * FROM message_mappings WHERE id = ?');
  const row = stmt.get(id);
  return hydrateMapping(row);
}

export function getMappingBySource(
  sourceChatId: string,
  sourceMessageId: number,
  destinationChatId?: string
): MessageMapping | null {
  const database = db();
  if (destinationChatId) {
    const stmt = database.prepare(`
      SELECT * FROM message_mappings
      WHERE source_chat_id = ? AND source_message_id = ? AND destination_chat_id = ?
    `);
    const row = stmt.get(sourceChatId, sourceMessageId, destinationChatId);
    return hydrateMapping(row);
  } else {
    const stmt = database.prepare(`
      SELECT * FROM message_mappings
      WHERE source_chat_id = ? AND source_message_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const row = stmt.get(sourceChatId, sourceMessageId);
    return hydrateMapping(row);
  }
}

export function updateMapping(id: string, updates: Partial<MessageMapping>): MessageMapping | null {
  const database = db();
  const allowedKeys = [
    'destination_chat_id', 'destination_message_id', 'signal_id',
    'parent_source_msg_id', 'parent_dest_msg_id', 'media_ids',
    'processing_status', 'delivery_status', 'published_at'
  ];

  const setClauses: string[] = [];
  const params: any[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (!allowedKeys.includes(key) || value === undefined) continue;

    setClauses.push(`${key} = ?`);
    if (key === 'media_ids') {
      params.push(stringifyJson(value));
    } else {
      params.push(value);
    }
  }

  if (setClauses.length === 0) {
    return getMapping(id);
  }

  params.push(id);

  const stmt = database.prepare(`
    UPDATE message_mappings
    SET ${setClauses.join(', ')}
    WHERE id = ?
  `);

  stmt.run(...params);
  return getMapping(id);
}

export function getMappings(limit = 50): MessageMapping[] {
  const database = db();
  const stmt = database.prepare('SELECT * FROM message_mappings ORDER BY created_at DESC LIMIT ?');
  const rows = stmt.all(limit);
  return rows.map(hydrateMapping).filter((m): m is MessageMapping => m !== null);
}

// ==========================================
// 4. PNL REPOSITORY
// ==========================================

export function insertPNL(record: Partial<PNLRecord>): PNLRecord {
  const database = db();
  const id = record.id || crypto.randomUUID();
  const detectedAt = record.detected_at || (typeof record.updatedAt === 'string' ? record.updatedAt : new Date().toISOString());

  const signalId = record.signal_id || record.signalId || null;
  const contractAddress = record.contract_address || null;

  const stmt = database.prepare(`
    INSERT INTO pnl_records (
      id, signal_id, message_id, multiplier, percentage, contract_address, raw_text, detected_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  stmt.run(
    id,
    signalId,
    record.message_id ?? null,
    record.multiplier ?? null,
    record.percentage ?? (record.pnlPercentage ? `${record.pnlPercentage}%` : null),
    contractAddress,
    record.raw_text ?? record.notes ?? null,
    detectedAt
  );

  return {
    id,
    signal_id: signalId,
    message_id: record.message_id ?? null,
    multiplier: record.multiplier ?? null,
    percentage: record.percentage ?? (record.pnlPercentage ? `${record.pnlPercentage}%` : null),
    contract_address: contractAddress,
    raw_text: record.raw_text ?? record.notes ?? null,
    detected_at: detectedAt,
  };
}

export function getPNLsForSignal(signalId: string): PNLRecord[] {
  const database = db();
  const stmt = database.prepare(`
    SELECT * FROM pnl_records
    WHERE signal_id = ?
    ORDER BY detected_at ASC
  `);
  return stmt.all(signalId) as PNLRecord[];
}

export function getPnlRecords(limit = 50): PNLRecord[] {
  const database = db();
  const stmt = database.prepare('SELECT * FROM pnl_records ORDER BY detected_at DESC LIMIT ?');
  return stmt.all(limit) as PNLRecord[];
}

// ==========================================
// 5. PUBLISHING LOG REPOSITORY
// ==========================================

export function logPublish(entry: Partial<PublishingLogEntry>): PublishingLogEntry {
  const database = db();
  const id = entry.id || crypto.randomUUID();
  const timestamp = entry.timestamp ? (typeof entry.timestamp === 'string' ? entry.timestamp : new Date(entry.timestamp).toISOString()) : new Date().toISOString();
  const success = entry.success !== undefined ? toIntBool(entry.success) : (entry.status === 'failed' ? 0 : 1);

  const sourceMsgId = entry.source_message_id ? String(entry.source_message_id) : (entry.sourceMessageId ? String(entry.sourceMessageId) : null);

  const stmt = database.prepare(`
    INSERT INTO publishing_log (
      id, source_message_id, destination_chat_id, destination_message_id,
      action, mode, success, error, timestamp
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  stmt.run(
    id,
    sourceMsgId,
    entry.destination_chat_id || entry.destination || null,
    entry.destination_message_id || entry.publicMessageId || entry.privateMessageId || null,
    entry.action || null,
    entry.mode || null,
    success,
    entry.error || null,
    timestamp
  );

  return hydratePublishLog({
    id,
    source_message_id: sourceMsgId,
    destination_chat_id: entry.destination_chat_id || entry.destination || null,
    destination_message_id: entry.destination_message_id || entry.publicMessageId || entry.privateMessageId || null,
    action: entry.action || null,
    mode: entry.mode || null,
    success,
    error: entry.error || null,
    timestamp,
  })!;
}

export function getPublishLog(limit = 50, destinationChatId?: string): PublishingLogEntry[] {
  const database = db();
  if (destinationChatId) {
    const stmt = database.prepare(`
      SELECT * FROM publishing_log
      WHERE destination_chat_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    const rows = stmt.all(destinationChatId, limit);
    return rows.map(hydratePublishLog).filter((p): p is PublishingLogEntry => p !== null);
  } else {
    const stmt = database.prepare(`
      SELECT * FROM publishing_log
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit);
    return rows.map(hydratePublishLog).filter((p): p is PublishingLogEntry => p !== null);
  }
}

export function getPublishingLogs(limit = 50): PublishingLogEntry[] {
  return getPublishLog(limit);
}

// ==========================================
// 6. MEDIA CACHE REPOSITORY
// ==========================================

export function cacheMedia(media: Partial<MediaCacheRecord>): MediaCacheRecord {
  const database = db();
  const id = media.id || crypto.randomUUID();
  const cachedAt = media.cached_at || new Date().toISOString();

  const stmt = database.prepare(`
    INSERT OR REPLACE INTO media_cache (
      id, source_chat_id, source_message_id, media_type, file_id, local_path, uploaded_file_id, cached_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  stmt.run(
    id,
    media.source_chat_id ?? null,
    media.source_message_id ?? null,
    media.media_type || media.mime_type || null,
    media.file_id || media.file_path || null,
    media.local_path ?? null,
    media.uploaded_file_id ?? null,
    cachedAt
  );

  return {
    id,
    source_chat_id: media.source_chat_id ?? null,
    source_message_id: media.source_message_id ?? null,
    media_type: media.media_type || media.mime_type || null,
    file_id: media.file_id || media.file_path || null,
    local_path: media.local_path ?? null,
    uploaded_file_id: media.uploaded_file_id ?? null,
    cached_at: cachedAt,
  };
}

export function getMediaCache(sourceChatId: string, sourceMessageId: number): MediaCacheRecord | null {
  const database = db();
  const stmt = database.prepare(`
    SELECT * FROM media_cache
    WHERE source_chat_id = ? AND source_message_id = ?
    ORDER BY cached_at DESC
    LIMIT 1
  `);
  const row = stmt.get(sourceChatId, sourceMessageId);
  return (row as MediaCacheRecord) || null;
}

// ==========================================
// 7. SOURCES CONFIG REPOSITORY
// ==========================================

export function getSources(enabledOnly = false): SourceConfig[] {
  const database = db();
  if (enabledOnly) {
    const stmt = database.prepare(`
      SELECT * FROM sources_config
      WHERE enabled = 1
      ORDER BY priority DESC, created_at ASC
    `);
    const rows = stmt.all();
    return rows.map(hydrateSource).filter((s): s is SourceConfig => s !== null);
  } else {
    const stmt = database.prepare(`
      SELECT * FROM sources_config
      ORDER BY priority DESC, created_at ASC
    `);
    const rows = stmt.all();
    return rows.map(hydrateSource).filter((s): s is SourceConfig => s !== null);
  }
}

export function getSourcesConfig(): SourceConfig[] {
  return getSources(false);
}

export function getSource(idOrChannel: string): SourceConfig | null {
  const database = db();
  const stmt = database.prepare(`
    SELECT * FROM sources_config
    WHERE id = ? OR channel = ?
    LIMIT 1
  `);
  const row = stmt.get(idOrChannel, idOrChannel);
  return hydrateSource(row);
}

export function updateSource(id: string, updates: Partial<SourceConfig>): SourceConfig | null {
  const database = db();
  const allowedKeys = [
    'channel', 'destination', 'mode', 'confidence_threshold',
    'media_enabled', 'reply_enabled', 'formatting_rules', 'priority', 'enabled'
  ];

  const mappedUpdates: Record<string, any> = { ...updates };
  if (updates.name || updates.usernameOrId) {
    mappedUpdates.channel = updates.channel || updates.name || updates.usernameOrId;
  }

  const setClauses: string[] = [];
  const params: any[] = [];

  for (const [key, value] of Object.entries(mappedUpdates)) {
    if (!allowedKeys.includes(key) || value === undefined) continue;

    setClauses.push(`${key} = ?`);
    if (key === 'media_enabled' || key === 'reply_enabled' || key === 'enabled') {
      params.push(toIntBool(value));
    } else if (key === 'formatting_rules') {
      params.push(stringifyJson(value));
    } else {
      params.push(value);
    }
  }

  if (setClauses.length === 0) {
    return getSource(id);
  }

  params.push(id);

  const stmt = database.prepare(`
    UPDATE sources_config
    SET ${setClauses.join(', ')}
    WHERE id = ?
  `);

  stmt.run(...params);
  return getSource(id);
}

export function addSource(source: Partial<SourceConfig>): SourceConfig {
  const database = db();
  const id = source.id || crypto.randomUUID();
  const createdAt = source.created_at || new Date().toISOString();
  const channelName = source.channel || source.name || source.usernameOrId || id;

  const record = {
    id,
    channel: channelName,
    destination: source.destination ?? null,
    mode: source.mode ?? 'SMART',
    confidence_threshold: source.confidence_threshold ?? source.minConfidence ?? 0.6,
    media_enabled: source.media_enabled !== undefined ? toIntBool(source.media_enabled) : 1,
    reply_enabled: source.reply_enabled !== undefined ? toIntBool(source.reply_enabled) : 1,
    formatting_rules: stringifyJson(source.formatting_rules),
    priority: source.priority ?? 0,
    enabled: source.enabled !== undefined ? toIntBool(source.enabled) : 1,
    created_at: createdAt,
  };

  const stmt = database.prepare(`
    INSERT INTO sources_config (
      id, channel, destination, mode, confidence_threshold,
      media_enabled, reply_enabled, formatting_rules, priority, enabled, created_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )
  `);

  stmt.run(
    record.id,
    record.channel,
    record.destination,
    record.mode,
    record.confidence_threshold,
    record.media_enabled,
    record.reply_enabled,
    record.formatting_rules,
    record.priority,
    record.enabled,
    record.created_at
  );

  return getSource(id)!;
}

export function saveSourceConfig(source: Partial<SourceConfig>): SourceConfig {
  if (source.id && getSource(source.id)) {
    return updateSource(source.id, source) || addSource(source);
  } else {
    return addSource(source);
  }
}

export function toggleSource(id: string, enabled?: boolean): SourceConfig | null {
  const database = db();
  if (enabled !== undefined) {
    const stmt = database.prepare('UPDATE sources_config SET enabled = ? WHERE id = ?');
    stmt.run(toIntBool(enabled), id);
  } else {
    const stmt = database.prepare('UPDATE sources_config SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END WHERE id = ?');
    stmt.run(id);
  }
  return getSource(id);
}

// ==========================================
// 8. HEALTH STATUS REPOSITORY
// ==========================================

export function updateHealth(component: string, status: string, details?: any): HealthStatusRecord {
  const database = db();
  const id = crypto.randomUUID();
  const lastCheck = new Date().toISOString();

  const stmt = database.prepare(`
    INSERT INTO health_status (id, component, status, last_check, details)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(component) DO UPDATE SET
      status = excluded.status,
      last_check = excluded.last_check,
      details = excluded.details
  `);

  stmt.run(id, component, status, lastCheck, stringifyJson(details));
  return (getHealth(component) as HealthStatusRecord) || { id, component, status, last_check: lastCheck, details };
}

export function getHealth(component?: string): HealthStatusRecord | HealthStatusRecord[] | null {
  const database = db();
  if (component) {
    const stmt = database.prepare('SELECT * FROM health_status WHERE component = ?');
    const row = stmt.get(component);
    return hydrateHealth(row);
  } else {
    const stmt = database.prepare('SELECT * FROM health_status');
    const rows = stmt.all();
    return rows.map(hydrateHealth).filter((h): h is HealthStatusRecord => h !== null);
  }
}

export function getHealthStatuses(): HealthStatusRecord[] {
  const result = getHealth();
  if (Array.isArray(result)) return result;
  if (result) return [result];
  return [];
}

// ==========================================
// 9. LOGS REPOSITORY
// ==========================================

export function insertLog(level: string, component: string, message: string, details?: any): LogEntry {
  const database = db();
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  const stmt = database.prepare(`
    INSERT INTO logs (id, level, component, message, details, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  stmt.run(id, level, component, message, stringifyJson(details), timestamp);

  return {
    id,
    level,
    component,
    message,
    details: details ?? null,
    timestamp,
  };
}

export function getLogs(
  limitOrOptions?: number | { level?: string; component?: string; search?: string; limit?: number; offset?: number },
  levelParam?: string,
  componentParam?: string
): LogEntry[] {
  const database = db();
  const conditions: string[] = [];
  const params: any[] = [];

  let limit = 100;
  let offset = 0;
  let level = levelParam;
  let component = componentParam;

  if (typeof limitOrOptions === 'number') {
    limit = limitOrOptions;
  } else if (typeof limitOrOptions === 'object' && limitOrOptions !== null) {
    limit = limitOrOptions.limit ?? 100;
    offset = limitOrOptions.offset ?? 0;
    if (limitOrOptions.level) level = limitOrOptions.level;
    if (limitOrOptions.component) component = limitOrOptions.component;
    if (limitOrOptions.search) {
      conditions.push('(message LIKE ? OR component LIKE ?)');
      params.push(`%${limitOrOptions.search}%`, `%${limitOrOptions.search}%`);
    }
  }

  if (level) {
    conditions.push('level = ?');
    params.push(level);
  }

  if (component) {
    conditions.push('component = ?');
    params.push(component);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);

  const stmt = database.prepare(`
    SELECT * FROM logs
    ${whereClause}
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `);

  const rows = stmt.all(...params);
  return rows.map(hydrateLog).filter((l): l is LogEntry => l !== null);
}

// ==========================================
// 10. SETTINGS REPOSITORY
// ==========================================

export function getSettings(): Record<string, string> {
  const database = db();
  const stmt = database.prepare('SELECT key, value FROM settings');
  const rows = stmt.all() as { key: string; value: string }[];
  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

export function saveSettings(settings: Record<string, string>): void {
  const database = db();
  const stmt = database.prepare(`
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  const saveTx = database.transaction(() => {
    for (const [key, value] of Object.entries(settings)) {
      stmt.run(key, String(value));
    }
  });

  saveTx();
}
