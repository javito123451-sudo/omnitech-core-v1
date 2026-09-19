// Errores estructurados del dominio de créditos. Cada uno lleva un `code`
// estable: es lo que ven las API y, más adelante, los canales — nunca un error
// genérico. Ninguno significa que se haya cobrado nada.

export type CreditErrorCode =
  | "CREDIT_INVALID"
  | "INSUFFICIENT_CREDITS"
  | "CREDIT_LIMIT_REACHED"
  | "DUPLICATE_REQUEST";

export class CreditError extends Error {
  readonly code: CreditErrorCode = "CREDIT_INVALID";
  constructor(message: string) { super(message); this.name = "CreditError"; }
}

export class InsufficientCreditsError extends Error {
  readonly code = "INSUFFICIENT_CREDITS" as const;
  constructor(
    /** Saldo contable de la cuenta. */
    public readonly balance: number,
    /** Saldo menos lo reservado por otras peticiones en curso. */
    public readonly available: number,
    /** Créditos que esta operación necesitaba reservar. */
    public readonly required: number,
  ) {
    super(`Créditos insuficientes: disponibles ${available}, se necesitan ~${required}.`);
    this.name = "InsufficientCreditsError";
  }
}

export type CreditLimitScope = "workspace_monthly" | "workspace_daily" | "agent_monthly";

export class CreditLimitReachedError extends Error {
  readonly code = "CREDIT_LIMIT_REACHED" as const;
  constructor(
    public readonly scope: CreditLimitScope,
    public readonly used: number,
    public readonly limit: number,
    public readonly requested: number,
  ) {
    super(`Límite de créditos alcanzado (${scope}): ${used} usados de ${limit}.`);
    this.name = "CreditLimitReachedError";
  }
}

export class DuplicateRequestError extends Error {
  readonly code = "DUPLICATE_REQUEST" as const;
  constructor(public readonly reference: string) {
    super(`La petición '${reference}' ya se procesó o está en curso.`);
    this.name = "DuplicateRequestError";
  }
}
