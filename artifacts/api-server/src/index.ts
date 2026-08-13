import app from "./app";
import { logger } from "./lib/logger";
import { scheduleAutoBackups } from "./utils/backupEngine";
import { autoSetupTelegramWebhooks } from "./routes/telegram";
import { runStartupMigrations } from "./utils/startupMigrations";
import { startAutopilotScheduler } from "./utils/autopilotScheduler";
import { startRecurringInvoiceScheduler } from "./utils/recurringInvoiceScheduler";
import { initAIE } from "./aie";

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
      // AIE starts after migrations so event handlers can safely query DB tables
      initAIE();
    });
  scheduleAutoBackups();
  if (process.env["NODE_ENV"] !== "test") startAutopilotScheduler();

  // Auto-register Telegram webhooks for all configured orgs.
  // Priority: PUBLIC_URL (env override) > hardcoded production domain.
  // NOTE: this backend runs on Render, never on Replit — REPLIT_DEV_DOMAIN
  // is intentionally not consulted here anymore (it doesn't exist on Render,
  // and falling back to localhost silently broke auto-registration on every
  // deploy, since Telegram rejects non-public webhook URLs).
  const publicBase = process.env.PUBLIC_URL || "https://www.omnitech-core.com";
  logger.info({ publicBase }, "Auto-registrando webhooks de Telegram con esta base URL");
  autoSetupTelegramWebhooks(publicBase).catch((e) =>
    logger.error({ err: e }, "Telegram auto-webhook setup failed"),
  );
});
