import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

// Captación pública de leads (formulario web: montaje de cocinas, muebles,
// portes y mudanzas). Dominio DISTINTO de OmniLeads (./leads.ts, prospección
// interna vía Google Places) — tabla física separada, sin relación entre ambas.
export const leadsTable = pgTable("leads", {
  id:            uuid("id").primaryKey().defaultRandom(),
  category:      text("category").notNull(),
  description:   text("description").notNull(),
  zone:          text("zone").notNull(),
  timing:        text("timing"),
  contactPhone:  text("contact_phone").notNull(),
  status:        text("status").notNull().default("open"),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
});
