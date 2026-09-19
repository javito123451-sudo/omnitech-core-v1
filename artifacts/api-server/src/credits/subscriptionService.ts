// Créditos incluidos en el plan: renovación por ciclo (mes natural UTC).
//
// Todo en UNA transacción y idempotente por referencia: ejecutarlo dos veces en el mismo ciclo
// no concede ni caduca nada de más, y un fallo a medias no deja un ciclo a medio cerrar. Los
// importes salen de credit_plans; sin configurar, no hace nada (status "not_configured"). No hay
// planificador todavía: se invoca a mano desde Super Admin o desde un cron futuro.
//
// Al abrir un ciclo nuevo, con los créditos por ORIGEN (cubos) del ledger:
//   1. el rollover del ciclo anterior que sobró CADUCA (no se acumula indefinidamente);
//   2. los créditos incluidos que sobraron caducan, y la parte que el plan permite arrastrar
//      (rolloverPct del sobrante, con tope opcional) se re-acredita como ROLLOVER;
//   3. se conceden los créditos incluidos del ciclo nuevo.
// Los créditos EXTRA (compras, concesiones) no se tocan. Cada paso es un movimiento del ledger
// con su origen, así que el arrastre queda trazado (caducidad + alta de rollover).

import { eq, and } from "drizzle-orm";
import { db, creditLedgerTable } from "@workspace/db";
import { insertEntry } from "./creditService";
import { getPlanConfig, monthBounds, resolveOrgPlan, rolloverCarry } from "./planService";
import { ensureAccountLocked } from "./creditService";

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

export type RenewalStatus = "not_configured" | "no_credits_included" | "granted" | "already_granted";

export interface RenewalResult {
  status:  RenewalStatus;
  plan:    string | null;
  period?: string;
  granted: number;
  /** Créditos que caducaron en este cierre de ciclo (sobrante que NO pasa como rollover). */
  expired: number;
  /** Créditos incluidos sobrantes que pasan al ciclo nuevo como rollover. */
  carried: number;
  entryId?: number;
}

export async function renewSubscription(orgId: number, opts: { at?: Date; userClerkId?: string | null } = {}): Promise<RenewalResult> {
  const at = opts.at ?? new Date();
  const { plan } = await resolveOrgPlan(orgId, db, at);
  const cfg = plan ? await getPlanConfig(plan) : null;
  if (!cfg || !cfg.active || cfg.includedCredits === null) return { status: "not_configured", plan, granted: 0, expired: 0, carried: 0 };

  const includedCredits = cfg.includedCredits;
  const month = monthBounds(at);
  const subRef = `subscription:${orgId}:${month.key}`;
  const base = { orgId, userClerkId: opts.userClerkId ?? null };

  return db.transaction(async (tx): Promise<RenewalResult> => {
    const account = await ensureAccountLocked(tx, orgId); // serializa renovaciones y consumos de la org

    const [already] = await tx.select().from(creditLedgerTable)
      .where(and(eq(creditLedgerTable.orgId, orgId), eq(creditLedgerTable.reference, subRef)));
    if (already) return { status: "already_granted" as const, plan, period: month.key, granted: 0, expired: 0, carried: 0, entryId: already.id };

    // 1) Cierre del ciclo anterior: lo que queda en cada cubo.
    const rollover = round4(Math.max(0, Number(account.rolloverBalance)));
    const included = round4(Math.max(0, Number(account.includedBalance)));
    const carried = rolloverCarry(cfg, included);
    let expired = 0;

    if (rollover > 0) {
      await insertEntry(tx, {
        ...base, type: "expiration", credits: -rollover, bucket: "rollover", reference: `expiration-rollover:${orgId}:${month.key}`,
        source: "subscription", metadata: { reason: "Fin de ciclo: rollover no consumido", plan, period: month.key },
      });
      expired += rollover;
    }
    if (included > 0) {
      await insertEntry(tx, {
        ...base, type: "expiration", credits: -included, bucket: "included", reference: `expiration:${orgId}:${month.key}`,
        source: "subscription", metadata: { reason: "Fin de ciclo: créditos incluidos sin consumir", plan, period: month.key, carriedOver: carried },
      });
      expired += round4(included - carried);
      if (carried > 0) {
        await insertEntry(tx, {
          ...base, type: "subscription", credits: carried, bucket: "rollover", reference: `rollover:${orgId}:${month.key}`,
          source: "rollover", metadata: { plan, period: month.key, rolloverPct: cfg.rolloverPct, from: "included" },
        });
      }
    }

    // 2) Créditos incluidos del ciclo nuevo.
    if (includedCredits <= 0) return { status: "no_credits_included" as const, plan, period: month.key, granted: 0, expired: round4(expired), carried };
    const { entry } = await insertEntry(tx, {
      ...base, type: "subscription", credits: includedCredits, bucket: "included", reference: subRef,
      source: "subscription", metadata: { plan, period: month.key },
    });
    return { status: "granted" as const, plan, period: month.key, granted: includedCredits, expired: round4(expired), carried, entryId: entry.id };
  });
}
