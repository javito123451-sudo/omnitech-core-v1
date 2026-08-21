// ── Pausa automática del Autopilot por respuesta del cliente ───────────────────
// Regla crítica no negociable: si el cliente responde por cualquier canal
// conectado, el Autopilot se pausa de inmediato y no vuelve a enviar nada
// hasta que un humano lo reactive manualmente.
//
// Capa PRIMARIA (event-driven, inmediata): se invoca desde whatsapp.ts
// processIncomingMessage y telegram.ts processIncomingTelegramMessage justo
// después de insertar el mensaje entrante.
//
// Existe una segunda capa (safety net) dentro de autopilotEngine.ts que
// vuelve a comprobar esto mismo justo antes de generar/enviar cualquier
// mensaje de seguimiento, por si esta capa primaria no llegó a ejecutarse
// (p. ej. dos procesos concurrentes).
import { db, autopilotTasksTable, activityTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logAuditSystem } from "./auditLogger";
import { logger } from "../lib/logger";

export async function pauseAutopilotOnReply(orgId: number, clientId: number): Promise<void> {
  const [task] = await db
    .select()
    .from(autopilotTasksTable)
    .where(
      and(
        eq(autopilotTasksTable.orgId, orgId),
        eq(autopilotTasksTable.clientId, clientId),
        eq(autopilotTasksTable.triggerType, "client_followup_sequence"),
        eq(autopilotTasksTable.enabled, true),
      ),
    );
  if (!task) return; // no hay Autopilot activo para este cliente — nada que pausar

  await db
    .update(autopilotTasksTable)
    .set({ enabled: false, pausedReason: "reply", updatedAt: new Date() })
    .where(eq(autopilotTasksTable.id, task.id));

  await db.insert(activityTable).values({
    orgId,
    clientId,
    type: "autopilot_paused_reply",
    description: "💬 El cliente ha respondido. El Autopilot está pausado.",
    clientName: null,
  });

  await logAuditSystem({
    actorClerkId: `system:autopilot:${orgId}`,
    action: "autopilot_paused_reply",
    resource: "autopilot_task",
    resourceId: task.id,
    orgId,
    details: { clientId },
    severity: "info",
  });

  logger.info({ orgId, clientId, taskId: task.id }, "[Autopilot] pausado por respuesta del cliente");
}
