import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { clientsTable } from "./clients";

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .default(1)
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  clientId: integer("client_id")
    .notNull()
    .references(() => clientsTable.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  direction: text("direction").notNull().default("outbound"),
  isAi: boolean("is_ai").default(false),
  status: text("status"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMessageSchema = createInsertSchema(messagesTable).omit({ id: true, createdAt: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messagesTable.$inferSelect;
