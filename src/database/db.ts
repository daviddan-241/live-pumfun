// @ts-nocheck
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

let instance: Database.Database | null = null;

export function getInstance(customPath?: string): Database.Database {
  if (!instance) {
    const dbPath = customPath || process.env.DB_PATH || './data/arcc.db';
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    instance = new Database(dbPath);
    instance.pragma('journal_mode = WAL');
  }
  return instance;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}

export function db(): Database.Database {
  return getInstance();
}

export default db;
