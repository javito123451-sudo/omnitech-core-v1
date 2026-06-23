import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { clientsTable } from "./clients";

export const tasksTable = pgTable("tasks", {
  id:          serial("id").primaryKey(),
  orgId:       integer("org_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  title:       text("title").notNull(),
  description: text("description"),
  status:      text("status").notNull().default("pending"),
  priority:    text("priority").notNull().default("medium"),
  dueDate:     timestamp("due_date"),
  clientId:    integer("client_id").references(() => clientsTable.id, { onDelete: "cascade" }),
  assignedTo:  text("assigned_to"),
  completed:   boolean("completed").notNull().default(false),
  completedAt: timestamp("completed_at"),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull(),
});

export const insertTaskSchema = createInsertSchema(tasksTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasksTable.$inferSelect;
