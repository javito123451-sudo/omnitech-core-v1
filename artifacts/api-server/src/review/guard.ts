// Reglas de elegibilidad: la ÚNICA puerta por la que un contacto puede pasar a la cola.
// Sin consentimiento/base jurídica vigente, sin dirección, dado de baja, suprimido o
// anonimizado → no se encola. El motor llama a checkEligibility antes de crear el envío.
import { and, eq } from "drizzle-orm";
import { db, reviewContactsTable, type ReviewChannel, type ReviewContact, REVIEW_CHANNELS } from "@workspace/db";
import { hasActiveConsent, isAddressSuppressed } from "./consent";

export type IneligibleReason =
  | "channel_invalid" | "contact_not_found" | "contact_erased" | "contact_unsubscribed" | "contact_invalid"
  | "missing_address" | "no_consent" | "suppressed";

export type Eligibility =
  | { ok: true; contact: ReviewContact; destination: string }
  | { ok: false; reason: IneligibleReason };

export async function checkEligibility(orgId: number, contactId: number, channel: string): Promise<Eligibility> {
  if (!(REVIEW_CHANNELS as readonly string[]).includes(channel)) return { ok: false, reason: "channel_invalid" };
  const ch = channel as ReviewChannel;
  const [contact] = await db.select().from(reviewContactsTable)
    .where(and(eq(reviewContactsTable.orgId, orgId), eq(reviewContactsTable.id, contactId)));
  if (!contact) return { ok: false, reason: "contact_not_found" };
  if (contact.status === "erased" || contact.anonymizedAt) return { ok: false, reason: "contact_erased" };
  if (contact.status === "unsubscribed") return { ok: false, reason: "contact_unsubscribed" };
  if (contact.status !== "active") return { ok: false, reason: "contact_invalid" }; // invalid | bounced
  const destination = ch === "email" ? contact.emailNorm : contact.phoneE164;
  if (!destination) return { ok: false, reason: "missing_address" };
  if (!(await hasActiveConsent(orgId, contactId, ch))) return { ok: false, reason: "no_consent" };
  if (await isAddressSuppressed(orgId, ch, destination)) return { ok: false, reason: "suppressed" };
  return { ok: true, contact, destination };
}
