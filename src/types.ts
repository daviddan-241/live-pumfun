// @ts-nocheck
/**
 * Shared Type Definitions for the ARCC Telegram Intelligence & Publishing System.
 */

export enum MessageType {
  TEXT = 'TEXT',
  PHOTO = 'PHOTO',
  VIDEO = 'VIDEO',
  GIF = 'GIF',
  DOCUMENT = 'DOCUMENT',
  ALBUM = 'ALBUM',
  VOICE = 'VOICE',
  STICKER = 'STICKER',
  UNKNOWN = 'UNKNOWN',
}

export enum MessageClassification {
  NEW_CALL = 'NEW_CALL',
  FOLLOW_UP = 'FOLLOW_UP',
  PNL_UPDATE = 'PNL_UPDATE',
  CA_UPDATE = 'CA_UPDATE',
  REPLY = 'REPLY',
  QUOTED_MESSAGE = 'QUOTED_MESSAGE',
  ANNOUNCEMENT = 'ANNOUNCEMENT',
  NEWS = 'NEWS',
  MEDIA_POST = 'MEDIA_POST',
  MEME = 'MEME',
  CHATTER = 'CHATTER',
  IRRELEVANT = 'IRRELEVANT',
  DUPLICATE = 'DUPLICATE',
  SIGNAL = 'SIGNAL',
  UPDATE = 'UPDATE',
  PNL = 'PNL',
  NOISE = 'NOISE',
  CHAT = 'CHAT',
  UNKNOWN = 'UNKNOWN',
}

export enum SignalStatus {
  NEW = 'NEW',
  ACTIVE = 'ACTIVE',
  FOLLOW_UP = 'FOLLOW_UP',
  PNL = 'PNL',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
}

export enum ProcessingStatus {
  PENDING = 'PENDING',
  CLASSIFIED = 'CLASSIFIED',
  MATCHED = 'MATCHED',
  PROCESSING = 'PROCESSING',
  PROCESSED = 'PROCESSED',
  PUBLISHING = 'PUBLISHING',
  PUBLISHED = 'PUBLISHED',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
}

export enum PublishingMode {
  FORWARD = 'FORWARD',
  COPY = 'COPY',
  TRANSFORM = 'TRANSFORM',
  SMART = 'SMART',
  DIRECT = 'DIRECT',
  ALWAYS = 'ALWAYS',
  MANUAL = 'MANUAL',
}

export interface MediaInfo {
  id?: string;
  type?: MessageType | string;
  mimeType?: string;
  fileId?: string;
  fileName?: string;
  fileSize?: number;
  url?: string;
  width?: number;
  height?: number;
  duration?: number;
  thumbUrl?: string;
  caption?: string;
  local_path?: string;
  [key: string]: any;
}

export interface IncomingMessage {
  id: string;
  source_chat_id?: string;
  source_message_id?: number;
  text?: string | null;
  raw_text?: string | null;
  message_type?: MessageType | string | null;
  has_media?: boolean | number | null;
  media_info?: MediaInfo | string | null;
  reply_to_msg_id?: number | null;
  quoted_msg_id?: number | null;
  sender_id?: string | null;
  sender_name?: string | null;
  is_edit?: boolean | number | null;
  edit_date?: number | null;
  edit_version?: number | null;
  received_at?: number | null;
  processed_at?: number | null;
  processing_status?: ProcessingStatus | string | null;
  classification?: MessageClassification | string | null;
  confidence?: number | null;
  signal_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;

  // CamelCase aliases
  telegramMessageId?: number;
  sourceChannelId?: string;
  sourceChannelName?: string;
  senderId?: string;
  messageType?: MessageType | string;
  media?: MediaInfo[];
  replyToMessageId?: number;
  groupedId?: string;
  timestamp?: Date | number | string;
  rawPayload?: Record<string, unknown>;
}

export interface ClassifiedMessage extends IncomingMessage {
  classification: MessageClassification | string;
  confidence: number;
  tokenSymbol?: string;
  ticker?: string;
  contractAddress?: string;
  ca?: string;
  chain?: string;
  targetPrices?: number[];
  stopLoss?: number;
  entryPrice?: number;
  extractedMetadata?: Record<string, unknown>;
  classifiedAt?: Date | string;
  isHighValue?: boolean;
  isVIPContent?: boolean;
  isProof?: boolean;
  isFollowUp?: boolean;
}

export interface Signal {
  id: string;
  ticker?: string | null;
  contract_address?: string | null;
  chain?: string | null;
  source_chat_id?: string | null;
  source_message_id?: number | null;
  destination_chat_id?: string | null;
  destination_message_id?: number | null;
  public_message_id?: number | null;
  status?: SignalStatus | string | null;
  follow_up_count?: number | null;
  pnl_history?: any[] | string | null;
  media_refs?: any[] | string | null;
  reply_chain?: any[] | string | null;
  cross_source?: boolean | number | null;
  first_seen_at?: string | null;
  last_updated_at?: string | null;
  closed_at?: string | null;

  // CamelCase aliases
  tokenSymbol?: string;
  contractAddress?: string;
  ca?: string;
  initialMessageId?: string;
  sourceChannelId?: string;
  entryPrice?: number;
  targetPrices?: number[];
  stopLoss?: number;
  currentPrice?: number;
  pnlPercentage?: number;
  highestPnlPercentage?: number;
  publishedMessageIds?: Record<string, number>;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  closedAt?: Date | string;
}

export interface MessageMapping {
  id: string;
  source_chat_id?: string | null;
  source_message_id?: number | null;
  destination_chat_id?: string | null;
  destination_message_id?: number | null;
  signal_id?: string | null;
  parent_source_msg_id?: number | null;
  parent_dest_msg_id?: number | null;
  media_ids?: string[] | string | null;
  processing_status?: string | null;
  delivery_status?: string | null;
  published_at?: string | null;
  created_at?: string | null;

  // CamelCase aliases
  sourceMessageId?: number | string;
  sourceChannelId?: string;
  sourceChatId?: string | number;
  destinationChannelId?: string;
  destinationChatId?: string | number;
  destinationMessageId?: number;
  privateMessageId?: number;
  publicMessageId?: number;
  signalId?: string;
  publishingMode?: PublishingMode | string;
  publishedAt?: Date | string;
}

export interface PNLRecord {
  id: string;
  signal_id?: string | null;
  message_id?: string | null;
  multiplier?: string | null;
  percentage?: string | null;
  contract_address?: string | null;
  raw_text?: string | null;
  detected_at?: string | null;

  // CamelCase aliases
  signalId?: string;
  tokenSymbol?: string;
  ticker?: string;
  entryPrice?: number;
  exitPrice?: number;
  currentPrice?: number;
  pnlPercentage?: number;
  isRealized?: boolean;
  updatedAt?: Date | string;
  notes?: string;
}

export interface PublishingLogEntry {
  id: string;
  source_message_id?: string | null;
  destination_chat_id?: string | null;
  destination_message_id?: number | null;
  action?: 'published' | 'forwarded' | 'edited' | 'pinned' | 'failed' | string | null;
  mode?: PublishingMode | string | null;
  success?: boolean | number | null;
  error?: string | null;
  timestamp?: string | null;

  // CamelCase aliases
  sourceMessageId?: string | number;
  classification?: MessageClassification | string;
  destination?: string;
  privateMessageId?: number;
  publicMessageId?: number;
  status?: 'success' | 'failed' | 'skipped' | string;
  details?: Record<string, unknown>;
}

export type PublishingLog = PublishingLogEntry;

export interface MediaCacheRecord {
  id: string;
  source_chat_id?: string | null;
  source_message_id?: number | null;
  media_type?: string | null;
  file_id?: string | null;
  local_path?: string | null;
  uploaded_file_id?: string | null;
  cached_at?: string | null;

  // Aliases
  file_path?: string;
  mime_type?: string;
}

export interface SourceConfig {
  id: string;
  channel?: string | null;
  destination?: string | null;
  mode?: PublishingMode | string | null;
  confidence_threshold?: number | null;
  media_enabled?: boolean | number | null;
  reply_enabled?: boolean | number | null;
  formatting_rules?: Record<string, any> | string | null;
  priority?: number | null;
  enabled?: boolean | number | null;
  created_at?: string | null;

  // CamelCase aliases
  usernameOrId?: string;
  name?: string;
  autoPublish?: boolean;
  publishingMode?: PublishingMode | string;
  minConfidence?: number;
  updated_at?: number | string;
}

export type DBSourceConfig = SourceConfig;

export interface HealthStatusRecord {
  id: string;
  component: string;
  status: string;
  last_check?: string | null;
  details?: Record<string, any> | string | null;
  timestamp?: string | Date;
}

export interface LogEntry {
  id: string;
  level: string;
  component: string;
  message: string;
  details?: Record<string, any> | string | null;
  timestamp: string;
  context?: Record<string, unknown>;
  source?: string;
}

export interface ProcessingJob {
  id: string;
  message: IncomingMessage;
  status: ProcessingStatus;
  attempts: number;
  error?: string;
  createdAt: Date;
}

export interface DashboardStatus {
  uptimeSeconds: number;
  systemStatus: 'healthy' | 'degraded' | 'unhealthy';
  activeSignalsCount: number;
  totalProcessedMessages: number;
  totalPublishedMessages: number;
  activeWorkers: number;
  lastHeartbeat: Date;
  channelsMonitored: number;
}
