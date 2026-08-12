import { Router } from "express";
import { db, appointmentsTable, clientsTable, activityTable } from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import {
  ListAppointmentsQueryParams,
  CreateAppointmentBody,
  UpdateAppointmentBody,
  UpdateAppointmentParams,
  DeleteAppointmentParams,
} from "@workspace/api-zod";
import { requirePermission } from "../middlewares/permissions";

export const appointmentsRouter = Router();

appointmentsRouter.get("/", requirePermission("calendar.read"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const query = ListAppointmentsQueryParams.parse(req.query);

    const filters: any[] = [eq(appointmentsTable.orgId, orgId)];
    if (query.from) {
      filters.push(gte(appointmentsTable.startTime, new Date(query.from)));
    }
    if (query.to) {
      filters.push(lte(appointmentsTable.endTime, new Date(query.to)));
    }
    if (query.clientId) {
      filters.push(eq(appointmentsTable.clientId, Number(query.clientId)));
    }

    const rows = await db
      .select()
      .from(appointmentsTable)
      .where(and(...filters))
      .orderBy(appointmentsTable.startTime);

    const clients = await db
      .select({ id: clientsTable.id, name: clientsTable.name, company: clientsTable.company })
      .from(clientsTable)
      .where(eq(clientsTable.orgId, orgId));
    const clientMap = new Map(clients.map((c) => [c.id, { name: c.name, company: c.company }]));

    res.json(
      rows.map((r) => ({
        ...r,
        // Guest appointments (no CRM client) fall back to the stored guest_name.
        clientName: r.clientId != null ? (clientMap.get(r.clientId)?.name ?? null) : (r.guestName ?? null),
        clientCompany: r.clientId != null ? (clientMap.get(r.clientId)?.company ?? null) : null,
        startTime: r.startTime.toISOString(),
        endTime: r.endTime.toISOString(),
        createdAt: r.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

appointmentsRouter.post("/", requirePermission("calendar.write"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const body = CreateAppointmentBody.parse(req.body);

    const [client] = await db
      .select({ name: clientsTable.name, company: clientsTable.company })
      .from(clientsTable)
      .where(and(eq(clientsTable.id, body.clientId), eq(clientsTable.orgId, orgId)));

    if (!client) {
      res.status(400).json({ error: "Client not found in this organization." });
      return;
    }

    const [appt] = await db
      .insert(appointmentsTable)
      .values({
        orgId,
        title: body.title,
        description: body.description ?? null,
        startTime: new Date(body.startTime),
        endTime: new Date(body.endTime),
        clientId: body.clientId,
        status: body.status ?? "pending",
        type: body.type ?? null,
        reminder: body.reminder ?? false,
        tags: body.tags ?? null,
        location: body.location ?? null,
      })
      .returning();

    await db.insert(activityTable).values({
      orgId,
      type: "appointment_scheduled",
      description: `Appointment "${appt.title}" scheduled`,
      clientName: client.name,
      userId: req.userId,
    });

    res.status(201).json({
      ...appt,
      clientName: client.name,
      clientCompany: client.company,
      startTime: appt.startTime.toISOString(),
      endTime: appt.endTime.toISOString(),
      createdAt: appt.createdAt.toISOString(),
    });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

appointmentsRouter.patch("/:id", requirePermission("calendar.write"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const { id } = UpdateAppointmentParams.parse({ id: Number(req.params.id) });
    const body = UpdateAppointmentBody.parse(req.body);

    const updates: Record<string, unknown> = {};
    if (body.title !== undefined)       updates.title = body.title;
    if (body.description !== undefined) updates.description = body.description;
    if (body.startTime !== undefined)   updates.startTime = new Date(body.startTime);
    if (body.endTime !== undefined)     updates.endTime = new Date(body.endTime);
    if (body.status !== undefined)      updates.status = body.status;
    if (body.type !== undefined)        updates.type = body.type;
    if (body.reminder !== undefined)    updates.reminder = body.reminder;
    if (body.tags !== undefined)        updates.tags = body.tags;
    if (body.location !== undefined)    updates.location = body.location;

    const [appt] = await db
      .update(appointmentsTable)
      .set(updates)
      .where(and(eq(appointmentsTable.id, id), eq(appointmentsTable.orgId, orgId)))
      .returning();

    if (!appt) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // Guest appointments (no CRM client) have no row to look up here.
    const [client] = appt.clientId != null
      ? await db
          .select({ name: clientsTable.name, company: clientsTable.company })
          .from(clientsTable)
          .where(and(eq(clientsTable.id, appt.clientId), eq(clientsTable.orgId, orgId)))
      : [];

    const resolvedClientName = client?.name ?? (appt.clientId == null ? appt.guestName ?? null : null);

    if (body.status === "completed") {
      await db.insert(activityTable).values({
        orgId,
        type: "appointment_completed",
        description: `Appointment "${appt.title}" completed`,
        clientName: resolvedClientName,
        userId: req.userId,
      });
    }

    res.json({
      ...appt,
      clientName: resolvedClientName,
      clientCompany: client?.company ?? null,
      startTime: appt.startTime.toISOString(),
      endTime: appt.endTime.toISOString(),
      createdAt: appt.createdAt.toISOString(),
    });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

appointmentsRouter.delete("/:id", requirePermission("calendar.delete"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const { id } = DeleteAppointmentParams.parse({ id: Number(req.params.id) });
    await db
      .delete(appointmentsTable)
      .where(and(eq(appointmentsTable.id, id), eq(appointmentsTable.orgId, orgId)));
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});
