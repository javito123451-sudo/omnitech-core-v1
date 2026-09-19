/**
 * Precios técnicos de los modelos de IA — configuración, no código.
 *
 * NO hay filas iniciales: los precios reales los decide negocio y pueden
 * cambiar sin tocar agentes, planes, frontend ni canales. Mientras no exista
 * una fila vigente para un modelo, el Cost Engine usa los valores heredados de
 * pricing.ts (los que ya usaba la app) y lo marca en el desglose.
 *
 * Unidades (todas en la moneda de la fila, USD por defecto):
 *   input/output/cached_input/reasoning_cost   por 1.000.000 de tokens
 *   image_cost                                  por imagen
 *   audio_cost, video_cost                      por minuto
 *
 * Una fila no se edita para cambiar un precio: se crea una nueva y se cierra
 * la anterior con effective_to. Así el histórico de precios (y el coste con el
 * que se calculó cada consumo) es reproducible y auditable.
 */

import { pgTable, serial, text, numeric, timestamp, boolean, index } from "drizzle-orm/pg-core";

export const aiModelPricingTable = pgTable("ai_model_pricing", {
  id:              serial("id").primaryKey(),
  provider:        text("provider").notNull(),
  model:           text("model").notNull(),
  inputCost:       numeric("input_cost", { precision: 14, scale: 6 }).notNull(),
  outputCost:      numeric("output_cost", { precision: 14, scale: 6 }).notNull(),
  cachedInputCost: numeric("cached_input_cost", { precision: 14, scale: 6 }),
  reasoningCost:   numeric("reasoning_cost", { precision: 14, scale: 6 }),
  imageCost:       numeric("image_cost", { precision: 14, scale: 6 }),
  audioCost:       numeric("audio_cost", { precision: 14, scale: 6 }),
  videoCost:       numeric("video_cost", { precision: 14, scale: 6 }),
  currency:        text("currency").notNull().default("USD"),
  effectiveFrom:   timestamp("effective_from").notNull().defaultNow(),
  effectiveTo:     timestamp("effective_to"),
  active:          boolean("active").notNull().default(true),
  notes:           text("notes"),
  // De dónde sale el precio (URL o documento oficial). Obligatorio para un precio definitivo.
  source:          text("source"),
  // true = precio aún sin validar. Un precio configurado y validado es provisional=false.
  provisional:     boolean("provisional").notNull().default(false),
  createdBy:       text("created_by"),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_ai_model_pricing_lookup").on(t.provider, t.model, t.active),
]);

export type AiModelPricing = typeof aiModelPricingTable.$inferSelect;
