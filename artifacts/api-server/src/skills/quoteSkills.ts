// ═══════════════════════════════════════════════════════════════════════════
//  Ava V2 — Quote Skills
// ═══════════════════════════════════════════════════════════════════════════

import { db, clientsTable, quotesTable, quoteItemsTable, activityTable } from "@workspace/db";
import { eq, and, desc, ilike } from "drizzle-orm";
import type { SkillDefinition, SkillContext } from "./types";

async function createQuote(
  params: Record<string, unknown>,
  orgId: number,
  context: SkillContext,
): Promise<string> {
  const clientName = String(params["client_name"] ?? "");
  const title      = String(params["title"]       ?? "Presupuesto");
  const rawItems   = (params["items"] as { description: string; quantity: number; unit_price: number }[]) ?? [];
  const taxRate    = Number(params["tax_rate"]    ?? 21);
  const notes      = params["notes"]      ? String(params["notes"])      : null;
  const validDays  = Number(params["valid_days"]  ?? 30);

  if (!clientName || rawItems.length === 0) {
    return JSON.stringify({ error: "Se necesita client_name y al menos un ítem." });
  }

  // Resolve client
  let client: typeof clientsTable.$inferSelect | undefined;
  if (context.client) {
    [client] = await db.select().from(clientsTable)
      .where(and(eq(clientsTable.orgId, orgId), eq(clientsTable.id, context.client.id)));
  } else {
    const matched = await db.select().from(clientsTable)
      .where(and(eq(clientsTable.orgId, orgId), ilike(clientsTable.name, `%${clientName}%`)))
      .limit(5);
    if (matched.length > 0) client = matched[0]!;
  }

  if (!client) {
    return JSON.stringify({ error: `No encontré ningún cliente que coincida con "${clientName}".` });
  }

  const lineItems = rawItems.map((item, idx) => ({
    description: item.description,
    quantity:    Number(item.quantity)   || 1,
    unitPrice:   Number(item.unit_price) || 0,
    total:       (Number(item.quantity) || 1) * (Number(item.unit_price) || 0),
    orderIndex:  idx,
  }));
  const subtotal  = lineItems.reduce((acc, i) => acc + i.total, 0);
  const taxAmount = subtotal * (taxRate / 100);
  const total     = subtotal + taxAmount;

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + validDays);

  const [quote] = await db.insert(quotesTable).values({
    orgId,
    clientId:  client.id,
    title,
    status:    "draft",
    subtotal,
    taxRate,
    taxAmount,
    total,
    notes,
    validUntil,
  }).returning();

  if (!quote) {
    return JSON.stringify({ error: "Error al crear el presupuesto en la base de datos." });
  }

  await db.insert(quoteItemsTable).values(
    lineItems.map(item => ({ ...item, quoteId: quote.id })),
  );

  await db.insert(activityTable).values({
    orgId,
    type:        "quote_created",
    description: `Presupuesto "${title}" creado para ${client.name} — ${new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(total)}`,
    clientName:  client.name,
  }).catch(() => {/* non-critical */});

  return JSON.stringify({
    success:     true,
    dbVerified:  true,
    quoteId:     quote.id,
    quoteNumber: String(quote.id).padStart(5, "0"),
    clientName:  client.name,
    clientCompany: client.company ?? null,
    title,
    status:      "draft",
    subtotal:    Math.round(subtotal * 100) / 100,
    taxRate,
    taxAmount:   Math.round(taxAmount * 100) / 100,
    total:       Math.round(total * 100) / 100,
    validUntil:  validUntil.toLocaleDateString("es-ES"),
    items:       lineItems.map(i => ({
      description: i.description,
      quantity:    i.quantity,
      unitPrice:   i.unitPrice,
      total:       Math.round(i.total * 100) / 100,
    })),
    downloadPath: `/api/quotes/${quote.id}/pdf`,
    message: `Presupuesto #${String(quote.id).padStart(5, "0")} creado con éxito.`,
  });
}

async function getQuotes(
  params: Record<string, unknown>,
  orgId: number,
  context: SkillContext,
): Promise<string> {
  const status = String(params["status"] ?? "all");
  const limit  = Math.min(Number(params["limit"] ?? 20), 50);

  const statusFilter = status === "all"
    ? undefined
    : eq(quotesTable.status, status);

  const conditions = [
    eq(quotesTable.orgId, orgId),
    statusFilter,
  ].filter(Boolean);

  const rows = await db
    .select({
      id:         quotesTable.id,
      title:      quotesTable.title,
      status:     quotesTable.status,
      total:      quotesTable.total,
      validUntil: quotesTable.validUntil,
      clientName: clientsTable.name,
    })
    .from(quotesTable)
    .leftJoin(clientsTable, eq(quotesTable.clientId, clientsTable.id))
    .where(conditions.length === 1 ? conditions[0]! : and(...conditions as Parameters<typeof and>))
    .orderBy(desc(quotesTable.createdAt))
    .limit(limit);

  return JSON.stringify({
    total: rows.length,
    quotes: rows.map(r => ({
      id:         r.id,
      title:      r.title,
      status:     r.status,
      total:      r.total,
      validUntil: r.validUntil?.toLocaleDateString("es-ES") ?? null,
      clientName: r.clientName ?? null,
    })),
  });
}

export const createQuoteSkill: SkillDefinition = {
  id: "create_quote",
  name: "Crear Presupuesto",
  description: "Crea un presupuesto para un cliente con ítems, impuestos y validez.",
  params: [
    { name: "client_name", type: "string", description: "Nombre del cliente", required: true },
    { name: "title",       type: "string", description: "Título del presupuesto", default: "Presupuesto" },
    { name: "items",       type: "array",  description: "Array de {description, quantity, unit_price}", required: true },
    { name: "tax_rate",    type: "number", description: "Porcentaje de impuesto", default: 21 },
    { name: "notes",       type: "string", description: "Notas adicionales", required: false },
    { name: "valid_days",  type: "number", description: "Días de validez", default: 30 },
  ],
  execute: createQuote,
};

export const getQuotesSkill: SkillDefinition = {
  id: "list_quotes",
  name: "Listar Presupuestos",
  description: "Lista presupuestos del CRM.",
  params: [
    { name: "status", type: "string", description: "draft, sent, accepted, all", default: "all" },
    { name: "limit",  type: "number", description: "Máximo de resultados", default: 20 },
  ],
  execute: getQuotes,
};
