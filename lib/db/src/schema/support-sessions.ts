/**
 * Support Sessions — Sesiones de "impersonate" / soporte del panel admin
 *
 * 1 tabla: support_sessions
 *
 * NOTA: creada originalmente vía SQL crudo en startupMigrations.ts.
 * org_id NO tiene FK real en producción (verificado), aunque referencia
 * lógicamente organizations.id.
 */

import {
  pgTable, serial, integer, text, timestamp, index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const supportSessionsTable = pgTable("support_sessions", {
  id:            serial("id").primaryKey(),
  adminClerkId:  text("admin_clerk_id").notNull(),
  orgId:         integer("org_id").notNull(),
  orgName:       text("org_name"),
  reason:        text("reason"),
  status:        text("status").notNull().default("active"), // active, ended

  startedAt:     timestamp("started_at").notNull().defaultNow(),
  endedAt:       timestamp("ended_at"),
}, (t) => [
  index("support_sessions_admin_idx").on(t.adminClerkId, t.status),
]);

export const insertSupportSessionSchema = createInsertSchema(supportSessionsTable).omit({
  id: true, startedAt: true,
});

export type SupportSession = typeof supportSessionsTable.$inferSelect;
export type InsertSupportSession = z.infer<typeof insertSupportSessionSchema>;
