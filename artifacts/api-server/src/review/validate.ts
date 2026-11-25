// Validación de entrada mínima y estricta, sin dependencias nuevas.
// Cualquier campo no declarado se rechaza (p. ej. un orgId en el cuerpo).
export class ValidationError extends Error {
  constructor(public readonly issues: { path: string; message: string }[]) {
    super(issues.map((i) => `${i.path}: ${i.message}`).join("; "));
    this.name = "ValidationError";
  }
}

type Spec = { type: "string"; min?: number; max: number; nullable?: boolean; required?: boolean };

export function parseObject<T extends Record<string, unknown>>(body: unknown, spec: Record<string, Spec>, opts: { partial?: boolean } = {}): T {
  const issues: { path: string; message: string }[] = [];
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new ValidationError([{ path: "", message: "Se esperaba un objeto JSON" }]);
  const src = body as Record<string, unknown>;
  for (const key of Object.keys(src)) if (!(key in spec)) issues.push({ path: key, message: "Campo no permitido" });
  const out: Record<string, unknown> = {};
  for (const [key, s] of Object.entries(spec)) {
    const v = src[key];
    if (v === undefined) { if (s.required && !opts.partial) issues.push({ path: key, message: "Obligatorio" }); continue; }
    if (v === null) { if (s.nullable) out[key] = null; else issues.push({ path: key, message: "No puede ser nulo" }); continue; }
    if (typeof v !== "string") { issues.push({ path: key, message: "Debe ser texto" }); continue; }
    const t = v.trim();
    if (s.min !== undefined && t.length < s.min) issues.push({ path: key, message: `Mínimo ${s.min} caracteres` });
    else if (t.length > s.max) issues.push({ path: key, message: `Máximo ${s.max} caracteres` });
    else out[key] = t;
  }
  if (issues.length) throw new ValidationError(issues);
  return out as T;
}

export function parseId(v: unknown): number | null {
  if (typeof v !== "string" || !/^[1-9][0-9]{0,9}$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
}
