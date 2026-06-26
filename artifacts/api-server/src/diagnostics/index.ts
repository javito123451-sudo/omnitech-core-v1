/**
 * Omni Diagnostics — Public API
 * Exporta el engine, el registry y los tipos.
 * Los adaptadores se auto-registran al importarse.
 */
export { DiagnosticEngine } from "./diagnosticEngine";
export { DiagnosticRegistry } from "./diagnosticRegistry";
export type {
  DiagnosticAdapter,
  DiagnosticContext,
  DiagnosticReport,
  ModuleDiagnosticResult,
  DiagnosticIssue,
  DiagnosticRecommendation,
  DiagnosticCheck,
  DiagnosticSeverity,
  DiagnosticStatus,
  FixAction,
} from "./types";

// Auto-register adapters
import "./adapters/infrastructureAdapter";
import "./adapters/integrationAdapter";
import "./adapters/aiAdapter";
import "./adapters/crmAdapter";
import "./adapters/securityAdapter";
