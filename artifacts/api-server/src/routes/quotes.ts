import { Router } from "express";
import { db, quotesTable, quoteItemsTable, clientsTable, activityTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { generateQuotePdf } from "../utils/pdf-quote";
import OpenAI from "openai";

export const quotesRouter = Router();

// ── List quotes (with client info) ────────────────────────────────────────────
quotesRouter.get("/", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const rows = await db
      .select({
        id:            quotesTable.id,
        title:         quotesTable.title,
        status:        quotesTable.status,
        currency:      quotesTable.currency,
        subtotal:      quotesTable.subtotal,
        taxRate:       quotesTable.taxRate,
        taxAmount:     quotesTable.taxAmount,
        total:         quotesTable.total,
        notes:         quotesTable.notes,
        validUntil:    quotesTable.validUntil,
        createdAt:     quotesTable.createdAt,
        updatedAt:     quotesTable.updatedAt,
        clientId:      quotesTable.clientId,
        clientName:    clientsTable.name,
        clientCompany: clientsTable.company,
        clientEmail:   clientsTable.email,
      })
      .from(quotesTable)
      .leftJoin(clientsTable, eq(quotesTable.clientId, clientsTable.id))
      .where(eq(quotesTable.orgId, orgId))
      .orderBy(desc(quotesTable.createdAt));

    res.json(rows.map(r => ({
      ...r,
      createdAt:  r.createdAt.toISOString(),
      updatedAt:  r.updatedAt.toISOString(),
      validUntil: r.validUntil?.toISOString() ?? null,
    })));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Get single quote with items ────────────────────────────────────────────────
quotesRouter.get("/:id", async (req, res) => {
  try {
    const orgId   = req.orgId!;
    const quoteId = parseInt(req.params.id);
    if (isNaN(quoteId)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [quote] = await db.select().from(quotesTable)
      .where(and(eq(quotesTable.id, quoteId), eq(quotesTable.orgId, orgId)));
    if (!quote) { res.status(404).json({ error: "Presupuesto no encontrado" }); return; }

    const [client] = await db.select().from(clientsTable)
      .where(eq(clientsTable.id, quote.clientId));

    const items = await db.select().from(quoteItemsTable)
      .where(eq(quoteItemsTable.quoteId, quoteId))
      .orderBy(quoteItemsTable.orderIndex);

    res.json({
      ...quote,
      items,
      client:     client ?? null,
      createdAt:  quote.createdAt.toISOString(),
      updatedAt:  quote.updatedAt.toISOString(),
      validUntil: quote.validUntil?.toISOString() ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Create quote with items ────────────────────────────────────────────────────
quotesRouter.post("/", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const {
      clientId,
      title,
      items,
      taxRate  = 21,
      notes,
      validUntil,
    } = req.body as {
      clientId:   number;
      title:      string;
      items:      { description: string; quantity: number; unitPrice: number }[];
      taxRate?:   number;
      notes?:     string;
      validUntil?: string;
    };

    if (!clientId || !title || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "clientId, title y al menos un ítem son obligatorios" });
      return;
    }

    // Verify client belongs to org
    const [client] = await db.select().from(clientsTable)
      .where(and(eq(clientsTable.id, clientId), eq(clientsTable.orgId, orgId)));
    if (!client) { res.status(404).json({ error: "Cliente no encontrado" }); return; }

    // Compute totals
    const lineItems = items.map((item, idx) => ({
      description: item.description,
      quantity:    Number(item.quantity)  || 1,
      unitPrice:   Number(item.unitPrice) || 0,
      total:       (Number(item.quantity) || 1) * (Number(item.unitPrice) || 0),
      orderIndex:  idx,
    }));
    const subtotal  = lineItems.reduce((acc, i) => acc + i.total, 0);
    const taxAmount = subtotal * (Number(taxRate) / 100);
    const total     = subtotal + taxAmount;

    const [quote] = await db.insert(quotesTable).values({
      orgId,
      clientId,
      title,
      status:     "draft",
      subtotal,
      taxRate:    Number(taxRate),
      taxAmount,
      total,
      notes:      notes      ?? null,
      validUntil: validUntil ? new Date(validUntil) : null,
    }).returning();

    const createdItems = await db.insert(quoteItemsTable)
      .values(lineItems.map(item => ({ ...item, quoteId: quote.id })))
      .returning();

    // Log activity
    await db.insert(activityTable).values({
      orgId,
      type:        "quote_created",
      description: `Presupuesto "${title}" creado para ${client.name} — ${new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(total)}`,
      clientName:  client.name,
      userId:      req.userId,
    }).catch(() => {/* non-critical */});

    res.status(201).json({
      ...quote,
      items:      createdItems,
      client,
      createdAt:  quote.createdAt.toISOString(),
      updatedAt:  quote.updatedAt.toISOString(),
      validUntil: quote.validUntil?.toISOString() ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Update quote (items + header) ─────────────────────────────────────────────
quotesRouter.patch("/:id", async (req, res) => {
  try {
    const orgId   = req.orgId!;
    const quoteId = parseInt(req.params.id);
    if (isNaN(quoteId)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [existing] = await db.select().from(quotesTable)
      .where(and(eq(quotesTable.id, quoteId), eq(quotesTable.orgId, orgId)));
    if (!existing) { res.status(404).json({ error: "Presupuesto no encontrado" }); return; }

    const { title, notes, validUntil, taxRate, items } = req.body as {
      title?:      string;
      notes?:      string | null;
      validUntil?: string | null;
      taxRate?:    number;
      items?:      { description: string; quantity: number; unitPrice: number }[];
    };

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (title      !== undefined) updateData["title"]      = title;
    if (notes      !== undefined) updateData["notes"]      = notes ?? null;
    if (validUntil !== undefined) updateData["validUntil"] = validUntil ? new Date(validUntil) : null;

    if (items && Array.isArray(items) && items.length > 0) {
      const rate      = Number(taxRate ?? existing.taxRate);
      const lineItems = items.map((item, idx) => ({
        description: item.description,
        quantity:    Number(item.quantity)  || 1,
        unitPrice:   Number(item.unitPrice) || 0,
        total:       (Number(item.quantity) || 1) * (Number(item.unitPrice) || 0),
        orderIndex:  idx,
      }));
      const subtotal  = lineItems.reduce((acc, i) => acc + i.total, 0);
      const taxAmount = subtotal * (rate / 100);
      Object.assign(updateData, { taxRate: rate, subtotal, taxAmount, total: subtotal + taxAmount });

      await db.delete(quoteItemsTable).where(eq(quoteItemsTable.quoteId, quoteId));
      await db.insert(quoteItemsTable).values(lineItems.map(item => ({ ...item, quoteId })));
    }

    const [updated] = await db.update(quotesTable).set(updateData)
      .where(and(eq(quotesTable.id, quoteId), eq(quotesTable.orgId, orgId)))
      .returning();

    const updatedItems = await db.select().from(quoteItemsTable)
      .where(eq(quoteItemsTable.quoteId, quoteId))
      .orderBy(quoteItemsTable.orderIndex);

    res.json({
      ...updated,
      items:      updatedItems,
      createdAt:  updated.createdAt.toISOString(),
      updatedAt:  updated.updatedAt.toISOString(),
      validUntil: updated.validUntil?.toISOString() ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Update status ──────────────────────────────────────────────────────────────
quotesRouter.patch("/:id/status", async (req, res) => {
  try {
    const orgId   = req.orgId!;
    const quoteId = parseInt(req.params.id);
    if (isNaN(quoteId)) { res.status(400).json({ error: "Invalid id" }); return; }

    const { status } = req.body as { status: string };
    const VALID = ["draft", "sent", "pending", "accepted", "rejected"];
    if (!VALID.includes(status)) {
      res.status(400).json({ error: `Estado inválido. Valores permitidos: ${VALID.join(", ")}` });
      return;
    }

    const [updated] = await db.update(quotesTable)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(quotesTable.id, quoteId), eq(quotesTable.orgId, orgId)))
      .returning();
    if (!updated) { res.status(404).json({ error: "Presupuesto no encontrado" }); return; }

    res.json({ ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Delete quote ───────────────────────────────────────────────────────────────
quotesRouter.delete("/:id", async (req, res) => {
  try {
    const orgId   = req.orgId!;
    const quoteId = parseInt(req.params.id);
    if (isNaN(quoteId)) { res.status(400).json({ error: "Invalid id" }); return; }

    await db.delete(quotesTable)
      .where(and(eq(quotesTable.id, quoteId), eq(quotesTable.orgId, orgId)));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Generate + stream PDF ──────────────────────────────────────────────────────
quotesRouter.get("/:id/pdf", async (req, res) => {
  try {
    const orgId   = req.orgId!;
    const quoteId = parseInt(req.params.id);
    if (isNaN(quoteId)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [quote] = await db.select().from(quotesTable)
      .where(and(eq(quotesTable.id, quoteId), eq(quotesTable.orgId, orgId)));
    if (!quote) { res.status(404).json({ error: "Presupuesto no encontrado" }); return; }

    const [client] = await db.select().from(clientsTable)
      .where(eq(clientsTable.id, quote.clientId));

    const items = await db.select().from(quoteItemsTable)
      .where(eq(quoteItemsTable.quoteId, quoteId))
      .orderBy(quoteItemsTable.orderIndex);

    const pdfBuffer = await generateQuotePdf({
      quote:  { ...quote, validUntil: quote.validUntil ?? null },
      client: client ?? null,
      items,
    });

    const filename = `presupuesto-${String(quoteId).padStart(5, "0")}.pdf`;
    res.setHeader("Content-Type",        "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length",      pdfBuffer.length);
    res.end(pdfBuffer);
  } catch (err) {
    console.error("[Quotes PDF]", err);
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /ai-prioritize — ¿Qué presupuesto perseguir hoy? ────────────────────
quotesRouter.post("/ai-prioritize", async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { res.status(503).json({ error: "OPENAI_API_KEY no configurada" }); return; }

  const orgId = req.orgId!;

  const rows = await db
    .select({
      id:            quotesTable.id,
      title:         quotesTable.title,
      status:        quotesTable.status,
      total:         quotesTable.total,
      updatedAt:     quotesTable.updatedAt,
      createdAt:     quotesTable.createdAt,
      validUntil:    quotesTable.validUntil,
      notes:         quotesTable.notes,
      clientId:      quotesTable.clientId,
      clientName:    clientsTable.name,
      clientCompany: clientsTable.company,
    })
    .from(quotesTable)
    .leftJoin(clientsTable, eq(quotesTable.clientId, clientsTable.id))
    .where(and(eq(quotesTable.orgId, orgId)))
    .orderBy(desc(quotesTable.createdAt));

  const active = rows.filter(r => ["sent", "pending", "draft"].includes(r.status));
  if (active.length === 0) {
    res.json({ ranked: [], summary: "No hay presupuestos activos para analizar." });
    return;
  }

  const now = new Date();
  const PROB: Record<string, number> = { draft: 0.10, sent: 0.40, pending: 0.65 };

  const scored = active.map(q => {
    const daysSince = Math.max(1, Math.round((now.getTime() - new Date(q.updatedAt).getTime()) / 86_400_000));
    const cappedDays = Math.min(daysSince, 30);
    const prob = PROB[q.status] ?? 0.1;
    const score = Math.round((q.total ?? 0) * prob * cappedDays);
    return { ...q, score, daysSince, prob };
  }).sort((a, b) => b.score - a.score);

  const top5 = scored.slice(0, 5);

  const listForAI = top5.map((q, i) =>
    (i + 1) + ". #" + q.id + " - " + q.title +
    " | Cliente: " + (q.clientName ?? "Desconocido") +
    (q.clientCompany ? " (" + q.clientCompany + ")" : "") +
    " | Total: " + (q.total ?? 0) + " EUR" +
    " | Estado: " + q.status +
    " | Dias sin cambio: " + q.daysSince +
    " | Score: " + q.score
  ).join("\n");

  const openai = new OpenAI({ apiKey });
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.3,
    response_format: { type: "json_object" },
    max_tokens: 600,
    messages: [
      {
        role: "system",
        content: `Eres un consultor comercial senior. Analiza los presupuestos ordenados por score (valor x probabilidad x dias sin respuesta).
Devuelve SOLO este JSON:
{
  "top_id": <id del presupuesto 1>,
  "summary": "<1-2 frases: por qué este presupuesto merece atención hoy>",
  "actions": [
    { "id": <quote_id>, "action": "<acción concreta a tomar>", "reason": "<por qué ahora>" }
  ]
}
El array actions debe tener exactamente los mismos IDs en el mismo orden. Solo JSON.`,
      },
      { role: "user", content: "Presupuestos a analizar (ordenados por score):\n" + listForAI },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let ai: { top_id?: number; summary?: string; actions?: { id: number; action: string; reason: string }[] };
  try { ai = JSON.parse(raw) as typeof ai; } catch { ai = {}; }

  const actionMap = new Map((ai.actions ?? []).map(a => [a.id, a]));

  res.json({
    ranked: top5.map(q => ({
      id:          q.id,
      title:       q.title,
      status:      q.status,
      total:       q.total,
      clientName:  q.clientName,
      clientCompany: q.clientCompany,
      daysSince:   q.daysSince,
      score:       q.score,
      prob:        q.prob,
      isTop:       q.id === ai.top_id,
      action:      actionMap.get(q.id)?.action ?? null,
      reason:      actionMap.get(q.id)?.reason ?? null,
    })),
    summary: ai.summary ?? null,
    generated_at: now.toISOString(),
  });
});

// ── POST /ai-generate — AI Quote Generator ────────────────────────────────────
quotesRouter.post("/ai-generate", async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { res.status(503).json({ error: "OPENAI_API_KEY no configurada" }); return; }

  const orgId = req.orgId!;
  const { clientId, serviceDescription, estimatedValue } = req.body as {
    clientId: number;
    serviceDescription: string;
    estimatedValue?: number | null;
  };

  if (!clientId || !serviceDescription?.trim()) {
    res.status(400).json({ error: "clientId y serviceDescription son obligatorios" });
    return;
  }

  const [client] = await db.select().from(clientsTable)
    .where(and(eq(clientsTable.id, clientId), eq(clientsTable.orgId, orgId)));
  if (!client) { res.status(404).json({ error: "Cliente no encontrado" }); return; }

  const now        = new Date();
  const validUntil = new Date(now.getTime() + 30 * 86_400_000);
  const dateStr    = now.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
  const validStr   = validUntil.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });

  const prompt = [
    "Cliente: " + client.name + (client.company ? " (" + client.company + ")" : ""),
    "Servicio solicitado: " + serviceDescription,
    estimatedValue ? "Valor estimado: " + estimatedValue + " EUR" : "",
    "Fecha: " + dateStr,
    "Validez: " + validStr,
  ].filter(Boolean).join("\n");

  const openai = new OpenAI({ apiKey });
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `Eres un experto en redacción de presupuestos comerciales profesionales en español.
Genera un presupuesto estructurado basado en el servicio descrito. Desglosa el servicio en partidas detalladas.

Devuelve SOLO este JSON:
{
  "title": "<título profesional del presupuesto>",
  "items": [
    { "description": "<descripción detallada de la partida>", "quantity": <número>, "unitPrice": <precio sin IVA> }
  ],
  "notes": "<condiciones de pago, garantías, alcance del servicio y exclusiones — texto con saltos de línea>"
}

Reglas:
- El título debe ser profesional: "Propuesta de [Servicio] para [Empresa/Cliente]"
- Desglosa en 2-5 partidas específicas con descripciones claras
- Si se da valor estimado, ajusta los precios unitarios para que el total (sin IVA) sea cercano a ese valor
- Las notas deben incluir: condiciones de pago (50% inicio / 50% entrega), alcance, exclusiones y validez 30 días
- Precios en euros, sin símbolo
- Solo JSON, sin texto extra`,
      },
      { role: "user", content: prompt },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let generated: { title: string; items: { description: string; quantity: number; unitPrice: number }[]; notes: string };
  try {
    generated = JSON.parse(raw) as typeof generated;
  } catch {
    res.status(500).json({ error: "Error al parsear respuesta AI" });
    return;
  }

  res.json({
    ...generated,
    client: {
      id:      client.id,
      name:    client.name,
      company: client.company,
      email:   client.email,
      phone:   client.phone,
    },
    validUntil: validUntil.toISOString(),
    generatedAt: now.toISOString(),
  });
});
