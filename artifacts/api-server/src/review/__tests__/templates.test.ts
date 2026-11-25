import { describe, it, expect } from "vitest";
import { renderText, validateTemplate, escapeHtml } from "../templates";
import { ReviewInputError } from "../locations";

const email = (over: Record<string, unknown> = {}) => ({ channel: "email", name: "t", subject: "Tu opinión sobre {{establecimiento}}", body: "Hola {{nombre}}, gracias por confiar en nosotros. ¿Nos cuentas tu experiencia? {{enlace}}", ...over });
const wa = (over: Record<string, unknown> = {}) => ({ channel: "whatsapp", name: "t", body: "Hola {{nombre}}, ¿nos cuentas tu experiencia con {{servicio}}? {{enlace}} Responde BAJA para no recibir más mensajes.", waTemplateName: "peticion_resena", waLanguage: "es_ES", ...over });

describe("validación de plantillas: sin incentivos y sin condicionar a la satisfacción", () => {
  it("acepta plantillas neutrales", () => { expect(() => validateTemplate(email())).not.toThrow(); expect(() => validateTemplate(wa())).not.toThrow(); });
  it.each([
    "Déjanos una reseña y te hacemos un 10% de descuento", "Entras en el sorteo de una cena", "Te regalamos una revisión gratis", "A cambio de tu opinión, un cupón",
    "Participa en nuestro sorteo valorándonos", "Valóranos y recibe una recompensa", "Reseña y llévate un premio", "Gratis para ti si opinas", "20 euros de descuento por opinar",
  ])("rechaza incentivo: %s", (frase) => {
    expect(() => validateTemplate(email({ body: `${frase} {{enlace}}` }))).toThrow(/incentivos/);
  });
  it.each([
    "Danos 5 estrellas {{enlace}}", "Puntúanos con un 5 {{enlace}}", "Si tu experiencia fue buena, déjanos una reseña {{enlace}}", "Si estás satisfecho, valóranos {{enlace}}",
    "Solo si todo fue bien {{enlace}}", "Déjanos una reseña positiva {{enlace}}", "Una buena valoración nos ayuda mucho {{enlace}}",
  ])("rechaza pedir valoración concreta o filtrar por satisfacción: %s", (frase) => {
    expect(() => validateTemplate(email({ body: frase }))).toThrow(/valoración concreta|satisfacción/);
  });
  it("también se revisa el asunto", () => { expect(() => validateTemplate(email({ subject: "Opina y gana un regalo" }))).toThrow(/incentivos/); });
  it("exige {{enlace}}, rechaza variables desconocidas y canales no registrados", () => {
    expect(() => validateTemplate(email({ body: "Hola {{nombre}}" }))).toThrow(/enlace/);
    expect(() => validateTemplate(email({ body: "{{enlace}} {{telefono}}" }))).toThrow(/Variable desconocida/);
    expect(() => validateTemplate(email({ channel: "sms" }))).toThrow(/Canal no soportado/);
  });
  it("email exige asunto; WhatsApp exige indicar la baja y valida nombre/idioma de Meta", () => {
    expect(() => validateTemplate(email({ subject: "" }))).toThrow(/asunto/);
    expect(() => validateTemplate(wa({ body: "Hola {{nombre}} {{enlace}}" }))).toThrow(/baja/);
    expect(() => validateTemplate(wa({ waTemplateName: "Mala Plantilla" }))).toThrow(ReviewInputError);
    expect(() => validateTemplate(wa({ waLanguage: "español" }))).toThrow(ReviewInputError);
  });
  it("límite de longitud de WhatsApp", () => { expect(() => validateTemplate(wa({ body: "x".repeat(1025) + " BAJA {{enlace}}" }))).toThrow(/1024/); });
});

describe("render", () => {
  it("sustituye variables y escapa el HTML de los datos del cliente pero no la URL propia", () => {
    const out = renderText("Hola {{nombre}}: {{enlace}}", { nombre: "<b>Ana</b>", servicio: "", establecimiento: "", enlace: "https://x.es/r/abc?a=1&b=2" }, escapeHtml);
    expect(out).toBe("Hola &lt;b&gt;Ana&lt;/b&gt;: https://x.es/r/abc?a=1&b=2");
  });
  it("variables desconocidas quedan vacías", () => { expect(renderText("{{nada}}x", { nombre: "", servicio: "", establecimiento: "", enlace: "" })).toBe("x"); });
});
