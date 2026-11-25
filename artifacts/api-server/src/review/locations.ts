// Repositorio de establecimientos. TODA función recibe orgId y lo aplica en el WHERE.
import { and, eq, desc } from "drizzle-orm";
import { db, reviewLocationsTable, type ReviewLocation } from "@workspace/db";
import { buildGoogleReviewUrl } from "./google";

export interface LocationInput { name: string; address?: string | null; googlePlaceId?: string | null }

export class ReviewInputError extends Error {
  constructor(public readonly field: string, message: string) { super(message); this.name = "ReviewInputError"; }
}

function placeFields(googlePlaceId: string | null | undefined) {
  if (googlePlaceId == null || googlePlaceId.trim() === "") return { googlePlaceId: null, googleReviewUrl: null };
  const url = buildGoogleReviewUrl(googlePlaceId);
  if (!url) throw new ReviewInputError("googlePlaceId", "El Place ID de Google no tiene un formato válido.");
  return { googlePlaceId: googlePlaceId.trim(), googleReviewUrl: url };
}

export async function listLocations(orgId: number): Promise<ReviewLocation[]> {
  return db.select().from(reviewLocationsTable)
    .where(and(eq(reviewLocationsTable.orgId, orgId), eq(reviewLocationsTable.status, "active")))
    .orderBy(desc(reviewLocationsTable.createdAt));
}

export async function getLocation(orgId: number, id: number): Promise<ReviewLocation | null> {
  const [row] = await db.select().from(reviewLocationsTable)
    .where(and(eq(reviewLocationsTable.orgId, orgId), eq(reviewLocationsTable.id, id)));
  return row ?? null;
}

export async function createLocation(orgId: number, input: LocationInput): Promise<ReviewLocation> {
  const [row] = await db.insert(reviewLocationsTable).values({
    orgId, name: input.name.trim(), address: input.address?.trim() || null, ...placeFields(input.googlePlaceId),
  }).returning();
  return row!;
}

export async function updateLocation(orgId: number, id: number, input: Partial<LocationInput>): Promise<ReviewLocation | null> {
  const set: Partial<typeof reviewLocationsTable.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) set.name = input.name.trim();
  if (input.address !== undefined) set.address = input.address?.trim() || null;
  if (input.googlePlaceId !== undefined) Object.assign(set, placeFields(input.googlePlaceId));
  const [row] = await db.update(reviewLocationsTable).set(set)
    .where(and(eq(reviewLocationsTable.orgId, orgId), eq(reviewLocationsTable.id, id))).returning();
  return row ?? null;
}

/** Archivar (no borrar): las campañas y reseñas históricas conservan su referencia. */
export async function archiveLocation(orgId: number, id: number): Promise<boolean> {
  const rows = await db.update(reviewLocationsTable).set({ status: "archived", updatedAt: new Date() })
    .where(and(eq(reviewLocationsTable.orgId, orgId), eq(reviewLocationsTable.id, id))).returning({ id: reviewLocationsTable.id });
  return rows.length > 0;
}
