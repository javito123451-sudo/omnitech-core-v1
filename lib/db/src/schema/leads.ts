import {
  pgTable, serial, integer, text, timestamp, doublePrecision, boolean, index,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

export const leadSearchesTable = pgTable("lead_searches", {
  id:          serial("id").primaryKey(),
  orgId:       integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  createdBy:   integer("created_by"),
  sector:      text("sector").notNull(),
  city:        text("city").notNull(),
  postalCode:  text("postal_code"),
  radiusKm:    integer("radius_km").notNull().default(20),
  maxResults:  integer("max_results").notNull().default(50),
  status:      text("status").notNull().default("pending"),
  totalFound:  integer("total_found").default(0),
  errorMsg:    text("error_msg"),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("lead_searches_org_id_idx").on(t.orgId),
]);

export const leadResultsTable = pgTable("lead_results", {
  id:           serial("id").primaryKey(),
  orgId:        integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  searchId:     integer("search_id").references(() => leadSearchesTable.id, { onDelete: "set null" }),
  createdBy:    integer("created_by"),
  placeId:      text("place_id"),
  name:         text("name").notNull(),
  address:      text("address"),
  phone:        text("phone"),
  website:      text("website"),
  email:        text("email"),
  rating:       doublePrecision("rating"),
  reviewCount:  integer("review_count"),
  lat:          doublePrecision("lat"),
  lng:          doublePrecision("lng"),
  sector:       text("sector"),
  status:       text("status").notNull().default("new"),
  crmClientId:  integer("crm_client_id"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
  updatedAt:    timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("lead_results_org_id_idx").on(t.orgId),
  index("lead_results_search_id_idx").on(t.searchId),
]);

export const leadAnalysisTable = pgTable("lead_analysis", {
  id:                    serial("id").primaryKey(),
  orgId:                 integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  resultId:              integer("result_id").notNull().references(() => leadResultsTable.id, { onDelete: "cascade" }),
  createdBy:             integer("created_by"),
  hasWebsite:            boolean("has_website"),
  hasHttps:              boolean("has_https"),
  hasForm:               boolean("has_form"),
  hasWhatsapp:           boolean("has_whatsapp"),
  hasFacebook:           boolean("has_facebook"),
  hasInstagram:          boolean("has_instagram"),
  hasGoogleBusiness:     boolean("has_google_business"),
  hasCta:                boolean("has_cta"),
  hasMobileOptimization: boolean("has_mobile_optimization"),
  hasLoadSpeed:          boolean("has_load_speed"),
  hasContactInfo:        boolean("has_contact_info"),
  score:                 integer("score"),
  opportunity:           text("opportunity"),
  improvements:          text("improvements"),
  summary:               text("summary"),
  createdAt:             timestamp("created_at").notNull().defaultNow(),
  updatedAt:             timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("lead_analysis_result_id_idx").on(t.resultId),
]);

export const leadMessagesTable = pgTable("lead_messages", {
  id:        serial("id").primaryKey(),
  orgId:     integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  resultId:  integer("result_id").notNull().references(() => leadResultsTable.id, { onDelete: "cascade" }),
  createdBy: integer("created_by"),
  channel:   text("channel").notNull().default("email"),
  content:   text("content").notNull(),
  tone:      text("tone"),
  status:    text("status").notNull().default("draft"),
  sentAt:    timestamp("sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("lead_messages_result_id_idx").on(t.resultId),
]);
