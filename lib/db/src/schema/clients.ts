import { pgTable, serial, text, real, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";

export const clientsTable = pgTable("clients", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .default(1)
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  company: text("company"),
  status: text("status").notNull().default("lead"),
  tags: text("tags"),
  notes: text("notes"),
  value: real("value"),
  telegramChatId: text("telegram_chat_id"),
  leadScore: text("lead_score").default("cold"),
  leadIntent: text("lead_intent"),
  // ── Security / assignment fields (nullable for backward compat) ───────────
  assignedAdminId:   integer("assigned_admin_id"),     // admin responsible
  assignedSellerId:  integer("assigned_seller_id"),    // vendedor assigned
  assignedBy:        integer("assigned_by"),           // who assigned this client
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertClientSchema = createInsertSchema(clientsTable).omit({ id: true, createdAt: true });
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clientsTable.$inferSelect;
