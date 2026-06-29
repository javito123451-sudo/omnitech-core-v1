import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { usersTable } from "./organizations";

export const supportTicketsTable = pgTable("support_tickets", {
  id:          serial("id").primaryKey(),
  orgId:       integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  // Creator: can be a registered user or a portal client
  creatorUserId: integer("creator_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  creatorEmail:  text("creator_email"), // for portal submissions
  // Assignment
  assignedToUserId: integer("assigned_to_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  // Content
  title:       text("title").notNull(),
  description: text("description").notNull(),
  category:    text("category").notNull().default("general"),
  priority:    text("priority").notNull().default("medium"), // low, medium, high, critical
  // State
  status:      text("status").notNull().default("open"), // open, in_progress, resolved, closed
  resolution:  text("resolution"),
  // Timestamps
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull(),
  resolvedAt:  timestamp("resolved_at"),
});

export const insertSupportTicketSchema = createInsertSchema(supportTicketsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
});

export type SupportTicket = typeof supportTicketsTable.$inferSelect;
export type InsertSupportTicket = z.infer<typeof insertSupportTicketSchema>;

// ── Ticket comments / activity ───────────────────────────────────────────────

export const ticketCommentsTable = pgTable("ticket_comments", {
  id:        serial("id").primaryKey(),
  ticketId:  integer("ticket_id").notNull().references(() => supportTicketsTable.id, { onDelete: "cascade" }),
  userId:    integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  authorName: text("author_name"), // for portal or system
  isInternal: boolean("is_internal").default(false),
  body:      text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type TicketComment = typeof ticketCommentsTable.$inferSelect;
