// Organizaciones temporales para tests de integración. Cada archivo crea las
// suyas, así los archivos pueden correr en paralelo contra la misma base sin
// pisarse saldos ni agentes. Borrar la org limpia en cascada agentes, cuentas,
// ledger, conocimiento y tareas.
import { eq, inArray } from "drizzle-orm";
import { db, organizationsTable } from "@workspace/db";

export async function createTempOrgs(count: number, label: string): Promise<number[]> {
  const tag = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const rows = await db.insert(organizationsTable)
    .values(Array.from({ length: count }, (_, i) => ({ name: `smoke ${tag} ${i}`, slug: `smoke-${tag}-${i}`, plan: "starter" })))
    .returning({ id: organizationsTable.id });
  return rows.map((r) => r.id);
}

export async function deleteTempOrgs(ids: number[]): Promise<void> {
  if (ids.length) await db.delete(organizationsTable).where(inArray(organizationsTable.id, ids));
}

/** El mensaje de un error de Postgres queda en `cause` cuando drizzle lo envuelve. */
export function pgMessage(err: unknown): string {
  const e = err as { message?: string; cause?: { message?: string } };
  return `${e?.cause?.message ?? ""} ${e?.message ?? ""}`;
}

export async function expectPgError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  let caught: unknown;
  try { await promise; } catch (e) { caught = e; }
  if (!caught) throw new Error("Se esperaba un error de Postgres y la operación tuvo éxito.");
  if (!pattern.test(pgMessage(caught))) throw new Error(`El error no coincide con ${pattern}: ${pgMessage(caught)}`);
}
