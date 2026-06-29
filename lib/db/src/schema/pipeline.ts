import { pgTable, serial, text, integer, timestamp, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { clientsTable } from "./clients";
import { usersTable } from "./organizations";

// ── Pipeline stages (Kanban columns) ──────────────────────────────────────────

export const pipelineStagesTable = pgTable("pipeline_stages", {
  id:        serial("id").primaryKey(),
  orgId:     integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  name:      text("name").notNull(),
  color:     text("color").default("#3b82f6"),
  orderIndex: integer("order_index").notNull().default(0),
  // Expected close probability for forecasting
  winProbability: real("win_probability").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPipelineStageSchema = createInsertSchema(pipelineStagesTable).omit({
  id: true,
  createdAt: true,
});

export type PipelineStage = typeof pipelineStagesTable.$inferSelect;
export type InsertPipelineStage = z.infer<typeof insertPipelineStageSchema>;

// ── Deals (clients in pipeline) ───────────────────────────────────────────────

export const dealsTable = pgTable("deals", {
  id:          serial("id").primaryKey(),
  orgId:       integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  clientId:    integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  // Pipeline position
  stageId:     integer("stage_id").notNull().references(() => pipelineStagesTable.id, { onDelete: "cascade" }),
  // Deal value
  value:       real("value").default(0),
  currency:    text("currency").default("EUR"),
  // Assignment
  assignedToUserId: integer("assigned_to_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  // Expected close date
  expectedCloseDate: timestamp("expected_close_date"),
  // Status
  status:      text("status").notNull().default("open"), // open, won, lost
  notes:       text("notes"),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull(),
});

export const insertDealSchema = createInsertSchema(dealsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Deal = typeof dealsTable.$inferSelect;
export type InsertDeal = z.infer<typeof insertDealSchema>;
