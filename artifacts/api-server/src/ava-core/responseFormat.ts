// ═══════════════════════════════════════════════════════════════════════════
//  AVA CORE — response format
//  Forces every answer through observado → análisis → hipótesis →
//  recomendación. Enforced by making it the ONLY way for the model to end
//  the tool-calling loop: the engine sets toolChoice to force this function
//  once it decides the model has gathered enough data.
// ═══════════════════════════════════════════════════════════════════════════

import type { ToolDefinition } from "../ai/types";
import type { AvaStructuredAnswer } from "./types";

export const PRESENT_FINDINGS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "present_findings",
    description:
      "Entrega la respuesta final al usuario, estructurada en observado/análisis/hipótesis/recomendación. " +
      "Debes llamar a esta función para terminar — nunca respondas en texto libre sin ella.",
    parameters: {
      type: "object",
      properties: {
        observed: {
          type: "string",
          description: "Qué datos reales se obtuvieron de las herramientas (hechos, sin interpretar).",
        },
        analysis: {
          type: "string",
          description: "Qué significan esos datos (interpretación).",
        },
        hypothesis: {
          type: "string",
          description: "Explicación probable de la causa, si aplica. Opcional.",
        },
        recommendation: {
          type: "string",
          description: "Qué acción concreta se sugiere, si aplica. Opcional.",
        },
      },
      required: ["observed", "analysis"],
    },
  },
};

export function parsePresentFindingsArgs(argsJson: string): AvaStructuredAnswer {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(argsJson);
  } catch {
    return { observed: argsJson, analysis: "" };
  }
  return {
    observed:       String(parsed["observed"] ?? ""),
    analysis:       String(parsed["analysis"] ?? ""),
    hypothesis:     parsed["hypothesis"]      != null ? String(parsed["hypothesis"])      : undefined,
    recommendation: parsed["recommendation"]  != null ? String(parsed["recommendation"])  : undefined,
  };
}
