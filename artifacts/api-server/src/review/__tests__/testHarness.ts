// Utilidades de pruebas de integración de Omni Review (Postgres real).
import { eq, inArray } from "drizzle-orm";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { db, organizationsTable, moduleConfigsTable, auditLogsTable } from "@workspace/db";

export const hasRealDb = !process.env["DATABASE_URL"]?.includes("placeholder");

export async function createOrg(label: string): Promise<number> {
  const slug = `review-test-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [org] = await db.insert(organizationsTable).values({ name: `Review Test ${label}`, slug, plan: "starter", status: "active" }).returning({ id: organizationsTable.id });
  return org!.id;
}

export async function setModule(orgId: number, enabled: boolean | null): Promise<void> {
  await db.delete(moduleConfigsTable).where(eq(moduleConfigsTable.orgId, orgId));
  if (enabled === null) return; // sin fila
  await db.insert(moduleConfigsTable).values({ orgId, moduleSlug: "omni_review", isEnabled: enabled, updatedBy: "test" });
}

/** Borra las organizaciones de prueba (las tablas review_* caen por ON DELETE CASCADE). */
export async function cleanupOrgs(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(auditLogsTable).where(inArray(auditLogsTable.orgId, ids));
  await db.delete(moduleConfigsTable).where(inArray(moduleConfigsTable.orgId, ids));
  await db.delete(organizationsTable).where(inArray(organizationsTable.id, ids));
}

export interface Identity { orgId?: number; role?: string; superAdmin?: boolean }

export async function startApp(mount: (app: express.Express) => void, getIdentity: () => Identity): Promise<{ base: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = getIdentity();
    Object.assign(req, { orgId: id.orgId, orgRole: id.role, effectiveRole: id.role, isSuperAdmin: id.superAdmin === true, clerkUserId: "user_test", userId: 1 });
    next();
  });
  mount(app);
  let server!: Server;
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise((r) => server.close(() => r())) };
}

// ── Motor de campañas ────────────────────────────────────────────────────────
import { and as andOp } from "drizzle-orm";
import { importContacts } from "../importer";
import { createLocation } from "../locations";
import { createTemplate } from "../templates";
import { createCampaign, type CampaignInput } from "../engine/campaigns";
import type { ChannelProvider, SendOutcome, SendRequest } from "../channels/types";
import { reviewMessagesTable } from "@workspace/db";

/** T0 fijo: 10:00 hora de Madrid (invierno). Lanzamientos y ticks usan relojes derivados de él. */
export const T0 = new Date("2026-12-01T09:00:00Z");
export const at = (ms: number) => new Date(T0.getTime() + ms);

/**
 * Doble de un proveedor externo: SOLO sustituye la llamada HTTP a WhatsApp/Resend (que requiere credenciales reales).
 * La cola, la BD, los límites, el guard y los reintentos que lo rodean son los reales.
 */
export function fakeProvider(channel: "email" | "whatsapp", behaviour: (req: SendRequest, n: number) => SendOutcome | Promise<SendOutcome> = (_r, n) => ({ ok: true, providerMessageId: `fake-${n}` }),
  limits = { maxPerMinute: 10_000, maxPerDay: null as number | null }) {
  const calls: SendRequest[] = [];
  const p: ChannelProvider & { calls: SendRequest[] } = {
    channel, providerId: `fake_${channel}`, limits, calls,
    async readiness() { return { ready: true }; },
    async send(req) { calls.push(req); return behaviour(req, calls.length); },
  };
  return p;
}
export const registryOf = (...ps: ChannelProvider[]) => new Map(ps.map((p) => [p.channel, p] as const));

export interface Seed { orgId: number; locationId: number; templateId: number }

export async function seedOrg(label: string, contacts: { email?: string; phone?: string }[], opts: { channel?: "email" | "whatsapp" } = {}): Promise<Seed> {
  const orgId = await createOrg(label);
  await setModule(orgId, true);
  const loc = await createLocation(orgId, { name: `Local ${label}`, googlePlaceId: `ChIJ${label.replace(/\W/g, "")}${Date.now().toString(36)}abcdef` });
  const channel = opts.channel ?? "email";
  const tpl = await createTemplate(orgId, 1, channel === "email"
    ? { channel, name: "Petición", subject: "Tu opinión sobre {{establecimiento}}", body: "Hola {{nombre}}, ¿nos cuentas tu experiencia? {{enlace}}" }
    : { channel, name: "Petición", body: "Hola {{nombre}}, ¿nos cuentas tu experiencia? {{enlace}} Responde BAJA para no recibir más mensajes.", waTemplateName: "peticion", waLanguage: "es_ES" });
  if (channel === "whatsapp") await db.execute(sql`UPDATE review_templates SET wa_status = 'approved' WHERE id = ${tpl.id}::integer`);
  if (contacts.length) {
    await importContacts({
      orgId, userId: 1, fileName: "seed.csv", source: "csv", locationId: loc.id, legalBasis: "existing_customer_relationship",
      headers: ["Nombre", "Email", "Teléfono"], rows: contacts.map((c, i) => ({ Nombre: `Cliente ${i}`, Email: c.email ?? null, Teléfono: c.phone ?? null })),
    });
  }
  return { orgId, locationId: loc.id, templateId: tpl.id };
}

export const newCampaign = (s: Seed, over: CampaignInput = {}) =>
  createCampaign(s.orgId, 1, { name: "Campaña", locationId: s.locationId, templateId: s.templateId, channel: "email", ratePerMinute: 600, ...over });

export const messagesOf = (campaignId: number) => db.select().from(reviewMessagesTable).where(andOp(eq(reviewMessagesTable.campaignId, campaignId)));
import { sql } from "drizzle-orm";
