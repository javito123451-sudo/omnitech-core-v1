/**
 * Client Portal — Tokens de acceso al portal público del cliente
 *
 * 1 tabla: client_portal_tokens
 */

import {
  pgTable, serial, integer, varchar, timestamp, index, unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { clientsTable } from "./clients";

export const clientPortalTokensTable = pgTable("client_portal_tokens", {
  id:        serial("id").primaryKey(),
  orgId:     integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  clientId:  integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),

  token:     varchar("token", { length: 128 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),

  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  unique("client_portal_tokens_org_id_client_id_key").on(t.orgId, t.clientId),
  unique("client_portal_tokens_token_key").on(t.token),
  // índice adicional pre-existente en producción, redundante con el unique de arriba
  index("portal_tokens_token_idx").on(t.token),
]);

export const insertClientPortalTokenSchema = createInsertSchema(clientPortalTokensTable).omit({
  id: true, createdAt: true,
});

export type ClientPortalToken = typeof clientPortalTokensTable.$inferSelect;
export type InsertClientPortalToken = z.infer<typeof insertClientPortalTokenSchema>;
