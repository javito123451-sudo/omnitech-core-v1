import { Router } from "express";
import { db, quotesTable, quoteItemsTable, clientsTable, activityTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { generateQuotePdf } from "../utils/pdf-quote";

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
    const VALID = ["draft", "sent", "accepted", "rejected", "expired"];
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
