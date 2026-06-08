import { Router } from "express";
import { db, clientsTable, activityTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import {
  ListClientsQueryParams,
  CreateClientBody,
  UpdateClientBody,
  GetClientParams,
  UpdateClientParams,
  DeleteClientParams,
} from "@workspace/api-zod";

export const clientsRouter = Router();

clientsRouter.get("/", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const query = ListClientsQueryParams.parse(req.query);
    let rows = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.orgId, orgId))
      .orderBy(desc(clientsTable.createdAt));

    if (query.search) {
      const s = query.search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(s) ||
          r.email.toLowerCase().includes(s) ||
          (r.company ?? "").toLowerCase().includes(s)
      );
    }
    if (query.status) {
      rows = rows.filter((r) => r.status === query.status);
    }

    res.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

clientsRouter.post("/", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const body = CreateClientBody.parse(req.body);
    const [client] = await db
      .insert(clientsTable)
      .values({
        orgId,
        name: body.name,
        email: body.email,
        phone: body.phone ?? null,
        company: body.company ?? null,
        status: body.status ?? "lead",
        tags: body.tags ?? null,
        notes: body.notes ?? null,
        value: body.value ?? null,
      })
      .returning();

    await db.insert(activityTable).values({
      orgId,
      type: "client_added",
      description: `New client ${client.name} was added`,
      clientName: client.name,
      userId: req.userId,
    });

    res.status(201).json({ ...client, createdAt: client.createdAt.toISOString() });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

clientsRouter.get("/:id", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const { id } = GetClientParams.parse({ id: Number(req.params.id) });
    const [client] = await db
      .select()
      .from(clientsTable)
      .where(and(eq(clientsTable.id, id), eq(clientsTable.orgId, orgId)));
    if (!client) return res.status(404).json({ error: "Not found" });
    res.json({ ...client, createdAt: client.createdAt.toISOString() });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

clientsRouter.patch("/:id", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const { id } = UpdateClientParams.parse({ id: Number(req.params.id) });
    const body = UpdateClientBody.parse(req.body);
    const [client] = await db
      .update(clientsTable)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.email !== undefined && { email: body.email }),
        ...(body.phone !== undefined && { phone: body.phone }),
        ...(body.company !== undefined && { company: body.company }),
        ...(body.status !== undefined && { status: body.status }),
        ...(body.tags !== undefined && { tags: body.tags }),
        ...(body.notes !== undefined && { notes: body.notes }),
        ...(body.value !== undefined && { value: body.value }),
      })
      .where(and(eq(clientsTable.id, id), eq(clientsTable.orgId, orgId)))
      .returning();

    if (!client) return res.status(404).json({ error: "Not found" });

    await db.insert(activityTable).values({
      orgId,
      type: "client_updated",
      description: `Client ${client.name} was updated`,
      clientName: client.name,
      userId: req.userId,
    });

    res.json({ ...client, createdAt: client.createdAt.toISOString() });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

clientsRouter.delete("/:id", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const { id } = DeleteClientParams.parse({ id: Number(req.params.id) });
    await db
      .delete(clientsTable)
      .where(and(eq(clientsTable.id, id), eq(clientsTable.orgId, orgId)));
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});
