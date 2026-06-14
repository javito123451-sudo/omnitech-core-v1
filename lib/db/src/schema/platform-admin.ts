import { pgTable, serial, text, boolean, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

export const platformRolesTable = pgTable("platform_roles", {
  id:           serial("id").primaryKey(),
  clerkUserId:  text("clerk_user_id").notNull().unique(),
  role:         text("role").notNull().default("STAFF_OMNITECH"),
  displayName:  text("display_name"),
  email:        text("email"),
  grantedBy:    text("granted_by"),
  isActive:     boolean("is_active").default(true),
  notes:        text("notes"),
  createdAt:    timestamp("created_at").defaultNow(),
  updatedAt:    timestamp("updated_at").defaultNow(),
});

export const moduleConfigsTable = pgTable("module_configs", {
  id:          serial("id").primaryKey(),
  orgId:       integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  moduleSlug:  text("module_slug").notNull(),
  isEnabled:   boolean("is_enabled").default(true),
  config:      jsonb("config").default({}),
  updatedBy:   text("updated_by"),
  createdAt:   timestamp("created_at").defaultNow(),
  updatedAt:   timestamp("updated_at").defaultNow(),
});

export const licensePlansTable = pgTable("license_plans", {
  id:           serial("id").primaryKey(),
  orgId:        integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  plan:         text("plan").notNull().default("starter"),
  seats:        integer("seats").default(5),
  validFrom:    timestamp("valid_from").defaultNow(),
  validUntil:   timestamp("valid_until"),
  isActive:     boolean("is_active").default(true),
  billingCycle: text("billing_cycle").default("monthly"),
  notes:        text("notes"),
  assignedBy:   text("assigned_by"),
  createdAt:    timestamp("created_at").defaultNow(),
  updatedAt:    timestamp("updated_at").defaultNow(),
});

export const auditLogsTable = pgTable("audit_logs", {
  id:           serial("id").primaryKey(),
  actorClerkId: text("actor_clerk_id"),
  actorEmail:   text("actor_email"),
  action:       text("action").notNull(),
  resource:     text("resource"),
  resourceId:   text("resource_id"),
  orgId:        integer("org_id"),
  ipAddress:    text("ip_address"),
  userAgent:    text("user_agent"),
  details:      jsonb("details"),
  severity:     text("severity").default("info"),
  createdAt:    timestamp("created_at").defaultNow(),
});

export type PlatformRole  = typeof platformRolesTable.$inferSelect;
export type ModuleConfig  = typeof moduleConfigsTable.$inferSelect;
export type LicensePlan   = typeof licensePlansTable.$inferSelect;
export type AuditLog      = typeof auditLogsTable.$inferSelect;
