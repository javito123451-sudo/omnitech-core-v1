// Utilidades de pruebas de integración de Omni Review (Postgres real).
import { eq, inArray } from "drizzle-orm";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { db, organizationsTable, moduleConfigsTable, auditLogsTable } from "@workspace/db";

export const hasRealDb = !process.env["DATABASE_URL"]?.includes("placeholder");

export async function createOrg(label: string): Promise<number> {
  const slug = `review-test-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [org] = await db.insert(organizationsTable).values({ name: `Review Test ${label}`, slug, plan: "starter", status: "active" }).returning({ id: organizationsTable.id });
  return org!.id;
}

export async function setModule(orgId: number, enabled: boolean | null): Promise<void> {
  await db.delete(moduleConfigsTable).where(eq(moduleConfigsTable.orgId, orgId));
  if (enabled === null) return; // sin fila
  await db.insert(moduleConfigsTable).values({ orgId, moduleSlug: "omni_review", isEnabled: enabled, updatedBy: "test" });
}

/** Borra las organizaciones de prueba (las tablas review_* caen por ON DELETE CASCADE). */
export async function cleanupOrgs(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(auditLogsTable).where(inArray(auditLogsTable.orgId, ids));
  await db.delete(moduleConfigsTable).where(inArray(moduleConfigsTable.orgId, ids));
  await db.delete(organizationsTable).where(inArray(organizationsTable.id, ids));
}

export interface Identity { orgId?: number; role?: string; superAdmin?: boolean }

export async function startApp(mount: (app: express.Express) => void, getIdentity: () => Identity): Promise<{ base: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = getIdentity();
    Object.assign(req, { orgId: id.orgId, orgRole: id.role, effectiveRole: id.role, isSuperAdmin: id.superAdmin === true, clerkUserId: "user_test", userId: 1 });
    next();
  });
  mount(app);
  let server!: Server;
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise((r) => server.close(() => r())) };
}
