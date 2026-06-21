/**
 * Client Self-Service Portal — public endpoints (no Clerk auth)
 * Clients access their invoices via a secure token-based URL.
 *
 * Endpoints (all public — no requireAuth middleware):
 *   GET  /api/portal/invoices?token=xxx   — list invoices for the token's client
 *   GET  /api/portal/profile?token=xxx    — client name + org name
 *   POST /api/portal/token                — (internal, requires Clerk auth) create/refresh token for a client
 */

import { Router, type Request } from "express";
import { db } from "@workspace/db";
import { clientsTable, invoicesTable, invoiceItemsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { requireAuth, resolveOrg } from "../middlewares/auth";
import crypto from "node:crypto";
import { logAudit } from "../utils/auditLogger";

export const portalRouter = Router();

// ── Token helpers ─────────────────────────────────────────────────────────────

async function resolveToken(token: string): Promise<{ clientId: number; orgId: number; expiresAt: Date } | null> {
  if (!token || token.length < 32) return null;
  const rows = await db.execute(sql`
    SELECT client_id, org_id, expires_at
    FROM client_portal_tokens
    WHERE token = ${token}
      AND expires_at > NOW()
    LIMIT 1
  `);
  const row = (rows as { rows: Array<{ client_id: number; org_id: number; expires_at: string }> }).rows[0];
  if (!row) return null;
  return { clientId: row.client_id, orgId: row.org_id, expiresAt: new Date(row.expires_at) };
}

// ── GET /api/portal/profile?token=xxx ─────────────────────────────────────────
portalRouter.get("/profile", async (req, res) => {
  const token = req.query["token"] as string | undefined;
  if (!token) { res.status(400).json({ error: "token requerido" }); return; }

  const session = await resolveToken(token);
  if (!session) { res.status(401).json({ error: "Enlace inválido o expirado" }); return; }

  const [client] = await db.select({ id: clientsTable.id, name: clientsTable.name, email: clientsTable.email, company: clientsTable.company })
    .from(clientsTable)
    .where(and(eq(clientsTable.id, session.clientId), eq(clientsTable.orgId, session.orgId)));

  if (!client) { res.status(404).json({ error: "Cliente no encontrado" }); return; }

  const [org] = await db.execute(sql`SELECT name FROM organizations WHERE id = ${session.orgId} LIMIT 1`) as unknown as { rows: Array<{ name: string }> };
  const orgName = (org as unknown as { rows: Array<{ name: string }> }).rows?.[0]?.name ?? "Tu proveedor";

  res.json({
    client: { id: client.id, name: client.name, email: client.email, company: client.company },
    orgName,
    expiresAt: session.expiresAt,
  });
});

// ── GET /api/portal/invoices?token=xxx ───────────────────────────────────────
portalRouter.get("/invoices", async (req, res) => {
  const token = req.query["token"] as string | undefined;
  if (!token) { res.status(400).json({ error: "token requerido" }); return; }

  const session = await resolveToken(token);
  if (!session) { res.status(401).json({ error: "Enlace inválido o expirado" }); return; }

  const rows = await db
    .select({
      id: invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
      status: invoicesTable.status,
      currency: invoicesTable.currency,
      subtotal: invoicesTable.subtotal,
      taxRate: invoicesTable.taxRate,
      taxAmount: invoicesTable.taxAmount,
      total: invoicesTable.total,
      dueDate: invoicesTable.dueDate,
      paidAt: invoicesTable.paidAt,
      notes: invoicesTable.notes,
      createdAt: invoicesTable.createdAt,
    })
    .from(invoicesTable)
    .where(and(
      eq(invoicesTable.orgId, session.orgId),
      eq(invoicesTable.clientId, session.clientId),
    ))
    .orderBy(desc(invoicesTable.createdAt))
    .limit(100);

  res.json({
    invoices: rows.map(r => ({
      ...r,
      subtotal:  parseFloat(String(r.subtotal)),
      taxRate:   parseFloat(String(r.taxRate)),
      taxAmount: parseFloat(String(r.taxAmount)),
      total:     parseFloat(String(r.total)),
    })),
    total: rows.length,
  });
});

// ── GET /api/portal/invoices/:id?token=xxx — invoice detail with line items ──
portalRouter.get("/invoices/:id", async (req, res) => {
  const token = req.query["token"] as string | undefined;
  if (!token) { res.status(400).json({ error: "token requerido" }); return; }

  const session = await resolveToken(token);
  if (!session) { res.status(401).json({ error: "Enlace inválido o expirado" }); return; }

  const invoiceId = Number(req.params["id"]);
  const [inv] = await db.select().from(invoicesTable)
    .where(and(
      eq(invoicesTable.id, invoiceId),
      eq(invoicesTable.orgId, session.orgId),
      eq(invoicesTable.clientId, session.clientId),
    ));

  if (!inv) { res.status(404).json({ error: "Factura no encontrada" }); return; }

  const items = await db.select().from(invoiceItemsTable)
    .where(eq(invoiceItemsTable.invoiceId, invoiceId));

  res.json({
    ...inv,
    subtotal:  parseFloat(String(inv.subtotal)),
    taxRate:   parseFloat(String(inv.taxRate)),
    taxAmount: parseFloat(String(inv.taxAmount)),
    total:     parseFloat(String(inv.total)),
    items: items.map(i => ({
      ...i,
      quantity:  parseFloat(String(i.quantity)),
      unitPrice: parseFloat(String(i.unitPrice)),
      total:     parseFloat(String(i.total)),
    })),
  });
});

// ── POST /api/portal/token — internal, requires Clerk auth ───────────────────
// Body: { clientId: number, expiresInDays?: number }
portalRouter.post("/token", requireAuth, resolveOrg, async (req, res) => {
  const orgId    = (req as Request & { orgId?: number }).orgId;
  const { clientId, expiresInDays = 30 } = req.body as { clientId: number; expiresInDays?: number };
  if (!clientId) { res.status(400).json({ error: "clientId requerido" }); return; }
  if (!orgId)    { res.status(403).json({ error: "Sin organización" }); return; }

  // Validate client belongs to this org
  const [client] = await db.select({ id: clientsTable.id, name: clientsTable.name })
    .from(clientsTable)
    .where(and(eq(clientsTable.id, clientId), eq(clientsTable.orgId, orgId)));
  if (!client) { res.status(404).json({ error: "Cliente no encontrado" }); return; }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

  // Upsert: one token per (org, client) — revokes previous
  await db.execute(sql`
    INSERT INTO client_portal_tokens (org_id, client_id, token, expires_at, created_at)
    VALUES (${orgId}, ${clientId}, ${token}, ${expiresAt.toISOString()}, NOW())
    ON CONFLICT (org_id, client_id) DO UPDATE
      SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at, created_at = NOW()
  `);

  await logAudit({
    actorClerkId: (req as Request & { clerkUserId?: string }).clerkUserId!,
    action: "portal_token_created",
    resource: "client",
    resourceId: clientId,
    orgId,
    details: { clientName: client.name, expiresInDays },
    req,
  });

  res.json({ token, expiresAt, clientId, orgId });
});
