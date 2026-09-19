/**
 * OmniCredits — ledger comercial de consumo de IA.
 *
 * Separado a propósito de ai_usage_logs:
 *   ai_usage_logs  = registro TÉCNICO de lo que costó cada llamada real de IA.
 *   credit_ledger  = registro COMERCIAL: saldo, movimientos y consumo en créditos.
 * Cada movimiento de consumo apunta a su fila de ai_usage_logs (usage_log_id).
 *
 * El ledger es append-only: un movimiento nunca se edita. Un trigger de
 * Postgres (ver la migración) rechaza cualquier UPDATE; las correcciones se
 * hacen con un movimiento nuevo de tipo 'adjustment' o 'refund'.
 * credit_accounts.balance es un saldo cacheado que se actualiza en la misma
 * transacción que inserta el movimiento; la fuente de verdad es el ledger.
 */

import {
  pgTable, serial, integer, text, timestamp, jsonb, numeric, index, unique,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { aiAgentsTable } from "./ai-agents";
import { aiUsageLogsTable } from "./ai-center";

export const CREDIT_ENTRY_TYPES = ["grant", "topup", "usage", "adjustment", "refund"] as const;
export type CreditEntryType = (typeof CREDIT_ENTRY_TYPES)[number];

export const creditAccountsTable = pgTable("credit_accounts", {
  id:        serial("id").primaryKey(),
  orgId:     integer("org_id").notNull().unique().references(() => organizationsTable.id, { onDelete: "cascade" }),
  balance:   numeric("balance", { precision: 16, scale: 4 }).notNull().default("0"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const creditLedgerTable = pgTable("credit_ledger", {
  id:               serial("id").primaryKey(),
  orgId:            integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  accountId:        integer("account_id").notNull().references(() => creditAccountsTable.id, { onDelete: "cascade" }),

  entryType:        text("entry_type").notNull(),
  // Con signo: positivo suma (grant/topup/refund), negativo resta (usage).
  credits:          numeric("credits", { precision: 16, scale: 4 }).notNull(),
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
]);

export type CreditAccount = typeof creditAccountsTable.$inferSelect;
export type CreditLedgerEntry = typeof creditLedgerTable.$inferSelect;
