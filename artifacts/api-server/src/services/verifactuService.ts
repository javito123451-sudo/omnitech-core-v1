/**
 * VeriFactu service — la única puerta de entrada al conector desde el resto de
 * la aplicación. Construye el InvoiceInput del conector a partir de datos YA
 * existentes (invoicesTable + invoiceItemsTable + organizationsTable), nunca
 * pide datos de factura duplicados. Bootstrapea el IntegrationRegistry del
 * Core una única vez por proceso.
 */
import { db, invoicesTable, invoiceItemsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  IntegrationRegistry,
  ConnectorFactory,
  ExecutionDispatcher,
  HealthEngine,
  ContextProviderRegistry,
  NO_RETRY,
  type ConnectorContext,
} from "@workspace/connector-core";
import { verifactuManifest, HttpAeatClient, createVerifactuModule } from "@workspace/connector-verifactu";
import type { InvoiceInput } from "@workspace/connector-verifactu";
import { PgVerifactuChainStore } from "./verifactuChainStore";
import { PgVerifactuContextProvider } from "./verifactuContextProvider";

// ── Bootstrap (una vez por proceso) ────────────────────────────────────────────
const chainStore = new PgVerifactuChainStore();

// verifactuManifest.load() no admite parámetros — construimos un manifiesto
// equivalente que inyecta nuestro ChainStore real en lugar del InMemoryChainStore
// de test/demo, reutilizando el resto del manifiesto (acciones, config, etc. sin duplicar).
const wiredManifest = {
  ...verifactuManifest,
  load: () => createVerifactuModule({ chainStore, aeatClient: new HttpAeatClient() }),
};

const registry = new IntegrationRegistry();
registry.bootstrap([wiredManifest]);

const factory = new ConnectorFactory(registry);
const dispatcher = new ExecutionDispatcher(registry, factory);
const healthEngine = new HealthEngine(registry, factory);

const contextProviders = new ContextProviderRegistry();
contextProviders.register(new PgVerifactuContextProvider());

// ── Construcción de InvoiceInput desde datos existentes ────────────────────────

export class InvoiceNotFoundError extends Error {
  constructor(invoiceId: number) {
    super(`Factura ${invoiceId} no encontrada`);
    this.name = "InvoiceNotFoundError";
  }
}

async function buildInvoiceInput(orgId: number, invoiceId: number): Promise<InvoiceInput> {
  const [invoice] = await db
    .select()
    .from(invoicesTable)
    .where(and(eq(invoicesTable.orgId, orgId), eq(invoicesTable.id, invoiceId)));
  if (!invoice) throw new InvoiceNotFoundError(invoiceId);

  const items = await db
    .select()
    .from(invoiceItemsTable)
    .where(eq(invoiceItemsTable.invoiceId, invoiceId))
    .orderBy(invoiceItemsTable.orderIndex);

  const taxRate = Number(invoice.taxRate) / 100; // invoicesTable guarda el tipo como porcentaje (21), el conector espera fracción (0.21)

  const ctx = await contextProviders.buildContext(orgId, "verifactu");
  const issuerNif = ctx.credentials["issuerNif"];
  if (!issuerNif) {
    throw new Error(
      "El org no tiene NIF configurado (organizations.tax_id vacío). Complétalo antes de generar registros VeriFactu.",
    );
  }

  return {
    invoiceNumber: invoice.invoiceNumber,
    issueDate: invoice.createdAt.toISOString().slice(0, 10),
    issuerNif,
    issuerName: (ctx.config["issuerName"] as string) ?? undefined,
    invoiceType: "F1",
    lines: items.map((item) => ({
      description: item.description,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      taxRate,
    })),
  };
}

// ── API pública del servicio ────────────────────────────────────────────────

export async function generateVerifactuRecord(orgId: number, invoiceId: number) {
  const invoiceInput = await buildInvoiceInput(orgId, invoiceId);
  const ctx: ConnectorContext = await contextProviders.buildContext(orgId, "verifactu");

  const result = await dispatcher.dispatch(ctx, "generate_invoice_record", invoiceInput as unknown as Record<string, unknown>, {
    retry: NO_RETRY, // generar un registro nunca debe reintentarse solo — un reintento crearía un segundo registro en la cadena
  });
  return result;
}

export async function submitVerifactuRecord(orgId: number, invoiceId: number) {
  const [invoice] = await db
    .select({ invoiceNumber: invoicesTable.invoiceNumber })
    .from(invoicesTable)
    .where(and(eq(invoicesTable.orgId, orgId), eq(invoicesTable.id, invoiceId)));
  if (!invoice) throw new InvoiceNotFoundError(invoiceId);

  const ctx = await contextProviders.buildContext(orgId, "verifactu");
  const result = await dispatcher.dispatch(ctx, "submit_record", { invoiceNumber: invoice.invoiceNumber });

  const mode = (ctx.config["mode"] as string) ?? "no_verifactu";
  await chainStore.markSubmitted(orgId, invoiceId, {
    accepted: result.success,
    aeatStatus: (result.output as { aeatStatus?: string } | undefined)?.aeatStatus,
    csv: (result.output as { csv?: string } | undefined)?.csv,
    error: result.error,
    mode,
  });

  return result;
}

export async function getVerifactuRecord(orgId: number, invoiceId: number) {
  return chainStore.getByInvoiceId(orgId, invoiceId);
}

export async function listVerifactuRecords(orgId: number) {
  return chainStore.listWithMeta(orgId);
}

export async function checkVerifactuHealth(orgId: number) {
  const ctx = await contextProviders.buildContext(orgId, "verifactu");
  return healthEngine.check(ctx);
}
