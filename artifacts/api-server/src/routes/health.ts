import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { sql } from "drizzle-orm";
import { db, logsTable, settingsTable } from "@workspace/db";
import { and, desc, eq, gt } from "drizzle-orm";

const router: IRouter = Router();
const startedAt = Date.now();

router.get("/healthz", async (_req, res): Promise<void> => {
  let database: "connected" | "unavailable" = "connected";
  try {
    await db.execute(sql`select 1`);
  } catch {
    database = "unavailable";
  }
  const [settings] = await db.select().from(settingsTable).limit(1);
  const [heartbeat] = await db.select().from(logsTable)
    .where(and(
      eq(logsTable.service, "worker"),
      eq(logsTable.message, "heartbeat"),
      gt(logsTable.createdAt, new Date(Date.now() - 90_000)),
    ))
    .orderBy(desc(logsTable.createdAt))
    .limit(1);
  const heartbeatMetadata = heartbeat?.metadata as { telegram?: boolean } | null | undefined;
  const telegramConfigured = Boolean(
    settings?.telegramApiIdEncrypted &&
    settings.telegramApiHashEncrypted &&
    settings.telegramSessionEncrypted,
  );
  const telegram = !telegramConfigured
    ? "not_configured"
    : heartbeatMetadata?.telegram
      ? "connected"
      : "disconnected";
  const redis = process.env.REDIS_URL ? "connected" : "not_configured";
  const data = HealthCheckResponse.parse({
    status: database === "connected" ? "ok" : "degraded",
    service: "arcc-api",
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    telegram,
    database,
    redis,
  });
  res.status(database === "connected" ? 200 : 503).json(data);
});

export default router;