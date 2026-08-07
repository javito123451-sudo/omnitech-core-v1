/**
 * PgVerifactuContextProvider — implementación real del ContextProvider que
 * @workspace/connector-core define como seam. Lee configuración y credenciales
 * de org_integrations (slug="verifactu"), reutilizando el mismo cifrado
 * AES-256-GCM (encryptCredentials/decryptCredentials) que ya usan los adapters
 * de WhatsApp/Telegram del hub — sin reinventar cifrado nuevo.
 *
 * Si el org no ha configurado nada todavía, cae a valores por defecto seguros:
 * modo "no_verifactu" y el NIF emisor tomado de organizationsTable.taxId
 * (reutilizado, no duplicado en config de VeriFactu).
 */
import { db, orgIntegrationsTable, organizationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { ContextProvider } from "@workspace/connector-core";
import { decryptCredentials } from "../utils/integrationCreds";

const INTEGRATION_SLUG = "verifactu";

export class PgVerifactuContextProvider implements ContextProvider {
  async resolve(orgId: number, _connectorSlug: string): Promise<{ config: Record<string, unknown>; credentials: Record<string, string> }> {
    const [row] = await db
      .select()
      .from(orgIntegrationsTable)
      .where(and(eq(orgIntegrationsTable.orgId, orgId), eq(orgIntegrationsTable.integrationSlug, INTEGRATION_SLUG)));

    const config: Record<string, unknown> = row?.config ? JSON.parse(row.config) : { mode: "no_verifactu" };
    const credentials: Record<string, string> = row?.credentialsEnc ? decryptCredentials(row.credentialsEnc) : {};

    // issuerNif se reutiliza de organizationsTable.taxId si el org no lo ha
    // sobrescrito explícitamente en sus credenciales de VeriFactu.
    if (!credentials["issuerNif"]) {
      const [org] = await db
        .select({ taxId: organizationsTable.taxId, legalName: organizationsTable.legalName, name: organizationsTable.name })
        .from(organizationsTable)
        .where(eq(organizationsTable.id, orgId));
      if (org?.taxId) credentials["issuerNif"] = org.taxId;
      if (!config["issuerName"] && (org?.legalName ?? org?.name)) {
        config["issuerName"] = org.legalName ?? org.name;
      }
    }

    return { config, credentials };
  }
}
