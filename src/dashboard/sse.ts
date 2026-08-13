// @ts-nocheck
import { Response } from 'express';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('SSEManager');

export class SSEManager {
  private clients: Set<Response> = new Set();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startHeartbeat();
  }

  /**
   * Add a new SSE client
   */
  public addClient(res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Flush headers if supported
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    this.clients.add(res);
    logger.info(`SSE client connected. Total connected clients: ${this.clients.size}`);

    // Initial connection acknowledgement
    this.sendToClient(res, 'connection', {
      status: 'connected',
      clientCount: this.clients.size,
      timestamp: Date.now(),
    });

    const cleanup = () => {
      if (this.clients.has(res)) {
        this.clients.delete(res);
        logger.info(`SSE client disconnected. Remaining clients: ${this.clients.size}`);
      }
    };

    res.on('close', cleanup);
    res.on('finish', cleanup);
    res.on('error', (err) => {
      logger.error('SSE client response error:', err.message);
      cleanup();
    });
  }

  /**
   * Explicitly remove an SSE client
   */
  public removeClient(res: Response): void {
    if (this.clients.has(res)) {
      this.clients.delete(res);
      try {
        res.end();
      } catch {
        // Ignore socket close errors
      }
      logger.info(`Removed SSE client. Remaining clients: ${this.clients.size}`);
    }
  }

  /**
   * Send event to a single client
   */
  private sendToClient(res: Response, event: string, data: any): void {
    try {
      const formattedData = typeof data === 'string' ? data : JSON.stringify(data);
      res.write(`event: ${event}\ndata: ${formattedData}\n\n`);
    } catch (error: any) {
      logger.error(`Error writing to SSE client: ${error.message}`);
      this.removeClient(res);
    }
  }

  /**
   * Broadcast event to all connected clients
   */
  public broadcast(event: string, data: any): void {
    if (this.clients.size === 0) return;

    const formattedData = typeof data === 'string' ? data : JSON.stringify(data);
    const message = `event: ${event}\ndata: ${formattedData}\n\n`;

    for (const client of Array.from(this.clients)) {
      try {
        client.write(message);
      } catch (error: any) {
        logger.error(`Error broadcasting to SSE client: ${error.message}`);
        this.removeClient(client);
      }
    }
  }

  /**
   * Periodic ping heartbeat to prevent client / proxy timeout
   */
  public startHeartbeat(intervalMs = 15000): void {
    if (this.heartbeatInterval) return;

    this.heartbeatInterval = setInterval(() => {
      if (this.clients.size === 0) return;
      const pingMessage = `: heartbeat ping\n\n`;
      for (const client of Array.from(this.clients)) {
        try {
          client.write(pingMessage);
        } catch {
          this.removeClient(client);
        }
      }
    }, intervalMs);
  }

  /**
   * Stop heartbeat
   */
  public stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Get active connection count
   */
  public getConnectedClientsCount(): number {
    return this.clients.size;
  }
}

export const sseManager = new SSEManager();
