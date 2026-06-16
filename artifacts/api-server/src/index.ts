import app from "./app";
import { logger } from "./lib/logger";
import { scheduleAutoBackups } from "./utils/backupEngine";
import { autoSetupTelegramWebhooks } from "./routes/telegram";

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
  scheduleAutoBackups();

  // Auto-register Telegram webhooks for all configured orgs
  const publicBase =
    process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : process.env.PUBLIC_URL ?? `http://localhost:${port}`;
  autoSetupTelegramWebhooks(publicBase).catch((e) =>
    logger.error({ err: e }, "Telegram auto-webhook setup failed"),
  );
});
