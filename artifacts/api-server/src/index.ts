import app from "./app";
import { logger } from "./lib/logger";
import { scheduleAutoBackups } from "./utils/backupEngine";
import { autoSetupTelegramWebhooks } from "./routes/telegram";
import { runStartupMigrations, runBackgroundIndexOptimization } from "./utils/startupMigrations";
import { startAutopilotScheduler } from "./utils/autopilotScheduler";
import { startRecurringInvoiceScheduler } from "./utils/recurringInvoiceScheduler";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  // Run migrations first, then start schedulers that depend on DB tables
  runStartupMigrations()
    .catch(() => {})
    .finally(() => {
      // Recurring invoice scheduler needs recurring_invoices table (created in FIX-H)
      startRecurringInvoiceScheduler();

      // ── Background index optimization ───────────────────────────────────
      // Runs AFTER the server is fully up and health checks have passed.
      // Uses CREATE INDEX CONCURRENTLY — never blocks reads/writes/deploys.
      // On subsequent restarts, IF NOT EXISTS makes each call a <1ms no-op.
      setTimeout(() => {
        runBackgroundIndexOptimization().catch((err) =>
          logger.warn({ err }, "[BgIndex] background optimization failed (non-fatal)"),
        );
      }, 5_000); // 5s delay — ensures health checks pass first
    });
  scheduleAutoBackups();
  if (process.env["NODE_ENV"] !== "test") startAutopilotScheduler();

  // Auto-register Telegram webhooks for all configured orgs.
  // Priority: PUBLIC_URL (production) > REPLIT_DEV_DOMAIN (dev IDE open) > localhost (fallback, not reachable externally)
  const publicBase =
    process.env.PUBLIC_URL
      ? process.env.PUBLIC_URL
      : process.env.REPLIT_DEV_DOMAIN
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : `http://localhost:${port}`;
  autoSetupTelegramWebhooks(publicBase).catch((e) =>
    logger.error({ err: e }, "Telegram auto-webhook setup failed"),
  );
});
