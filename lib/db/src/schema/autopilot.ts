import { pgTable, serial, text, boolean, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { clientsTable } from "./clients";

export const autopilotTasksTable = pgTable("autopilot_tasks", {
  id:            serial("id").primaryKey(),
  orgId:         integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  name:          text("name").notNull(),
  enabled:       boolean("enabled").notNull().default(true),
  triggerType:   text("trigger_type").notNull(),
  triggerConfig: jsonb("trigger_config").default({}),
  actionType:    text("action_type").notNull(),
  actionConfig:  jsonb("action_config").default({}),
  lastRunAt:     timestamp("last_run_at"),
  nextRunAt:     timestamp("next_run_at"),
  // ── Per-client follow-up sequence support (triggerType "client_followup_sequence") ──
  // When clientId is set, this row IS one client's Autopilot config/state — not
  // an org-wide bulk task. NULL for every pre-existing org-wide task.
  clientId:      integer("client_id").references(() => clientsTable.id, { onDelete: "cascade" }),
  currentStep:   integer("current_step").notNull().default(0),
  pausedReason:  text("paused_reason"), // "reply" | "manual" | null
  createdAt:     timestamp("created_at").defaultNow().notNull(),
  updatedAt:     timestamp("updated_at").defaultNow().notNull(),
});

export const autopilotRunsTable = pgTable("autopilot_runs", {
  id:            serial("id").primaryKey(),
  taskId:        integer("task_id").notNull().references(() => autopilotTasksTable.id, { onDelete: "cascade" }),
  orgId:         integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  status:        text("status").notNull().default("pending"),
  startedAt:     timestamp("started_at").defaultNow().notNull(),
  completedAt:   timestamp("completed_at"),
  resultSummary: text("result_summary"),
  errorMessage:  text("error_message"),
});

export type AutopilotTask = typeof autopilotTasksTable.$inferSelect;
export type AutopilotRun  = typeof autopilotRunsTable.$inferSelect;
