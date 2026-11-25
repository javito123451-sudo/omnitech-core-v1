// Ventana horaria de envío y horas de silencio, en la zona horaria de la empresa.
export interface HourRange { startHour: number; endHour: number }

export function localHour(now: Date, timeZone: string): number {
  try {
    const h = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone }).format(now);
    return Number(h);
  } catch { return now.getUTCHours(); }
}

export const DEFAULT_SEND_WINDOW: HourRange = { startHour: 9, endHour: 20 };

export function validHourRange(r: unknown): r is HourRange {
  const o = r as HourRange;
  return !!o && Number.isInteger(o.startHour) && Number.isInteger(o.endHour) && o.startHour >= 0 && o.startHour <= 23 && o.endHour >= 1 && o.endHour <= 24 && o.startHour < o.endHour;
}

/** ¿Se puede enviar ahora? Dentro de la ventana de la campaña y fuera de las horas de silencio de la empresa (que pueden cruzar medianoche). */
export function canSendNow(now: Date, timeZone: string, window: HourRange | null | undefined, quiet: HourRange | null | undefined): boolean {
  const h = localHour(now, timeZone);
  const w = validHourRange(window) ? window : DEFAULT_SEND_WINDOW;
  if (!(h >= w.startHour && h < w.endHour)) return false;
  if (quiet && Number.isInteger(quiet.startHour) && Number.isInteger(quiet.endHour) && quiet.startHour !== quiet.endHour) {
    const inQuiet = quiet.startHour < quiet.endHour ? h >= quiet.startHour && h < quiet.endHour : h >= quiet.startHour || h < quiet.endHour;
    if (inQuiet) return false;
  }
  return true;
}
