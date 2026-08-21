import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { clientsTable } from "./clients";
import { autopilotTasksTable } from "./autopilot";

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .default(1)
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  clientId: integer("client_id")
    .references(() => clientsTable.id, { onDelete: "set null" }),
  // Links this message back to the Autopilot task+step that produced it.
  // Also the basis of the per-step idempotency check (never send the same
  // step twice for the same task).
  autopilotTaskId: integer("autopilot_task_id")
    .references(() => autopilotTasksTable.id, { onDelete: "set null" }),
  autopilotStep: integer("autopilot_step"),
  // Guest conversations (no CRM client linked): identity of the sender on the
  // external channel — phone number for WhatsApp, chat_id for Telegram — plus
  // their visible name/username when available. Both nullable; only used when
  // clientId is null.
  externalId: text("external_id"),
  externalName: text("external_name"),
  content: text("content").notNull(),
  direction: text("direction").notNull().default("outbound"),
  channel: text("channel").default("telegram"),
  isAi: boolean("is_ai").default(false),
  status: text("status"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMessageSchema = createInsertSchema(messagesTable).omit({ id: true, createdAt: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messagesTable.$inferSelect;
