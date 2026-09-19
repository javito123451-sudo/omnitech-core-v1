// Qué operaciones son "uso de IA" y por tanto consumen OmniCredits, y cuáles no.
//
// Consume créditos (uso de IA): cualquier operación que llame a un modelo o a una
// herramienta de IA de pago. Se declara con `usageKind` en la petición al gateway y queda
// registrada en ai_usage_logs y en el ledger, para poder desglosar el consumo por tipo.
//
// NO consume créditos: CRUD normal, navegación, consultas directas de datos, tareas
// manuales y cualquier operación normal sin IA. Esas operaciones no pasan por el gateway
// (y aunque pasaran, el gateway se niega a cobrar un `usageKind` que no sea de IA).

export const AI_USAGE_KINDS = [
  "agent_execution",        // ejecución de un agente
  "llm_response",           // respuesta de un LLM
  "ai_analysis",            // análisis con IA
  "ai_content_generation",  // generación de contenido con IA
  "ai_document_processing", // procesado de documentos con IA
  "ocr",                    // reconocimiento óptico de caracteres
  "image_generation",       // generación de imágenes
  "audio_generation",       // generación de audio
  "external_ai_tool",       // herramienta de IA externa de pago
] as const;
export type AiUsageKind = (typeof AI_USAGE_KINDS)[number];

/** Operaciones que NUNCA consumen créditos. Solo documentación ejecutable: no son usageKind válidos. */
export const NON_BILLABLE_OPERATIONS = [
  "crud", "navigation", "direct_data_query", "manual_task", "non_ai_operation",
] as const;

export const isAiUsageKind = (value: unknown): value is AiUsageKind =>
  typeof value === "string" && (AI_USAGE_KINDS as readonly string[]).includes(value);

export class NonBillableUsageError extends Error {
  readonly code = "NON_BILLABLE_USAGE" as const;
  constructor(kind: unknown) {
    super(`'${String(kind)}' no es uso de IA: no consume OmniCredits.`);
    this.name = "NonBillableUsageError";
  }
}
