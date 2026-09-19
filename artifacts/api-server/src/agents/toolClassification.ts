// "Puede leer" y "puede hacer" son permisos distintos: que una herramienta
// exista en el Skill Engine no significa que un agente pueda escribir con ella.
// La clasificación vive en el Tool Registry (toolRegistry.ts); una herramienta
// que no esté registrada no se considera de lectura.

import { getAgentTool } from "./toolRegistry";

export function isReadTool(toolId: string): boolean {
  return getAgentTool(toolId)?.kind === "read";
}
