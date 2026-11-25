// Filtro de audiencia de campañas. REGLA DE CUMPLIMIENTO: las campañas se dirigen a todos
// los clientes elegibles, sin filtrar por satisfacción. Solo se admiten criterios
// objetivos (establecimiento, servicio, fechas, origen, lote). Cualquier otro campo
// —en particular valoración, NPS, sentimiento o satisfacción— se rechaza.
export const ALLOWED_AUDIENCE_KEYS = ["locationId", "services", "serviceDateFrom", "serviceDateTo", "source", "batchId"] as const;
const FORBIDDEN_HINT = /satisf|nps|rating|valoraci|puntuaci|sentiment|sentimiento|score|estrellas|stars|feedback|queja|complaint/i;

export interface AudienceFilter {
  locationId?: number; services?: string[]; serviceDateFrom?: string; serviceDateTo?: string;
  source?: "csv" | "xlsx" | "crm" | "manual"; batchId?: number;
}

export class AudienceFilterError extends Error {
  constructor(public readonly key: string, message: string) { super(message); this.name = "AudienceFilterError"; }
}

export function validateAudienceFilter(raw: unknown): AudienceFilter {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw new AudienceFilterError("", "El filtro de audiencia debe ser un objeto.");
  const f = raw as Record<string, unknown>;
  for (const key of Object.keys(f)) {
    if (!(ALLOWED_AUDIENCE_KEYS as readonly string[]).includes(key)) {
      throw new AudienceFilterError(key, FORBIDDEN_HINT.test(key)
        ? `Filtrar la audiencia por «${key}» no está permitido: las campañas deben dirigirse a todos los clientes elegibles, sin seleccionar por satisfacción.`
        : `Criterio de audiencia no permitido: «${key}».`);
    }
  }
  const isId = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v > 0;
  const isDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (f["locationId"] !== undefined && !isId(f["locationId"])) throw new AudienceFilterError("locationId", "locationId inválido.");
  if (f["batchId"] !== undefined && !isId(f["batchId"])) throw new AudienceFilterError("batchId", "batchId inválido.");
  if (f["serviceDateFrom"] !== undefined && !isDate(f["serviceDateFrom"])) throw new AudienceFilterError("serviceDateFrom", "Fecha inválida (YYYY-MM-DD).");
  if (f["serviceDateTo"] !== undefined && !isDate(f["serviceDateTo"])) throw new AudienceFilterError("serviceDateTo", "Fecha inválida (YYYY-MM-DD).");
  if (f["source"] !== undefined && !["csv", "xlsx", "crm", "manual"].includes(String(f["source"]))) throw new AudienceFilterError("source", "Origen inválido.");
  if (f["services"] !== undefined && !(Array.isArray(f["services"]) && f["services"].length <= 50 && f["services"].every((s) => typeof s === "string" && s.length <= 100)))
    throw new AudienceFilterError("services", "services debe ser una lista de textos.");
  return f as AudienceFilter;
}
