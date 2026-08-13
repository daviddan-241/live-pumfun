// @ts-nocheck
/**
 * Media Engine — Real Telegram media download and re-upload.
 * Handles photos, videos, GIFs, documents, voice messages, and albums.
 * Never sends placeholder text like "[IMAGE]".
 */

import { getClient } from './client.js';
import { createLogger } from '../utils/logger.js';
import { Api } from 'telegram';
import * as fs from 'fs';
import * as path from 'path';

const logger = createLogger('telegram:media');

const MEDIA_DIR = path.join(process.cwd(), 'data', 'media');

// Ensure media directory exists
try {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
} catch {
  // Directory may already exist
}

export interface DownloadedMedia {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  fileSize: number;
  localPath: string;
}

/**
 * Download media from a Telegram message.
 * Uses gramjs client.downloadMedia().
 */
export async function downloadMedia(message: any): Promise<DownloadedMedia | null> {
  if (!message?.media) {
    return null;
  }

  const client = getClient();
  const msgId = message.id || 'unknown';

  try {
    // Determine file name and mime type
    let fileName = `media_${msgId}`;
    let mimeType = 'application/octet-stream';

    const media = message.media;

    if (media.className === 'MessageMediaPhoto') {
      fileName = `photo_${msgId}.jpg`;
      mimeType = 'image/jpeg';
    } else if (media.className === 'MessageMediaDocument') {
      const doc = media.document;
      mimeType = doc?.mimeType || 'application/octet-stream';
      // Get original filename if available
      const fileNameAttr = doc?.attributes?.find((a: any) => a?.fileName);
      if (fileNameAttr?.fileName) {
        fileName = fileNameAttr.fileName;
      } else {
        const ext = mimeType.split('/')[1]?.split(';')[0] || 'bin';
        fileName = `file_${msgId}.${ext}`;
      }
    } else {
      logger.warn(`Unsupported media type: ${media.className}`);
      return null;
    }

    // Download to buffer
    const localPath = path.join(MEDIA_DIR, fileName);

    const result = await client.downloadMedia(message, {
      outputFile: localPath,
    });

    if (!result) {
      logger.error(`Download returned null for message ${msgId}`);
      return null;
    }

    // Read the file into buffer
    const buffer = fs.readFileSync(localPath);
    const fileSize = buffer.length;

    logger.info(`Downloaded media: ${fileName} (${fileSize} bytes) for msg ${msgId}`);

    return {
      buffer,
      mimeType,
      fileName,
      fileSize,
      localPath,
    };
  } catch (err) {
    logger.error(`Failed to download media for message ${msgId}: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Upload a media file to a destination chat.
 */
export async function uploadMedia(
  chatId: string | number,
  fileBuffer: Buffer,
  opts: { caption?: string; mimeType?: string; fileName?: string; replyToMsgId?: number }
): Promise<{ success: boolean; messageId?: number; error?: string }> {
  const client = getClient();

  try {
    const entity = await client.getEntity(chatId);
    const result = await client.sendFile(entity, {
      file: fileBuffer,
      caption: opts?.caption || '',
      replyTo: opts?.replyToMsgId || undefined,
    });

    const msgId = Number((result as any)?.id || 0);
    logger.info(`Uploaded media to ${chatId}: msgId=${msgId}`);
    return { success: true, messageId: msgId };
  } catch (err) {
    const error = (err as Error).message;
    logger.error(`Failed to upload media to ${chatId}: ${error}`);
    return { success: false, error };
  }
}

/**
 * Process media for a message: download from source, upload to destination.
 * Handles caching to avoid duplicate downloads.
 */
export async function processMedia(
  sourceMessage: any,
  destinationChatId: string | number,
  cacheFn?: (key: string) => any,
  cacheSetFn?: (key: string, value: any) => void
): Promise<{ success: boolean; messageId?: number; error?: string }> {
  const msgKey = `${sourceMessage.peerId?.channelId || 'unknown'}_${sourceMessage.id}`;

  // Check cache
  if (cacheFn && cacheFn(msgKey)) {
    logger.debug(`Media ${msgKey} already processed, skipping`);
    return { success: true };
  }

  // Download
  const downloaded = await downloadMedia(sourceMessage);
  if (!downloaded) {
    return { success: false, error: 'Download failed or no media' };
  }

  // Upload to destination
  const result = await uploadMedia(destinationChatId, downloaded.buffer, {
    caption: sourceMessage.message || '',
    mimeType: downloaded.mimeType,
    fileName: downloaded.fileName,
  });

  if (result.success && cacheSetFn) {
    cacheSetFn(msgKey, { localPath: downloaded.localPath, uploaded: true });
  }

  // Clean up local file (optional — could keep for cache)
  // fs.unlinkSync(downloaded.localPath);

  return result;
}

/**
 * Clean up old cached media files older than maxAgeMs.
 */
export function cleanupOldMedia(maxAgeMs: number = 24 * 60 * 60 * 1000): void {
  try {
    const files = fs.readdirSync(MEDIA_DIR);
    const now = Date.now();
    let cleaned = 0;

    for (const file of files) {
      const filePath = path.join(MEDIA_DIR, file);
      const stats = fs.statSync(filePath);
      if (now - stats.mtimeMs > maxAgeMs) {
        fs.unlinkSync(filePath);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} old media files`);
    }
  } catch (err) {
    logger.warn(`Media cleanup failed: ${(err as Error).message}`);
  }
}
