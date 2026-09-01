/**
 * Notifications — Notificaciones in-app
 *
 * 1 tabla: notifications
 *
 * NOTA: creada originalmente vía SQL crudo en startupMigrations.ts.
 * org_id y target_user_id NO tienen FK real en producción (verificado),
 * aunque referencian lógicamente organizations.id y users.id.
 */

import {
  pgTable, serial, integer, text, boolean, timestamp, index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const notificationsTable = pgTable("notifications", {
  id:           serial("id").primaryKey(),
  orgId:        integer("org_id").notNull(),
  targetUserId: integer("target_user_id").notNull(),

  title:        text("title").notNull(),
  body:         text("body").notNull(),
  link:         text("link"),
  level:        text("level").notNull().default("info"), // info, success, warning, error
  isRead:       boolean("is_read").notNull().default(false),

  createdAt:    timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_notifications_user").on(t.orgId, t.targetUserId, t.isRead),
]);

export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({
  id: true, createdAt: true,
});

export type Notification = typeof notificationsTable.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
