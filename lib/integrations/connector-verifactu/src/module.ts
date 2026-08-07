import type { ActionResult, ConnectorContext, ConnectorModule, HealthCheckResult, ValidationResult } from "@workspace/connector-core";
import type { InvoiceInput } from "./domain.js";
import { buildInvoiceRecord } from "./hashChain.js";
import { InMemoryChainStore, type ChainStore } from "./chainStore.js";
import { FakeAeatClient, HttpAeatClient, type AeatHttpClient } from "./aeatClient.js";

const DEFAULT_QR_BASE_URL = "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR"; // pre-production verification path per AEAT spec; confirm production URL before go-live

export interface VerifactuModuleOptions {
  chainStore?: ChainStore;
  aeatClient?: AeatHttpClient;
}

/**
 * Factory so the manifest's `load()` can inject a real DB-backed ChainStore
 * in production while tests/demos use the in-memory defaults.
 */
export function createVerifactuModule(options: VerifactuModuleOptions = {}): ConnectorModule {
  const chainStore = options.chainStore ?? new InMemoryChainStore();
  const aeatClient = options.aeatClient ?? new FakeAeatClient();

  return {
    async validate(ctx: ConnectorContext): Promise<ValidationResult> {
      const missing: string[] = [];
      if (!ctx.credentials["issuerNif"]) missing.push("issuerNif");
      const mode = ctx.config["mode"];
      if (mode === "verifactu_activo" && !ctx.config["aeatEndpoint"]) missing.push("aeatEndpoint");
      return { valid: missing.length === 0, missing };
    },

    async healthCheck(ctx: ConnectorContext): Promise<HealthCheckResult> {
      const start = Date.now();
      const last = await chainStore.getLastRecord(ctx.orgId);
      return {
        status: "healthy",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        detail: { chainLength: (await chainStore.list(ctx.orgId)).length, lastHash: last?.hash ?? null },
      };
    },

    async executeAction(ctx: ConnectorContext, actionSlug: string, input: Record<string, unknown>): Promise<ActionResult> {
      switch (actionSlug) {
        case "generate_invoice_record":
          return generateInvoiceRecord(ctx, input, chainStore);
        case "submit_record":
          return submitRecord(ctx, input, chainStore, aeatClient);
        case "list_records":
          return listRecords(ctx, chainStore);
        default:
          return { success: false, error: `Unknown action "${actionSlug}"`, errorCode: "ACTION_NOT_FOUND" };
      }
    },

    async parseEvent(): Promise<null> {
      // VeriFactu has no inbound provider webhook in Fase 1 (outbound-only compliance flow).
      return null;
    },
  };
}

async function generateInvoiceRecord(
  ctx: ConnectorContext,
  input: Record<string, unknown>,
  chainStore: ChainStore,
): Promise<ActionResult> {
  const invoice = input as unknown as InvoiceInput;
  const validationError = validateInvoiceInput(invoice);
  if (validationError) return { success: false, error: validationError, errorCode: "INVALID_INPUT" };

  const qrBaseUrl = (ctx.config["qrVerificationBaseUrl"] as string) ?? DEFAULT_QR_BASE_URL;
  const previous = await chainStore.getLastRecord(ctx.orgId);
  const record = buildInvoiceRecord(invoice, previous?.hash ?? null, qrBaseUrl);
  await chainStore.append(ctx.orgId, record);

  return {
    success: true,
    output: {
      invoiceNumber: record.invoiceNumber,
      hash: record.hash,
      previousHash: record.previousHash,
      qrUrl: record.qrUrl,
      totals: record.totals,
      generatedAt: record.generatedAt,
    },
  };
}

async function submitRecord(
  ctx: ConnectorContext,
  input: Record<string, unknown>,
  chainStore: ChainStore,
  aeatClient: AeatHttpClient,
): Promise<ActionResult> {
  const invoiceNumber = input["invoiceNumber"] as string | undefined;
  if (!invoiceNumber) return { success: false, error: "invoiceNumber is required", errorCode: "INVALID_INPUT" };

  const records = await chainStore.list(ctx.orgId);
  const record = records.find((r) => r.invoiceNumber === invoiceNumber);
  if (!record) return { success: false, error: `No record found for invoice "${invoiceNumber}"`, errorCode: "NOT_FOUND" };

  const mode = (ctx.config["mode"] as string) ?? "no_verifactu";
  if (mode !== "verifactu_activo") {
    return {
      success: true,
      output: { submitted: false, reason: "modo no_verifactu: registro conservado localmente, no se envía a AEAT" },
    };
  }

  const result = await aeatClient.submit(record, {
    endpoint: (ctx.config["aeatEndpoint"] as string) ?? "",
    clientCertPem: ctx.credentials["clientCertPem"] ?? "",
    clientKeyPem: ctx.credentials["clientKeyPem"] ?? "",
  });

  return {
    success: result.accepted,
    output: { ...result },
    error: result.error,
  };
}

async function listRecords(ctx: ConnectorContext, chainStore: ChainStore): Promise<ActionResult> {
  const records = await chainStore.list(ctx.orgId);
  return {
    success: true,
    output: {
      records: records.map((r) => ({
        invoiceNumber: r.invoiceNumber,
        hash: r.hash,
        previousHash: r.previousHash,
        total: r.totals.total,
        generatedAt: r.generatedAt,
      })),
    },
  };
}

function validateInvoiceInput(invoice: InvoiceInput): string | null {
  if (!invoice?.invoiceNumber) return "invoiceNumber is required";
  if (!invoice?.issuerNif) return "issuerNif is required";
  if (!invoice?.issueDate) return "issueDate is required";
  if (!Array.isArray(invoice.lines) || invoice.lines.length === 0) return "at least one invoice line is required";
  return null;
}

export { HttpAeatClient };
