// Propuestas de acción de un agente pendientes de confirmación humana.
//
// Reemplaza al almacén en memoria de AVA CORE para Agent Factory (AVA sigue con el suyo). Diseño:
//  - PERSISTENTE (PostgreSQL, ai_agent_proposals): sobrevive a reinicios y funciona con varias instancias.
//  - El token (256 bits aleatorios) solo se entrega al usuario; en la base de datos se guarda su hash SHA-256.
//  - ATÓMICO: consumir es UN UPDATE condicional (status = pending, no caducada y mismos org, usuario y agente).
//    Dos confirmaciones simultáneas: solo una recibe la fila. Quien no coincide (otro usuario, otro workspace, otro
//    agente) no consume nada, así que tampoco puede «quemar» la propuesta de otra persona.
//  - Estados: pending → consumed | expired. Un token consumido, caducado o inexistente es indistinguible para el llamador.
//  - Los parámetros los fija el servidor al crear la propuesta; el cliente nunca los envía al confirmar.

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lte } from "drizzle-orm";
import { db, aiAgentProposalsTable } from "@workspace/db";

export const PROPOSAL_TTL_MS = 5 * 60 * 1000;

export interface NewProposal {
  orgId:          number;
  userId:         number;
  agentId:        number;
  agentVersionId: number;
  toolId:         string;
  args:           Record<string, unknown>;
  testOnly:       boolean;
  runId?:         string | null;
}

export interface ProposalContext { orgId: number; userId: number; agentId: number }

export interface ConsumedProposal {
  toolId:         string;
  args:           Record<string, unknown>;
  testOnly:       boolean;
  agentVersionId: number;
  runId:          string | null;
}

export interface ProposalStore {
  create(p: NewProposal): Promise<{ token: string; expiresAt: string }>;
  /** Atómico y de un solo uso. null si no existe, ya se consumió, caducó o no pertenece a este org+usuario+agente. */
  consume(token: string, ctx: ProposalContext): Promise<ConsumedProposal | null>;
}

export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
const newToken = (): string => randomBytes(32).toString("base64url");

export const dbProposalStore: ProposalStore = {
  async create(p) {
    const token = newToken();
    const expiresAt = new Date(Date.now() + PROPOSAL_TTL_MS);
    await db.insert(aiAgentProposalsTable).values({
      tokenHash: hashToken(token), orgId: p.orgId, userId: p.userId, agentId: p.agentId, agentVersionId: p.agentVersionId,
      toolId: p.toolId, args: p.args, testOnly: p.testOnly, runId: p.runId ?? null, expiresAt,
    });
    // Limpieza oportunista de propuestas viejas (no bloquea ni falla la petición).
    if (Math.random() < 0.02) void db.delete(aiAgentProposalsTable).where(lte(aiAgentProposalsTable.expiresAt, new Date(Date.now() - 24 * 3600 * 1000))).catch(() => {});
    return { token, expiresAt: expiresAt.toISOString() };
  },

  async consume(token, ctx) {
    const hash = hashToken(token);
    const [row] = await db.update(aiAgentProposalsTable)
      .set({ status: "consumed", consumedAt: new Date() })
      .where(and(
        eq(aiAgentProposalsTable.tokenHash, hash),
        eq(aiAgentProposalsTable.status, "pending"),
        eq(aiAgentProposalsTable.orgId, ctx.orgId),
        eq(aiAgentProposalsTable.userId, ctx.userId),
        eq(aiAgentProposalsTable.agentId, ctx.agentId),
        gt(aiAgentProposalsTable.expiresAt, new Date()),
      ))
      .returning();
    if (!row) {
      // Mantiene el estado real: una propuesta pendiente ya caducada pasa a «expired» (sin tocar las de otros).
      await db.update(aiAgentProposalsTable).set({ status: "expired" })
        .where(and(eq(aiAgentProposalsTable.tokenHash, hash), eq(aiAgentProposalsTable.status, "pending"), lte(aiAgentProposalsTable.expiresAt, new Date())))
        .catch(() => {});
      return null;
    }
    return { toolId: row.toolId, args: (row.args ?? {}) as Record<string, unknown>, testOnly: row.testOnly, agentVersionId: row.agentVersionId, runId: row.runId };
  },
};

/** Misma semántica en memoria, para tests unitarios sin base de datos. */
export function createMemoryProposalStore(now: () => number = Date.now): ProposalStore {
  const rows = new Map<string, NewProposal & { expiresAt: number; status: "pending" | "consumed" | "expired" }>();
  return {
    async create(p) {
      const token = newToken();
      const expiresAt = now() + PROPOSAL_TTL_MS;
      rows.set(hashToken(token), { ...p, expiresAt, status: "pending" });
      return { token, expiresAt: new Date(expiresAt).toISOString() };
    },
    async consume(token, ctx) {
      const r = rows.get(hashToken(token));
      if (!r || r.status !== "pending") return null;
      if (now() > r.expiresAt) { r.status = "expired"; return null; }
      if (r.orgId !== ctx.orgId || r.userId !== ctx.userId || r.agentId !== ctx.agentId) return null;
      r.status = "consumed";
      return { toolId: r.toolId, args: r.args, testOnly: r.testOnly, agentVersionId: r.agentVersionId, runId: r.runId ?? null };
    },
  };
}
