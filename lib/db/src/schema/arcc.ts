import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const channelsTable = pgTable("arcc_channels", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  kind: text("kind").notNull().default("source"),
  status: text("status").notNull().default("monitoring"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  messagesToday: integer("messages_today").notNull().default(0),
  errorMessage: text("error_message"),
});

export const callsTable = pgTable("arcc_calls", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  tokenName: text("token_name").notNull(),
  chain: text("chain").notNull(),
  contract: text("contract").notNull().unique(),
  status: text("status").notNull().default("pending"),
  confidence: numeric("confidence", { precision: 5, scale: 2 }).notNull(),
  risk: text("risk").notNull(),
  narrative: text("narrative").notNull(),
  observations: jsonb("observations").$type<string[]>().notNull(),
  sourceChannels: jsonb("source_channels").$type<string[]>().notNull(),
  sourceMessageId: integer("source_message_id"),
  sourceMessageUrl: text("source_message_url"),
  sourceText: text("source_text"),
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishRequested: boolean("publish_requested").notNull().default(false),
  multiplier: numeric("multiplier", { precision: 10, scale: 2 }),
  milestone: text("milestone"),
  market: jsonb("market").$type<{
    marketCap: number | null;
    liquidity: number | null;
    volume24h: number | null;
    holders: number | null;
    age: string | null;
    priceChange24h?: number | null;
  }>().notNull(),
});

export const messagesTable = pgTable("arcc_messages", {
  id: serial("id").primaryKey(),
  sourceChannel: text("source_channel").notNull(),
  telegramMessageId: integer("telegram_message_id").notNull(),
  textHash: text("text_hash").notNull(),
  contract: text("contract"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  sourceMessageUnique: unique().on(table.sourceChannel, table.telegramMessageId),
}));

export const activityTable = pgTable("arcc_activity", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
});

export const logsTable = pgTable("arcc_logs", {
  id: serial("id").primaryKey(),
  level: text("level").notNull(),
  service: text("service").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
});

export const settingsTable = pgTable("arcc_settings", {
  id: serial("id").primaryKey(),
  destinationChannel: text("destination_channel").notNull(),
  llmProvider: text("llm_provider").notNull(),
  autoPublish: boolean("auto_publish").notNull().default(false),
  mediaRepost: boolean("media_repost").notNull().default(true),
  minimumConfidence: numeric("minimum_confidence", { precision: 5, scale: 2 }).notNull(),
  duplicateWindowHours: integer("duplicate_window_hours").notNull(),
  telegramApiIdEncrypted: text("telegram_api_id_encrypted"),
  telegramApiHashEncrypted: text("telegram_api_hash_encrypted"),
  telegramSessionEncrypted: text("telegram_session_encrypted"),
  telegramBotTokenEncrypted: text("telegram_bot_token_encrypted"),
  geminiApiKeyEncrypted: text("gemini_api_key_encrypted"),
  credentialsUpdatedAt: timestamp("credentials_updated_at", { withTimezone: true }),
});

export const insertChannelSchema = createInsertSchema(channelsTable).omit({ id: true });
export const insertCallSchema = createInsertSchema(callsTable).omit({ id: true });
export const insertActivitySchema = createInsertSchema(activityTable).omit({ id: true, createdAt: true });
export const insertLogSchema = createInsertSchema(logsTable).omit({ id: true, createdAt: true });
export const insertSettingsSchema = createInsertSchema(settingsTable).omit({ id: true });
export type Channel = typeof channelsTable.$inferSelect;
export type Call = typeof callsTable.$inferSelect;
export type Activity = typeof activityTable.$inferSelect;
export type Log = typeof logsTable.$inferSelect;
export type Settings = typeof settingsTable.$inferSelect;
export type InsertChannel = z.infer<typeof insertChannelSchema>;