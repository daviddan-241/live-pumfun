import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

const COOKIE = "arcc_session";

function configuredPassword(): string {
  const password = process.env.ARCC_DASHBOARD_PASSWORD;
  if (!password) throw new Error("ARCC_DASHBOARD_PASSWORD is required");
  return password;
}

function signature(value: string): string {
  return createHmac("sha256", configuredPassword()).update(value).digest("hex");
}

function validCookie(value: string | undefined): boolean {
  if (!value) return false;
  const [payload, digest] = value.split(".");
  if (!payload || !digest) return false;
  const expected = signature(payload);
  return digest.length === expected.length && timingSafeEqual(Buffer.from(digest), Buffer.from(expected));
}

export function requireDashboardAuth(req: Request, res: Response, next: NextFunction): void {
  if (!process.env.ARCC_DASHBOARD_PASSWORD) {
    res.status(503).json({ error: "Dashboard password is not configured" });
    return;
  }
  if (!validCookie(req.cookies?.[COOKIE])) {
    res.status(401).json({ error: "Dashboard authentication required" });
    return;
  }
  next();
}

export function login(password: string, res: Response): boolean {
  if (!process.env.ARCC_DASHBOARD_PASSWORD || password !== process.env.ARCC_DASHBOARD_PASSWORD) return false;
  const payload = Buffer.from(`${Date.now()}`).toString("base64url");
  res.cookie(COOKIE, `${payload}.${signature(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });
  return true;
}