// @ts-nocheck
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { db } from './db.js';

export function runMigrations(customDb?: Database.Database): void {
  const database = customDb || db();

  // Create tables
  database.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      source_chat_id TEXT NOT NULL,
      source_message_id INTEGER NOT NULL,
      text TEXT,
      raw_text TEXT,
      message_type TEXT,
      has_media INTEGER DEFAULT 0,
      media_info TEXT,
      reply_to_msg_id INTEGER,
      quoted_msg_id INTEGER,
      sender_id TEXT,
      sender_name TEXT,
      is_edit INTEGER DEFAULT 0,
      edit_date INTEGER,
      edit_version INTEGER DEFAULT 0,
      received_at INTEGER,
      processed_at INTEGER,
      processing_status TEXT DEFAULT 'PENDING',
      classification TEXT,
      confidence REAL,
      signal_id TEXT,
      created_at TEXT,
      updated_at TEXT,
      UNIQUE(source_chat_id, source_message_id, edit_version),
      FOREIGN KEY(signal_id) REFERENCES signals(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS signals (
      id TEXT PRIMARY KEY,
      ticker TEXT,
      contract_address TEXT,
      chain TEXT,
      source_chat_id TEXT,
      source_message_id INTEGER,
      destination_chat_id TEXT,
      destination_message_id INTEGER,
      public_message_id INTEGER,
      status TEXT DEFAULT 'NEW',
      follow_up_count INTEGER DEFAULT 0,
      pnl_history TEXT,
      media_refs TEXT,
      reply_chain TEXT,
      cross_source INTEGER DEFAULT 0,
      first_seen_at TEXT,
      last_updated_at TEXT,
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS message_mappings (
      id TEXT PRIMARY KEY,
      source_chat_id TEXT NOT NULL,
      source_message_id INTEGER NOT NULL,
      destination_chat_id TEXT,
      destination_message_id INTEGER,
      signal_id TEXT,
      parent_source_msg_id INTEGER,
      parent_dest_msg_id INTEGER,
      media_ids TEXT,
      processing_status TEXT,
      delivery_status TEXT,
      published_at TEXT,
      created_at TEXT,
      UNIQUE(source_chat_id, source_message_id, destination_chat_id),
      FOREIGN KEY(signal_id) REFERENCES signals(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS pnl_records (
      id TEXT PRIMARY KEY,
      signal_id TEXT,
      message_id TEXT,
      multiplier TEXT,
      percentage TEXT,
      contract_address TEXT,
      raw_text TEXT,
      detected_at TEXT,
      FOREIGN KEY(signal_id) REFERENCES signals(id) ON DELETE CASCADE,
      FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS publishing_log (
      id TEXT PRIMARY KEY,
      source_message_id TEXT,
      destination_chat_id TEXT,
      destination_message_id INTEGER,
      action TEXT,
      mode TEXT,
      success INTEGER DEFAULT 1,
      error TEXT,
      timestamp TEXT,
      FOREIGN KEY(source_message_id) REFERENCES messages(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS media_cache (
      id TEXT PRIMARY KEY,
      source_chat_id TEXT,
      source_message_id INTEGER,
      media_type TEXT,
      file_id TEXT,
      local_path TEXT,
      uploaded_file_id TEXT,
      cached_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sources_config (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      destination TEXT,
      mode TEXT DEFAULT 'SMART',
      confidence_threshold REAL DEFAULT 0.6,
      media_enabled INTEGER DEFAULT 1,
      reply_enabled INTEGER DEFAULT 1,
      formatting_rules TEXT,
      priority INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS health_status (
      id TEXT PRIMARY KEY,
      component TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      last_check TEXT,
      details TEXT
    );

    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      level TEXT NOT NULL,
      component TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Create indexes
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_source ON messages(source_chat_id, source_message_id);
    CREATE INDEX IF NOT EXISTS idx_messages_signal ON messages(signal_id);
    CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);
    CREATE INDEX IF NOT EXISTS idx_signals_ticker ON signals(ticker);
    CREATE INDEX IF NOT EXISTS idx_signals_ca ON signals(contract_address);
    CREATE INDEX IF NOT EXISTS idx_mappings_source ON message_mappings(source_chat_id, source_message_id);
    CREATE INDEX IF NOT EXISTS idx_publishing_log_dest ON publishing_log(destination_chat_id);
  `);

  // Seed default sources if sources_config is empty
  const countStmt = database.prepare('SELECT COUNT(*) as count FROM sources_config');
  const result = countStmt.get() as { count: number };

  if (result.count === 0) {
    const seedSources = ['Alpha_Circle1', 'Maestrosdegen', 'BRUCECALL0'];
    const insertStmt = database.prepare(`
      INSERT INTO sources_config (
        id, channel, destination, mode, confidence_threshold,
        media_enabled, reply_enabled, formatting_rules, priority, enabled, created_at
      ) VALUES (
        ?, ?, NULL, 'SMART', 0.6,
        1, 1, NULL, 0, 1, ?
      )
    `);

    const seedTransaction = database.transaction(() => {
      const now = new Date().toISOString();
      for (const channel of seedSources) {
        insertStmt.run(crypto.randomUUID(), channel, now);
      }
    });

    seedTransaction();
  }
}
