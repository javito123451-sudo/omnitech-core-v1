import { describe, it, expect } from "vitest";
import { mapHeaders, normalizeEmail, normalizePhone, parseServiceDate } from "../normalize";

describe("normalizeEmail", () => {
  it.each([
    ["  Ana.Lopez@Gmail.com ", "ana.lopez@gmail.com"], ["mailto:x@y.es", "x@y.es"], ["<juan@empresa.co.uk>", "juan@empresa.co.uk"], ["a+b@sub.dominio.es", "a+b@sub.dominio.es"],
  ])("%s → %s", (i, o) => expect(normalizeEmail(i)).toBe(o));
  it.each(["", "sin-arroba", "a@b", "a@@b.es", "a b@c.es", "a..b@c.es", ".a@c.es", "a@-c.es", "a@c.e", null, undefined, `${"x".repeat(65)}@c.es`])("rechaza %j", (i) => expect(normalizeEmail(i)).toBeNull());
});

describe("normalizePhone (E.164, +34 por defecto)", () => {
  it.each([
    ["600 11 12 22", "+34600111222"], ["600-111-222", "+34600111222"], ["+34 600 111 222", "+34600111222"], ["0034600111222", "+34600111222"],
    ["34600111222", "+34600111222"], ["(+34) 700.111.222", "+34700111222"], [600111222, "+34600111222"], ["6.00111222E8", "+34600111222"],
    ["+44 7911 123456", "+447911123456"], ["+1 (415) 555-2671", "+14155552671"],
  ])("%s → %s", (i, o) => expect(normalizePhone(i)?.e164).toBe(o));
  it.each(["", "123", "abcdefghi", "+34 500111222", "+34 60011122", "6001112223", "+0 600111222", "+1234567890123456", null, undefined])("rechaza %j", (i) => expect(normalizePhone(i)).toBeNull());
  it("móviles españoles (6/7) son aptos para WhatsApp; fijos (8/9) no", () => {
    expect(normalizePhone("600111222")?.whatsappCapable).toBe(true);
    expect(normalizePhone("711111222")?.whatsappCapable).toBe(true);
    const fijo = normalizePhone("911234567");
    expect(fijo?.whatsappCapable).toBe(false); expect(fijo?.note).toMatch(/fijo/);
  });
  it("un número sin prefijo y que no es español se rechaza en vez de adivinar el país", () => {
    expect(normalizePhone("4155552671")).toBeNull();
  });
});

describe("parseServiceDate", () => {
  it.each([["2026-03-15", "2026-03-15"], ["15/03/2026", "2026-03-15"], ["5-3-2026", "2026-03-05"], ["2026-03-15T10:00:00Z", "2026-03-15"], [new Date("2026-03-15T00:00:00Z"), "2026-03-15"]])("%s", (i, o) => expect(parseServiceDate(i)).toBe(o));
  it("fechas imposibles → null; ausentes → undefined", () => {
    expect(parseServiceDate("31/02/2026")).toBeNull(); expect(parseServiceDate("ayer")).toBeNull();
    expect(parseServiceDate("")).toBeUndefined(); expect(parseServiceDate(null)).toBeUndefined();
  });
});

describe("mapHeaders", () => {
  it("reconoce alias en español/inglés con tildes y mayúsculas", () => {
    expect(mapHeaders(["Nombre", "Correo electrónico", "Móvil", "Servicio", "Fecha del servicio"])).toEqual({
      name: "Nombre", email: "Correo electrónico", phone: "Móvil", service: "Servicio", serviceDate: "Fecha del servicio",
    });
    expect(mapHeaders(["Full Name", "E-mail", "WhatsApp"])).toEqual({ name: "Full Name", email: "E-mail", phone: "WhatsApp" });
  });
  it("ignora columnas desconocidas", () => expect(mapHeaders(["foo", "bar"])).toEqual({}));
});
