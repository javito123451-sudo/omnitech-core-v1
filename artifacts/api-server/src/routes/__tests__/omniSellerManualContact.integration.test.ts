// OmniSeller — POST /api/missions/:id/contacts (carga manual, sin proveedor).
//
// Mientras no haya un ProspectingProvider real conectado (ver "###
// PROVIDER DECISION" en contactFinder/index.ts), este es el único camino
// para meter un contacto en una Mission. Cubre:
//   1. Crear un contacto manual ligado a un lead — SIN cobrar OmniCredits.
//   2. Validación: leadResultId obligatorio.
//   3. Validación: al menos name/email/phone.
//   4. lead_result de otra Mission/organización → rechazado (404).
//   5. Mission de otra organización → mismo comportamiento (404).
//   6. Mission cerrada (completed) → rechazada (409).
//   7. Deduplicación: mismo email dentro del mismo lead_result no duplica.
//   8. Aislamiento multi-tenant end-to-end (orgB no ve el contacto de orgA).
//
// Requiere una base de datos real desechable en DATABASE_URL, con las
// migraciones reales aplicadas (mismo requisito que el resto de
// .integration.test.ts de OmniSeller). Se omite limpiamente sin DB real.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import {
  db, missionsTable, leadSearchesTable, leadResultsTable, leadContactsTable,
} from "@workspace/db";
import { grantCredits, getBalance } from "../../credits/creditService";
import { createTempOrgs, deleteTempOrgs } from "../../test-utils/tempOrgs";

const { missionsRouter } = await import("../missions");

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");

describe.skipIf(!hasRealDb)("OmniSeller — POST /api/missions/:id/contacts (manual)", () => {
  let orgAId: number;
  let orgBId: number;
  let server: Server;
  let base = "";
  let currentOrgId = 0;

  const cleanupMissionIds: number[] = [];
  const cleanupSearchIds: number[] = [];
  const cleanupResultIds: number[] = [];

  beforeAll(async () => {
    [orgAId, orgBId] = await createTempOrgs(2, "omniseller-manual-contact");

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, { orgId: currentOrgId, orgRole: "owner", userId: 1, clerkUserId: "omniseller-manual-contact-user" });
      next();
    });
    app.use("/api/missions", missionsRouter);
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
    for (const id of cleanupResultIds) await db.delete(leadContactsTable).where(eq(leadContactsTable.leadResultId, id));
    for (const id of cleanupResultIds) await db.delete(leadResultsTable).where(eq(leadResultsTable.id, id));
    for (const id of cleanupSearchIds) await db.delete(leadSearchesTable).where(eq(leadSearchesTable.id, id));
    for (const id of cleanupMissionIds) await db.delete(missionsTable).where(eq(missionsTable.id, id));
    await deleteTempOrgs([orgAId, orgBId]);
  });

  const asOrg = (orgId: number) => { currentOrgId = orgId; };

  async function seedMissionWithLead(orgId: number, missionOverrides: Record<string, unknown> = {}) {
    const [mission] = await db.insert(missionsTable).values({
      orgId, name: `Mission manual-contact test ${Date.now()}`, ...missionOverrides,
    }).returning();
    cleanupMissionIds.push(mission!.id);
    const [search] = await db.insert(leadSearchesTable).values({
      orgId, missionId: mission!.id, sector: "test", city: "Madrid", status: "done", totalFound: 1,
    }).returning();
    cleanupSearchIds.push(search!.id);
    const [result] = await db.insert(leadResultsTable).values({
      orgId, searchId: search!.id, name: `Empresa Test ${Date.now()}`, website: null, status: "new",
    }).returning();
    cleanupResultIds.push(result!.id);
    return { missionId: mission!.id, leadResultId: result!.id };
  }

  const post = (missionId: number, body: unknown) =>
    fetch(`${base}/api/missions/${missionId}/contacts`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });

  // ── 1. Crear un contacto manual — sin cobrar créditos ──────────────────────
  it("1 — crea el contacto con provider='manual' y status='verificado', sin tocar OmniCredits", async () => {
    asOrg(orgAId);
    await grantCredits(orgAId, 5, { reference: `manual-contact-grant-${Date.now()}` });
    const before = await getBalance(orgAId);

    const { missionId, leadResultId } = await seedMissionWithLead(orgAId);
    const resp = await post(missionId, { leadResultId, name: "Ana García", role: "CEO", email: "ana@empresa-test.invalid", phone: "+34600000001" });
    expect(resp.status).toBe(201);
    const body = await resp.json() as { missionId: number; leadResultId: number; contact: { id: number; name: string; status: string; provider: string } };
    expect(body.missionId).toBe(missionId);
    expect(body.leadResultId).toBe(leadResultId);
    expect(body.contact.name).toBe("Ana García");
    expect(body.contact.status).toBe("verificado");
    expect(body.contact.provider).toBe("manual");

    const rows = await db.select().from(leadContactsTable).where(eq(leadContactsTable.leadResultId, leadResultId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.orgId).toBe(orgAId);
    expect(rows[0]!.provider).toBe("manual");
    expect(rows[0]!.email).toBe("ana@empresa-test.invalid");

    const after = await getBalance(orgAId);
    expect(after).toBe(before); // ni un crédito gastado
  });

  // ── 2. Validación: leadResultId obligatorio ─────────────────────────────────
  it("2 — 400 si falta leadResultId", async () => {
    asOrg(orgAId);
    const { missionId } = await seedMissionWithLead(orgAId);
    const resp = await post(missionId, { name: "Sin lead" });
    expect(resp.status).toBe(400);
  });

  // ── 3. Validación: al menos name/email/phone ────────────────────────────────
  it("3 — 400 si no se manda ni name, ni email, ni phone", async () => {
    asOrg(orgAId);
    const { missionId, leadResultId } = await seedMissionWithLead(orgAId);
    const resp = await post(missionId, { leadResultId, role: "Solo un cargo, sin nada más" });
    expect(resp.status).toBe(400);
  });

  // ── 4. lead_result de otra Mission → rechazado ──────────────────────────────
  it("4 — 404 si el leadResultId no pertenece a esta misión", async () => {
    asOrg(orgAId);
    const { missionId } = await seedMissionWithLead(orgAId);
    const { leadResultId: otherLeadResultId } = await seedMissionWithLead(orgAId); // de OTRA misión
    const resp = await post(missionId, { leadResultId: otherLeadResultId, name: "Ajeno" });
    expect(resp.status).toBe(404);
  });

  // ── 5. Mission de otra organización → 404 ───────────────────────────────────
  it("5 — 404 si la misión es de otra organización", async () => {
    asOrg(orgAId);
    const { missionId, leadResultId } = await seedMissionWithLead(orgAId);

    asOrg(orgBId);
    const resp = await post(missionId, { leadResultId, name: "Intruso" });
    expect(resp.status).toBe(404);
  });

  // ── 6. Mission cerrada → 409 ─────────────────────────────────────────────────
  it("6 — 409 si la misión está 'completed'", async () => {
    asOrg(orgAId);
    const { missionId, leadResultId } = await seedMissionWithLead(orgAId, { status: "completed" });
    const resp = await post(missionId, { leadResultId, name: "Tarde" });
    expect(resp.status).toBe(409);
  });

  // ── 7. Deduplicación ─────────────────────────────────────────────────────────
  it("7 — el mismo email dentro del mismo lead_result no duplica el contacto", async () => {
    asOrg(orgAId);
    const { missionId, leadResultId } = await seedMissionWithLead(orgAId);
    const email = `dup-${Date.now()}@example-test.invalid`;

    const first = await post(missionId, { leadResultId, name: "Primero", email });
    expect(first.status).toBe(201);
    const firstBody = await first.json() as { contact: { id: number } };

    const second = await post(missionId, { leadResultId, name: "Segundo (mismo email)", email });
    expect(second.status).toBe(201);
    const secondBody = await second.json() as { contact: { id: number; name: string } };

    expect(secondBody.contact.id).toBe(firstBody.contact.id); // misma fila reutilizada, no duplicada
    expect(secondBody.contact.name).toBe("Primero"); // el dedup devuelve la fila EXISTENTE, no la sobrescribe

    const rows = await db.select().from(leadContactsTable).where(eq(leadContactsTable.leadResultId, leadResultId));
    expect(rows).toHaveLength(1);
  });

  // ── 8. Aislamiento multi-tenant end-to-end ──────────────────────────────────
  it("8 — un contacto manual de orgA no aparece en el listado de orgB", async () => {
    asOrg(orgAId);
    const { missionId, leadResultId } = await seedMissionWithLead(orgAId);
    const resp = await post(missionId, { leadResultId, name: "Solo de orgA", email: `orgA-${Date.now()}@example-test.invalid` });
    expect(resp.status).toBe(201);

    asOrg(orgBId);
    const listResp = await fetch(`${base}/api/missions/${missionId}/contacts`, { headers: {} });
    // La propia misión ya no es visible para orgB (404), no solo el contacto.
    expect(listResp.status).toBe(404);
  });
});
