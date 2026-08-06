import { Router, type IRouter } from "express";
import { login, requireDashboardAuth } from "../lib/auth";

const router: IRouter = Router();

router.post("/auth/login", (req, res): void => {
  if (typeof req.body?.password !== "string" || !login(req.body.password, res)) {
    res.status(401).json({ error: "Invalid dashboard password" });
    return;
  }
  res.json({ authenticated: true });
});

router.get("/auth/session", requireDashboardAuth, (_req, res): void => {
  res.json({ authenticated: true });
});

export default router;