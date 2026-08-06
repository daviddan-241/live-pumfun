import { Router, type IRouter } from "express";
import healthRouter from "./health";
import arccRouter from "./arcc";
import authRouter from "./auth";
import { requireDashboardAuth } from "../lib/auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(requireDashboardAuth);
router.use(arccRouter);

export default router;
