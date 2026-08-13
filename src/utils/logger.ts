// @ts-nocheck
/**
 * Logging utility using Winston.
 *
 * Provides structured logging with console, rotating file transport,
 * component-tagged child loggers, and automatic persistence to database
 * logs table via repository functions for dashboard display.
 */

import winston from 'winston';
import Transport from 'winston-transport';
import { insertLog } from '../database/repositories.js';

/**
 * Custom Winston transport that persists log records to the database.
 */
class DatabaseTransport extends Transport {
  constructor(opts?: Transport.TransportStreamOptions) {
    super(opts);
  }

  log(info: any, callback: () => void) {
    setImmediate(() => {
      this.emit('logged', info);
    });

    const level = info.level || 'info';
    const message = typeof info.message === 'string' ? info.message : JSON.stringify(info.message);
    const component = info.component || 'system';
    const timestamp = info.timestamp || new Date().toISOString();

    insertLog({
      level,
      message,
      component,
      timestamp,
      metadata: info.metadata || info.context,
    }).catch(() => {
      // Fire-and-forget: do not throw on log database insertion error
    });

    callback();
  }
}

/**
 * Custom format combiner for consistent output formatting.
 */
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, component, message, stack }) => {
    const compTag = component ? `[${component}]` : '[ARCC]';
    const outputMessage = stack || message;
    return `[${timestamp}] [${level.toUpperCase()}] ${compTag} ${outputMessage}`;
  })
);

/**
 * Base winston logger instance configured with console, rotating file, and database transports.
 */
export const logger = winston.createLogger({
  levels: winston.config.npm.levels, // error: 0, warn: 1, info: 2, debug: 5
  level: process.env.LOG_LEVEL || 'debug',
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        logFormat
      ),
    }),
    new winston.transports.File({
      filename: './logs/arcc.log',
      maxsize: 10485760, // 10MB per file
      maxFiles: 5,
      tailable: true,
    }),
    new DatabaseTransport(),
  ],
  exceptionHandlers: [
    new winston.transports.File({ filename: './logs/exceptions.log' }),
  ],
  rejectionHandlers: [
    new winston.transports.File({ filename: './logs/rejections.log' }),
  ],
});

/**
 * Creates a child logger tagged with a specific component name.
 *
 * @param component - Name of the subsystem or module (e.g. 'Classifier', 'Tracker', 'CA')
 * @returns Winston child logger pre-configured with the component field
 */
export function createLogger(component: string): winston.Logger {
  return logger.child({ component });
}

export default logger;
