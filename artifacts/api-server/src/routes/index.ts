import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import type { Request } from "express";
import healthRouter from "./health";
import { clientsRouter } from "./clients";
import { appointmentsRouter } from "./appointments";
import { messagesRouter, conversationsHandler } from "./messages";
import { statsRouter } from "./stats";
import { chatRouter } from "./chat";
import { calendarAiRouter } from "./calendar-ai";
import { authRouter } from "./auth";
import { organizationsRouter } from "./organizations";
import { invitationsRouter } from "./invitations";
import { memoryRouter } from "./memory";
import { quotesRouter } from "./quotes";
import { executiveRouter } from "./executive";
import { whatsappRouter, whatsappWebhookRouter } from "./whatsapp";
import { telegramRouter, telegramWebhookRouter } from "./telegram";
import { integrationsRouter } from "./integrations";
import { requireAuth, resolveOrg } from "../middlewares/auth";
import { controlCenterRouter } from "./control-center";
import { importAiRouter } from "./import-ai";
import { requireModule } from "../middlewares/requireModule";
import { backupRouter } from "./backup";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);

// ── Control Center — uses its own requireSuperAdmin middleware ─────────────────
router.use("/control-center", controlCenterRouter);
router.use("/backups", backupRouter);
router.use("/invitations", invitationsRouter);

// ── WhatsApp webhook — public (Meta calls this without auth) ──────────────────
router.use("/whatsapp", whatsappWebhookRouter);

// ── Telegram webhook — public (Telegram calls this without auth) ──────────────
router.use("/telegram", telegramWebhookRouter);

router.use(requireAuth, resolveOrg);

router.use("/organizations", organizationsRouter);
router.use("/clients", clientsRouter);
router.use("/appointments", appointmentsRouter);
router.use("/messages", messagesRouter);
router.get("/conversations", conversationsHandler);
router.use("/stats", statsRouter);

// ── Stricter rate limit for AI chat: 20 req/min keyed by org+user ────────────
const chatLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Límite de mensajes alcanzado. Espera un momento antes de continuar." },
  // Key by org+user for authenticated requests (bypasses IP-based limits per org)
  // validate.keyGeneratorIpFallback disabled because we key on orgId, not IP
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req: Request) => {
    const r = req as Request & { orgId?: number; userId?: number };
    return r.orgId ? `org:${r.orgId}:uid:${r.userId ?? "anon"}` : (req.ip ?? "anon");
  },
});
router.use("/chat", chatLimiter);
router.use("/chat", chatRouter);

router.use("/calendar-ai", calendarAiRouter);
router.use("/memory", memoryRouter);
router.use("/quotes", quotesRouter);
router.use("/executive", executiveRouter);
router.use("/whatsapp", whatsappRouter);
router.use("/telegram", telegramRouter);
router.use("/integrations", integrationsRouter);
router.use("/import", importAiRouter);

export default router;
