// @ts-nocheck
import dotenv from 'dotenv';
dotenv.config();

export const config = {
  DASHBOARD_PORT: parseInt(process.env.DASHBOARD_PORT || '3000', 10),
  TELEGRAM_API_ID: parseInt(process.env.TELEGRAM_API_ID || '0', 10),
  TELEGRAM_API_HASH: process.env.TELEGRAM_API_HASH || '',
  TELEGRAM_SESSION: process.env.TELEGRAM_SESSION || '',
  SOURCE_CHANNELS: (process.env.SOURCE_CHANNELS || 'Alpha_Circle1,Maestrosdegen,BRUCECALL0').split(',').map(s => s.trim()),
  PRIVATE_GROUP_ID: process.env.PRIVATE_GROUP_ID || '',
  PUBLIC_CHANNEL_USERNAME: process.env.PUBLIC_CHANNEL_USERNAME || '',
  CONFIDENCE_THRESHOLD: parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.7'),
  ARCC_CONTACT: process.env.ARCC_CONTACT || '@ARCCAdmin',
  PRIVATE_GROUP_LINK: process.env.PRIVATE_GROUP_LINK || 'https://t.me/+example',
  DB_PATH: process.env.DB_PATH || './data/arcc.db',
  WORKER_CONCURRENCY: parseInt(process.env.WORKER_CONCURRENCY || '4', 10),
  HEARTBEAT_INTERVAL: parseInt(process.env.HEARTBEAT_INTERVAL || '30000', 10),
  ENABLE_DASHBOARD: process.env.ENABLE_DASHBOARD !== 'false',
};

export type Config = typeof config;
export default config;
