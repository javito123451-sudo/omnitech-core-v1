// Ejecución de POST /:id/run con idempotencia, límite de uso y auditoría.
//
// IDEMPOTENCIA (cabecera Idempotency-Key, opcional)
//   El servidor NO confía en ningún requestId del cliente: la identidad interna de cada ejecución es un runId que genera él.
//   El Idempotency-Key solo se usa para reconocer un reintento, y se guarda como hash SHA-256 junto a org + usuario + agente
//   + modo (ai_agent_run_requests, con una restricción UNIQUE). Reglas:
//     · misma clave, mismo contenido → se devuelve el resultado ya calculado: sin proveedor, sin créditos, sin tools,
//       sin propuestas nuevas ni otra auditoría de ejecución. Si la primera ejecución aún está en curso, se espera a que termine.
//     · misma clave, contenido distinto → 409 IDEMPOTENCY_KEY_REUSED.
//     · solo se repite un resultado EXITOSO. Un intento que falló (402, 503, 409…) libera la clave y se puede reintentar.
//       Si un fallo llega DESPUÉS de haber cobrado una ronda del modelo, el reintento volverá a cobrar esa ronda.
//   Sin cabecera no hay idempotencia: cada petición es una ejecución nueva.
//
// LÍMITE DE USO (solo LIVE), por usuario y por workspace, contado sobre la propia tabla de ejecuciones: es persistente,
//   vale con varias instancias y no cuenta los reintentos idempotentes. Al superarlo: 429 rate_limited, sin proveedor,
//   sin créditos y con un evento agent_run_denied. Valores por defecto (configurables por entorno, ver liveLimits()).

import { createHash, randomUUID } from "node:crypto";
import { and, count, eq, lt, lte, gt, or, sql } from "drizzle-orm";
import { db, aiAgentRunRequestsTable, aiAgentsTable } from "@workspace/db";
import { AgentError } from "./agentService";
import { runAgent, defaultRunnerDeps, type RunActor, type RunResult, type RunnerDeps } from "./agentRunner";
import { makeAudit, type AuditFn, type LiveAuditActor } from "./liveAudit";

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/** Ventana y valores por defecto del límite LIVE. Decisión de producto pendiente de confirmar: se pueden cambiar por entorno. */
export const LIVE_LIMIT_WINDOW_SECONDS = 60;
export const DEFAULT_LIVE_LIMITS = { userPerWindow: 10, orgPerWindow: 60 } as const;

export function liveLimits(env: NodeJS.ProcessEnv = process.env): { userPerWindow: number; orgPerWindow: number } {
  const n = (v: string | undefined, d: number) => { const x = Number(v); return Number.isInteger(x) && x > 0 ? x : d; };
  return {
    userPerWindow: n(env["AGENT_LIVE_USER_LIMIT_PER_MIN"], DEFAULT_LIVE_LIMITS.userPerWindow),
    orgPerWindow: n(env["AGENT_LIVE_ORG_LIMIT_PER_MIN"], DEFAULT_LIVE_LIMITS.orgPerWindow),
  };
}

/** Errores propios del contrato (la ruta los traduce a HTTP con su cuerpo). */
export class LiveRunRejection extends Error {
  constructor(
    readonly status: 409 | 429,
    readonly code: "IDEMPOTENCY_KEY_REUSED" | "IDEMPOTENCY_IN_PROGRESS" | "RATE_LIMITED",
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) { super(message); this.name = "LiveRunRejection"; }
}

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
export const hashIdempotencyKey = (key: string) => sha256(key);

/** Huella del contenido que define «la misma petición»: modo, mensaje, historial y versión pedida. */
export function hashRequest(r: { mode: string; message: string; history: unknown[]; versionId?: number }): string {
  return sha256(JSON.stringify({ m: r.mode, msg: r.message, h: r.history, v: r.versionId ?? null }));
}

export interface LiveRunInput {
  actor:           RunActor;
  agentId:         number;
  mode:            "testing" | "live";
  message:         string;
  history:         Array<{ role: "user" | "assistant"; content: string }>;
  versionId?:      number;
  idempotencyKey?: string | null;
}

export interface LiveRunOutcome { result: RunResult; replayed: boolean; runId: string }

export interface LiveRunDeps {
  runner:     RunnerDeps;
  audit:      AuditFn;
  /** Traduce un error de ejecución a su estado HTTP y motivo (lo aporta la capa de rutas). */
  classify:   (err: unknown) => { status: number; reason: string };
  limits:     () => { userPerWindow: number; orgPerWindow: number };
  /** Para tests: cuánto se espera a que termine la ejecución original antes de responder 409 IDEMPOTENCY_IN_PROGRESS. */
  waitMs?:    number;
  /** Cuánto tarda una ejecución «en curso» en considerarse abandonada (proceso caído) y poder reclamarse. */
  staleMs?:   number;
}

const auditActor = (a: RunActor): LiveAuditActor => ({ clerkId: a.userClerkId, userId: a.userId, orgId: a.orgId, role: a.orgRole });

// Los rechazos por límite se auditan como mucho una vez por org+usuario+ámbito cada 30 s (un cliente que insiste no debe inundar audit_logs).
const deniedAuditedAt = new Map<string, number>();
const DENIED_AUDIT_EVERY_MS = 30_000;
export const resetDeniedAuditThrottle = () => deniedAuditedAt.clear();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Quita los tokens de propuestas que ya no valen (un resultado repetido no debe seguir exponiendo tokens muertos). */
function scrubExpiredTokens(result: RunResult, now = Date.now()): RunResult {
  return { ...result, proposals: result.proposals.map((p) => (Date.parse(p.expiresAt) <= now ? { ...p, confirmToken: "" } : p)) };
}

export async function executeRun(input: LiveRunInput, deps: LiveRunDeps): Promise<LiveRunOutcome> {
  const { actor } = input;
  const keyHash = input.idempotencyKey ? hashIdempotencyKey(input.idempotencyKey) : null;
  const requestHash = hashRequest({ mode: input.mode, message: input.message, history: input.history, versionId: input.versionId });
  const runId = randomUUID();
  const staleMs = deps.staleMs ?? 10 * 60 * 1000;
  const waitMs = deps.waitMs ?? 25_000;
  const T = aiAgentRunRequestsTable;

  // El agente debe ser de ESTE workspace antes de reservar nada: uno ajeno o inexistente es un 404 sin dejar rastro.
  const [owned] = await db.select({ id: aiAgentsTable.id }).from(aiAgentsTable).where(and(eq(aiAgentsTable.id, input.agentId), eq(aiAgentsTable.orgId, actor.orgId)));
  if (!owned) throw new AgentError(404, "Agente no encontrado.");

  // ── 1. Reclamar la ejecución (o reconocer un reintento) ────────────────────────────────────────────
  let claimedId: number | null = null;

  const [inserted] = await db.insert(T).values({
    runId, orgId: actor.orgId, userId: actor.userId, agentId: input.agentId, mode: input.mode, idempotencyKeyHash: keyHash, requestHash,
  }).onConflictDoNothing().returning();
  if (inserted) claimedId = inserted.id;

  const deadline = Date.now() + waitMs;
  while (claimedId === null) {
    const [existing] = await db.select().from(T).where(and(
      eq(T.orgId, actor.orgId), eq(T.userId, actor.userId), eq(T.agentId, input.agentId), eq(T.mode, input.mode), eq(T.idempotencyKeyHash, keyHash!),
    ));
    if (!existing) {
      // La fila desapareció entre el conflicto y la lectura (p. ej. la ejecución original fue rechazada): se intenta reclamar de nuevo.
      const [again] = await db.insert(T).values({ runId, orgId: actor.orgId, userId: actor.userId, agentId: input.agentId, mode: input.mode, idempotencyKeyHash: keyHash, requestHash }).onConflictDoNothing().returning();
      if (again) claimedId = again.id;
      continue;
    }
    if (existing.requestHash !== requestHash) {
      throw new LiveRunRejection(409, "IDEMPOTENCY_KEY_REUSED", "Este Idempotency-Key ya se usó con una petición distinta. Usa una clave nueva para una petición nueva.");
    }
    if (existing.status === "completed" && existing.response) {
      return { result: scrubExpiredTokens(existing.response as RunResult), replayed: true, runId: existing.runId };
    }
    // failed, o en curso pero abandonada: se reclama de forma atómica para reejecutar.
    const [taken] = await db.update(T).set({ runId, requestHash, status: "in_progress", httpStatus: null, response: null, createdAt: sql`now()`, completedAt: null })
      .where(and(eq(T.id, existing.id), or(eq(T.status, "failed"), and(eq(T.status, "in_progress"), lt(T.createdAt, sql`now() - make_interval(secs => ${staleMs / 1000})`)))!))
      .returning();
    if (taken) { claimedId = taken.id; break; }
    // La otra ejecución sigue en curso: se espera a que termine.
    if (Date.now() > deadline) {
      throw new LiveRunRejection(409, "IDEMPOTENCY_IN_PROGRESS", "La petición original con este Idempotency-Key sigue en curso. Reintenta en unos segundos.", { retryAfterSeconds: 5 });
    }
    await sleep(150);
  }

  // Limpieza oportunista de ejecuciones antiguas (no bloquea la petición).
  if (Math.random() < 0.02) void db.delete(T).where(lt(T.createdAt, new Date(Date.now() - 7 * 24 * 3600 * 1000))).catch(() => {});

  // Una ejecución rechazada o fallida no deja fila: libera la clave (se puede reintentar) y no ocupa hueco del límite.
  const release = async () => { await db.delete(T).where(eq(T.id, claimedId!)); };

  // ── 2. Límite de uso (solo LIVE): cuenta esta ejecución y las anteriores de la ventana ──────────────────
  if (input.mode === "live") {
    const limits = deps.limits();
    const windowStart = sql`now() - make_interval(secs => ${LIVE_LIMIT_WINDOW_SECONDS})`;
    // Todo se compara del lado de la base de datos (mismo reloj): esta ejecución y las anteriores de la ventana.
    const mine = sql`(select created_at from ai_agent_run_requests where id = ${claimedId})`;
    const base = [eq(T.mode, "live"), gt(T.createdAt, windowStart), lte(T.createdAt, mine)];
    const [{ n: userN } = { n: 0 }] = await db.select({ n: count() }).from(T).where(and(eq(T.orgId, actor.orgId), eq(T.userId, actor.userId), ...base));
    const [{ n: orgN } = { n: 0 }] = await db.select({ n: count() }).from(T).where(and(eq(T.orgId, actor.orgId), ...base));
    const exceeded = userN > limits.userPerWindow ? { scope: "user" as const, limit: limits.userPerWindow } : orgN > limits.orgPerWindow ? { scope: "org" as const, limit: limits.orgPerWindow } : null;
    if (exceeded) {
      await release();
      const key = `${actor.orgId}:${actor.userId}:${exceeded.scope}`;
      if (Date.now() - (deniedAuditedAt.get(key) ?? 0) >= DENIED_AUDIT_EVERY_MS) {
        deniedAuditedAt.set(key, Date.now());
        await deps.audit({ action: "agent_run_denied", actor: auditActor(actor), agentId: input.agentId, mode: "live", success: false, reason: "rate_limited", details: { scope: exceeded.scope, limitPerMinute: exceeded.limit } });
      }
      throw new LiveRunRejection(429, "RATE_LIMITED", exceeded.scope === "user"
        ? "Has alcanzado el límite de ejecuciones por minuto. Espera un momento antes de volver a intentarlo."
        : "Este workspace ha alcanzado el límite de ejecuciones por minuto. Espera un momento antes de volver a intentarlo.",
      { scope: exceeded.scope, limitPerMinute: exceeded.limit, retryAfterSeconds: LIVE_LIMIT_WINDOW_SECONDS });
    }
  }

  // ── 3. Ejecutar ────────────────────────────────────────────────────────────────────────────────────
  const runnerDeps: RunnerDeps = { ...deps.runner, audit: deps.audit };
  try {
    const result = await runAgent({ actor, agentId: input.agentId, mode: input.mode, message: input.message, history: input.history, versionId: input.versionId, runId }, runnerDeps);
    await db.update(T).set({ status: "completed", httpStatus: 200, response: result as unknown as Record<string, unknown>, completedAt: new Date() }).where(eq(T.id, claimedId));
    await deps.audit({
      action: "agent_run_completed", actor: auditActor(actor), agentId: input.agentId, mode: input.mode, versionNumber: result.agent.versionNumber, runId, success: true,
      details: {
        provider: result.usage.provider, model: result.usage.model, credits: result.usage.credits, requestIds: result.usage.requestIds,
        toolsUsed: result.toolsUsed, proposals: result.proposals.map((p) => p.toolId), denied: result.denied.map((d) => d.toolId),
        idempotencyKeyHash: keyHash, replayable: keyHash !== null,
      },
    });
    return { result, replayed: false, runId };
  } catch (err) {
    await release().catch(() => {});
    const { status, reason } = deps.classify(err);
    // 402 (créditos), 429 (presupuesto/límite) y 403: rechazos de política → denied. El resto → failed.
    const denied = status === 402 || status === 429 || status === 403;
    await deps.audit({
      action: denied ? "agent_run_denied" : "agent_run_failed", actor: auditActor(actor), agentId: input.agentId, mode: input.mode, runId, success: false, reason,
      details: { httpStatus: status, idempotencyKeyHash: keyHash },
    }).catch(() => {});
    throw err;
  }
}

/** Cadena por defecto usada por la ruta. */
export const defaultLiveRunDeps = (audit: AuditFn = makeAudit(), classify: LiveRunDeps["classify"]): LiveRunDeps => ({
  runner: defaultRunnerDeps, audit, classify, limits: () => liveLimits(),
});
