// ═══════════════════════════════════════════════════════════════════════════
//  Ava V2 — Client Skills
// ═══════════════════════════════════════════════════════════════════════════

import { db, clientsTable, activityTable } from "@workspace/db";
import { eq, and, desc, ilike, inArray } from "drizzle-orm";
import type { SkillDefinition, SkillContext } from "./types";

const STATUS_LABEL: Record<string, string> = {
  lead:     "Prospecto",
  prospect: "Prospecto calificado",
  active:   "Cliente activo",
  inactive: "Inactivo",
  churned:  "Perdido",
};

async function createClient(
  params: Record<string, unknown>,
  orgId: number,
  context: SkillContext,
): Promise<string> {
  const name    = String(params["name"]    ?? "");
  const email   = params["email"]   ? String(params["email"])   : null;
  const phone   = params["phone"]   ? String(params["phone"])   : null;
  const company = params["company"] ? String(params["company"]) : null;
  const status  = String(params["status"]  ?? "lead");
  const value   = params["value"]   ? Number(params["value"])  : null;
  const tags    = params["tags"]    ? String(params["tags"])    : null;
  const notes   = params["notes"]   ? String(params["notes"])   : null;
  const source  = params["source"]  ? String(params["source"])  : "skill_engine";

  if (!name) {
    return JSON.stringify({ error: "Se requiere el nombre del cliente." });
  }

  // ── Deduplication: search by email or phone before creating ───────────────
  let existing: typeof clientsTable.$inferSelect | undefined;
  if (email) {
    const [byEmail] = await db.select().from(clientsTable)
      .where(and(eq(clientsTable.orgId, orgId), eq(clientsTable.email, email)))
      .limit(1);
    if (byEmail) existing = byEmail;
  }
  if (!existing && phone) {
    const [byPhone] = await db.select().from(clientsTable)
      .where(and(eq(clientsTable.orgId, orgId), eq(clientsTable.phone, phone)))
      .limit(1);
    if (byPhone) existing = byPhone;
  }

  if (existing) {
    // Update existing client with new data
    await db.update(clientsTable)
      .set({
        name:   existing.name !== name ? name : existing.name,
        status: status !== existing.status ? status : existing.status,
        company: company ?? existing.company,
        tags:    tags    ?? existing.tags,
        notes:   notes   ? `${existing.notes ?? ""}\n${notes}`.trim() : existing.notes,
        updatedAt: new Date(),
      })
      .where(eq(clientsTable.id, existing.id));

    const [updated] = await db.select().from(clientsTable)
      .where(eq(clientsTable.id, existing.id));

    return JSON.stringify({
      success:    true,
      dbVerified: true,
      clientId:   existing.id,
      updated:    true,
      name:       updated?.name ?? name,
      status:     updated?.status ?? status,
      statusLabel: STATUS_LABEL[updated?.status ?? status] ?? status,
      email:      updated?.email ?? email,
      phone:      updated?.phone ?? phone,
      company:    updated?.company ?? company,
      message:    `Cliente existente actualizado: "${updated?.name ?? name}" (ID #${existing.id}).`,
    });
  }

  const [client] = await db.insert(clientsTable).values({
    orgId,
    name,
    email,
    phone,
    company,
    status,
    value,
    tags,
    notes,
    source: source as any,
  }).returning();

  if (!client) {
    return JSON.stringify({ error: "Error al crear el cliente en la base de datos." });
  }

  await db.insert(activityTable).values({
    orgId,
    type:        "client_created",
    description: `Cliente "${name}" creado desde ${source}${company ? ` (${company})` : ""}`,
    clientName:  name,
  }).catch(() => {/* non-critical */});

  return JSON.stringify({
    success:   true,
    dbVerified: true,
    clientId:  client.id,
    name,
    status,
    statusLabel: STATUS_LABEL[status] ?? status,
    email,
    phone,
    company,
    value,
    message:   `Cliente "${name}" creado correctamente con ID #${client.id}.`,
  });
}

async function getClients(
  params: Record<string, unknown>,
  orgId: number,
  context: SkillContext,
): Promise<string> {
  const status = String(params["status"] ?? "all");
  const sort   = String(params["sort"]   ?? "name");
  const limit  = Math.min(Number(params["limit"] ?? 50), 100);
  const search = params["search"] ? String(params["search"]) : null;

  const orderBy =
    sort === "created_desc" ? desc(clientsTable.createdAt) :
    sort === "value_desc"   ? desc(clientsTable.value)     :
    clientsTable.name;

  let whereClause = eq(clientsTable.orgId, orgId);
  if (status !== "all") {
    if (status === "followup") {
      whereClause = and(whereClause, inArray(clientsTable.status, ["lead", "inactive"]));
    } else {
      whereClause = and(whereClause, eq(clientsTable.status, status));
    }
  }
  if (search) {
    whereClause = and(whereClause, ilike(clientsTable.name, `%${search}%`));
  }

  const rows = await db
    .select()
    .from(clientsTable)
    .where(whereClause)
    .orderBy(orderBy)
    .limit(limit);

  const totalValue = rows.reduce((acc, c) => acc + (c.value ?? 0), 0);
  const byStatus: Record<string, number> = {};
  for (const c of rows) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;

  return JSON.stringify({
    total: rows.length,
    totalValue: Math.round(totalValue),
    byStatus: Object.entries(byStatus).map(([s, n]) => ({
      status: s, label: STATUS_LABEL[s] ?? s, count: n,
    })),
    clients: rows.map(c => ({
      id:        c.id,
      name:      c.name,
      company:   c.company ?? null,
      status:    c.status,
      label:     STATUS_LABEL[c.status] ?? c.status,
      email:     c.email,
      phone:     c.phone ?? null,
      value:     c.value ?? 0,
      tags:      c.tags ?? null,
      createdAt: c.createdAt.toISOString(),
    })),
  });
}

async function getClientDetail(
  params: Record<string, unknown>,
  orgId: number,
  context: SkillContext,
): Promise<string> {
  const clientId   = params["client_id"]   ? Number(params["client_id"])   : null;
  const clientName = params["client_name"] ? String(params["client_name"]) : null;

  if (!clientId && !clientName) {
    return JSON.stringify({ error: "Se requiere client_id o client_name." });
  }

  let client: typeof clientsTable.$inferSelect | undefined;
  if (clientId) {
    [client] = await db.select().from(clientsTable)
      .where(and(eq(clientsTable.id, clientId), eq(clientsTable.orgId, orgId)));
  } else {
    const matched = await db.select().from(clientsTable)
      .where(and(eq(clientsTable.orgId, orgId), ilike(clientsTable.name, `%${clientName}%`)))
      .limit(1);
    client = matched[0];
  }

  if (!client) {
    return JSON.stringify({ error: "Cliente no encontrado." });
  }

  return JSON.stringify({
    id:        client.id,
    name:      client.name,
    company:   client.company ?? null,
    email:     client.email,
    phone:     client.phone ?? null,
    status:    client.status,
    label:     STATUS_LABEL[client.status] ?? client.status,
    value:     client.value ?? 0,
    tags:      client.tags ?? null,
    notes:     client.notes ?? null,
    createdAt: client.createdAt.toISOString(),
  });
}

export const createClientSkill: SkillDefinition = {
  id: "create_client",
  name: "Crear Cliente",
  description: "Crea un nuevo cliente en el CRM.",
  params: [
    { name: "name",    type: "string", description: "Nombre completo", required: true },
    { name: "email",   type: "string", description: "Email", required: false },
    { name: "phone",   type: "string", description: "Teléfono", required: false },
    { name: "company", type: "string", description: "Empresa", required: false },
    { name: "status",  type: "string", description: "lead, active, inactive, churned", default: "lead" },
    { name: "value",   type: "number", description: "Valor estimado (€)", required: false },
    { name: "tags",    type: "string", description: "Etiquetas separadas por coma", required: false },
    { name: "notes",   type: "string", description: "Notas", required: false },
    { name: "source",  type: "string", description: "Origen: whatsapp, telegram, web, skill_engine", default: "skill_engine" },
  ],
  execute: createClient,
};

export const getClientsSkill: SkillDefinition = {
  id: "list_clients",
  name: "Listar Clientes",
  description: "Lista clientes del CRM con filtros y ordenación.",
  params: [
    { name: "status", type: "string", description: "all, lead, active, inactive, followup", default: "all" },
    { name: "sort",   type: "string", description: "name, created_desc, value_desc", default: "name" },
    { name: "limit",  type: "number", description: "Máximo de resultados", default: 50 },
    { name: "search", type: "string", description: "Búsqueda por nombre", required: false },
  ],
  execute: getClients,
};

export const getClientDetailSkill: SkillDefinition = {
  id: "get_client",
  name: "Ver Cliente",
  description: "Obtiene detalle completo de un cliente.",
  params: [
    { name: "client_id",   type: "number", description: "ID del cliente", required: false },
    { name: "client_name", type: "string", description: "Nombre del cliente", required: false },
  ],
  execute: getClientDetail,
};
