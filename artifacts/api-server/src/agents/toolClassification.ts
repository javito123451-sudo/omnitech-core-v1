// "Puede leer" y "puede hacer" son permisos distintos: que una herramienta
// exista en el Skill Engine no significa que un agente pueda escribir con ella.
// Sin esta clasificación, listar `create_task` en la lista de lectura le daría
// escritura a un agente por la puerta de atrás — por eso se valida al publicar.
//
// Las skills de solo lectura del catálogo siguen la convención get_* / list_*
// (más accounting_summary). Todo lo demás se trata como escritura.

const READ_TOOL = /^(get|list)_|^accounting_summary$/;

export function isReadTool(toolId: string): boolean {
  return READ_TOOL.test(toolId);
}
