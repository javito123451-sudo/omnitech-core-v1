import { execSync }         from "child_process";
import { existsSync, mkdirSync, statSync, unlinkSync, writeFileSync, readFileSync } from "fs";
import { createHash }        from "crypto";
import { join }              from "path";
import { db }                from "@workspace/db";
import { sql }               from "drizzle-orm";

// ── Config ────────────────────────────────────────────────────────────────────
export const BACKUPS_DIR     = process.env["BACKUPS_DIR"]
  ?? join(process.cwd(), "../../backups");
const DATABASE_URL           = process.env["DATABASE_URL"]!;
export const RETENTION_DAYS  = Number(process.env["BACKUP_RETENTION_DAYS"] ?? 30);

mkdirSync(BACKUPS_DIR, { recursive: true });

// ── Types ─────────────────────────────────────────────────────────────────────
export type BackupType = "full_db" | "workspace" | "config" | "audit";

interface BackupRow {
  id: number;
  type: string;
  status: string;
  org_id: number | null;
  file_path: string | null;
  file_name: string | null;
  size_bytes: string | null;
  checksum: string | null;
  row_count: number | null;
  error: string | null;
  triggered_by: string | null;
  metadata: Record<string, unknown> | null;
  started_at: string;
  completed_at: string | null;
  expires_at: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function computeChecksum(filePath: string): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

async function createJob(type: BackupType, orgId: number | null, triggeredBy: string): Promise<number> {
  const expiresAt = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const rows = await db.execute(sql`
    INSERT INTO backup_jobs (type, status, org_id, triggered_by, expires_at)
    VALUES (${type}, 'running', ${orgId}, ${triggeredBy}, ${expiresAt}::timestamp)
    RETURNING id
  `);
  return (rows.rows[0] as { id: number }).id;
}

async function finishJob(id: number, updates: {
  status: string;
  filePath?: string; fileName?: string; sizeBytes?: number;
  checksum?: string; rowCount?: number; error?: string;
  metadata?: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  await db.execute(sql`
    UPDATE backup_jobs SET
      status       = ${updates.status},
      file_path    = COALESCE(${updates.filePath ?? null}, file_path),
      file_name    = COALESCE(${updates.fileName ?? null}, file_name),
      size_bytes   = COALESCE(${updates.sizeBytes ?? null}::bigint, size_bytes),
      checksum     = COALESCE(${updates.checksum ?? null}, checksum),
      row_count    = COALESCE(${updates.rowCount ?? null}::integer, row_count),
      error        = COALESCE(${updates.error ?? null}, error),
      metadata     = COALESCE(${updates.metadata ? JSON.stringify(updates.metadata) : null}::jsonb, metadata),
      completed_at = ${now}::timestamp
    WHERE id = ${id}
  `);
}

// ── Data exporters ────────────────────────────────────────────────────────────
async function exportWorkspace(orgId: number) {
  const [org, clients, quotes, quoteItems, appts, msgs, activity, memory] = await Promise.all([
    db.execute(sql`SELECT * FROM organizations WHERE id = ${orgId}`),
    db.execute(sql`SELECT * FROM clients WHERE org_id = ${orgId}`),
    db.execute(sql`SELECT * FROM quotes WHERE org_id = ${orgId}`),
    db.execute(sql`SELECT qi.* FROM quote_items qi JOIN quotes q ON qi.quote_id = q.id WHERE q.org_id = ${orgId}`),
    db.execute(sql`SELECT * FROM appointments WHERE org_id = ${orgId}`),
    db.execute(sql`SELECT * FROM messages WHERE org_id = ${orgId}`),
    db.execute(sql`SELECT * FROM activity WHERE org_id = ${orgId}`),
    db.execute(sql`SELECT * FROM agent_memory WHERE org_id = ${orgId}`),
  ]);
  return {
    exportedAt:   new Date().toISOString(),
    schemaVersion: "1.0",
    orgId,
    organization:  org.rows,
    clients:       clients.rows,
    quotes:        quotes.rows,
    quoteItems:    quoteItems.rows,
    appointments:  appts.rows,
    messages:      msgs.rows,
    activity:      activity.rows,
    agentMemory:   memory.rows,
  };
}

async function exportConfig() {
  const [orgs, members, modules, integs, licenses, roles, catalog] = await Promise.all([
    db.execute(sql`SELECT * FROM organizations`),
    db.execute(sql`SELECT * FROM org_members`),
    db.execute(sql`SELECT * FROM module_configs`),
    db.execute(sql`SELECT id, org_id, integration_id, is_active, credentials_enc, created_at FROM org_integrations`),
    db.execute(sql`SELECT * FROM license_plans`),
    db.execute(sql`SELECT * FROM platform_roles`),
    db.execute(sql`SELECT * FROM role_catalog`),
  ]);
  return {
    exportedAt:     new Date().toISOString(),
    schemaVersion:  "1.0",
    organizations:   orgs.rows,
    orgMembers:      members.rows,
    moduleConfigs:   modules.rows,
    orgIntegrations: integs.rows,
    licensePlans:    licenses.rows,
    platformRoles:   roles.rows,
    roleCatalog:     catalog.rows,
  };
}

async function exportAudit(orgId: number | null) {
  const logs = orgId
    ? await db.execute(sql`SELECT * FROM (SELECT * FROM audit_logs WHERE org_id = ${orgId} ORDER BY created_at DESC) sub`)
    : await db.execute(sql`SELECT * FROM (SELECT * FROM audit_logs ORDER BY created_at DESC) sub`);
  return {
    exportedAt:    new Date().toISOString(),
    schemaVersion: "1.0",
    orgId,
    totalLogs:     logs.rows.length,
    logs:          logs.rows,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────
export async function runBackup(
  type: BackupType,
  orgId: number | null,
  triggeredBy: string,
): Promise<number> {
  const jobId    = await createJob(type, orgId, triggeredBy);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  try {
    let filePath = "";
    let fileName = "";
    let rowCount: number | undefined;

    if (type === "full_db") {
      fileName = `full_db_${timestamp}.sql.gz`;
      filePath = join(BACKUPS_DIR, fileName);
      execSync(`pg_dump "${DATABASE_URL}" | gzip > "${filePath}"`, { stdio: "pipe", maxBuffer: 256 * 1024 * 1024 });

    } else if (type === "workspace") {
      if (orgId == null) throw new Error("orgId required for workspace backup");
      fileName = `workspace_${orgId}_${timestamp}.json`;
      filePath = join(BACKUPS_DIR, fileName);
      const data = await exportWorkspace(orgId);
      rowCount   = Object.values(data)
        .filter(Array.isArray)
        .reduce((s: number, a) => s + (a as unknown[]).length, 0);
      writeFileSync(filePath, JSON.stringify(data, null, 2));

    } else if (type === "config") {
      fileName = `config_platform_${timestamp}.json`;
      filePath = join(BACKUPS_DIR, fileName);
      const data = await exportConfig();
      rowCount   = Object.values(data)
        .filter(Array.isArray)
        .reduce((s: number, a) => s + (a as unknown[]).length, 0);
      writeFileSync(filePath, JSON.stringify(data, null, 2));

    } else if (type === "audit") {
      fileName = `audit_${orgId ? `org${orgId}` : "platform"}_${timestamp}.json`;
      filePath = join(BACKUPS_DIR, fileName);
      const data = await exportAudit(orgId);
      rowCount   = data.totalLogs;
      writeFileSync(filePath, JSON.stringify(data, null, 2));

    } else {
      throw new Error(`Invalid backup type: ${type}`);
    }

    const sizeBytes = statSync(filePath).size;
    const checksum  = computeChecksum(filePath);

    await finishJob(jobId, { status: "completed", filePath, fileName, sizeBytes, checksum, rowCount });
    return jobId;

  } catch (err) {
    await finishJob(jobId, { status: "failed", error: String(err) });
    throw err;
  }
}

export async function verifyBackup(jobId: number): Promise<{
  valid: boolean; expectedChecksum: string; actualChecksum: string; fileExists: boolean; error?: string;
}> {
  const rows = await db.execute(sql`SELECT * FROM backup_jobs WHERE id = ${jobId}`);
  const job  = rows.rows[0] as BackupJobRow | undefined;
  if (!job)           throw new Error("Backup not found");
  if (!job.file_path) throw new Error("Backup has no associated file");

  const fileExists = existsSync(job.file_path);
  if (!fileExists) {
    return { valid: false, expectedChecksum: job.checksum ?? "", actualChecksum: "", fileExists: false, error: "File not found on disk" };
  }

  const actualChecksum = computeChecksum(job.file_path);
  const valid          = actualChecksum === job.checksum;

  if (!valid) {
    await db.execute(sql`
      UPDATE backup_jobs SET status = 'corrupted',
        metadata = jsonb_set(COALESCE(metadata,'{}'), '{integrityError}', '"checksum mismatch"'::jsonb)
      WHERE id = ${jobId}
    `);
  }

  return { valid, expectedChecksum: job.checksum ?? "", actualChecksum, fileExists };
}

export async function restoreBackup(jobId: number): Promise<void> {
  const rows = await db.execute(sql`SELECT * FROM backup_jobs WHERE id = ${jobId}`);
  const job  = rows.rows[0] as BackupJobRow | undefined;
  if (!job) throw new Error("Backup not found");
  if (job.status !== "completed") throw new Error(`Cannot restore a backup with status: ${job.status}`);
  if (!job.file_path || !existsSync(job.file_path)) throw new Error("Backup file not found on disk");

  // Always verify before restoring
  const check = await verifyBackup(jobId);
  if (!check.valid) throw new Error("Backup integrity check failed — restore aborted");

  if (job.type === "full_db") {
    execSync(`gunzip -c "${job.file_path}" | psql "${DATABASE_URL}"`, { stdio: "pipe", maxBuffer: 256 * 1024 * 1024 });

  } else if (job.type === "workspace") {
    const data: Record<string, unknown[]> = JSON.parse(readFileSync(job.file_path, "utf-8")) as Record<string, unknown[]>;
    const orgId = job.org_id;
    if (!orgId) throw new Error("orgId missing from workspace backup metadata");
    await restoreWorkspaceData(data, orgId);

  } else {
    throw new Error(`Restore not supported for backup type: ${job.type}. Download and apply manually.`);
  }

  await db.execute(sql`
    UPDATE backup_jobs SET status = 'restored',
      metadata = jsonb_set(COALESCE(metadata,'{}'), '{restoredAt}', ${JSON.stringify(new Date().toISOString())}::jsonb)
    WHERE id = ${jobId}
  `);
}

async function restoreWorkspaceData(data: Record<string, unknown[]>, orgId: number) {
  const clients = (data["clients"] ?? []) as Array<Record<string, unknown>>;
  for (const c of clients) {
    await db.execute(sql`
      INSERT INTO clients (org_id, name, email, phone, company, status, tags, notes, value)
      VALUES (${orgId}, ${c["name"]}, ${c["email"]}, ${c["phone"] ?? null},
              ${c["company"] ?? null}, ${c["status"] ?? "lead"}, ${c["tags"] ?? null},
              ${c["notes"] ?? null}, ${c["value"] ?? null})
      ON CONFLICT DO NOTHING
    `).catch(() => {});
  }
  const memory = (data["agentMemory"] ?? []) as Array<Record<string, unknown>>;
  for (const m of memory) {
    await db.execute(sql`
      INSERT INTO agent_memory (org_id, key, value)
      VALUES (${orgId}, ${m["key"]}, ${m["value"]})
      ON CONFLICT DO NOTHING
    `).catch(() => {});
  }
}

export async function deleteBackup(jobId: number): Promise<void> {
  const rows = await db.execute(sql`SELECT file_path FROM backup_jobs WHERE id = ${jobId}`);
  const job  = rows.rows[0] as { file_path: string | null } | undefined;
  if (!job) throw new Error("Backup not found");
  if (job.file_path && existsSync(job.file_path)) {
    try { unlinkSync(job.file_path); } catch { /* ignore */ }
  }
  await db.execute(sql`DELETE FROM backup_jobs WHERE id = ${jobId}`);
}

export async function applyRetention(): Promise<number> {
  const rows = await db.execute(sql`
    SELECT id, file_path FROM backup_jobs
    WHERE (expires_at < NOW() OR started_at < NOW() - INTERVAL '${sql.raw(String(RETENTION_DAYS))} days')
    AND status IN ('completed', 'failed', 'corrupted', 'restored')
  `);
  let deleted = 0;
  for (const row of rows.rows as Array<{ id: number; file_path: string | null }>) {
    if (row.file_path && existsSync(row.file_path)) {
      try { unlinkSync(row.file_path); } catch { /* ignore */ }
    }
    await db.execute(sql`DELETE FROM backup_jobs WHERE id = ${row.id}`);
    deleted++;
  }
  return deleted;
}

export function getDiskUsage(): number {
  try {
    if (!existsSync(BACKUPS_DIR)) return 0;
    const out = execSync(`du -sb "${BACKUPS_DIR}" 2>/dev/null || echo 0`, { stdio: "pipe" })
      .toString().split("\t")[0];
    return Number(out) || 0;
  } catch {
    return 0;
  }
}

export function scheduleAutoBackups(): void {
  const DAY_MS = 24 * 60 * 60 * 1000;

  const runDailyBackup = async () => {
    console.log("[BackupScheduler] Starting daily backup run…");
    try {
      await runBackup("full_db", null, "auto:scheduler");
      await runBackup("config",  null, "auto:scheduler");
      await runBackup("audit",   null, "auto:scheduler");
      const pruned = await applyRetention();
      console.log(`[BackupScheduler] Daily backup completed. Pruned ${pruned} expired backups.`);
    } catch (err) {
      console.error("[BackupScheduler] Daily backup failed:", String(err));
    }
  };

  // Initial run after 90s (let server fully start), then every 24h
  setTimeout(() => {
    runDailyBackup();
    setInterval(runDailyBackup, DAY_MS);
  }, 90_000);

  console.log("[BackupScheduler] Auto-backup scheduler armed — first run in 90s, then daily.");
}
