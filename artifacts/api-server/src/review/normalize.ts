// Normalización y validación de datos de contacto. Sin dependencias externas.
// Conservador a propósito: ante la duda, el dato se rechaza y se informa (un teléfono
// mal normalizado enviaría un mensaje a un tercero, que es peor que no enviarlo).

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/;

export function normalizeEmail(raw: unknown): string | null {
  if (raw == null) return null;
  let v = String(raw).trim().toLowerCase();
  v = v.replace(/^mailto:/, "").replace(/^<|>$/g, "").trim();
  if (v.length === 0 || v.length > 254) return null;
  const [local] = v.split("@");
  if (!local || local.length > 64 || v.includes("..") || local.startsWith(".") || local.endsWith(".")) return null;
  return EMAIL_RE.test(v) ? v : null;
}

export interface NormalizedPhone { e164: string; whatsappCapable: boolean; note?: string }

/** Excel entrega a veces 6.00111222E8 para un número largo. */
function expandScientific(v: string): string {
  if (/^\d+(\.\d+)?e\+?\d+$/i.test(v)) {
    const n = Number(v);
    if (Number.isFinite(n) && n < Number.MAX_SAFE_INTEGER) return String(Math.round(n));
  }
  return v;
}

export function normalizePhone(raw: unknown, defaultCountryCallingCode = "34"): NormalizedPhone | null {
  if (raw == null) return null;
  let v = expandScientific(String(raw).trim());
  if (v === "") return null;
  v = v.replace(/[\s().-]/g, "");
  let digits: string;
  if (v.startsWith("+")) digits = v.slice(1);
  else if (v.startsWith("00")) digits = v.slice(2);
  else if (defaultCountryCallingCode === "34" && /^[6789]\d{8}$/.test(v)) digits = `34${v}`;
  else if (v.startsWith(defaultCountryCallingCode) && v.length >= defaultCountryCallingCode.length + 8) digits = v;
  else return null; // sin prefijo internacional y sin forma nacional reconocible
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null; // E.164: máx. 15 dígitos
  if (digits.startsWith("34")) {
    const national = digits.slice(2);
    if (!/^[6789]\d{8}$/.test(national)) return null;
    // Móviles españoles: 6xx y 7xx. 8xx/9xx son fijos (sin WhatsApp).
    const mobile = /^[67]/.test(national);
    return { e164: `+${digits}`, whatsappCapable: mobile, note: mobile ? undefined : "Teléfono fijo: no apto para WhatsApp" };
  }
  return { e164: `+${digits}`, whatsappCapable: true };
}

export function parseServiceDate(raw: unknown): string | null | undefined {
  if (raw == null || raw === "") return undefined; // ausente
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10);
  const v = String(raw).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  let y: number, mo: number, d: number;
  if (m) { y = +m[1]!; mo = +m[2]!; d = +m[3]!; }
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v))) { d = +m[1]!; mo = +m[2]!; y = +m[3]!; }
  else return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// ── Cabeceras ────────────────────────────────────────────────────────────────
export type ContactField = "name" | "email" | "phone" | "service" | "serviceDate";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

const ALIASES: Record<ContactField, string[]> = {
  name: ["nombre", "name", "cliente", "nombrecompleto", "fullname", "customer", "nombreycliente"],
  email: ["email", "correo", "correoelectronico", "mail", "emailaddress", "direccionemail"],
  phone: ["telefono", "tel", "movil", "phone", "mobile", "whatsapp", "celular", "telefonomovil", "numerotelefono"],
  service: ["servicio", "service", "trabajo", "reparacion", "tipodeservicio", "servicioprestado"],
  serviceDate: ["fecha", "fechaservicio", "servicedate", "date", "fechadelservicio", "fechareparacion"],
};

export function mapHeaders(headers: string[]): Partial<Record<ContactField, string>> {
  const out: Partial<Record<ContactField, string>> = {};
  for (const h of headers) {
    const f = fold(h);
    for (const [field, names] of Object.entries(ALIASES) as [ContactField, string[]][]) {
      if (!out[field] && names.includes(f)) out[field] = h;
    }
  }
  return out;
}
