import type { ConnectorManifest } from "@workspace/connector-core";
import { createVerifactuModule } from "./module.js";

/**
 * The official VeriFactu connector manifest. This is what gets imported into
 * connectors/manifest.ts at the application layer — the Core never scans for
 * this file, it must be explicitly registered.
 */
export const verifactuManifest: ConnectorManifest = {
  slug: "verifactu",
  name: "VeriFactu (AEAT)",
  version: "0.1.0",
  vendor: "Agencia Tributaria (AEAT)",
  description:
    "Generación y envío de registros de facturación encadenados (SHA-256) conforme al Reglamento VERI*FACTU (RD 1007/2023 / RRSIF).",
  category: "custom",
  configSchema: [
    {
      key: "mode",
      label: "Modo de operación",
      type: "select",
      required: true,
      default: "no_verifactu",
      options: [
        { label: "VeriFactu activo (envío en tiempo real a AEAT)", value: "verifactu_activo" },
        { label: "No VeriFactu (conservación local, exportable)", value: "no_verifactu" },
      ],
      description: "Determina si los registros se envían a AEAT en tiempo real o se conservan localmente para inspección.",
    },
    {
      key: "aeatEndpoint",
      label: "Endpoint webservice AEAT",
      type: "string",
      required: false,
      description: "Requerido solo en modo VeriFactu activo. Confirmar la URL vigente en la Sede Electrónica de la AEAT antes de producción.",
    },
    {
      key: "qrVerificationBaseUrl",
      label: "URL base de verificación QR",
      type: "string",
      required: false,
      description: "Por defecto usa el endpoint de pre-producción de AEAT. Sustituir por el de producción antes de operar en real.",
    },
  ],
  actions: [
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
        { key: "recipientNif", label: "NIF destinatario", type: "string", required: false },
        { key: "recipientName", label: "Nombre destinatario", type: "string", required: false },
        { key: "invoiceType", label: "Tipo de factura", type: "select", required: true, default: "F1",
          options: [
            { label: "F1 - Factura completa", value: "F1" },
            { label: "F2 - Factura simplificada", value: "F2" },
          ] },
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
      description: "En modo VeriFactu activo, envía el registro generado al webservice de AEAT. En modo no_verifactu, no hace nada (conservación local).",
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
  ],
  events: [],
  resources: [
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
  ],
  load: () => createVerifactuModule(),
};
