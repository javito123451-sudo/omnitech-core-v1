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
import { resolvePermissions } from "../middlewares/permissions";
import { backupRouter } from "./backup";
import { knowledgeBaseRouter } from "./knowledge-base";
import { docsRouter } from "./docs";
import { autopilotRouter } from "./autopilot";
import { accountingRouter, publicAccountingRouter } from "./accounting";
import { portalRouter } from "./portal";
import { diagnosticsRouter } from "./diagnostics";
import { dashboardRouter } from "./dashboard";
import { pipelineRouter } from "./pipeline";
import { onboardingRouter } from "./onboarding";
import { supportRouter } from "./support";
import { taxRouter } from "./tax";
import { marketingRouter } from "./marketing";
import { adsRouter } from "./ads";
import { leadsRouter } from "./leads";
import { aceRouter } from "./ace";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);

// ── Client portal — public GET endpoints (no Clerk auth on reads) ─────────────
// POST /portal/token uses its own requireAuth internally
router.use("/portal", portalRouter);

// ── Public invoice viewer — no auth, token-gated ──────────────────────────────
router.use("/accounting-public", publicAccountingRouter);

// ── Control Center — uses its own requireSuperAdmin middleware ─────────────────
router.use("/control-center", controlCenterRouter);
router.use("/backups", backupRouter);
router.use("/invitations", invitationsRouter);

// ── WhatsApp webhook — public (Meta calls this without auth) ──────────────────
router.use("/whatsapp", whatsappWebhookRouter);

// ── Telegram webhook — public (Telegram calls this without auth) ──────────────
router.use("/telegram", telegramWebhookRouter);

router.use(requireAuth, resolveOrg, resolvePermissions);

router.use("/organizations", organizationsRouter);
router.use("/clients",       clientsRouter);
router.use("/appointments",  appointmentsRouter);
router.use("/messages",      messagesRouter);
router.get("/conversations", conversationsHandler);
router.use("/stats",         requireModule("analytics"), statsRouter);

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

// ── Module-gated routes — requireModule enforces DB module_configs per org ────
router.use("/calendar-ai",   requireModule("crm"),            calendarAiRouter);
router.use("/memory",        requireModule("ai_agents"),       memoryRouter);
router.use("/quotes",        requireModule("crm"),             quotesRouter);
router.use("/executive",     requireModule("analytics"),       executiveRouter);
router.use("/whatsapp",      requireModule("whatsapp"),        whatsappRouter);
router.use("/telegram",      requireModule("ai_agents"),       telegramRouter);
router.use("/integrations",  requireModule("integrations"),    integrationsRouter);
router.use("/import",        requireModule("omni_import_ai"),  importAiRouter);
router.use("/knowledge-base",requireModule("knowledge_base"),   knowledgeBaseRouter);
router.use("/docs",          requireModule("omni_docs"),       docsRouter);
router.use("/autopilot",     requireModule("automations"),     autopilotRouter);
router.use("/accounting",    requireModule("omni_accounting"), accountingRouter);
router.use("/diagnostics",    requireModule("omni_diagnostics"), diagnosticsRouter);
router.use("/dashboard",      dashboardRouter);
router.use("/pipeline",       requireModule("crm"), pipelineRouter);
router.use("/onboarding",     onboardingRouter);
router.use("/support",        supportRouter);
router.use("/tax",            requireModule("omni_tax"), taxRouter);
router.use("/marketing",      requireModule("omni_marketing"), marketingRouter);
router.use("/ads",            requireModule("omni_ads"),       adsRouter);
router.use("/leads",          requireModule("omni_leads"),     leadsRouter);

// ── Ava Context Engine — lightweight context sync, no module gate ─────────
router.use("/ace", aceRouter);

export default router;
