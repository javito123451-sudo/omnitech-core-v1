/**
 * Omni Integration Hub — VeriFactu Adapter
 *
 * Primer ActionAdapter del hub. VeriFactu no encaja en el contrato de
 * mensajería (send/receive) que WhatsApp y Telegram implementan — no manda
 * ni recibe mensajes, ejecuta acciones declaradas (generar registro, enviar
 * a AEAT, listar cadena). Por eso implementa ActionAdapter en vez de
 * MessagingAdapter, tal como distingue hub/types.ts.
 *
 * La lógica de dominio (hash SHA-256 encadenado, XML, QR, cliente AEAT) vive
 * en ./verifactu/* — funciones puras sin acoplamiento a ningún framework,
 * reutilizadas tal cual.
 */
import type {
  ActionAdapter,
  AdapterContext,
  ActionDefinition,
  ResourceDefinition,
  ActionResult,
  ValidationResult,
  IntegrationHealth,
} from "../types";
import { IntegrationRegistry } from "../integrationRegistry";
import { buildInvoiceRecord } from "./verifactu/hashChain";
import type { InvoiceInput } from "./verifactu/domain";
import { InMemoryChainStore, type ChainStore } from "./verifactu/chainStore";
import { HttpAeatClient, FakeAeatClient, type AeatHttpClient } from "./verifactu/aeatClient";
import { PgVerifactuChainStore } from "../../services/verifactuChainStore";

const DEFAULT_QR_BASE_URL = "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR"; // pre-producción — confirmar URL de producción antes de ir a real

const actions: ActionDefinition[] = [
  {
    slug: "generate_invoice_record",
    label: "Generar registro de facturación",
    description: "Calcula totales, genera el hash SHA-256 encadenado, el XML canónico y el QR de una factura.",
    idempotent: false,
    input: [
      { key: "invoiceNumber", label: "Número de factura", type: "string", required: true },
      { key: "issueDate", label: "Fecha de expedición", type: "date", required: true },
      { key: "issuerNif", label: "NIF emisor", type: "string", required: true },
      { key: "issuerName", label: "Nombre emisor", type: "string", required: false },
      {
        key: "invoiceType", label: "Tipo de factura", type: "select", required: true, default: "F1",
        options: [
          { label: "F1 - Factura completa", value: "F1" },
          { label: "F2 - Factura simplificada", value: "F2" },
        ],
      },
      { key: "lines", label: "Líneas de factura", type: "json", required: true },
    ],
    output: [
      { key: "hash", label: "Huella (hash)", type: "string" },
      { key: "previousHash", label: "Huella anterior", type: "string" },
      { key: "qrUrl", label: "URL QR", type: "string" },
      { key: "totals", label: "Totales", type: "json" },
    ],
  },
  {
    slug: "submit_record",
    label: "Enviar registro a AEAT",
    description: "En modo verifactu_activo, envía el registro al webservice de AEAT. En modo no_verifactu, no hace nada.",
    idempotent: true,
    input: [{ key: "invoiceNumber", label: "Número de factura", type: "string", required: true }],
    output: [
      { key: "accepted", label: "Aceptado", type: "boolean" },
      { key: "csv", label: "Código Seguro de Verificación", type: "string" },
    ],
  },
  {
    slug: "list_records",
    label: "Listar registros de la cadena",
    description: "Devuelve la cadena completa de registros generados para el org, en orden.",
    idempotent: true,
    input: [],
    output: [{ key: "records", label: "Registros", type: "json" }],
  },
];

const resources: ResourceDefinition[] = [
  {
    slug: "invoice_records",
    label: "Registros de facturación",
    listable: true,
    fields: [
      { key: "invoiceNumber", label: "Número de factura", type: "string" },
      { key: "hash", label: "Huella", type: "string" },
      { key: "previousHash", label: "Huella anterior", type: "string" },
      { key: "total", label: "Importe total", type: "number" },
      { key: "generatedAt", label: "Generado en", type: "date" },
    ],
  },
];

export function createVerifactuAdapter(deps: { chainStore?: ChainStore; aeatClient?: AeatHttpClient } = {}): ActionAdapter {
  const chainStore = deps.chainStore ?? new InMemoryChainStore();
  const aeatClient = deps.aeatClient ?? new FakeAeatClient();

  async function generateInvoiceRecord(ctx: AdapterContext, input: Record<string, unknown>): Promise<ActionResult> {
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

  async function submitRecord(ctx: AdapterContext, input: Record<string, unknown>): Promise<ActionResult> {
    const invoiceNumber = input["invoiceNumber"] as string | undefined;
    if (!invoiceNumber) return { success: false, error: "invoiceNumber is required", errorCode: "INVALID_INPUT" };

    const records = await chainStore.list(ctx.orgId);
    const record = records.find((r) => r.invoiceNumber === invoiceNumber);
    if (!record) return { success: false, error: `No record found for invoice "${invoiceNumber}"`, errorCode: "NOT_FOUND" };

    const mode = (ctx.config["mode"] as string) ?? "no_verifactu";
    if (mode !== "verifactu_activo") {
      return { success: true, output: { submitted: false, mode, reason: "modo no_verifactu: conservado localmente" } };
    }

    const result = await aeatClient.submit(record, {
      endpoint: (ctx.config["aeatEndpoint"] as string) ?? "",
      clientCertPem: ctx.credentials["clientCertPem"] ?? "",
      clientKeyPem: ctx.credentials["clientKeyPem"] ?? "",
    });

    return { success: result.accepted, output: { ...result, mode }, error: result.error };
  }

  async function listRecords(ctx: AdapterContext): Promise<ActionResult> {
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

  return {
    actions,
    resources,
    events: [],

    async validate(ctx: AdapterContext): Promise<ValidationResult> {
      const missing: string[] = [];
      if (!ctx.credentials["issuerNif"]) missing.push("issuerNif");
      if (ctx.config["mode"] === "verifactu_activo" && !ctx.config["aeatEndpoint"]) missing.push("aeatEndpoint");
      return { valid: missing.length === 0, missing };
    },

    async healthCheck(ctx: AdapterContext): Promise<IntegrationHealth> {
      const start = Date.now();
      const records = await chainStore.list(ctx.orgId);
      const last = records[records.length - 1];
      return {
        overall: "healthy",
        checkedAt: new Date().toISOString(),
        results: [
          {
            name: "chain_readable",
            status: "pass",
            message: `Cadena con ${records.length} registro(s)`,
            durationMs: Date.now() - start,
            detail: { chainLength: records.length, lastHash: last?.hash ?? null },
          },
        ],
      };
    },

    async executeAction(ctx: AdapterContext, actionSlug: string, input: Record<string, unknown>): Promise<ActionResult> {
      switch (actionSlug) {
        case "generate_invoice_record":
          return generateInvoiceRecord(ctx, input);
        case "submit_record":
          return submitRecord(ctx, input);
        case "list_records":
          return listRecords(ctx);
        default:
          return { success: false, error: `Unknown action "${actionSlug}"`, errorCode: "ACTION_NOT_FOUND" };
      }
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

// ── Self-register (mismo patrón que whatsappAdapter.ts / telegramAdapter.ts) ──
const verifactuAdapter = createVerifactuAdapter({
  chainStore: new PgVerifactuChainStore(),
  aeatClient: new HttpAeatClient(),
});

IntegrationRegistry.register("verifactu", verifactuAdapter);
console.log("[IntegrationHub] VeriFactu adapter registered (action-shaped)");

export { verifactuAdapter };
