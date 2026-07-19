// ═══════════════════════════════════════════════════════════════════════════
//  Ava V2 — Intent Engine
//  Intent classification: independent from LLM
//  Primary: regex + keyword matching (deterministic)
//  Fallback: LLM (only when needed)
// ═══════════════════════════════════════════════════════════════════════════

export enum Intent {
  UNKNOWN = "UNKNOWN",
  CREATE_APPOINTMENT = "CREATE_APPOINTMENT",
  RESCHEDULE_APPOINTMENT = "RESCHEDULE_APPOINTMENT",
  CANCEL_APPOINTMENT = "CANCEL_APPOINTMENT",
  CREATE_CLIENT = "CREATE_CLIENT",
  CREATE_TASK = "CREATE_TASK",
  CREATE_QUOTE = "CREATE_QUOTE",
  GET_APPOINTMENTS = "GET_APPOINTMENTS",
  GET_CLIENTS = "GET_CLIENTS",
  GET_QUOTES = "GET_QUOTES",
  GET_TASKS = "GET_TASKS",
  CREATE_INVOICE = "CREATE_INVOICE",
  GET_INVOICES = "GET_INVOICES",
  ACCOUNTING_SUMMARY = "ACCOUNTING_SUMMARY",
  GENERAL_QUERY = "GENERAL_QUERY",
  GREETING = "GREETING",
  HELP = "HELP",
}

export interface IntentResult {
  intent:     Intent;
  confidence: number; // 0-1
  source:     "regex" | "llm" | "default";
  params:     Record<string, unknown>; // extracted params
  // For multi-step intents: what data is still needed
  missingParams?: string[];
}
