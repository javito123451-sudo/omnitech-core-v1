/**
 * lead_contacts — OmniSeller Fase 3 (Contact Finder).
 *
 * Contactos de PERSONAS (nombre, cargo, email, teléfono) encontrados por un
 * proveedor de Contact Finder para un lead_result concreto. No sustituye a
 * los campos email/phone de lead_results, que son datos de la EMPRESA
 * capturados por el Hunter (Google Places) — lead_contacts es un dato de
 * PERSONA, de una fuente distinta (proveedor externo), con su propio ciclo
 * de vida y calidad. Tampoco se reutiliza clientsTable: un contacto
 * encontrado no es un cliente ni un lead comercial, es un dato crudo del
 * proveedor hasta que alguien decida darle ese paso.
 *
 * Calidad del dato: nunca se asume "verificado" por defecto. `status`
 * distingue encontrado/verificado/no_verificado/inválido/rechazado.
 * "invalido"/"rechazado" están reservados para una futura revisión manual o
 * automática (p. ej. bounce de email) — Contact Finder en Fase 3 solo
 * escribe "encontrado" (el proveedor no declaró si lo verificó) o
 * "verificado"/"no_verificado" (el proveedor sí lo declaró explícitamente).
 *
 * Deduplicación (ver contactFinder/contactFinderService.ts):
 *  - Primaria: (org_id, provider, provider_contact_id) — único a nivel de
 *    Postgres cuando provider_contact_id no es null. Aislado por
 *    organización a propósito: el mismo provider_contact_id puede repetirse
 *    en dos organizaciones distintas sin conflicto (son proveedores propios
 *    de cada org).
 *  - Fallback (cuando el proveedor no da un id de persona propio): se
 *    comprueba a nivel de aplicación si ya existe un contacto para el mismo
 *    lead_result con el mismo email (case-insensitive) o teléfono antes de
 *    insertar uno nuevo — documentado explícitamente porque NO se asume que
 *    email o teléfono estén siempre presentes, y no hay constraint de DB
 *    para este caso (los valores pueden repetirse legítimamente entre
 *    personas distintas de empresas distintas).
 */
import {
  pgTable, serial, integer, text, doublePrecision, timestamp, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations";
import { leadResultsTable } from "./leads";

export const LEAD_CONTACT_STATUSES = ["encontrado", "verificado", "no_verificado", "invalido", "rechazado"] as const;
export type LeadContactStatus = (typeof LEAD_CONTACT_STATUSES)[number];

export const leadContactsTable = pgTable("lead_contacts", {
  id:           serial("id").primaryKey(),
  orgId:        integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  leadResultId: integer("lead_result_id").notNull().references(() => leadResultsTable.id, { onDelete: "cascade" }),

  name:         text("name"),
  role:         text("role"),   // cargo
  email:        text("email"),
  phone:        text("phone"),
  linkedinUrl:  text("linkedin_url"), // LinkedIn u otra referencia externa del proveedor

  // Proveedor y datos crudos de origen — el core nunca inventa estos valores.
  provider:          text("provider").notNull(),
  providerContactId: text("provider_contact_id"),
  confidence:        doublePrecision("confidence"), // 0..1, autodeclarado por el proveedor; nunca inventado

  status: text("status").notNull().default("encontrado"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("lead_contacts_org_id_idx").on(t.orgId),
  index("lead_contacts_lead_result_id_idx").on(t.leadResultId),
  // Dedup primaria, aislada por organización — ver comentario de cabecera.
  uniqueIndex("lead_contacts_org_provider_contact_uidx")
    .on(t.orgId, t.provider, t.providerContactId)
    .where(sql`${t.providerContactId} is not null`),
]);

export type LeadContact = typeof leadContactsTable.$inferSelect;
export type NewLeadContact = typeof leadContactsTable.$inferInsert;
