/**
 * Omni Diagnostics — Tipos compartidos del sistema de diagnóstico.
 * Cada módulo (existente o futuro) registra su propio DiagnosticAdapter.
 * El core nunca tiene lógica específica de ningún módulo.
 */

export type DiagnosticSeverity = "critical" | "warning" | "info";
export type DiagnosticStatus = "pass" | "fail" | "skip" | "warn";
export type FixAction = "none" | "clear_cache" | "reconnect" | "regenerate_token" | "reindex_kb" | "sync_crm" | "repair_orphans" | "custom";

export interface DiagnosticIssue {
  id: string;
  module: string;
  severity: DiagnosticSeverity;
  title: string;
  description: string;
  fixAction?: FixAction;
  fixLabel?: string;
  fixPayload?: Record<string, unknown>;
  autoFixable: boolean;
}

export interface DiagnosticRecommendation {
  id: string;
  module: string;
  severity: DiagnosticSeverity;
  title: string;
  description: string;
}

export interface ModuleDiagnosticResult {
  module: string;
  score: number; // 0-100
  status: "healthy" | "degraded" | "unhealthy" | "unknown";
  checks: DiagnosticCheck[];
  issues: DiagnosticIssue[];
  recommendations: DiagnosticRecommendation[];
  durationMs: number;
  detail?: Record<string, unknown>;
}

export interface DiagnosticCheck {
  name: string;
  status: DiagnosticStatus;
  message: string;
  durationMs: number;
  detail?: Record<string, unknown>;
}

export interface DiagnosticReport {
  id: number;
  orgId: number;
  runBy?: string;
  scope: "workspace" | "platform";
  score: number;
  status: "healthy" | "degraded" | "unhealthy";
  summary: string;
  modules: ModuleDiagnosticResult[];
  issues: DiagnosticIssue[];
  recommendations: DiagnosticRecommendation[];
  actionsTaken: string[];
  createdAt: string;
}

export interface DiagnosticContext {
  orgId: number;
  workspaceId?: number;
  scope: "workspace" | "platform";
  runBy?: string;
}

/**
 * Cada módulo nuevo (o existente) implementa esta interfaz.
 * Se registra en DiagnosticRegistry con su nombre de módulo.
 * El engine lo ejecuta automáticamente cuando se lanza un diagnóstico.
 */
export interface DiagnosticAdapter {
  /** Nombre del módulo: "infrastructure", "integrations", "crm", etc. */
  name: string;

  /** Ejecutar el diagnóstico completo de este módulo. */
  run(ctx: DiagnosticContext): Promise<ModuleDiagnosticResult>;

  /** Opcional: ejecutar una acción de corrección automática. */
  fix?(ctx: DiagnosticContext, action: FixAction, payload?: Record<string, unknown>): Promise<{ success: boolean; message: string }>;

  /** Opcional: prioridad de ejecución (menor = antes). Default 100. */
  priority?: number;
}
