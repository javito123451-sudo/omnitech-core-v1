import { describe, it, expect } from "vitest";
import { canSendNow, localHour, validHourRange } from "../engine/window";

const at = (iso: string) => new Date(iso);
describe("ventana horaria en zona de la empresa", () => {
  it("convierte a hora local (Madrid UTC+1 invierno, UTC+2 verano)", () => {
    expect(localHour(at("2026-12-01T09:00:00Z"), "Europe/Madrid")).toBe(10);
    expect(localHour(at("2026-06-01T09:00:00Z"), "Europe/Madrid")).toBe(11);
    expect(localHour(at("2026-12-01T09:00:00Z"), "America/Mexico_City")).toBe(3);
  });
  it("por defecto 09–20: fuera de horario no se envía", () => {
    expect(canSendNow(at("2026-12-01T09:00:00Z"), "Europe/Madrid", null, null)).toBe(true);   // 10:00
    expect(canSendNow(at("2026-12-01T02:00:00Z"), "Europe/Madrid", null, null)).toBe(false);  // 03:00
    expect(canSendNow(at("2026-12-01T19:30:00Z"), "Europe/Madrid", null, null)).toBe(false);  // 20:30
    expect(canSendNow(at("2026-12-01T19:00:00Z"), "Europe/Madrid", null, null)).toBe(false);  // 20:00 justo: excluido
  });
  it("ventana propia y horas de silencio, también las que cruzan medianoche", () => {
    expect(canSendNow(at("2026-12-01T11:00:00Z"), "Europe/Madrid", { startHour: 12, endHour: 14 }, null)).toBe(true);
    expect(canSendNow(at("2026-12-01T09:00:00Z"), "Europe/Madrid", { startHour: 12, endHour: 14 }, null)).toBe(false);
    expect(canSendNow(at("2026-12-01T13:00:00Z"), "Europe/Madrid", { startHour: 9, endHour: 22 }, { startHour: 14, endHour: 16 })).toBe(false); // 14:00 silencio
    expect(canSendNow(at("2026-12-01T21:30:00Z"), "Europe/Madrid", { startHour: 9, endHour: 24 }, { startHour: 22, endHour: 8 })).toBe(false); // 22:30 en silencio nocturno
  });
  it("validHourRange", () => {
    expect(validHourRange({ startHour: 9, endHour: 20 })).toBe(true);
    for (const x of [{ startHour: 20, endHour: 9 }, { startHour: -1, endHour: 5 }, { startHour: 9, endHour: 25 }, { startHour: 9.5, endHour: 20 }, null, "x"]) expect(validHourRange(x)).toBe(false);
  });
});
