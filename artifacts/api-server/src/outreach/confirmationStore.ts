// OmniSeller Fase 4 — Confirmación humana de un envío de Outreach.
//
// Mismo patrón que agents/proposalStore.ts (Agent Factory): token de un solo
// uso, hash SHA-256 en base de datos, consumo ATÓMICO vía un UPDATE
// condicional (status=pending, no caducado, misma organización, mismo
// lead_message_id). Ver el comentario de cabecera de
// lib/db/src/schema/outreachConfirmations.ts para por qué es una tabla
// separada de ai_agent_proposals en vez de reutilizarla tal cual.
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lte } from "drizzle-orm";
import { db, outreachConfirmationsTable } from "@workspace/db";

export const CONFIRMATION_TTL_MS = 10 * 60 * 1000; // 10 min — una persona revisando un borrador necesita más margen que la confirmación de una acción de agente (5 min)

export const hashConfirmToken = (token: string): string => createHash("sha256").update(token).digest("hex");
const newConfirmToken = (): string => randomBytes(32).toString("base64url");

export interface CreateConfirmationInput {
  orgId: number;
  leadMessageId: number;
  createdBy: number;
}

export interface ConfirmationContext { orgId: number; leadMessageId: number }

export interface ConsumedConfirmation { leadMessageId: number; orgId: number }

export interface ConfirmationStore {
  create(p: CreateConfirmationInput): Promise<{ token: string; expiresAt: string }>;
  /** Atómico y de un solo uso. null si no existe, ya se consumió, caducó o no pertenece a esta org+mensaje. */
  consume(token: string, ctx: ConfirmationContext, consumedBy: number): Promise<ConsumedConfirmation | null>;
}

export const dbConfirmationStore: ConfirmationStore = {
  async create(p) {
    // Cualquier confirmación pendiente anterior para el MISMO mensaje queda
    // caducada — así nunca hay dos tokens válidos simultáneos apuntando al
    // mismo lead_message (defensa en profundidad además de la transición
    // atómica de estado del propio mensaje, ver outreachService.ts).
    await db.update(outreachConfirmationsTable)
      .set({ status: "expired" })
      .where(and(eq(outreachConfirmationsTable.leadMessageId, p.leadMessageId), eq(outreachConfirmationsTable.status, "pending")));

    const token = newConfirmToken();
    const expiresAt = new Date(Date.now() + CONFIRMATION_TTL_MS);
    await db.insert(outreachConfirmationsTable).values({
      tokenHash: hashConfirmToken(token), orgId: p.orgId, leadMessageId: p.leadMessageId, createdBy: p.createdBy, expiresAt,
    });
    return { token, expiresAt: expiresAt.toISOString() };
  },

  async consume(token, ctx, consumedBy) {
    const hash = hashConfirmToken(token);
    const [row] = await db.update(outreachConfirmationsTable)
      .set({ status: "consumed", consumedAt: new Date(), consumedBy })
      .where(and(
        eq(outreachConfirmationsTable.tokenHash, hash),
        eq(outreachConfirmationsTable.status, "pending"),
        eq(outreachConfirmationsTable.orgId, ctx.orgId),
        eq(outreachConfirmationsTable.leadMessageId, ctx.leadMessageId),
        gt(outreachConfirmationsTable.expiresAt, new Date()),
      ))
      .returning();
    if (!row) {
      // Igual que proposalStore.ts: si estaba pendiente pero ya caducó, se
      // marca expired explícitamente (sin tocar la de otro mensaje/token).
      await db.update(outreachConfirmationsTable).set({ status: "expired" })
        .where(and(eq(outreachConfirmationsTable.tokenHash, hash), eq(outreachConfirmationsTable.status, "pending"), lte(outreachConfirmationsTable.expiresAt, new Date())))
        .catch(() => {});
      return null;
    }
    return { leadMessageId: row.leadMessageId, orgId: row.orgId };
  },
};
