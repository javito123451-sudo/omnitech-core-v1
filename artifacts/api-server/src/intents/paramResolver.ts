// ═══════════════════════════════════════════════════════════════════════════
//  Ava V2 — Multi-step Param Resolver
//  Extracts individual parameter values from free-text user responses
//  + conversational prompts for each param/skill combination
// ═══════════════════════════════════════════════════════════════════════════

// ── Date helper ──────────────────────────────────────────────────────────────

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Param extraction from raw text (user's reply in multi-step flow)
// ═══════════════════════════════════════════════════════════════════════════

export function extractParamFromText(
  paramName: string,
  paramType: string,
  rawText:   string,
): unknown {
  const text = rawText.trim();

  switch (paramName) {

    case "date":
    case "new_date": {
      // ISO date yyyy-mm-dd
      const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
      if (iso) return iso[1];
      // dd/mm/yyyy or dd-mm-yyyy
      const dmy = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
      if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}`;
      // FIX-AP: Spanish natural format "24 de agosto" or "24 de agosto de 2026" —
      // previously unhandled, silently dropping the whole multi-step flow
      // whenever a user typed a date this way (the most common way Spanish
      // speakers say a date out loud).
      const MONTHS: Record<string, number> = {
        enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
        julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
        noviembre: 11, diciembre: 12,
      };
      const monthNamePattern = Object.keys(MONTHS).join("|");
      const naturalEs = text.match(
        new RegExp(`\\b(\\d{1,2})\\s*(?:de\\s+)?(${monthNamePattern})\\b(?:\\s*(?:de\\s+)?(\\d{4}))?`, "i"),
      );
      if (naturalEs) {
        const day = Number(naturalEs[1]);
        const month = MONTHS[naturalEs[2]!.toLowerCase()]!;
        const now = new Date();
        let yr = naturalEs[3] ? Number(naturalEs[3]) : now.getFullYear();
        // If no year given and that day/month already passed this year, assume next year
        if (!naturalEs[3]) {
          const candidate = new Date(yr, month - 1, day);
          if (candidate < new Date(now.getFullYear(), now.getMonth(), now.getDate())) yr += 1;
        }
        return `${yr}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
      // relative keywords
      const now = new Date();
      if (/\bhoy\b/i.test(text))                 { return fmtDate(now); }
      if (/\bma\u00f1ana\b/i.test(text))          { now.setDate(now.getDate() + 1); return fmtDate(now); }
      if (/\bpasado\s+ma\u00f1ana\b/i.test(text)) { now.setDate(now.getDate() + 2); return fmtDate(now); }
      // weekday names (next occurrence)
      const DAYS: Record<string, number> = {
        lunes: 1, martes: 2, "mi\u00e9rcoles": 3,
        jueves: 4, viernes: 5, "s\u00e1bado": 6, domingo: 0,
      };
      for (const [word, target] of Object.entries(DAYS)) {
        if (new RegExp(`\\b${word}\\b`, "i").test(text)) {
          const d    = new Date();
          const diff = (target - d.getDay() + 7) % 7 || 7;
          d.setDate(d.getDate() + diff);
          return fmtDate(d);
        }
      }
      return undefined;
    }

    case "start_time":
    case "new_start_time": {
      const hhmm = text.match(/\b(\d{1,2}):(\d{2})\b/);
      if (hhmm) return `${hhmm[1]!.padStart(2, "0")}:${hhmm[2]}`;
      const hOnly = text.match(/\b(\d{1,2})\s*h\b/i);
      if (hOnly) return `${hOnly[1]!.padStart(2, "0")}:00`;
      const ampm = text.match(/\b(\d{1,2})\s*(am|pm)\b/i);
      if (ampm) {
        let hr = parseInt(ampm[1]!, 10);
        if (/pm/i.test(ampm[2]!) && hr < 12) hr += 12;
        if (/am/i.test(ampm[2]!) && hr === 12) hr = 0;
        return `${String(hr).padStart(2, "0")}:00`;
      }
      return undefined;
    }

    case "duration_minutes": {
      const min  = text.match(/\b(\d{1,3})\s*(min|minutos)\b/i);
      if (min) return Number(min[1]);
      const hrs  = text.match(/\b(\d{1,2})\s*(hora|horas)\b/i);
      if (hrs) return Number(hrs[1]) * 60;
      // bare number (user types just "30" or "90")
      const bare = text.match(/^\s*(\d{1,3})\s*$/);
      if (bare) return Number(bare[1]);
      return 60;
    }

    case "amount": {
      // Handle European format: "1.200,50" → 1200.50
      const m = text.match(/(\d[\d.,]*)/);
      if (!m) return undefined;
      const normalized = m[1]!.replace(/\.(?=\d{3})/g, "").replace(",", ".");
      return parseFloat(normalized);
    }

    case "invoice_number": {
      // Patterns like F-2026-001, INV-42, FAC-001
      const m = text.match(/\b([A-Z]{0,5}[-/]?\d{3,}[-/]?\d*)\b/i);
      return m ? m[1] : (text || undefined);
    }

    case "client_name":
    case "name": {
      // Strip common Spanish prepositions / leading phrases
      const stripped = text
        .replace(/^(para\s+|de\s+|con\s+el\s+|con\s+la\s+|con\s+|al\s+cliente\s+|el\s+cliente\s+|la\s+clienta?\s+|se\s+llama\s+|llama\s+|nombre\s+es\s+|es\s+)/i, "")
        .trim();
      return stripped || undefined;
    }

    case "title":
    case "description": {
      const stripped = text
        .replace(/^(sobre\s+|de\s+|para\s+|tarea\s+(sobre\s+|de\s+|para\s+)?|recordatorio\s+(de\s+|sobre\s+)?)/i, "")
        .trim();
      return stripped || undefined;
    }

    default: {
      if (paramType === "number") {
        const m = text.match(/(\d[\d.,]*)/);
        return m ? parseFloat(m[1]!.replace(",", ".")) : undefined;
      }
      return text || undefined;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Conversational prompts: one question at a time, per skill + param
// ═══════════════════════════════════════════════════════════════════════════

const PARAM_PROMPTS: Record<string, Record<string, string>> = {
  create_appointment: {
    client_name: "👤 ¿Con qué cliente es la cita? Dime su nombre.",
    date:        "📅 ¿Para qué fecha la agendo? (ej: mañana, el viernes, 25/07/2026)",
    start_time:  "🕐 ¿A qué hora la ponemos? (ej: 10:00, 15:30)",
    title:       "📝 ¿Cómo la llamamos? (ej: Reunión de seguimiento, Consulta inicial)",
  },
  reschedule_appointment: {
    new_date:       "📅 ¿A qué nueva fecha la movemos? (ej: el lunes, 28/07/2026)",
    new_start_time: "🕐 ¿A qué hora la ponemos?",
  },
  create_client: {
    name:    "👤 ¿Cuál es el nombre completo del cliente?",
    email:   "📧 ¿Cuál es su email? (escribe *sin email* para omitirlo)",
    phone:   "📞 ¿Cuál es su teléfono? (escribe *sin teléfono* para omitirlo)",
    company: "🏢 ¿A qué empresa pertenece? (escribe *sin empresa* para omitirlo)",
  },
  create_quote: {
    client_name: "👤 ¿Para qué cliente es el presupuesto?",
  },
  create_invoice: {
    client_name: "👤 ¿Para qué cliente es la factura?",
  },
  create_task: {
    title:    "📝 ¿Cuál es el título de la tarea?",
    due_date: "📅 ¿Cuándo vence? (escribe *sin fecha* para crear sin límite)",
  },
  register_payment: {
    invoice_number: "🧾 ¿Cuál es el número de la factura cobrada? (ej: F-2026-001)",
    amount:         "💰 ¿Qué importe se ha recibido? (ej: 500, 1200.50)",
  },
};

export function promptForParam(skillId: string, paramName: string): string {
  return PARAM_PROMPTS[skillId]?.[paramName]
    ?? `Necesito el campo **${paramName}**. Por favor, indícalo.`;
}

// ── Skip / omit keywords ──────────────────────────────────────────────────────

export function isSkipKeyword(text: string): boolean {
  return /^(sin\b|no\s+tengo\b|no\s+s[eé]\b|omit|n\/a\b|ninguno\b|ninguna\b|nada\b)/i.test(text.trim());
}
