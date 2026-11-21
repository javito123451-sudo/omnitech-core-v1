// Envío de invitaciones a un workspace. Antes vivía dentro de routes/control-center.ts;
// ahora lo comparten Control Center (invitar/reenviar) y OmniCommerce (bienvenida al aprobar).
import { eq } from "drizzle-orm";
import { db, organizationsTable, usersTable, orgInvitationsTable } from "@workspace/db";
import { sendInvitationEmail } from "./email";

export type InvitationRow = typeof orgInvitationsTable.$inferSelect;

/** Envía el email de una invitación pendiente y guarda el resultado real. */
export async function deliverInvitation(
  inv: InvitationRow,
  baseUrl: string,
): Promise<{ emailSent: boolean; emailError: string | null; acceptUrl: string }> {
  const acceptUrl = `${baseUrl}/invite/${inv.token}`;
  let emailSent = false;
  let emailError: string | null = null;
  try {
    const [[org], [inviter]] = await Promise.all([
      db.select({ name: organizationsTable.name }).from(organizationsTable).where(eq(organizationsTable.id, inv.orgId)),
      db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, inv.invitedBy)),
    ]);
    const result = await sendInvitationEmail({
      to:          inv.email,
      inviterName: inviter?.name ?? null,
      orgName:     org?.name ?? "Tu organización",
      role:        inv.role,
      acceptUrl,
      expiresAt:   inv.expiresAt,
    });
    emailSent = result.ok;
    emailError = result.ok ? null : (result.error ?? "Error desconocido del proveedor de email");
  } catch (err) {
    emailError = String(err instanceof Error ? err.message : err);
  }
  await db.update(orgInvitationsTable)
    .set({ lastSentAt: new Date(), lastSendError: emailError })
    .where(eq(orgInvitationsTable.id, inv.id));
  return { emailSent, emailError, acceptUrl };
}
