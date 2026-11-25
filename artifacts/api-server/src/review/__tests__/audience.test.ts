import { describe, it, expect } from "vitest";
import { AudienceFilterError, validateAudienceFilter } from "../audience";

describe("filtro de audiencia: sin filtrar por satisfacción", () => {
  it("acepta criterios objetivos", () => {
    expect(validateAudienceFilter({ locationId: 3, services: ["Reparación"], serviceDateFrom: "2026-01-01", serviceDateTo: "2026-03-31", source: "csv", batchId: 9 })).toBeTruthy();
    expect(validateAudienceFilter(undefined)).toEqual({});
  });
  it.each(["rating", "minRating", "satisfaction", "nps", "sentiment", "score", "stars", "valoracion", "puntuación", "feedback", "complaint", "queja"])(
    "rechaza «%s» con un mensaje que explica la regla", (key) => {
      expect(() => validateAudienceFilter({ [key]: 5 })).toThrow(AudienceFilterError);
      expect(() => validateAudienceFilter({ [key]: 5 })).toThrow(/no está permitido|no permitido/);
    });
  it("rechaza criterios desconocidos, tipos erróneos y filtros mal formados", () => {
    for (const bad of [{ orgId: 1 }, { locationId: "3" }, { locationId: -1 }, { serviceDateFrom: "15/03/2026" }, { source: "sms" }, { services: "x" }, [], "x"])
      expect(() => validateAudienceFilter(bad)).toThrow(AudienceFilterError);
  });
});
