import { Router } from "express";
import { db, appointmentsTable, clientsTable, activityTable } from "@workspace/db";
import { eq, gte, lte, and, desc } from "drizzle-orm";
import {
  ListAppointmentsQueryParams,
  CreateAppointmentBody,
  UpdateAppointmentBody,
  UpdateAppointmentParams,
  DeleteAppointmentParams,
} from "@workspace/api-zod";

export const appointmentsRouter = Router();

appointmentsRouter.get("/", async (req, res) => {
  try {
    const query = ListAppointmentsQueryParams.parse(req.query);
    let rows = await db.select().from(appointmentsTable).orderBy(appointmentsTable.startTime);

    if (query.from) {
      const from = new Date(query.from);
      rows = rows.filter((r) => r.startTime >= from);
    }
    if (query.to) {
      const to = new Date(query.to);
      rows = rows.filter((r) => r.endTime <= to);
    }
    if (query.clientId) {
      rows = rows.filter((r) => r.clientId === Number(query.clientId));
    }

    // Join client names
    const clients = await db.select({ id: clientsTable.id, name: clientsTable.name }).from(clientsTable);
    const clientMap = new Map(clients.map((c) => [c.id, c.name]));

    const mapped = rows.map((r) => ({
      ...r,
      clientName: clientMap.get(r.clientId) ?? null,
      startTime: r.startTime.toISOString(),
      endTime: r.endTime.toISOString(),
      createdAt: r.createdAt.toISOString(),
    }));
    res.json(mapped);
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

appointmentsRouter.post("/", async (req, res) => {
  try {
    const body = CreateAppointmentBody.parse(req.body);
    const [appt] = await db
      .insert(appointmentsTable)
      .values({
        title: body.title,
        description: body.description ?? null,
        startTime: new Date(body.startTime),
        endTime: new Date(body.endTime),
        clientId: body.clientId,
        status: body.status ?? "scheduled",
        type: body.type ?? null,
      })
      .returning();

    const [client] = await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, body.clientId));

    await db.insert(activityTable).values({
      type: "appointment_scheduled",
      description: `Appointment "${appt.title}" scheduled`,
      clientName: client?.name ?? null,
    });

    res.status(201).json({
      ...appt,
      clientName: client?.name ?? null,
      startTime: appt.startTime.toISOString(),
      endTime: appt.endTime.toISOString(),
      createdAt: appt.createdAt.toISOString(),
    });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

appointmentsRouter.patch("/:id", async (req, res) => {
  try {
    const { id } = UpdateAppointmentParams.parse({ id: Number(req.params.id) });
    const body = UpdateAppointmentBody.parse(req.body);

    const updates: Record<string, unknown> = {};
    if (body.title !== undefined) updates.title = body.title;
    if (body.description !== undefined) updates.description = body.description;
    if (body.startTime !== undefined) updates.startTime = new Date(body.startTime);
    if (body.endTime !== undefined) updates.endTime = new Date(body.endTime);
    if (body.status !== undefined) updates.status = body.status;
    if (body.type !== undefined) updates.type = body.type;

    const [appt] = await db
      .update(appointmentsTable)
      .set(updates)
      .where(eq(appointmentsTable.id, id))
      .returning();

    if (!appt) return res.status(404).json({ error: "Not found" });

    const [client] = await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, appt.clientId));

    if (body.status === "completed") {
      await db.insert(activityTable).values({
        type: "appointment_completed",
        description: `Appointment "${appt.title}" completed`,
        clientName: client?.name ?? null,
      });
    }

    res.json({
      ...appt,
      clientName: client?.name ?? null,
      startTime: appt.startTime.toISOString(),
      endTime: appt.endTime.toISOString(),
      createdAt: appt.createdAt.toISOString(),
    });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

appointmentsRouter.delete("/:id", async (req, res) => {
  try {
    const { id } = DeleteAppointmentParams.parse({ id: Number(req.params.id) });
    await db.delete(appointmentsTable).where(eq(appointmentsTable.id, id));
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});
