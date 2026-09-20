import { Badge } from "@/components/ui/badge";
import { countChanges, diffVersions, type ChangeKind, type FieldChange } from "@/lib/agents/versionDiff";
import type { AgentVersion } from "@/lib/agents/types";

const KIND_LABEL: Record<ChangeKind, string> = { added: "Añadido", removed: "Eliminado", modified: "Modificado", reordered: "Orden cambiado" };
const KIND_STYLE: Record<ChangeKind, string> = {
  added: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  removed: "border-rose-500/30 bg-rose-500/10 text-rose-400",
  modified: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  reordered: "border-sky-500/30 bg-sky-500/10 text-sky-400",
};

function Change({ c, sectionId }: { c: FieldChange; sectionId: string }) {
  return (
    <li className="space-y-1 py-2" data-testid={`diff-change-${sectionId}`} data-kind={c.kind} data-label={c.label}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">{c.label}</span>
        <Badge variant="outline" className={KIND_STYLE[c.kind]}>{KIND_LABEL[c.kind]}</Badge>
      </div>
      {(c.before !== null || c.after !== null) && (
        <div className="grid gap-1 text-xs sm:grid-cols-2">
          {c.before !== null && <p className="whitespace-pre-wrap break-words rounded bg-rose-500/5 px-2 py-1 text-muted-foreground" data-testid="diff-before"><span className="font-semibold">Antes: </span>{c.before}</p>}
          {c.after !== null && <p className="whitespace-pre-wrap break-words rounded bg-emerald-500/5 px-2 py-1 text-foreground" data-testid="diff-after"><span className="font-semibold">Ahora: </span>{c.after}</p>}
        </div>
      )}
      {(c.addedItems.length > 0 || c.removedItems.length > 0) && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {c.addedItems.map((i) => <Badge key={`a-${i}`} variant="outline" className={KIND_STYLE.added} data-testid="diff-item-added">+ {i}</Badge>)}
          {c.removedItems.map((i) => <Badge key={`r-${i}`} variant="outline" className={KIND_STYLE.removed} data-testid="diff-item-removed">− {i}</Badge>)}
        </div>
      )}
    </li>
  );
}

/** Cambios entre dos versiones reales (de `from` a `to`), por sección. Sin `from` no hay nada con lo que comparar. */
export function VersionDiff({ from, to }: { from: AgentVersion | null; to: AgentVersion }) {
  if (!from) {
    return <p className="text-sm text-muted-foreground" data-testid="diff-no-base">No hay otra versión con la que comparar.</p>;
  }
  const diff = diffVersions(from.config, to.config);
  const total = countChanges(diff);
  return (
    <div className="space-y-3" data-testid="version-diff">
      <p className="text-sm font-medium text-foreground" data-testid="diff-summary">
        v{from.versionNumber} → v{to.versionNumber}: {total === 0 ? "Sin cambios" : `${total} ${total === 1 ? "cambio" : "cambios"}`}
      </p>
      {diff.map((s) => (
        <div key={s.id} className="rounded-lg border border-border p-3" data-testid={`diff-section-${s.id}`} data-changes={s.changes.length}>
          <p className="text-sm font-semibold text-foreground">{s.title}</p>
          {s.changes.length === 0
            ? <p className="text-xs text-muted-foreground" data-testid={`diff-empty-${s.id}`}>Sin cambios</p>
            : <ul className="divide-y divide-border">{s.changes.map((c) => <Change key={c.label} c={c} sectionId={s.id} />)}</ul>}
        </div>
      ))}
    </div>
  );
}
