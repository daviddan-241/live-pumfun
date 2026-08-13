// @ts-nocheck
import { Router, Request, Response } from 'express';
import {
  getMessages,
  getSignals,
  getSignalById,
  getMappings,
  getPublishingLogs,
  getSourcesConfig,
  saveSourceConfig,
  toggleSource,
  getHealthStatuses,
  getLogs,
  getPnlRecords,
  getSettings,
  saveSettings,
  DBSourceConfig,
} from '../database/repositories.js';
import { getHealthSummary } from '../workers/health.js';
import { queueManager } from '../workers/queue.ts';
import { getClient } from '../telegram/client.js';
import { listener } from '../telegram/listener.js';
import config from '../config.js';

export const router = Router();

// GET /api/status - overall system status
router.get('/status', (req: Request, res: Response) => {
  const telegramClient = getClient();
  const telegramStatus = telegramClient.isConnected() ? 'CONNECTED' : 'DISCONNECTED';
  const monitoringStatus = listener.isListening() ? 'ACTIVE' : 'STOPPED';
  const queueHealth = queueManager.getQueueHealth();
  const workerHealth = queueHealth.size > 100 ? 'DEGRADED' : 'HEALTHY';

  res.json({
    telegram: telegramStatus,
    monitoring: monitoringStatus,
    worker: workerHealth,
    queue: queueHealth,
    sseClients: sseManagerCount(),
    timestamp: Date.now(),
  });
});

// Helper for SSE client count
function sseManagerCount(): number {
  try {
    const { sseManager } = require('./sse.js');
    return sseManager.getConnectedClientsCount();
  } catch {
    return 0;
  }
}

// GET /api/sources - list all sources
router.get('/sources', (req: Request, res: Response) => {
  let sources = getSourcesConfig();
  if (!sources || sources.length === 0) {
    // Return default channels if DB empty
    sources = config.SOURCE_CHANNELS.map((name, index) => ({
      id: `source_${index + 1}`,
      name,
      enabled: 1,
      mode: 'auto',
      priority: index === 0 ? 10 : 5,
      updated_at: Date.now(),
    }));
    // Seed DB
    for (const s of sources) {
      saveSourceConfig(s);
    }
  }
  res.json(sources);
});

// POST /api/sources - add new source
router.post('/sources', (req: Request, res: Response) => {
  const { name, enabled = true, mode = 'auto', priority = 5 } = req.body;
  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'Name is required' });
    return;
  }
  const id = `source_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
  const newSource: DBSourceConfig = {
    id,
    name,
    enabled: enabled ? 1 : 0,
    mode,
    priority: Number(priority) || 5,
    updated_at: Date.now(),
  };
  saveSourceConfig(newSource);
  res.status(201).json(newSource);
});

// POST /api/sources/:id/toggle - enable/disable a source
router.post('/sources/:id/toggle', (req: Request, res: Response) => {
  const { id } = req.params;
  const { enabled } = req.body;
  const updated = toggleSource(id, typeof enabled === 'boolean' ? enabled : undefined);
  if (!updated) {
    res.status(404).json({ error: 'Source not found' });
    return;
  }
  res.json(updated);
});

// PUT /api/sources/:id - update source config
router.put('/sources/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, enabled, mode, priority } = req.body;

  const existing = getSourcesConfig().find((s) => s.id === id);
  if (!existing) {
    res.status(404).json({ error: 'Source not found' });
    return;
  }

  const updated: DBSourceConfig = {
    id,
    name: name !== undefined ? String(name) : existing.name,
    enabled: enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
    mode: mode !== undefined ? String(mode) : existing.mode,
    priority: priority !== undefined ? Number(priority) : existing.priority,
    updated_at: Date.now(),
  };

  saveSourceConfig(updated);
  res.json(updated);
});

// GET /api/signals - list signals with pagination & filters
router.get('/signals', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const page = parseInt(req.query.page as string) || 1;
  const offset = (page - 1) * limit;
  const status = req.query.status as string;
  const search = req.query.search as string;

  const signals = getSignals({ limit, offset, status, search });
  res.json({
    page,
    limit,
    data: signals,
  });
});

// GET /api/signals/:id - signal detail with lifecycle
router.get('/signals/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const signal = getSignalById(id);
  if (!signal) {
    res.status(404).json({ error: 'Signal not found' });
    return;
  }

  // Related messages, mappings, and PNL records
  const messages = getMessages({ limit: 20 }).filter((m) => m.text?.includes(signal.ticker));
  const pnl = getPnlRecords(50).filter((p) => p.signal_id === signal.id || p.ticker === signal.ticker);

  res.json({
    ...signal,
    lifecycle: {
      messages,
      pnl,
    },
  });
});

// GET /api/messages - recent messages with filters
router.get('/messages', (req: Request, res: Response) => {
  const classification = req.query.classification as string;
  const source = req.query.source as string;
  const status = req.query.status as string;
  const limit = parseInt(req.query.limit as string) || 50;
  const page = parseInt(req.query.page as string) || 1;
  const offset = (page - 1) * limit;

  const messages = getMessages({ classification, source, status, limit, offset });
  res.json({
    page,
    limit,
    data: messages,
  });
});

// GET /api/pnl - PNL records
router.get('/pnl', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const records = getPnlRecords(limit);
  res.json(records);
});

// GET /api/mappings - message mappings
router.get('/mappings', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const mappings = getMappings(limit);
  res.json(mappings);
});

// GET /api/logs - recent logs with level filter, pagination
router.get('/logs', (req: Request, res: Response) => {
  const level = req.query.level as string;
  const component = req.query.component as string;
  const search = req.query.search as string;
  const limit = parseInt(req.query.limit as string) || 100;
  const page = parseInt(req.query.page as string) || 1;
  const offset = (page - 1) * limit;

  const logs = getLogs({ level, component, search, limit, offset });
  res.json({
    page,
    limit,
    data: logs,
  });
});

// GET /api/publishing-log - publishing log
router.get('/publishing-log', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const logs = getPublishingLogs(limit);
  res.json(logs);
});

// GET /api/health - component health status
router.get('/health', (req: Request, res: Response) => {
  const summary = getHealthSummary();
  res.json(summary);
});

// GET /api/settings - get settings
router.get('/settings', (req: Request, res: Response) => {
  const stored = getSettings();
  const currentSettings = {
    CONFIDENCE_THRESHOLD: stored.CONFIDENCE_THRESHOLD || String(config.CONFIDENCE_THRESHOLD),
    ARCC_CONTACT: stored.ARCC_CONTACT || config.ARCC_CONTACT,
    PRIVATE_GROUP_LINK: stored.PRIVATE_GROUP_LINK || config.PRIVATE_GROUP_LINK,
    WORKER_CONCURRENCY: stored.WORKER_CONCURRENCY || String(config.WORKER_CONCURRENCY),
    HEARTBEAT_INTERVAL: stored.HEARTBEAT_INTERVAL || String(config.HEARTBEAT_INTERVAL),
    FORMATTING_RULES: stored.FORMATTING_RULES || 'Standard Call Template',
    MEDIA_RULES: stored.MEDIA_RULES || 'Auto-attach chart images',
  };
  res.json(currentSettings);
});

// PUT /api/settings - update settings
router.put('/settings', (req: Request, res: Response) => {
  const newSettings = req.body;
  if (!newSettings || typeof newSettings !== 'object') {
    res.status(400).json({ error: 'Invalid settings body' });
    return;
  }

  saveSettings(newSettings);
  res.json({ success: true, settings: getSettings() });
});
