/**
 * Rutas de cron internas — Migración a hosting serverless (Vercel)
 *
 * En Replit, recurringInvoiceScheduler / autopilotScheduler / backupEngine se
 * disparaban con node-cron / setInterval DENTRO del propio proceso, porque el
 * proceso vivía para siempre (app.listen). En un entorno serverless eso no es
 * fiable — el proceso puede apagarse entre invocaciones y esos temporizadores
 * mueren con él (ver auditoría de migración, ago 2026).
 *
 * Estas rutas exponen las mismas tareas por HTTP, para que algo EXTERNO
 * (GitHub Actions programado, en nuestro caso) las dispare con la frecuencia
 * exacta que ya tenían. La lógica de negocio no cambia ni una línea — solo
 * cambia quién la dispara.
 *
 * Protegidas por un secreto compartido (CRON_SECRET), no por Clerk — quien
 * las llama no es un usuario logueado, es un job programado.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { processDueTemplates } from "../utils/recurringInvoiceScheduler";
import { runAutopilotTick } from "../utils/autopilotScheduler";
import { runDailyBackupJob } from "../utils/backupEngine";
import { logger } from "../lib/logger";

export const internalCronRouter: IRouter = Router();

function requireCronSecret(req: Request, res: Response): boolean {
  const expected = process.env["CRON_SECRET"];
  if (!expected) {
    logger.error("[InternalCron] CRON_SECRET no está configurado — rechazando toda petición");
    res.status(500).json({ error: "CRON_SECRET no configurado en el servidor" });
    return false;
  }
  const provided = req.header("x-cron-secret");
  if (provided !== expected) {
    res.status(401).json({ error: "No autorizado" });
    return false;
  }
  return true;
}

// Antes: cron.schedule("*/15 * * * *", ...) dentro del proceso.
internalCronRouter.post("/recurring-invoices", async (req, res) => {
  if (!requireCronSecret(req, res)) return;
  try {
    await processDueTemplates();
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[InternalCron] recurring-invoices falló");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Antes: cron.schedule("* * * * *", ...) dentro del proceso.
internalCronRouter.post("/autopilot", async (req, res) => {
  if (!requireCronSecret(req, res)) return;
  try {
    await runAutopilotTick();
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[InternalCron] autopilot falló");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Antes: setInterval(runDailyBackup, 24h) dentro del proceso.
internalCronRouter.post("/daily-backup", async (req, res) => {
  if (!requireCronSecret(req, res)) return;
  try {
    await runDailyBackupJob();
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[InternalCron] daily-backup falló");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
