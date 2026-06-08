import { pgTable, serial, text, integer, timestamp, uuid, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { usersTable } from "./organizations";

export const aiSessionsTable = pgTable("ai_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: integer("org_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  agentSlug: text("agent_slug").notNull().default("operator"),
  title: text("title"),
  clientId: integer("client_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertAiSessionSchema = createInsertSchema(aiSessionsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertAiSession = z.infer<typeof insertAiSessionSchema>;
export type AiSession = typeof aiSessionsTable.$inferSelect;

export const aiMessagesTable = pgTable("ai_messages", {
  id: serial("id").primaryKey(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => aiSessionsTable.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  tokensUsed: integer("tokens_used"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAiMessageSchema = createInsertSchema(aiMessagesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAiMessage = z.infer<typeof insertAiMessageSchema>;
export type AiMessage = typeof aiMessagesTable.$inferSelect;

export const agentMemoryTable = pgTable(
  "agent_memory",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    agentSlug: text("agent_slug").notNull(),
    memoryKey: text("memory_key").notNull(),
    memoryVal: text("memory_val").notNull(),
    source: text("source").default("user_input"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [unique().on(t.orgId, t.agentSlug, t.memoryKey)],
);

export const insertAgentMemorySchema = createInsertSchema(agentMemoryTable).omit({
  id: true,
  updatedAt: true,
});
export type InsertAgentMemory = z.infer<typeof insertAgentMemorySchema>;
export type AgentMemory = typeof agentMemoryTable.$inferSelect;
