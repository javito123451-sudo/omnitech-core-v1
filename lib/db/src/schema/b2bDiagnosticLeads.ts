import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

// Captación pública del formulario "Solicita tu diagnóstico" de
// info.omnitech-core.com (marketing del propio SaaS OmniTech Core) — dominio
// DISTINTO del resto de leads públicos (A Medida/A3 Ordena, ./leadCapture.ts):
// estos son leads B2B del producto (nombre, empresa, email), no solicitudes
// de servicio para el hogar. Tabla física separada a propósito, mismo
// criterio que leadCapture.ts frente a OmniLeads.
export const b2bDiagnosticLeadsTable = pgTable("b2b_diagnostic_leads", {
  id:          uuid("id").primaryKey().defaultRandom(),
  nombre:      text("nombre").notNull(),
  empresa:     text("empresa").notNull(),
  email:       text("email").notNull(),
  telefono:    text("telefono"),
  necesidad:   text("necesidad").notNull(),
  status:      text("status").notNull().default("open"),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});
