import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Save, Undo2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { AgentStatusBadge } from "@/components/agents/AgentStatusBadge";
import { ApiErrorAlert } from "@/components/agents/ApiErrorAlert";
import { UnsavedChangesDialog } from "@/components/agents/UnsavedChangesDialog";
import { errorIssues } from "@/lib/agents/agentErrors";
import {
  PARAM_LIMITS, buildPayload, isDirty, mapIssues, toBuilderValues, validate, type BuilderErrors, type BuilderValues,
} from "@/lib/agents/builder";
import { channelLabel } from "@/lib/agents/format";
import { PartialSaveError, useSaveAgent } from "@/lib/agents/hooks";
import { useUnsavedChangesGuard } from "@/lib/agents/useUnsavedChangesGuard";
import { AGENT_CHANNELS, type Agent, type AgentChannel, type AgentVersion } from "@/lib/agents/types";

type StringField = Exclude<keyof BuilderValues, "channels">;

function Section({ title, hint, children, testId }: { title: string; hint?: string; children: ReactNode; testId: string }) {
  return (
    <Card data-testid={testId}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">{children}</CardContent>
    </Card>
  );
}

interface FieldProps { id: string; label: string; error?: string; hint?: string; wide?: boolean; children: ReactNode }
function Field({ id, label, error, hint, wide, children }: FieldProps) {
  return (
    <div className={wide ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive" role="alert" data-testid={`error-${id}`}>{error}</p>}
    </div>
  );
}

/**
 * Editor del borrador (solo lectura de model/knowledge/tools/permissions: sin catálogo ni UI soportados todavía).
 * Guarda con PUT /:id/draft (secciones de configuración) y PATCH /:id (nombre, descripción, avatar), enviando solo
 * lo que cambió. Nunca publica ni ejecuta nada.
 */
export function AgentConfigForm({ agent, versions, onDraftChanged, onDirtyChange }: {
  agent: Agent;
  versions: AgentVersion[];
  /** El borrador cambió en el servidor por un guardado de esta pantalla (para invalidar simulaciones anteriores). */
  onDraftChanged?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  // Misma base que usa el backend (saveDraft): el borrador si existe; si no, la última versión.
  const draft = versions.find((v) => v.publishedAt === null) ?? null;
  const base = draft ?? versions[0] ?? null;
  const nextVersion = (versions[0]?.versionNumber ?? 0) + 1;

  const serverValues = useMemo(() => toBuilderValues(agent, base?.config), [agent, base]);
  const serverKey = useMemo(() => `${base?.id ?? "none"}|${JSON.stringify(serverValues)}`, [base, serverValues]);

  const [baseline, setBaseline] = useState<BuilderValues>(serverValues);
  const [values, setValues] = useState<BuilderValues>(serverValues);
  const [clientErrors, setClientErrors] = useState<BuilderErrors>({});
  const [serverErrors, setServerErrors] = useState<BuilderErrors>({});
  const [otherIssues, setOtherIssues] = useState<string[]>([]);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const submitting = useRef(false);
  const { toast } = useToast();
  const save = useSaveAgent(agent.id);

  const dirty = isDirty(values, baseline);
  const guard = useUnsavedChangesGuard(dirty);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  // El servidor trae datos nuevos (tras guardar, o cambios de otra persona): se recarga el formulario solo si no hay
  // cambios sin guardar; si los hay, se avisa y nunca se pisan en silencio.
  const lastKey = useRef(serverKey);
  useEffect(() => {
    if (lastKey.current === serverKey) return;
    lastKey.current = serverKey;
    if (!isDirty(values, baseline)) { setBaseline(serverValues); setValues(serverValues); setStale(false); }
    else setStale(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);

  const errors: BuilderErrors = { ...serverErrors, ...clientErrors };

  function set<K extends keyof BuilderValues>(key: K, value: BuilderValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    setClientErrors((e) => { const { [key]: _drop, ...rest } = e; return rest; });
    setServerErrors((e) => { const { [key]: _drop, ...rest } = e; return rest; });
    setLastSaved(null);
  }

  function setStr(key: StringField, value: string) { set(key, value); }

  function revert() {
    setValues(baseline);
    setClientErrors({}); setServerErrors({}); setOtherIssues([]); setLastSaved(null);
    save.reset();
  }

  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (submitting.current || save.isPending || !dirty) return;

    const found = validate(values);
    setClientErrors(found);
    if (Object.keys(found).length > 0) return;

    const payload = buildPayload(values, baseline);
    if (!payload.meta && !payload.config) return;

    submitting.current = true;
    setServerErrors({}); setOtherIssues([]); setLastSaved(null);
    const snapshot = values;
    save.mutate(payload, {
      onSuccess: ({ version }) => {
        setBaseline(snapshot);
        setStale(false);
        if (version) onDraftChanged?.();
        const message = !version
          ? "Datos del agente guardados."
          : draft ? `Borrador v${version.versionNumber} actualizado.` : `Nueva versión v${version.versionNumber} creada como borrador.`;
        setLastSaved(message);
        toast({ title: "Cambios guardados", description: message });
      },
      onError: (err) => {
        const cause = err instanceof PartialSaveError ? err.cause : err;
        if (err instanceof PartialSaveError) {
          // La configuración ya está guardada: solo queda pendiente lo de PATCH (nombre, descripción, avatar).
          setBaseline((b) => ({ ...snapshot, name: b.name, description: b.description, avatarUrl: b.avatarUrl }));
        }
        const { fields, other } = mapIssues(errorIssues(cause));
        setServerErrors(fields);
        setOtherIssues(other);
      },
      onSettled: () => { submitting.current = false; },
    });
  }

  const saveError = save.isError ? (save.error instanceof PartialSaveError ? save.error.cause : save.error) : null;
  const partial = save.error instanceof PartialSaveError;

  const target = draft
    ? `Editando el borrador v${draft.versionNumber}`
    : versions.length === 0
      ? "Al guardar se creará la versión v1 (borrador)"
      : `Al guardar se creará la versión v${nextVersion} como borrador; la versión publicada no cambia`;

  const text = (id: string, field: StringField, label: string, opts: { wide?: boolean; hint?: string; type?: string } = {}) => (
    <Field id={id} label={label} error={errors[field]} hint={opts.hint} wide={opts.wide}>
      <Input id={id} type={opts.type ?? "text"} value={values[field]} onChange={(e) => setStr(field, e.target.value)} aria-invalid={!!errors[field]} />
    </Field>
  );
  const area = (id: string, field: StringField, label: string, opts: { rows?: number; hint?: string } = {}) => (
    <Field id={id} label={label} error={errors[field]} hint={opts.hint} wide>
      <Textarea id={id} rows={opts.rows ?? 3} value={values[field]} onChange={(e) => setStr(field, e.target.value)} aria-invalid={!!errors[field]} />
    </Field>
  );
  const num = (id: string, field: StringField, label: string, lim: { min: number; max: number; integer: boolean }) => (
    <Field id={id} label={label} error={errors[field]} hint={`Entre ${lim.min} y ${lim.max}${lim.integer ? " (entero)" : ""}.`}>
      <Input id={id} type="number" step={lim.integer ? 1 : 0.1} min={lim.min} max={lim.max} value={values[field]}
        onChange={(e) => setStr(field, e.target.value)} aria-invalid={!!errors[field]} />
    </Field>
  );

  function toggleChannel(c: AgentChannel, on: boolean) {
    set("channels", on ? [...values.channels, c] : values.channels.filter((x) => x !== c));
  }

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="config-form" noValidate>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3" data-testid="builder-header">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <AgentStatusBadge status={agent.status} />
          <span className="text-sm text-muted-foreground" data-testid="builder-target">{target}</span>
          {dirty && <span className="text-xs font-medium text-amber-400" data-testid="dirty-indicator">Cambios sin guardar</span>}
        </div>
        <Button type="submit" data-testid="save-draft-button" disabled={!dirty || save.isPending}>
          <Save className="h-4 w-4 mr-1.5" /> {save.isPending ? "Guardando…" : "Guardar borrador"}
        </Button>
      </div>

      {lastSaved && !dirty && (
        <Alert data-testid="save-result"><AlertTitle>Guardado</AlertTitle><AlertDescription>{lastSaved} Ya puedes probarlo con la simulación; no se ha publicado nada.</AlertDescription></Alert>
      )}
      {stale && (
        <Alert data-testid="stale-warning">
          <AlertTitle>El borrador ha cambiado en el servidor</AlertTitle>
          <AlertDescription>Otra persona (u otra pestaña) lo modificó. Tus cambios siguen aquí; al guardar sobrescribirán esas secciones.</AlertDescription>
        </Alert>
      )}
      {saveError && (
        <div className="space-y-2" data-testid="save-error">
          {partial && (
            <Alert><AlertTitle>Guardado a medias</AlertTitle>
              <AlertDescription>La configuración del borrador sí se guardó, pero no se pudieron guardar el nombre, la descripción o el avatar. Inténtalo de nuevo.</AlertDescription></Alert>
          )}
          <ApiErrorAlert error={saveError} />
          {otherIssues.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-destructive" data-testid="error-issues">{otherIssues.map((i) => <li key={i}>{i}</li>)}</ul>
          )}
        </div>
      )}

      <Section title="Identidad" hint="El nombre, la descripción y el avatar pertenecen al agente; el rol, a la versión." testId="form-identity">
        {text("f-name", "name", "Nombre")}
        {text("f-role", "identityRole", "Rol")}
        {area("f-description", "description", "Descripción", { rows: 2 })}
        {text("f-avatar", "avatarUrl", "URL del avatar (opcional)", { wide: true })}
      </Section>

      <Section title="Objetivo" testId="form-objective">
        {area("f-what", "objectiveWhat", "Qué hace el agente", { rows: 2 })}
        {text("f-audience", "objectiveAudience", "Audiencia")}
        {text("f-outcome", "objectiveExpectedOutcome", "Resultado esperado")}
      </Section>

      <Section title="Personalidad" testId="form-personality">
        {text("f-tone", "personalityTone", "Tono")}
        {text("f-style", "personalityStyle", "Estilo")}
        {text("f-language", "personalityLanguage", "Idioma")}
        {text("f-formality", "personalityFormality", "Formalidad")}
      </Section>

      <Section title="Comportamiento" testId="form-behavior">
        {area("f-instructions", "behaviorInstructions", "Instrucciones", { rows: 5 })}
        {area("f-rules", "behaviorRules", "Reglas", { hint: "Una por línea." })}
        {area("f-restrictions", "behaviorRestrictions", "Restricciones", { hint: "Una por línea." })}
        {area("f-avoid", "behaviorAvoid", "Evitar", { hint: "Una por línea." })}
      </Section>

      <Section title="Empresa y contexto" testId="form-context">
        {area("f-context", "businessContext", "Contexto del negocio", { rows: 4 })}
      </Section>

      <Section title="Parámetros" hint="Límites de ejecución de esta versión." testId="form-parameters">
        {num("f-temperature", "paramTemperature", "Temperatura", PARAM_LIMITS.temperature)}
        {num("f-max-output", "paramMaxOutputTokens", "Tokens máximos de salida", PARAM_LIMITS.maxOutputTokens)}
        {num("f-tool-rounds", "paramMaxToolRounds", "Rondas de herramientas", PARAM_LIMITS.maxToolRounds)}
        {num("f-history", "paramMaxHistoryMessages", "Mensajes de historial", PARAM_LIMITS.maxHistoryMessages)}
      </Section>

      <Section title="Canales" hint="Solo declara en qué canales debe poder usarse la versión. Los bots actuales de Telegram y WhatsApp todavía no usan estos agentes." testId="form-channels">
        <div className="sm:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-2" role="group" aria-label="Canales">
          {AGENT_CHANNELS.map((c) => (
            <div key={c} className="flex items-center gap-2">
              <Checkbox id={`ch-${c}`} checked={values.channels.includes(c)} onCheckedChange={(on) => toggleChannel(c, on === true)} />
              <Label htmlFor={`ch-${c}`} className="font-normal">{channelLabel(c)}</Label>
            </div>
          ))}
          {errors.channels && <p className="col-span-full text-xs text-destructive" role="alert" data-testid="error-channels">{errors.channels}</p>}
        </div>
      </Section>

      <p className="text-xs text-muted-foreground" data-testid="readonly-note">
        Modelo, conocimiento, herramientas y permisos de acciones no se pueden editar todavía: se muestran en «Configuración actual».
      </p>

      {dirty && (
        <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-background/95 p-3 backdrop-blur" data-testid="unsaved-bar">
          <span className="text-sm text-amber-400">Cambios sin guardar</span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" data-testid="cancel-button" onClick={revert} disabled={save.isPending}>
              <Undo2 className="h-4 w-4 mr-1.5" /> Cancelar
            </Button>
            <Button type="submit" data-testid="save-draft-button-bar" disabled={save.isPending}>
              {save.isPending ? "Guardando…" : "Guardar borrador"}
            </Button>
          </div>
        </div>
      )}

      <UnsavedChangesDialog open={guard.confirmingLeave} onStay={guard.stay} onLeave={guard.leave} />
    </form>
  );
}
