import { pgTable, serial, text, boolean, timestamp, integer, numeric, jsonb } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

export const aiUsageLogsTable = pgTable("ai_usage_logs", {
  id:           serial("id").primaryKey(),
  orgId:        integer("org_id").references(() => organizationsTable.id, { onDelete: "set null" }),
  userClerkId:  text("user_clerk_id"),
  functionName: text("function_name").notNull(),
  model:        text("model").notNull(),
  tokensInput:  integer("tokens_input").default(0),
  tokensOutput: integer("tokens_output").default(0),
  tokensTotal:  integer("tokens_total").default(0),
  costUsd:      numeric("cost_usd", { precision: 10, scale: 6 }).default("0"),
  durationMs:   integer("duration_ms"),
  status:       text("status").default("ok"),
  errorMsg:     text("error_msg"),
  metadata:     jsonb("metadata"),
  createdAt:    timestamp("created_at").defaultNow(),
});

export const aiBudgetsTable = pgTable("ai_budgets", {
  id:               serial("id").primaryKey(),
  orgId:            integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }).unique(),
  monthlyBudgetUsd: numeric("monthly_budget_usd", { precision: 10, scale: 2 }).default("10.00"),
  alert80:          boolean("alert_80").default(true),
  alert90:          boolean("alert_90").default(true),
  blockAt100:       boolean("block_at_100").default(true),
  isBlocked:        boolean("is_blocked").default(false),
  blockReason:      text("block_reason"),
  updatedBy:        text("updated_by"),
  createdAt:        timestamp("created_at").defaultNow(),
  updatedAt:        timestamp("updated_at").defaultNow(),
});

export type AiUsageLog = typeof aiUsageLogsTable.$inferSelect;
export type AiBudget   = typeof aiBudgetsTable.$inferSelect;
