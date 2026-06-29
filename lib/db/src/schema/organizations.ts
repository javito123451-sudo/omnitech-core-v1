import { pgTable, serial, text, timestamp, boolean, integer, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const organizationsTable = pgTable("organizations", {
  id:        serial("id").primaryKey(),
  name:      text("name").notNull(),
  slug:      text("slug").notNull().unique(),
  plan:      text("plan").notNull().default("free"),
  logoUrl:   text("logo_url"),
  status:    text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertOrganizationSchema = createInsertSchema(organizationsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type Organization = typeof organizationsTable.$inferSelect;

export const usersTable = pgTable("users", {
  id:              serial("id").primaryKey(),
  clerkId:         text("clerk_id").notNull().unique(),
  email:           text("email").notNull(),
  name:            text("name"),
  avatarUrl:       text("avatar_url"),
  status:          text("status").notNull().default("active"),
  suspendedReason: text("suspended_reason"),
  suspendedAt:     timestamp("suspended_at"),
  // ── Security / RBAC fields (nullable for backward compat) ──────────────
  assignedOrgId:   integer("assigned_org_id"),           // default workspace
  assignedCompanyId: integer("assigned_company_id"),     // company grouping
  sellerId:        integer("seller_id"),                   // if user is a seller, their own ID
  sellerCode:      text("seller_code"),                    // internal seller reference
  createdAt:       timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

export const orgMembersTable = pgTable(
  "org_members",
  {
    id:          serial("id").primaryKey(),
    orgId:       integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
    userId:      integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    role:        text("role").notNull().default("owner"),
    isSuspended: boolean("is_suspended").default(false),
    joinedAt:    timestamp("joined_at").defaultNow().notNull(),
  },
  (t) => [unique().on(t.orgId, t.userId)],
);

export type OrgMember = typeof orgMembersTable.$inferSelect;

export const orgInvitationsTable = pgTable("org_invitations", {
  id:         serial("id").primaryKey(),
  orgId:      integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  invitedBy:  integer("invited_by").notNull().references(() => usersTable.id),
  email:      text("email").notNull(),
  role:       text("role").notNull().default("member"),
  token:      text("token").notNull().unique(),
  expiresAt:  timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  createdAt:  timestamp("created_at").defaultNow().notNull(),
});

export type OrgInvitation = typeof orgInvitationsTable.$inferSelect;
