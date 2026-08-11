// ═══════════════════════════════════════════════════════════════════════════
//  Ava V2 — Intent Engine
//  Two-stage classification:
//    1. REGEX (deterministic, fast, no LLM) → 90% of cases
//    2. LLM fallback (only when regex is ambiguous)
//  Goal: minimize LLM dependency to ~20% of traffic
// ═══════════════════════════════════════════════════════════════════════════

import { Intent, type IntentResult } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Phase 1: Regex patterns (deterministic, no LLM)
// ═══════════════════════════════════════════════════════════════════════════

interface Pattern {
  intent: Intent;
  confidence: number;
  patterns: RegExp[];
  paramExtractors?: Record<string, (match: RegExpMatchArray, text: string) => unknown>;
}

const DATE_RE = /\b(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}|\d{2}-\d{2}-\d{4}|ma\u00f1ana|pasado ma\u00f1ana|hoy|lunes|martes|mi\u00e9rcoles|jueves|viernes|s\u00e1bado|domingo)\b/i;
const TIME_RE = /\b(\d{1,2}:\d{2}|\d{1,2}h|\d{1,2}\s*(am|pm|AM|PM))\b/i;
const DURATION_RE = /\b(\d{1,3})\s*(min|minutos|hora|horas)\b/i;

const PATTERNS: Pattern[] = [
  // ── CREATE_APPOINTMENT ──
  {
    intent: Intent.CREATE_APPOINTMENT,
    confidence: 0.95,
    patterns: [
      /\b(crea[r]?\s+(una?\s+)?cita|agenda[r]?\s+(una?\s+)?cita|programa[r]?\s+(una?\s+)?cita|poner\s+(una?\s+)?cita|quiero\s+(una?\s+)?cita|necesito\s+(una?\s+)?cita|reserva[r]?\s+(una?\s+)?cita|sacar\s+(una?\s+)?cita|pedir\s+(una?\s+)?cita|concertar\s+(una?\s+)?cita|concertar\s+(una?\s+)?reuni\u00f3n|quiero\s+(una?\s+)?reuni\u00f3n|necesito\s+(una?\s+)?reuni\u00f3n|agenda[r]?\s+(una?\s+)?reuni\u00f3n|programa[r]?\s+(una?\s+)?reuni\u00f3n)\b/i,
      /\b(reuni\u00f3n\s+con|cita\s+con|cita\s+para\s+(el|la)\s+.+\s+con)\b/i,
    ],
    paramExtractors: {
      date: (_m, text) => {
        const d = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
        if (d) return d[1];
        if (/\bhoy\b/i.test(text)) {
          const now = new Date();
          return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
        }
        if (/\bma\u00f1ana\b/i.test(text)) {
          const now = new Date();
          now.setDate(now.getDate()+1);
          return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
        }
        return undefined;
      },
      start_time: (_m, text) => {
        const t = text.match(/\b(\d{1,2}:\d{2})\b/);
        return t ? t[1] : "10:00";
      },
      duration_minutes: (_m, text) => {
        const d = text.match(/\b(\d{1,3})\s*(min|minutos)\b/i);
        if (d) return Number(d[1]);
        const h = text.match(/\b(\d{1,2})\s*(hora|horas)\b/i);
        if (h) return Number(h[1]) * 60;
        return 60;
      },
      client_name: (_m, text) => {
        // "cita con [Name]" or "reunión con [Name]"
        const withMatch = text.match(
          /\b(?:cita|reuni[oó]n)\s+con\s+([a-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1A-Z\u00c1\u00c9\u00cd\u00d3\u00da\u00d1][a-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1A-Z\u00c1\u00c9\u00cd\u00d3\u00da\u00d1\s]{1,35}?)(?=\s+(?:el|la|para|hoy|ma\u00f1ana|\d|a\s+las?)|\s*$)/i,
        );
        if (withMatch?.[1]) return withMatch[1].trim();
        // FIX-AQ: "cita para [Name]" — igual de común y antes no se reconocía
        const paraMatch = text.match(
          /\b(?:cita|reuni[oó]n)\s+para\s+([a-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1A-Z\u00c1\u00c9\u00cd\u00d3\u00da\u00d1][a-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1A-Z\u00c1\u00c9\u00cd\u00d3\u00da\u00d1\s]{1,35}?)(?=\s+(?:el|la|hoy|ma\u00f1ana|pasado\s+ma\u00f1ana|\d|a\s+las?)|\s*$)/i,
        );
        if (paraMatch?.[1]) return paraMatch[1].trim();
        // "con [Name] el lunes"
        const genWith = text.match(
          /\bcon\s+([a-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1A-Z\u00c1\u00c9\u00cd\u00d3\u00da\u00d1][a-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1A-Z\u00c1\u00c9\u00cd\u00d3\u00da\u00d1\s]{1,35}?)(?=\s+(?:el|la|hoy|ma\u00f1ana|\d))/i,
        );
        if (genWith?.[1]) return genWith[1].trim();
        return undefined;
      },
    },
  },
  // ── RESCHEDULE_APPOINTMENT ──
  {
    intent: Intent.RESCHEDULE_APPOINTMENT,
    confidence: 0.95,
    patterns: [
      /\b(reprograma[r]?|reagenda[r]?|cambiar\s+(la\s+)?(fecha|hora|hora)\s+(de\s+)?(la\s+)?cita|mover\s+(la\s+)?cita|posponer\s+(la\s+)?cita|adelantar\s+(la\s+)?cita|la\s+cita\s+(para|a)\s+otro\s+(d\u00eda|horario|momento))\b/i,
      /\b(cambiar\s+(la\s+)?reuni\u00f3n|mover\s+(la\s+)?reuni\u00f3n|reprograma[r]?\s+(la\s+)?reuni\u00f3n)\b/i,
    ],
    paramExtractors: {
      new_date: (_m, text) => {
        const d = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
        if (d) return d[1];
        if (/\bma\u00f1ana\b/i.test(text)) {
          const now = new Date();
          now.setDate(now.getDate()+1);
          return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
        }
        return undefined;
      },
      new_start_time: (_m, text) => {
        const t = text.match(/\b(\d{1,2}:\d{2})\b/);
        return t ? t[1] : undefined;
      },
      client_name: (_m, text) => {
        // FIX-AQ: previously stopped at the first space, truncating multi-word
        // names ("Juan Perez" → "juan"). Now expands through spaces until a
        // real boundary keyword appears.
        const m = text.match(
          /\bde\s+([a-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1A-Z\u00c1\u00c9\u00cd\u00d3\u00da\u00d1][a-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1A-Z\u00c1\u00c9\u00cd\u00d3\u00da\u00d1\s]{1,35}?)(?=\s+(?:el|la|hoy|ma\u00f1ana|pasado\s+ma\u00f1ana|a\s+las?|\ba\b|\d)|\s*$)/i,
        ) ?? text.match(
          /\bcon\s+([a-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1A-Z\u00c1\u00c9\u00cd\u00d3\u00da\u00d1][a-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1A-Z\u00c1\u00c9\u00cd\u00d3\u00da\u00d1\s]{1,35}?)(?=\s+(?:el|la|hoy|ma\u00f1ana|pasado\s+ma\u00f1ana|a\s+las?|\ba\b|\d)|\s*$)/i,
        );
        return m?.[1]?.trim();
      },
    },
  },
  // ── CANCEL_APPOINTMENT ──
  {
    intent: Intent.CANCEL_APPOINTMENT,
    confidence: 0.95,
    patterns: [
      /\b(cancela[r]?|anula[r]?|elimina[r]?\s+(la\s+)?cita|borra[r]?\s+(la\s+)?cita|quita[r]?\s+(la\s+)?cita|no\s+(puedo|voy\s+a)\s+(ir|asistir|acudir)\s+(a\s+)?(la\s+)?cita|no\s+puedo\s+(ir|asistir)\s+(a\s+)?(la\s+)?reuni\u00f3n)\b/i,
      /\b(cancela[r]?\s+(la\s+)?reuni\u00f3n|anula[r]?\s+(la\s+)?reuni\u00f3n)\b/i,
    ],
    paramExtractors: {
      reason: (_m, text) => {
        const r = text.match(/\bporque\s+(.{3,100})/i);
        return r ? r[1].trim() : undefined;
      },
      client_name: (_m, text) => {
        // FIX-AQ: previously stopped at the first space, truncating multi-word
        // names ("Maria Garcia" → "maria"). Now expands through spaces until a
        // real boundary keyword appears.
        const m = text.match(
          /\bde\s+([a-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1A-Z\u00c1\u00c9\u00cd\u00d3\u00da\u00d1][a-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1A-Z\u00c1\u00c9\u00cd\u00d3\u00da\u00d1\s]{1,35}?)(?=\s+(?:el|la|hoy|ma\u00f1ana|pasado\s+ma\u00f1ana|a\s+las?|\ba\b|\d)|\s*$)/i,
        ) ?? text.match(
          /\bcon\s+([a-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1A-Z\u00c1\u00c9\u00cd\u00d3\u00da\u00d1][a-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1A-Z\u00c1\u00c9\u00cd\u00d3\u00da\u00d1\s]{1,35}?)(?=\s+(?:el|la|hoy|ma\u00f1ana|pasado\s+ma\u00f1ana|a\s+las?|\ba\b|\d)|\s*$)/i,
        );
        return m?.[1]?.trim();
      },
    },
  },
  // ── CREATE_CLIENT ──
  {
    intent: Intent.CREATE_CLIENT,
    confidence: 0.90,
    patterns: [
      /\b(dar\s+(de\s+)?alta\s+(un\s+)?cliente|crea[r]?\s+(un\s+)?cliente|nuevo\s+cliente|registrar\s+(un\s+)?cliente|agrega[r]?\s+(un\s+)?cliente|alta\s+(de\s+)?cliente)\b/i,
    ],
    paramExtractors: {
      name: (_m, text) => {
        const n = text.match(/\b(?:cliente|llama|nombre)\s+(?:llama|es|se\s+llama)?\s*["']?([^"'.,\d]{2,40})["']?/i);
        return n ? n[1].trim() : undefined;
      },
    },
  },
  // ── CREATE_TASK ──
  {
    intent: Intent.CREATE_TASK,
    confidence: 0.90,
    patterns: [
      /\b(crea[r]?\s+(una?\s+)?tarea|nueva\s+tarea|agrega[r]?\s+(una?\s+)?tarea|poner\s+(una?\s+)?tarea|recordatorio\s+(de\s+)?tarea|tarea\s+para\s+\w+)\b/i,
    ],
    paramExtractors: {
      title: (_m, text) => {
        const t = text.match(/\b(?:tarea|recordatorio)\s+(?:para|de|sobre)?\s*["']?([^"'.,\d]{3,60})["']?/i);
        return t ? t[1].trim() : undefined;
      },
    },
  },
  // ── CREATE_QUOTE ──
  {
    intent: Intent.CREATE_QUOTE,
    confidence: 0.90,
    patterns: [
      /\b(crea[r]?\s+(un\s+)?presupuesto|nuevo\s+presupuesto|genera[r]?\s+(un\s+)?presupuesto|hace[r]?\s+(un\s+)?presupuesto|presupuesto\s+(para|de)\b)/i,
    ],
  },
  // ── GET_APPOINTMENTS ──
  {
    intent: Intent.GET_APPOINTMENTS,
    confidence: 0.90,
    patterns: [
      /\b(qu[eé]\s+citas\s+tengo|ver\s+(mis\s+)?citas|mis\s+citas|citas\s+para\s+hoy|citas\s+de\s+hoy|pr[oó]ximas\s+citas|citas\s+pendientes|citas\s+confirmadas)\b/i,
      /\b(qu[eé]\s+reuniones\s+tengo|mis\s+reuniones|reuniones\s+de\s+hoy|calendario\s+de\s+hoy)\b/i,
    ],
    paramExtractors: {
      date_filter: (_m, text) => {
        if (/\bhoy\b/i.test(text)) return "today";
        if (/\bma\u00f1ana\b/i.test(text)) return "tomorrow";
        if (/\bsemana\b/i.test(text)) return "this_week";
        if (/\bpr[oó]xima\b/i.test(text)) return "upcoming";
        return "all";
      },
    },
  },
  // ── GET_CLIENTS ──
  {
    intent: Intent.GET_CLIENTS,
    confidence: 0.85,
    patterns: [
      /\b(lista\s+de\s+clientes|ver\s+clientes|mis\s+clientes|clientes\s+activos|clientes\s+del\s+crm|todos\s+los\s+clientes)\b/i,
      /\b(qu[eé]\s+clientes\s+tengo|qui[eé]nes\s+son\s+(mis\s+)?clientes)\b/i,
    ],
  },
  // ── GET_QUOTES ──
  {
    intent: Intent.GET_QUOTES,
    confidence: 0.85,
    patterns: [
      /\b(mis\s+presupuestos|ver\s+presupuestos|lista\s+de\s+presupuestos|presupuestos\s+enviados|presupuestos\s+pendientes)\b/i,
    ],
  },
  // ── GET_TASKS ──
  {
    intent: Intent.GET_TASKS,
    confidence: 0.85,
    patterns: [
      /\b(mis\s+tareas|ver\s+tareas|lista\s+de\s+tareas|tareas\s+pendientes|qu[eé]\s+tareas\s+tengo)\b/i,
    ],
  },
  // ── CREATE_INVOICE ──
  {
    intent: Intent.CREATE_INVOICE,
    confidence: 0.90,
    patterns: [
      /\b(crea[r]?\s+(una?\s+)?factura|nueva\s+factura|genera[r]?\s+(una?\s+)?factura|hace[r]?\s+(una?\s+)?factura|factura\s+para\b|emiti[r]?\s+(una?\s+)?factura|pon[e]?\s+(una?\s+)?factura)\b/i,
    ],
    paramExtractors: {
      client_name: (_m, text) => {
        // FIX-AQ: same multi-word truncation fix as appointments
        const m = text.match(/\bpara\s+([a-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1A-Z\u00c1\u00c9\u00cd\u00d3\u00da\u00d1][a-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1A-Z\u00c1\u00c9\u00cd\u00d3\u00da\u00d1\s]{1,35}?)(?=\s+(?:el|la|con|por|de|hoy|ma\u00f1ana|\d)|\s*$)/i);
        return m?.[1]?.trim();
      },
    },
  },
  // ── GET_INVOICES ──
  {
    intent: Intent.GET_INVOICES,
    confidence: 0.88,
    patterns: [
      /\b(mis\s+facturas|ver\s+facturas|lista\s+de\s+facturas|facturas\s+pendientes|qu[eé]\s+facturas\s+tengo|facturas\s+vencidas|cobros\s+pendientes|cu[aá]nto\s+(me\s+)?deben|facturas\s+sin\s+pagar)\b/i,
    ],
  },
  // ── ACCOUNTING_SUMMARY ──
  {
    intent: Intent.ACCOUNTING_SUMMARY,
    confidence: 0.88,
    patterns: [
      /\b(resumen\s+financiero|an[aá]lisis\s+de\s+ventas|analiza[r]?\s+(mis\s+)?ventas|ventas\s+recientes|cu[aá]nto\s+(he\s+|hemos?\s+)?(facturado|ingresado|vendido|cobrado)|ingresos\s+(del\s+mes|del\s+a[nñ]o|recientes|actuales|mensuales)|estado\s+financiero|facturaci[oó]n\s+(del\s+mes|mensual|actual)|cu[aá]nto\s+dinero|din[ea]ro\s+en\s+caja|cu[aá]nto\s+llevo\s+(este\s+)?mes|cartera\s+de\s+cobros|resumen\s+de\s+cobros|qu[eé]\s+(he\s+)?cobrado)\b/i,
    ],
  },
  // ── GREETING ──
  {
    intent: Intent.GREETING,
    confidence: 0.98,
    patterns: [
      /^(hola|buenos\s+d[ií]as|buenas\s+tardes|buenas\s+noches|saludos|qu[eé]\s+tal|ey|hello|hi)\b/i,
      /^\/(start|help|info)\b/i,
    ],
  },
  // ── HELP ──
  {
    intent: Intent.HELP,
    confidence: 0.90,
    patterns: [
      /\b(ayuda|help|comandos|qu[eé]\s+puedes\s+hacer|qu[eé]\s+sabes\s+hacer|c[oó]mo\s+funciona|instrucciones|gu[ií]a|tutorial)\b/i,
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Phase 1: Regex classification
// ═══════════════════════════════════════════════════════════════════════════

export function classifyIntentRegex(text: string): IntentResult | null {
  const lower = text.toLowerCase();

  let best: IntentResult | null = null;

  for (const pattern of PATTERNS) {
    for (const re of pattern.patterns) {
      const match = re.exec(lower);
      if (match) {
        const params: Record<string, unknown> = {};
        if (pattern.paramExtractors) {
          for (const [key, extractor] of Object.entries(pattern.paramExtractors)) {
            const val = extractor(match, lower);
            if (val !== undefined) params[key] = val;
          }
        }
        // If multiple patterns match, take the highest confidence
        if (!best || pattern.confidence > best.confidence) {
          best = {
            intent: pattern.intent,
            confidence: pattern.confidence,
            source: "regex",
            params,
          };
        }
      }
    }
  }

  return best;
}

// ════════════════════════════════════════════════════════════════════════════
// Phase 2: Main classifier (regex + optional LLM fallback)
// ═══════════════════════════════════════════════════════════════════════════

interface ClassifyOptions {
  // If true, use LLM fallback when regex is ambiguous (< 0.90)
  useLLMFallback?: boolean;
  // LLM provider for fallback (optional)
  llmProvider?: { classify: (text: string) => Promise<IntentResult> };
}

export async function classifyIntent(
  text: string,
  options: ClassifyOptions = {},
): Promise<IntentResult> {
  // 1. Try regex first
  const regexResult = classifyIntentRegex(text);

  if (regexResult && regexResult.confidence >= 0.90) {
    return regexResult;
  }

  // 2. LLM fallback (if enabled and ambiguous)
  if (options.useLLMFallback && options.llmProvider) {
    try {
      const llmResult = await options.llmProvider.classify(text);
      return llmResult;
    } catch (err) {
      console.error("[IntentEngine] LLM fallback failed:", err);
      // Fall through to default
    }
  }

  // 3. If regex matched but with low confidence, return it anyway
  if (regexResult) {
    return regexResult;
  }

  // 4. Default: GENERAL_QUERY
  return {
    intent: Intent.GENERAL_QUERY,
    confidence: 0.50,
    source: "default",
    params: {},
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Intent → Skill mapping
// ═══════════════════════════════════════════════════════════════════════════

export function intentToSkill(intent: Intent): string | null {
  switch (intent) {
    case Intent.CREATE_APPOINTMENT:     return "create_appointment";
    case Intent.RESCHEDULE_APPOINTMENT: return "reschedule_appointment";
    case Intent.CANCEL_APPOINTMENT:     return "cancel_appointment";
    case Intent.CREATE_CLIENT:          return "create_client";
    case Intent.CREATE_TASK:            return "create_task";
    case Intent.CREATE_QUOTE:           return "create_quote";
    case Intent.GET_APPOINTMENTS:       return "get_appointments";
    case Intent.GET_CLIENTS:            return "list_clients";
    case Intent.GET_QUOTES:             return "list_quotes";
    case Intent.GET_TASKS:              return "list_tasks";
    case Intent.CREATE_INVOICE:         return "create_invoice";
    case Intent.GET_INVOICES:           return "list_pending_invoices";
    case Intent.ACCOUNTING_SUMMARY:     return "accounting_summary";
    default:                            return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Parameter validation for multi-step flows
// ═══════════════════════════════════════════════════════════════════════════

import { getSkill } from "../skills";

export function validateIntentParams(
  intent: Intent,
  params: Record<string, unknown>,
): { complete: boolean; missing: string[] } {
  const skillId = intentToSkill(intent);
  if (!skillId) return { complete: true, missing: [] };

  const skill = getSkill(skillId);
  if (!skill) return { complete: true, missing: [] };

  const missing = skill.params
    .filter(p => p.required && !(p.name in params))
    .map(p => p.name);

  return {
    complete: missing.length === 0,
    missing,
  };
}
