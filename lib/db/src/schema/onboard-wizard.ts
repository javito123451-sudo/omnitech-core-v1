/**
 * Onboard Wizard Schema
 *
 * 2 tablas:
 *   onboard_wizard_drafts   -- borradores de creacion de empresa
 *   onboard_templates       -- plantillas preconfiguradas
 */

import { pgTable, serial, text, timestamp, integer, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// -- onboard_wizard_drafts ---------------------------------------------------------------

export const onboardWizardDraftsTable = pgTable("onboard_wizard_drafts", {
  id:              serial("id").primaryKey(),
  name:            text("name").notNull(),
  // -- Datos del wizard acumulados (JSON para flexibilidad)
  wizardData:      jsonb("wizard_data").notNull().default({}),
  currentStep:     integer("current_step").notNull().default(1),
  // -- Metadata
  createdBy:       text("created_by"),
  status:          text("status").notNull().default("draft"),
  completedAt:     timestamp("completed_at"),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
  updatedAt:       timestamp("updated_at").defaultNow().notNull(),
});

export const insertOnboardWizardDraftSchema = createInsertSchema(onboardWizardDraftsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type OnboardWizardDraft = typeof onboardWizardDraftsTable.$inferSelect;
export type InsertOnboardWizardDraft = z.infer<typeof insertOnboardWizardDraftSchema>;

// -- onboard_templates ---------------------------------------------------------------

export const onboardTemplatesTable = pgTable("onboard_templates", {
  id:              serial("id").primaryKey(),
  slug:            text("slug").notNull().unique(),
  name:            text("name").notNull(),
  description:     text("description"),
  icon:            text("icon"),
  // -- Modulos preactivados para esta plantilla
  defaultModules:  jsonb("default_modules").notNull().default([]),
  // -- Config fiscal por defecto
  defaultFiscal:   jsonb("default_fiscal").default({}),
  // -- Plan recomendado
  recommendedPlan: text("recommended_plan").default("starter"),
  // -- Roles por defecto a crear
  defaultRoles:    jsonb("default_roles").default([]),
  isActive:        boolean("is_active").default(true),
  orderIndex:      integer("order_index").default(0),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
});

export const insertOnboardTemplateSchema = createInsertSchema(onboardTemplatesTable).omit({
  id: true,
  createdAt: true,
});
export type OnboardTemplate = typeof onboardTemplatesTable.$inferSelect;
export type InsertOnboardTemplate = z.infer<typeof insertOnboardTemplateSchema>;
