import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const docsPagesTable = pgTable("docs_pages", {
  id:                 serial("id").primaryKey(),
  slug:               text("slug").notNull().unique(),
  title:              text("title").notNull(),
  chapterOrder:       integer("chapter_order").notNull().default(0),
  content:            text("content").notNull().default(""),
  isPublished:        boolean("is_published").notNull().default(true),
  createdAt:          timestamp("created_at").defaultNow(),
  updatedAt:          timestamp("updated_at").defaultNow(),
  updatedByClerkId:   text("updated_by_clerk_id"),
  updatedByEmail:     text("updated_by_email"),
  currentVersion:     integer("current_version").notNull().default(1),
});

export const docsVersionsTable = pgTable("docs_versions", {
  id:            serial("id").primaryKey(),
  pageSlug:      text("page_slug").notNull(),
  versionNumber: integer("version_number").notNull(),
  content:       text("content").notNull(),
  authorClerkId: text("author_clerk_id"),
  authorEmail:   text("author_email"),
  changeNote:    text("change_note"),
  createdAt:     timestamp("created_at").defaultNow(),
});

export type DocsPage    = typeof docsPagesTable.$inferSelect;
export type DocsVersion = typeof docsVersionsTable.$inferSelect;
