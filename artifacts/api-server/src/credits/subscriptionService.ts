// Créditos incluidos en el plan: renovación por periodo (mes natural UTC).
//
// Todo idempotente por referencia: ejecutarlo dos veces en el mismo periodo no
// concede ni caduca nada de más. Los importes salen de credit_plans; sin
// configurar, no hace nada (status "not_configured"). No hay planificador
// todavía: se invoca a mano desde Super Admin o desde un cron futuro.
//
// Política de fin de periodo (documentada, pendiente de confirmar con negocio):
// los créditos incluidos que sobran del periodo anterior caducan (EXPIRATION)
// salvo que el plan tenga rollover, con tope opcional (rolloverCap). Se asume
// que el consumo del periodo salió primero de lo incluido. Los créditos
// comprados no se tocan aquí.

import { and, eq } from "drizzle-orm";
import { db, creditLedgerTable } from "@workspace/db";
import { appendEntry, expireCredits, getBalance } from "./creditService";
import { consumedBetween, getPlanConfig, monthBounds, resolveOrgPlan } from "./planService";

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

export type RenewalStatus = "not_configured" | "no_credits_included" | "granted" | "already_granted";

export interface RenewalResult {
  status:  RenewalStatus;
  plan:    string | null;
  period?: string;
  granted: number;
  expired: number;
  entryId?: number;
}

export async function renewSubscription(orgId: number, opts: { at?: Date; userClerkId?: string | null } = {}): Promise<RenewalResult> {
  const at = opts.at ?? new Date();
  const { plan } = await resolveOrgPlan(orgId, db, at);
  const cfg = plan ? await getPlanConfig(plan) : null;
  if (!cfg || !cfg.active || cfg.includedCredits === null) return { status: "not_configured", plan, granted: 0, expired: 0 };

  const month = monthBounds(at);
  const prev = monthBounds(new Date(month.start.getTime() - 1));

  // 1) Lo que sobró del periodo anterior.
  let expired = 0;
  const [prevGrant] = await db.select().from(creditLedgerTable)
    .where(and(eq(creditLedgerTable.orgId, orgId), eq(creditLedgerTable.reference, `subscription:${orgId}:${prev.key}`)));
  if (prevGrant) {
    const consumed = await consumedBetween(db, orgId, prev.start, prev.end);
    const balance = await getBalance(orgId);
    const leftover = Math.min(Math.max(0, Number(prevGrant.credits) - consumed), Math.max(0, balance));
    const carried = cfg.rollover ? (cfg.rolloverCap !== null ? Math.min(leftover, cfg.rolloverCap) : leftover) : 0;
    const toExpire = round4(leftover - carried);
    if (toExpire > 0) {
      const res = await expireCredits(orgId, toExpire, {
        reference: `expiration:${orgId}:${prev.key}`, source: "subscription", userClerkId: opts.userClerkId,
        reason: cfg.rollover ? "Fin de periodo: excede el tope de rollover" : "Fin de periodo: créditos incluidos sin rollover",
        metadata: { plan, period: prev.key },
      });
      expired = res.duplicate ? 0 : toExpire;
    }
  }

  // 2) Créditos incluidos del periodo actual.
  if (cfg.includedCredits <= 0) return { status: "no_credits_included", plan, period: month.key, granted: 0, expired };
  const res = await appendEntry({
    orgId, type: "subscription", credits: cfg.includedCredits, reference: `subscription:${orgId}:${month.key}`,
    source: "subscription", userClerkId: opts.userClerkId ?? null, metadata: { plan, period: month.key },
  });
  return {
    status: res.duplicate ? "already_granted" : "granted", plan, period: month.key,
    granted: res.duplicate ? 0 : cfg.includedCredits, expired, entryId: res.entry.id,
  };
}
