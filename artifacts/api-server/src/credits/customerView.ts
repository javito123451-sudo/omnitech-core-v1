// Vista de CLIENTE de los datos de consumo: créditos, nunca tokens ni costes en dinero.
//
// OmniCredits es la unidad comercial. La conversión 1 USD = 4.000 créditos es una regla interna
// del Cost Engine y no se enseña al cliente, ni tampoco los tokens: solo el modo técnico/admin
// los ve. Se aplica a las respuestas de los endpoints de workspace; las de Super Admin no.
// El ORIGEN del precio (priceSource) y la marca provisional NO se ocultan nunca.

const TECHNICAL_KEYS = new Set([
  "technicalCostUsd", "costUsd", "typicalCostUsd", "maxCostUsd",
  "tokensIn", "tokensOut", "tokensEstimated", "tokens",
]);

export function stripTechnical<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripTechnical(v)) as unknown as T;
  if (value instanceof Date) return value;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !TECHNICAL_KEYS.has(k))
        .map(([k, v]) => [k, stripTechnical(v)]),
    ) as T;
  }
  return value;
}
