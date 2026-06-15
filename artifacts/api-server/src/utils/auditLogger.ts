import { db, auditLogsTable } from "@workspace/db";
import { eq, desc, and, gte } from "drizzle-orm";

export type AuditSeverity = "info" | "warning" | "critical";
export type AuditResult   = "success" | "failure" | "error";

export interface LogAuditParams {
  actorClerkId: string;
  actorEmail?:  string;
  action:       string;
  resource?:    string;
  resourceId?:  string | number;
  orgId?:       number;
  details?:     Record<string, unknown>;
  severity?:    AuditSeverity;
  result?:      AuditResult;
  req:          import("express").Request;
}

export async function logAudit(params: LogAuditParams): Promise<void> {
  const details: Record<string, unknown> = {
    ...(params.details ?? {}),
    result: params.result ?? "success",
  };
  await db.insert(auditLogsTable).values({
    actorClerkId: params.actorClerkId,
    actorEmail:   params.actorEmail   ?? null,
    action:       params.action,
    resource:     params.resource     ?? null,
    resourceId:   params.resourceId != null ? String(params.resourceId) : null,
    orgId:        params.orgId        ?? null,
    ipAddress:    params.req.ip       ?? null,
    userAgent:    (params.req.headers["user-agent"] as string | undefined) ?? null,
    details,
    severity:     params.severity ?? "info",
  }).catch(() => {});
}

export async function logAuditSystem(params: Omit<LogAuditParams, "req"> & { ip?: string; userAgent?: string }): Promise<void> {
  const details: Record<string, unknown> = {
    ...(params.details ?? {}),
    result: params.result ?? "success",
  };
  await db.insert(auditLogsTable).values({
    actorClerkId: params.actorClerkId,
    actorEmail:   params.actorEmail   ?? null,
    action:       params.action,
    resource:     params.resource     ?? null,
    resourceId:   params.resourceId != null ? String(params.resourceId) : null,
    orgId:        params.orgId        ?? null,
    ipAddress:    params.ip           ?? null,
    userAgent:    params.userAgent    ?? null,
    details,
    severity:     params.severity ?? "info",
  }).catch(() => {});
}

export async function shouldLogLogin(clerkUserId: string): Promise<boolean> {
  const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000);
  const rows = await db
    .select({ id: auditLogsTable.id })
    .from(auditLogsTable)
    .where(
      and(
        eq(auditLogsTable.actorClerkId, clerkUserId),
        eq(auditLogsTable.action, "user_login"),
        gte(auditLogsTable.createdAt, eightHoursAgo),
      ),
    )
    .limit(1)
    .catch(() => []);
  return rows.length === 0;
}
