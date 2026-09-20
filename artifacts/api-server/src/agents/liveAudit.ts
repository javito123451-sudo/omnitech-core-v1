// Auditoría de la ejecución LIVE de Agent Factory: un evento por cada paso relevante, con quién, dónde y qué.
//
// Eventos: agent_run_started · agent_run_completed · agent_run_failed · agent_run_denied
//          tool_proposed · tool_read_executed · tool_action_executed · tool_action_failed
//
// Reglas de privacidad: NUNCA se guardan claves, secretos, tokens de confirmación ni el Idempotency-Key en claro (solo su
// hash). De los argumentos de una tool se guardan los NOMBRES de los parámetros y una huella corta, no los valores (pueden
// llevar datos personales de clientes); el valor completo vive en la propuesta (ai_agent_proposals) mientras es válida.

import { createHash } from "node:crypto";
import { logAuditSystem } from "../utils/auditLogger";

export type LiveAuditAction =
  | "agent_run_started" | "agent_run_completed" | "agent_run_failed" | "agent_run_denied"
  | "tool_proposed" | "tool_read_executed" | "tool_action_executed" | "tool_action_failed";

export interface LiveAuditActor {
  clerkId: string;
  userId:  number;
  orgId:   number;
  role:    string;
}

export interface LiveAuditEvent {
  action:         LiveAuditAction;
  actor:          LiveAuditActor;
  agentId:        number | null;
  mode?:          "testing" | "live";
  versionNumber?: number | null;
  runId?:         string | null;
  toolId?:        string;
  success:        boolean;
  /** Motivo corto y estable: permission_denied, rate_limited, insufficient_credits, agent_not_published… */
  reason?:        string;
  details?:       Record<string, unknown>;
}

export type AuditFn = (e: LiveAuditEvent) => Promise<void>;

/** Huella corta y estable de un valor (para correlacionar sin guardar el contenido). */
export const fingerprint = (value: unknown): string =>
  createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value ?? null)).digest("hex").slice(0, 16);

export const argKeys = (args: Record<string, unknown>): string[] => Object.keys(args).sort();

const SECRET_KEY = /token|secret|password|passwd|api[_-]?key|authorization|cookie|bearer|idempotency[_-]?key$/i;

/** Quita cualquier campo que parezca un secreto (defensa en profundidad: los llamadores ya no los pasan). */
export function scrub(details: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    if (SECRET_KEY.test(k) && !/hash$/i.test(k)) continue;
    out[k] = v && typeof v === "object" && !Array.isArray(v) ? scrub(v as Record<string, unknown>) : v;
  }
  return out;
}

/** Sumidero por defecto: escribe en audit_logs. Se espera (await) para que el evento quede antes de responder. */
export function makeAudit(ctx: { ip?: string; userAgent?: string } = {}): AuditFn {
  return async (e) => {
    await logAuditSystem({
      actorClerkId: e.actor.clerkId,
      action: e.action,
      resource: "ai_agent",
      resourceId: e.agentId ?? undefined,
      orgId: e.actor.orgId,
      severity: e.success ? "info" : "warning",
      result: e.success ? "success" : "failure",
      ip: ctx.ip, userAgent: ctx.userAgent,
      details: scrub({
        actorType: "user", role: e.actor.role, userId: e.actor.userId, agentId: e.agentId,
        mode: e.mode, versionNumber: e.versionNumber, runId: e.runId, toolId: e.toolId, reason: e.reason, ...e.details,
      }),
    });
  };
}

export const noopAudit: AuditFn = async () => {};
