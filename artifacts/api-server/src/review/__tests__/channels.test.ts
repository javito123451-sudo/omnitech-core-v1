import { describe, it, expect, vi, beforeEach } from "vitest";

const getWhatsAppCreds = vi.hoisted(() => vi.fn());
vi.mock("../../utils/integrationCreds", async (orig) => ({ ...(await orig<typeof import("../../utils/integrationCreds")>()), getWhatsAppCreds: (...a: unknown[]) => getWhatsAppCreds(...a) }));

import { classifyMetaError, sanitizeParam, whatsappProvider } from "../channels/whatsapp";
import { buildEmail, classifyEmailError, emailProvider } from "../channels/email";
import type { SendRequest } from "../channels/types";

const req = (over: Partial<SendRequest> = {}): SendRequest => ({
  orgId: 1, messageId: 9, to: "+34600111222", contactName: "Ana", service: "Reparación", location: { name: "Taller Sur" },
  template: { id: 1, subject: "Tu opinión sobre {{establecimiento}}", body: "Hola {{nombre}}, ¿cómo fue {{servicio}}? {{enlace}}", waTemplateName: "peticion_resena", waLanguage: "es_ES", waStatus: "approved" },
  links: { review: "https://app.test/api/review-public/r/TOK", unsubscribe: "https://app.test/api/review-public/u/TOK" },
  sender: { name: "Frío Sur", legalName: "Frío Sur S.L.", taxId: "B12345678", address: "C/ Mayor 1, Madrid" }, ...over,
});
const ok = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data }) as unknown as Response;

describe("WhatsApp Cloud API (con la API de Meta sustituida por un doble HTTP: NO es un envío real)", () => {
  beforeEach(() => getWhatsAppCreds.mockReset());

  it("envía una plantilla aprobada con los parámetros en el orden del texto", async () => {
    getWhatsAppCreds.mockResolvedValue({ phoneNumberId: "PN1", accessToken: "TKN", source: "db" });
    const f = vi.fn().mockResolvedValue(ok({ messages: [{ id: "wamid.XYZ" }] }));
    const out = await whatsappProvider(f as unknown as typeof fetch).send(req());
    expect(out).toEqual({ ok: true, providerMessageId: "wamid.XYZ" });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v19.0/PN1/messages");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer TKN" });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ messaging_product: "whatsapp", to: "34600111222", type: "template", template: { name: "peticion_resena", language: { code: "es_ES" } } });
    expect(body.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual(["Ana", "Reparación", "https://app.test/api/review-public/r/TOK"]);
  });
  it("sin credenciales PROPIAS (solo variables de entorno de la plataforma) no envía", async () => {
    getWhatsAppCreds.mockResolvedValue({ phoneNumberId: "ENV", accessToken: "ENV", source: "env" });
    const f = vi.fn();
    const p = whatsappProvider(f as unknown as typeof fetch);
    expect(await p.readiness(1, req().template)).toMatchObject({ ready: false, reason: expect.stringMatching(/propia cuenta/) });
    expect(await p.send(req())).toMatchObject({ ok: false, fatal: true, code: "no_credentials" });
    expect(f).not.toHaveBeenCalled();
  });
  it("plantilla no aprobada por Meta → no lista y no envía", async () => {
    getWhatsAppCreds.mockResolvedValue({ phoneNumberId: "P", accessToken: "T", source: "db" });
    const f = vi.fn(); const p = whatsappProvider(f as unknown as typeof fetch);
    const t = { ...req().template, waStatus: "pending" };
    expect(await p.readiness(1, t)).toMatchObject({ ready: false, reason: expect.stringMatching(/no está aprobada/) });
    expect(await p.send(req({ template: t }))).toMatchObject({ ok: false, code: "template_not_approved" });
    expect(f).not.toHaveBeenCalled();
  });
  it("error de red → reintentable", async () => {
    getWhatsAppCreds.mockResolvedValue({ phoneNumberId: "P", accessToken: "T", source: "db" });
    const out = await whatsappProvider((async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch).send(req());
    expect(out).toMatchObject({ ok: false, retryable: true, code: "network_error" });
  });
  it.each([
    [429, { error: { code: 130429, message: "Rate limit" } }, { retryable: true }],
    [500, null, { retryable: true }],
    [400, { error: { code: 131026, message: "Undeliverable" } }, { retryable: false, invalidDestination: true }],
    [401, { error: { code: 190, message: "Invalid OAuth" } }, { retryable: false, fatal: true }],
    [400, { error: { code: 132001, message: "Template does not exist" } }, { retryable: false, fatal: true }],
    [400, { error: { code: 131047, message: "x" } }, { retryable: false }],
    [403, null, { retryable: false, fatal: true }],
  ])("clasifica errores de Meta (HTTP %i)", (status, body, expected) => {
    expect(classifyMetaError(status, body)).toMatchObject({ ok: false, ...expected });
  });
  it("parámetros sin saltos de línea ni vacíos (Meta los rechaza)", () => {
    expect(sanitizeParam("a\nb\t c")).toBe("a b  c"); expect(sanitizeParam("")).toBe("-"); expect(sanitizeParam("x".repeat(2000)).length).toBe(1000);
  });
});

describe("correo", () => {
  it("incluye identificación del remitente, enlace de baja y cabeceras List-Unsubscribe (baja de un clic)", () => {
    const e = buildEmail(req({ to: "ana@x.es" }));
    expect(e.subject).toBe("Tu opinión sobre Taller Sur");
    expect(e.headers).toEqual({ "List-Unsubscribe": "<https://app.test/api/review-public/u/TOK>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    expect(e.html).toContain("Frío Sur S.L. · B12345678 · C/ Mayor 1, Madrid");
    expect(e.html).toContain('href="https://app.test/api/review-public/u/TOK"');
    expect(e.html).toContain('<a href="https://app.test/api/review-public/r/TOK">');
    expect(e.text).toContain("Baja: https://app.test/api/review-public/u/TOK");
  });
  it("escapa HTML de los datos del cliente (sin inyección) y limpia saltos de línea del asunto", () => {
    const e = buildEmail(req({ contactName: "<script>alert(1)</script>", location: { name: "A\r\nBcc: x@y.es" } }));
    expect(e.html).not.toContain("<script>"); expect(e.html).toContain("&lt;script&gt;");
    expect(e.subject).not.toMatch(/[\r\n]/);
  });
  it("envía con el servicio compartido y devuelve el id de Resend", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, id: "re_123" });
    const out = await emailProvider(send).send(req({ to: "ana@x.es" }));
    expect(out).toEqual({ ok: true, providerMessageId: "re_123" });
    expect(send.mock.calls[0]![0]).toBe("ana@x.es"); expect(send.mock.calls[0]![3].headers["List-Unsubscribe-Post"]).toBeTruthy();
  });
  it.each([
    ["RESEND_API_KEY no configurado", { fatal: true, retryable: false }], ["The domain is not verified", { fatal: true }],
    ["Too many requests (429)", { retryable: true }], ["fetch failed", { retryable: true }],
    ["Invalid `to` email address", { invalidDestination: true, retryable: false }], ["Something else", { retryable: false }],
  ])("clasifica errores de correo: %s", (msg, expected) => { expect(classifyEmailError(msg)).toMatchObject({ ok: false, ...expected }); });
  it("readiness depende de RESEND_API_KEY", async () => {
    const old = process.env["RESEND_API_KEY"]; delete process.env["RESEND_API_KEY"];
    expect(await emailProvider().readiness(1, req().template)).toMatchObject({ ready: false });
    process.env["RESEND_API_KEY"] = "x"; expect(await emailProvider().readiness(1, req().template)).toEqual({ ready: true });
    if (old === undefined) delete process.env["RESEND_API_KEY"]; else process.env["RESEND_API_KEY"] = old;
  });
});
