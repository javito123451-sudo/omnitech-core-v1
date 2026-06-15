import { Router }   from "express";
import { createReadStream, existsSync } from "fs";
import { requireSuperAdmin }            from "../middlewares/superAdmin";
import { requireAuth }                  from "../middlewares/auth";
import { db }                           from "@workspace/db";
import { sql }                          from "drizzle-orm";
import { logAudit }                     from "../utils/auditLogger";
import {
  runBackup, verifyBackup, restoreBackup, deleteBackup,
  applyRetention, getDiskUsage, BACKUPS_DIR, RETENTION_DAYS,
  type BackupType,
} from "../utils/backupEngine";

export const backupRouter = Router();

// All backup routes require super-admin
backupRouter.use(requireAuth, requireSuperAdmin);

// ── GET /backups — list history ───────────────────────────────────────────────
backupRouter.get("/", async (req, res) => {
  try {
    const limit  = Math.min(Number(req.query["limit"]  ?? 50), 200);
    const offset = Number(req.query["offset"] ?? 0);
    const type   = req.query["type"]   as string | undefined;
    const status = req.query["status"] as string | undefined;
    const orgId  = req.query["orgId"]  as string | undefined;

    const conditions: string[] = [];
    if (type)   conditions.push(`type = '${type.replace(/'/g, "")}'`);
    if (status) conditions.push(`status = '${status.replace(/'/g, "")}'`);
    if (orgId)  conditions.push(`org_id = ${Number(orgId)}`);

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows  = await db.execute(sql.raw(`
      SELECT * FROM backup_jobs ${where}
      ORDER BY started_at DESC LIMIT ${limit} OFFSET ${offset}
    `));
    const total = await db.execute(sql.raw(
      `SELECT COUNT(*) as cnt FROM backup_jobs ${where}`
    ));
    const diskBytes = getDiskUsage();

    res.json({
      jobs:      rows.rows,
      total:     Number((total.rows[0] as { cnt: string }).cnt),
      limit,
      offset,
      diskBytes,
      backupsDir: BACKUPS_DIR,
      retentionDays: RETENTION_DAYS,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /backups — trigger manual backup ─────────────────────────────────────
backupRouter.post("/", async (req, res) => {
  const { type, orgId } = req.body as { type?: string; orgId?: number };

  const validTypes: BackupType[] = ["full_db", "workspace", "config", "audit"];
  if (!type || !validTypes.includes(type as BackupType)) {
    res.status(400).json({ error: `type must be one of: ${validTypes.join(", ")}` });
    return;
  }
  if (type === "workspace" && !orgId) {
    res.status(400).json({ error: "orgId is required for workspace backups" });
    return;
  }

  res.json({ message: "Backup iniciado", status: "running" });

  // Run async (don't block response)
  runBackup(type as BackupType, orgId ?? null, req.clerkUserId!)
    .then(jobId => {
      logAudit({
        actorClerkId: req.clerkUserId!,
        action:   "backup_created",
        resource: "backup",
        resourceId: String(jobId),
        details:  { type, orgId: orgId ?? null, result: "success" },
        severity: "info",
        req,
      });
    })
    .catch(err => console.error("[Backup] Manual backup failed:", String(err)));
});

// ── POST /backups/retention — apply retention policy ─────────────────────────
backupRouter.post("/retention", async (req, res) => {
  try {
    const deleted = await applyRetention();
    logAudit({
      actorClerkId: req.clerkUserId!,
      action:   "backup_retention_applied",
      resource: "backup",
      details:  { deleted, result: "success" },
      severity: "info",
      req,
    });
    res.json({ ok: true, deleted });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /backups/:id — detail ─────────────────────────────────────────────────
backupRouter.get("/:id", async (req, res) => {
  try {
    const id   = Number(req.params["id"]);
    const rows = await db.execute(sql`SELECT * FROM backup_jobs WHERE id = ${id}`);
    if (!rows.rows.length) { res.status(404).json({ error: "Not found" }); return; }
    const job = rows.rows[0] as Record<string, unknown>;
    res.json({ ...job, fileExists: job["file_path"] ? existsSync(String(job["file_path"])) : false });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /backups/:id/verify — verify checksum ────────────────────────────────
backupRouter.post("/:id/verify", async (req, res) => {
  try {
    const id     = Number(req.params["id"]);
    const result = await verifyBackup(id);
    logAudit({
      actorClerkId: req.clerkUserId!,
      action:   "backup_verified",
      resource: "backup",
      resourceId: String(id),
      details:  { ...result, result: result.valid ? "success" : "failure" },
      severity: result.valid ? "info" : "warning",
      req,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /backups/:id/restore — restore ───────────────────────────────────────
backupRouter.post("/:id/restore", async (req, res) => {
  const id = Number(req.params["id"]);
  try {
    await restoreBackup(id);
    logAudit({
      actorClerkId: req.clerkUserId!,
      action:   "backup_restored",
      resource: "backup",
      resourceId: String(id),
      details:  { result: "success" },
      severity: "critical",
      req,
    });
    res.json({ ok: true, message: "Restauración completada" });
  } catch (err) {
    logAudit({
      actorClerkId: req.clerkUserId!,
      action:   "backup_restored",
      resource: "backup",
      resourceId: String(id),
      details:  { result: "failure", error: String(err) },
      severity: "critical",
      req,
    });
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /backups/:id/download — download file ─────────────────────────────────
backupRouter.get("/:id/download", async (req, res) => {
  try {
    const id   = Number(req.params["id"]);
    const rows = await db.execute(sql`SELECT file_path, file_name, type FROM backup_jobs WHERE id = ${id}`);
    const job  = rows.rows[0] as { file_path: string | null; file_name: string | null; type: string } | undefined;
    if (!job || !job.file_path) { res.status(404).json({ error: "Not found" }); return; }
    if (!existsSync(job.file_path)) { res.status(404).json({ error: "File not found on disk" }); return; }

    const contentType = job.file_name?.endsWith(".gz") ? "application/gzip" : "application/json";
    res.setHeader("Content-Disposition", `attachment; filename="${job.file_name ?? "backup"}"`);
    res.setHeader("Content-Type", contentType);
    createReadStream(job.file_path).pipe(res);

    logAudit({
      actorClerkId: req.clerkUserId!,
      action:   "backup_downloaded",
      resource: "backup",
      resourceId: String(id),
      details:  { fileName: job.file_name, result: "success" },
      severity: "warning",
      req,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── DELETE /backups/:id — delete ──────────────────────────────────────────────
backupRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params["id"]);
  try {
    await deleteBackup(id);
    logAudit({
      actorClerkId: req.clerkUserId!,
      action:   "backup_deleted",
      resource: "backup",
      resourceId: String(id),
      details:  { result: "success" },
      severity: "warning",
      req,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
