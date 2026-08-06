import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db, channelsTable, callsTable, activityTable, logsTable, settingsTable } from "@workspace/db";
import {
  CreateChannelBody,
  GetCallParams,
  GetDashboardActivityQueryParams,
  GetDashboardActivityResponse,
  GetDashboardSummaryResponse,
  GetCallResponse,
  GetSettingsResponse,
  ListChannelsResponse,
  ListCallsQueryParams,
  ListCallsResponse,
  ListLogsQueryParams,
  ListLogsResponse,
  ReviewCallBody,
  ReviewCallParams,
  UpdateChannelBody,
  UpdateChannelParams,
  UpdateSettingsBody,
  UpdateSettingsResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { encryptSecret, hasSecret } from "../lib/secrets";

const router: IRouter = Router();
const asNumber = (value: string | number | null): number | null =>
  value == null ? null : Number(value);
const asMarket = (market: Record<string, unknown>) => ({
  marketCap: typeof market.marketCap === "number" ? market.marketCap : null,
  liquidity: typeof market.liquidity === "number" ? market.liquidity : null,
  volume24h: typeof market.volume24h === "number" ? market.volume24h : null,
  holders: typeof market.holders === "number" ? market.holders : null,
  age: typeof market.age === "string" ? market.age : null,
  priceChange24h: typeof market.priceChange24h === "number" ? market.priceChange24h : null,
});
const mapCall = (call: typeof callsTable.$inferSelect) => ({
  ...call,
  confidence: Number(call.confidence),
  multiplier: asNumber(call.multiplier),
  milestone: call.milestone as "2x" | "5x" | "10x" | "25x" | "50x" | null,
  market: asMarket(call.market),
});
const mapSettings = (settings: typeof settingsTable.$inferSelect) => ({
  ...settings,
  minimumConfidence: Number(settings.minimumConfidence),
});

async function ensureInitialized(): Promise<void> {
  const [settings] = await db.select().from(settingsTable).limit(1);
  if (!settings) {
    await db.insert(settingsTable).values({
      destinationChannel: process.env.TELEGRAM_DESTINATION_CHANNEL ?? "",
      llmProvider: process.env.LLM_PROVIDER ?? "gemini",
      autoPublish: false,
      mediaRepost: false,
      minimumConfidence: "72",
      duplicateWindowHours: 48,
    });
  }
  const channels = await db.select().from(channelsTable);
  const configuredSources = (process.env.TELEGRAM_SOURCE_CHANNELS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (channels.length === 0 && configuredSources.length > 0) {
    await db.insert(channelsTable).values(configuredSources.map((username) => ({
      username: username.startsWith("@") ? username : `@${username}`,
      displayName: username.replace(/^@/, ""),
      kind: "source",
      status: "monitoring",
      lastSeenAt: null,
      messagesToday: 0,
    })));
  }
  const destination = process.env.TELEGRAM_DESTINATION_CHANNEL?.trim();
  if (destination && !(await db.select().from(channelsTable).where(eq(channelsTable.username, destination)).limit(1)).length) {
    await db.insert(channelsTable).values({
      username: destination.startsWith("@") ? destination : `@${destination}`,
      displayName: destination.replace(/^@/, ""),
      kind: "destination",
      status: "monitoring",
      lastSeenAt: null,
      messagesToday: 0,
    });
  }
}

router.use(async (_req, _res, next) => {
  try {
    await ensureInitialized();
    next();
  } catch (error) {
    logger.error({ error }, "Unable to initialize ARCC data");
    next(error);
  }
});

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const [channels, calls, settings] = await Promise.all([
    db.select().from(channelsTable),
    db.select().from(callsTable),
    db.select().from(settingsTable).limit(1),
  ]);
  const published = calls.filter((call) => call.status === "published");
  const wins = published.filter((call) => Number(call.multiplier ?? 0) >= 2);
  const summary = GetDashboardSummaryResponse.parse({
    monitoredChannels: channels.filter((channel) => channel.kind === "source").length,
    activeChannels: channels.filter((channel) => channel.status === "monitoring").length,
    detectedCalls: calls.length,
    pendingReview: calls.filter((call) => call.status === "pending").length,
    publishedCalls: published.length,
    duplicateQueue: calls.filter((call) => call.status === "duplicate").length,
    winRate: published.length ? Math.round((wins.length / published.length) * 100) : 0,
    uptimeSeconds: Math.floor(process.uptime()),
     confidenceHistory: calls
       .slice()
       .sort((a, b) => a.detectedAt.getTime() - b.detectedAt.getTime())
       .slice(-12)
       .map((call) => ({ label: call.detectedAt.toISOString(), value: Number(call.confidence) })),
  });
  res.json(summary);
});

router.get("/dashboard/activity", async (req, res): Promise<void> => {
  const parsed = GetDashboardActivityQueryParams.safeParse(req.query);
  const limit = parsed.success ? Number(parsed.data.limit ?? 25) : 25;
  const data = await db.select().from(activityTable).orderBy(desc(activityTable.createdAt)).limit(limit);
  res.json(GetDashboardActivityResponse.parse(data));
});

router.get("/channels", async (_req, res): Promise<void> => {
  res.json(ListChannelsResponse.parse(await db.select().from(channelsTable).orderBy(channelsTable.id)));
});

router.post("/channels", async (req, res): Promise<void> => {
  const parsed = CreateChannelBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const username = parsed.data.username.startsWith("@") ? parsed.data.username : `@${parsed.data.username}`;
  const [channel] = await db.insert(channelsTable).values({
    username,
    displayName: parsed.data.displayName ?? username.slice(1),
    kind: "source",
    status: "monitoring",
    lastSeenAt: new Date(),
    messagesToday: 0,
  }).returning();
  res.status(201).json(channel);
});

router.patch("/channels/:channelId", async (req, res): Promise<void> => {
  const params = UpdateChannelParams.safeParse(req.params);
  const parsed = UpdateChannelBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({ error: "Invalid channel update" }); return; }
  const [channel] = await db.update(channelsTable).set(parsed.data).where(eq(channelsTable.id, params.data.channelId)).returning();
  if (!channel) { res.status(404).json({ error: "Channel not found" }); return; }
  res.json(channel);
});

router.get("/calls", async (req, res): Promise<void> => {
  const parsed = ListCallsQueryParams.safeParse(req.query);
  const query = parsed.success ? parsed.data : { status: "all", limit: 25, search: undefined };
  const filters = [];
  if (query.status !== "all") filters.push(eq(callsTable.status, query.status));
  if (query.search) filters.push(or(ilike(callsTable.ticker, `%${query.search}%`), ilike(callsTable.tokenName, `%${query.search}%`), ilike(callsTable.contract, `%${query.search}%`)));
  const rows = await db.select().from(callsTable).where(filters.length ? and(...filters) : undefined).orderBy(desc(callsTable.detectedAt)).limit(Number(query.limit ?? 25));
  res.json(ListCallsResponse.parse(rows.map(mapCall)));
});

router.get("/calls/:callId", async (req, res): Promise<void> => {
  const params = GetCallParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, params.data.callId));
  if (!call) { res.status(404).json({ error: "Call not found" }); return; }
  res.json(GetCallResponse.parse(mapCall(call)));
});

router.post("/calls/:callId/review", async (req, res): Promise<void> => {
  const params = ReviewCallParams.safeParse(req.params);
  const parsed = ReviewCallBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({ error: "Invalid review" }); return; }
   const [call] = await db.update(callsTable).set({
     status: parsed.data.action === "approve" ? "pending" : "rejected",
     publishRequested: parsed.data.action === "approve",
     publishedAt: null,
  }).where(eq(callsTable.id, params.data.callId)).returning();
  if (!call) { res.status(404).json({ error: "Call not found" }); return; }
   await db.insert(activityTable).values({ kind: parsed.data.action === "approve" ? "system" : "system", message: `${call.ticker} ${parsed.data.action === "approve" ? "approved and queued for Telegram publishing" : "rejected during review"}`, metadata: { callId: call.id } });
  res.json(mapCall(call));
});

router.get("/settings", async (_req, res): Promise<void> => {
  const [settings] = await db.select().from(settingsTable).limit(1);
  res.json(GetSettingsResponse.parse(mapSettings(settings)));
});

router.get("/credentials/status", async (_req, res): Promise<void> => {
  const [settings] = await db.select().from(settingsTable).limit(1);
  res.json({
    telegramApiIdConfigured: hasSecret(settings?.telegramApiIdEncrypted ?? null),
    telegramApiHashConfigured: hasSecret(settings?.telegramApiHashEncrypted ?? null),
    telegramSessionConfigured: hasSecret(settings?.telegramSessionEncrypted ?? null),
    telegramBotTokenConfigured: hasSecret(settings?.telegramBotTokenEncrypted ?? null),
    geminiApiKeyConfigured: hasSecret(settings?.geminiApiKeyEncrypted ?? null),
  });
});

router.patch("/credentials", async (req, res): Promise<void> => {
  const values = req.body as Record<string, unknown>;
  const fields: Record<string, string | Date | undefined> = {};
  const mapping = {
    telegramApiId: "telegramApiIdEncrypted",
    telegramApiHash: "telegramApiHashEncrypted",
    telegramSession: "telegramSessionEncrypted",
    telegramBotToken: "telegramBotTokenEncrypted",
    geminiApiKey: "geminiApiKeyEncrypted",
  } as const;
  for (const [input, column] of Object.entries(mapping)) {
    if (typeof values[input] === "string" && values[input].trim()) {
      fields[column] = encryptSecret(values[input].trim());
    }
  }
  if (!Object.keys(fields).length) {
    res.status(400).json({ error: "At least one credential value is required" });
    return;
  }
  const [existing] = await db.select().from(settingsTable).limit(1);
  const [updated] = await db.update(settingsTable)
    .set({ ...fields, credentialsUpdatedAt: new Date() })
    .where(eq(settingsTable.id, existing.id))
    .returning();
  res.json({
    telegramApiIdConfigured: hasSecret(updated.telegramApiIdEncrypted),
    telegramApiHashConfigured: hasSecret(updated.telegramApiHashEncrypted),
    telegramSessionConfigured: hasSecret(updated.telegramSessionEncrypted),
    telegramBotTokenConfigured: hasSecret(updated.telegramBotTokenEncrypted),
    geminiApiKeyConfigured: hasSecret(updated.geminiApiKeyEncrypted),
  });
});

router.patch("/settings", async (req, res): Promise<void> => {
  const parsed = UpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [existing] = await db.select().from(settingsTable).limit(1);
  const [settings] = await db.update(settingsTable).set({
    ...parsed.data,
    minimumConfidence: parsed.data.minimumConfidence == null ? undefined : String(parsed.data.minimumConfidence),
  }).where(eq(settingsTable.id, existing.id)).returning();
  res.json(UpdateSettingsResponse.parse(mapSettings(settings)));
});

router.get("/logs", async (req, res): Promise<void> => {
  const parsed = ListLogsQueryParams.safeParse(req.query);
  const limit = parsed.success ? Number(parsed.data.limit ?? 25) : 25;
  const data = await db.select().from(logsTable).orderBy(desc(logsTable.createdAt)).limit(limit);
  res.json(ListLogsResponse.parse(data));
});

export default router;