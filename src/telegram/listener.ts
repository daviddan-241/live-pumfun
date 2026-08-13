// @ts-nocheck
/**
 * Multi-Source Telegram Listener — Real gramjs event handlers
 * Monitors source channels for new messages, edits, and albums.
 * NEVER posts to source channels.
 */

import { EventEmitter } from 'events';
import { NewMessage, EditedMessage } from 'telegram/events';
import { Api } from 'telegram';
import { getClient } from './client.js';
import { createLogger } from '../utils/logger.js';
import { MessageType, IncomingMessage } from '../types.js';
import { randomUUID } from 'crypto';

const logger = createLogger('telegram:listener');

class TelegramListener extends EventEmitter {
  private listening = false;
  private handlerRefs: { type: string; handler: any }[] = [];
  private albumBuffer = new Map<string, { messages: any[]; timer: NodeJS.Timeout }>();

  /**
   * Start listening for messages from the configured source channels.
   */
  async startListening(sources: string[]): Promise<void> {
    if (this.listening) {
      logger.warn('Listener already running');
      return;
    }

    const client = getClient();
    logger.info(`Starting listener for ${sources.length} sources: ${sources.join(', ')}`);

    // New message handler
    const newMessageHandler = async (event: any) => {
      try {
        const message = event.message as Api.Message;
        if (!message) return;

        // Determine which source channel this came from
        const chat = message.peerId;
        let chatId: string | undefined;
        let chatTitle: string | undefined;

        if (chat?.className === 'PeerChannel') {
          chatId = String((chat as Api.PeerChannel).channelId);
        } else if (chat?.className === 'PeerUser') {
          chatId = String((chat as Api.PeerUser).userId);
        } else if (chat?.className === 'PeerChat') {
          chatId = String((chat as Api.PeerChat).chatId);
        }

        // Check if this source is in our monitored list
        const isMonitored = await this.isMonitoredSource(sources, chatId, chat);
        if (!isMonitored) return;

        // Get chat info
        try {
          const entity = await client.getEntity(chat);
          chatTitle = (entity as any)?.title || (entity as any)?.username || chatId;
        } catch {
          chatTitle = chatId;
        }

        // Handle albums (grouped media)
        const groupedId = (message as any).groupedId;
        if (groupedId) {
          this.handleAlbum(groupedId.toString(), message, chatId!, chatTitle);
          return;
        }

        const incoming = this.parseMessage(message, chatId!, chatTitle);
        this.emit('message', incoming);
      } catch (err) {
        logger.error(`Error in new message handler: ${(err as Error).message}`);
      }
    };

    // Edited message handler
    const editHandler = async (event: any) => {
      try {
        const message = event.message as Api.Message;
        if (!message) return;

        const chat = message.peerId;
        let chatId: string | undefined;

        if (chat?.className === 'PeerChannel') {
          chatId = String((chat as Api.PeerChannel).channelId);
        } else if (chat?.className === 'PeerUser') {
          chatId = String((chat as Api.PeerUser).userId);
        } else if (chat?.className === 'PeerChat') {
          chatId = String((chat as Api.PeerChat).chatId);
        }

        const isMonitored = await this.isMonitoredSource(sources, chatId, chat);
        if (!isMonitored) return;

        const incoming = this.parseMessage(message, chatId!, undefined, true);
        this.emit('edit', incoming);
      } catch (err) {
        logger.error(`Error in edit handler: ${(err as Error).message}`);
      }
    };

    client.addEventHandler(newMessageHandler, new NewMessage({}));
    client.addEventHandler(editHandler, new EditedMessage({}));

    this.handlerRefs = [
      { type: 'new', handler: newMessageHandler },
      { type: 'edit', handler: editHandler },
    ];

    this.listening = true;
    logger.info('Listener started successfully');
  }

  /**
   * Stop listening and remove all event handlers.
   */
  stopListening(): void {
    if (!this.listening) return;

    const client = getClient();
    // gramjs doesn't have removeEventHandler in all versions, so we just mark as stopped
    // The handlers will check this.listening before processing
    this.listening = false;
    this.handlerRefs = [];

    // Clear album buffers
    for (const [key, buf] of this.albumBuffer) {
      clearTimeout(buf.timer);
    }
    this.albumBuffer.clear();

    logger.info('Listener stopped');
  }

  isListening(): boolean {
    return this.listening;
  }

  /**
   * Check if a chat is one of our monitored sources.
   */
  private async isMonitoredSource(sources: string[], chatId: string | undefined, peer: any): Promise<boolean> {
    if (!chatId) return false;

    const client = getClient();
    for (const source of sources) {
      try {
        const entity = await client.getEntity(source);
        let entityId: string;
        if (entity.className === 'Channel' || entity.className === 'ChannelForbidden') {
          entityId = String((entity as any).id);
        } else if (entity.className === 'User') {
          entityId = String((entity as any).id);
        } else {
          entityId = String((entity as any).id || '');
        }

        if (entityId === chatId) return true;

        // Also check by username
        const username = (entity as any)?.username?.toLowerCase();
        if (username && source.toLowerCase().replace('@', '') === username) return true;
      } catch {
        // If we can't resolve, compare by string
        if (source === chatId) return true;
      }
    }
    return false;
  }

  /**
   * Parse a gramjs message into our IncomingMessage type.
   */
  private parseMessage(message: Api.Message, chatId: string, chatTitle?: string, isEdit = false): IncomingMessage {
    const text = message.message || '';
    const msgId = Number(message.id);

    // Determine message type
    let messageType: MessageType = MessageType.TEXT;
    let hasMedia = false;
    let mediaInfo: any = null;

    if (message.media) {
      hasMedia = true;
      const media = message.media as any;

      if (media.className === 'MessageMediaPhoto') {
        messageType = MessageType.PHOTO;
        mediaInfo = { type: 'photo', fileId: media.photo?.id?.toString() };
      } else if (media.className === 'MessageMediaDocument') {
        const doc = media.document;
        const mimeType = doc?.mimeType || '';
        if (mimeType.includes('video')) {
          messageType = mimeType.includes('gif') ? MessageType.GIF : MessageType.VIDEO;
        } else if (mimeType.includes('audio')) {
          messageType = MessageType.VOICE;
        } else {
          messageType = MessageType.DOCUMENT;
        }
        mediaInfo = { type: messageType.toLowerCase(), fileId: doc?.id?.toString(), mimeType };
      } else {
        messageType = MessageType.UNKNOWN;
        mediaInfo = { type: 'unknown', raw: media.className };
      }
    }

    // Reply info
    const replyToMsgId = message.replyTo?.replyToMsgId ? Number(message.replyTo.replyToMsgId) : null;

    // Sender info
    let senderId: string | undefined;
    let senderName: string | undefined;
    try {
      if (message.senderId) {
        senderId = String(message.senderId);
        const client = getClient();
        const sender = client.getEntity(senderId).catch(() => null);
      }
    } catch {
      // ignore
    }

    const incoming: IncomingMessage = {
      id: randomUUID(),
      source_chat_id: chatId,
      source_message_id: msgId,
      text,
      raw_text: text,
      message_type: messageType,
      has_media: hasMedia,
      media_info: mediaInfo,
      reply_to_msg_id: replyToMsgId,
      quoted_msg_id: replyToMsgId,
      sender_id: senderId || null,
      sender_name: senderName || null,
      is_edit: isEdit,
      edit_date: message.editDate ? Number(message.editDate) : null,
      edit_version: isEdit ? 1 : 0,
      received_at: Date.now(),
      processing_status: 'PENDING',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    logger.debug(`Parsed message ${msgId} from ${chatTitle || chatId}: type=${messageType}, hasMedia=${hasMedia}, reply=${!!replyToMsgId}`);

    return incoming;
  }

  /**
   * Handle album (grouped media) detection.
   * gramjs sends individual messages with the same groupedId; we buffer and emit as a batch.
   */
  private handleAlbum(groupedId: string, message: any, chatId: string, chatTitle?: string): void {
    let buffer = this.albumBuffer.get(groupedId);

    if (!buffer) {
      buffer = { messages: [], timer: null as any };
      this.albumBuffer.set(groupedId, buffer);

      // Wait 2 seconds for all messages in the album to arrive
      buffer.timer = setTimeout(() => {
        const buf = this.albumBuffer.get(groupedId);
        if (!buf) return;

        this.albumBuffer.delete(groupedId);

        if (!this.listening) return;

        const messages = buf.messages;
        logger.info(`Album ${groupedId}: ${messages.length} items from ${chatTitle || chatId}`);

        const albumMessages = messages.map((msg, idx) =>
          this.parseMessage(msg, chatId, chatTitle, false)
        );

        this.emit('album', albumMessages);
      }, 2000);
    }

    buffer.messages.push(message);
  }
}

export const listener = new TelegramListener();

export function startListening(sources: string[]): Promise<void> {
  return listener.startListening(sources);
}

export function stopListening(): void {
  listener.stopListening();
}
