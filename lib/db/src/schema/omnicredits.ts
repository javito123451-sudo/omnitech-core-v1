/**
 * OmniCredits — capa COMERCIAL de consumo de IA.
 *
 * Separada a propósito de ai_usage_logs:
 *   ai_usage_logs  = registro TÉCNICO de lo que costó cada llamada real de IA.
 *   credit_ledger  = registro COMERCIAL: saldo, movimientos y consumo en créditos.
 * Cada movimiento de consumo apunta a su fila de ai_usage_logs (usage_log_id).
 *
 * Integridad (migraciones 0005 + 0006, aplicada en Postgres, no solo en el código):
 *  - credit_ledger es append-only: un trigger rechaza cualquier UPDATE.
 *  - Cada movimiento guarda balance_before y balance_after, y un CHECK exige
 *    balance_after = balance_before + credits.
 *  - Un trigger comprueba que balance_before coincide con el saldo real de la
 *    cuenta, y es ese trigger —no la aplicación— quien actualiza el saldo. Otro
 *    trigger prohíbe cambiar credit_accounts.balance por cualquier otra vía.
 *    Resultado: el saldo solo puede cambiar generando un movimiento de ledger.
 *  - CHECKs de tipo e importe (un consumo nunca suma, una recarga nunca resta).
 *
 * Los valores comerciales (créditos por plan, límites, umbrales, precios de
 * modelos) NO están fijados aquí: viven en credit_plans y ai_model_pricing,
 * vacíos hasta que se configuren.
 */

import {
  pgTable, serial, integer, text, timestamp, jsonb, numeric, boolean, index, unique, check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations";
import { aiAgentsTable } from "./ai-agents";
import { aiUsageLogsTable } from "./ai-center";

export const CREDIT_ENTRY_TYPES = [
  "grant", "purchase", "subscription", "consumption", "refund", "adjustment", "expiration",
] as const;
export type CreditEntryType = (typeof CREDIT_ENTRY_TYPES)[number];

/** Tipos que siempre suman / siempre restan. `adjustment` puede ir en cualquier sentido. */
export const CREDIT_POSITIVE_TYPES = ["grant", "purchase", "subscription", "refund"] as const;
export const CREDIT_NEGATIVE_TYPES = ["consumption", "expiration"] as const;

const quoted = (list: readonly string[]) => list.map((t) => `'${t}'`).join(", ");

export const creditAccountsTable = pgTable("credit_accounts", {
  id:        serial("id").primaryKey(),
  orgId:     integer("org_id").notNull().unique().references(() => organizationsTable.id, { onDelete: "cascade" }),
  // Saldo cacheado. Solo lo modifica el trigger del ledger; la fuente de verdad es el ledger.
  balance:   numeric("balance", { precision: 16, scale: 4 }).notNull().default("0"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const creditLedgerTable = pgTable("credit_ledger", {
  id:               serial("id").primaryKey(),
  orgId:            integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  accountId:        integer("account_id").notNull().references(() => creditAccountsTable.id, { onDelete: "cascade" }),

  entryType:        text("entry_type").notNull(),
  // Con signo: positivo suma, negativo resta.
  credits:          numeric("credits", { precision: 16, scale: 4 }).notNull(),
  balanceBefore:    numeric("balance_before", { precision: 16, scale: 4 }).notNull(),
  balanceAfter:     numeric("balance_after", { precision: 16, scale: 4 }).notNull(),

  agentId:          integer("agent_id").references(() => aiAgentsTable.id, { onDelete: "set null" }),
  agentVersionId:   integer("agent_version_id"),
  userClerkId:      text("user_clerk_id"),
  provider:         text("provider"),
  model:            text("model"),
  technicalCostUsd: numeric("technical_cost_usd", { precision: 12, scale: 6 }),
  // Créditos estimados antes de ejecutar; permite ver la diferencia con los reales.
  estimatedCredits: numeric("estimated_credits", { precision: 16, scale: 4 }),
  usageLogId:       integer("usage_log_id").references(() => aiUsageLogsTable.id, { onDelete: "set null" }),

  // Idempotencia: la misma referencia en la misma org no se registra dos veces.
  reference:        text("reference"),
  source:           text("source").notNull().default("system"),
  metadata:         jsonb("metadata"),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_credit_ledger_org_created").on(t.orgId, t.createdAt),
  index("idx_credit_ledger_org_agent").on(t.orgId, t.agentId),
  unique("credit_ledger_org_reference_unique").on(t.orgId, t.reference),
  check("credit_ledger_type_check", sql`${t.entryType} in (${sql.raw(quoted(CREDIT_ENTRY_TYPES))})`),
  check("credit_ledger_amount_check", sql`${t.credits} <> 0 and (
    (${t.entryType} in (${sql.raw(quoted(CREDIT_POSITIVE_TYPES))}) and ${t.credits} > 0)
    or (${t.entryType} in (${sql.raw(quoted(CREDIT_NEGATIVE_TYPES))}) and ${t.credits} < 0)
    or ${t.entryType} = 'adjustment')`),
  // Operaciones manuales: la referencia (clave de idempotencia) es obligatoria.
  check("credit_ledger_manual_reference_check", sql`${t.entryType} not in ('grant', 'adjustment', 'refund', 'expiration') or (${t.reference} is not null and btrim(${t.reference}) <> '')`),
  check("credit_ledger_chain_check", sql`${t.balanceAfter} = ${t.balanceBefore} + ${t.credits}`),
]);

// Reserva de créditos mientras una llamada de IA está en curso. Es lo que evita
// que dos peticiones simultáneas gasten más de lo disponible: cada petición
// reserva su coste estimado (bajo bloqueo de la cuenta) antes de llamar al
// proveedor, y al terminar se liquida contra el consumo real o se libera.
// NO es un movimiento comercial: no cambia el saldo ni forma parte del ledger.
export const creditHoldsTable = pgTable("credit_holds", {
  id:             serial("id").primaryKey(),
  orgId:          integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  accountId:      integer("account_id").notNull().references(() => creditAccountsTable.id, { onDelete: "cascade" }),
  credits:        numeric("credits", { precision: 16, scale: 4 }).notNull(),
  status:         text("status").notNull().default("held"), // held | settled | released
  reference:      text("reference").notNull(),              // request id
  agentId:        integer("agent_id").references(() => aiAgentsTable.id, { onDelete: "set null" }),
  userClerkId:    text("user_clerk_id"),
  expiresAt:      timestamp("expires_at").notNull(),        // una reserva huérfana (caída) deja de contar sola
  settledCredits: numeric("settled_credits", { precision: 16, scale: 4 }),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  unique("credit_holds_org_reference_unique").on(t.orgId, t.reference),
  index("idx_credit_holds_org_status").on(t.orgId, t.status),
  check("credit_holds_status_check", sql`${t.status} in ('held', 'settled', 'released')`),
  check("credit_holds_positive_check", sql`${t.credits} > 0`),
]);

// Configuración comercial de créditos por plan. NO hay filas iniciales: los
// valores de Starter/Professional/Business/Enterprise los decide negocio.
// NULL = "no configurado" (sin límite / sin créditos incluidos), nunca un valor por defecto.
export const creditPlansTable = pgTable("credit_plans", {
  id:                   serial("id").primaryKey(),
  plan:                 text("plan").notNull().unique(),
  includedCredits:      numeric("included_credits", { precision: 16, scale: 4 }),
  monthlyLimit:         numeric("monthly_limit", { precision: 16, scale: 4 }),
  dailyLimit:           numeric("daily_limit", { precision: 16, scale: 4 }),
  perAgentMonthlyLimit: numeric("per_agent_monthly_limit", { precision: 16, scale: 4 }),
  rollover:             boolean("rollover").notNull().default(false),
  rolloverCap:          numeric("rollover_cap", { precision: 16, scale: 4 }),
  blockAtLimit:         boolean("block_at_limit").notNull().default(true),
  // Porcentajes del tope mensual (o de los créditos incluidos) que disparan una alerta. Vacío = sin alertas.
  alertThresholds:      jsonb("alert_thresholds").notNull().default([]),
  active:               boolean("active").notNull().default(true),
  updatedBy:            text("updated_by"),
  createdAt:            timestamp("created_at").notNull().defaultNow(),
  updatedAt:            timestamp("updated_at").notNull().defaultNow(),
});

// Compras de OmniCredits extra (independientes del plan). Sin integración de
// pago: paymentReference es solo la referencia externa.
export const creditPurchasesTable = pgTable("credit_purchases", {
  id:               serial("id").primaryKey(),
  orgId:            integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  credits:          numeric("credits", { precision: 16, scale: 4 }).notNull(),
  priceAmount:      numeric("price_amount", { precision: 12, scale: 2 }),
  currency:         text("currency").notNull().default("EUR"),
  purchasedAt:      timestamp("purchased_at").notNull().defaultNow(),
  expiresAt:        timestamp("expires_at"),
  paymentReference: text("payment_reference"),
  status:           text("status").notNull().default("completed"), // completed | reversed
  ledgerEntryId:    integer("ledger_entry_id").references(() => creditLedgerTable.id, { onDelete: "set null" }),
  createdBy:        text("created_by"),
  metadata:         jsonb("metadata"),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  unique("credit_purchases_org_payment_unique").on(t.orgId, t.paymentReference),
  index("idx_credit_purchases_org").on(t.orgId, t.purchasedAt),
  check("credit_purchases_status_check", sql`${t.status} in ('completed', 'reversed')`),
  check("credit_purchases_positive_check", sql`${t.credits} > 0`),
]);

// Alertas de consumo (umbral de plan o consumo anómalo). La restricción única
// evita repetir la misma alerta en el mismo periodo.
export const creditAlertsTable = pgTable("credit_alerts", {
  id:        serial("id").primaryKey(),
  orgId:     integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  kind:      text("kind").notNull(),            // threshold | anomaly
  threshold: integer("threshold").notNull().default(0),
  periodKey: text("period_key").notNull(),      // YYYY-MM (umbral) o YYYY-MM-DD (anomalía)
  details:   jsonb("details"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  unique("credit_alerts_dedupe_unique").on(t.orgId, t.kind, t.threshold, t.periodKey),
  index("idx_credit_alerts_org").on(t.orgId, t.createdAt),
]);

export type CreditAccount = typeof creditAccountsTable.$inferSelect;
export type CreditLedgerEntry = typeof creditLedgerTable.$inferSelect;
export type CreditHold = typeof creditHoldsTable.$inferSelect;
export type CreditPlan = typeof creditPlansTable.$inferSelect;
export type CreditPurchase = typeof creditPurchasesTable.$inferSelect;
export type CreditAlert = typeof creditAlertsTable.$inferSelect;
