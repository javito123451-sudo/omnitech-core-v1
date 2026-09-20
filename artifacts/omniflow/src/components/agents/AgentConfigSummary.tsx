import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { channelLabel } from "@/lib/agents/format";
import type { AgentConfig } from "@/lib/agents/types";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground whitespace-pre-wrap break-words">{children}</dd>
    </div>
  );
}

const text = (v: string | null | undefined) => (v && v.trim() ? v : "—");

function Chips({ items, empty = "—" }: { items: string[] | undefined; empty?: string }) {
  if (!items || items.length === 0) return <span className="text-muted-foreground">{empty}</span>;
  return <span className="flex flex-wrap gap-1.5">{items.map((i) => <Badge key={i} variant="outline">{i}</Badge>)}</span>;
}

function Section({ title, children, testId }: { title: string; children: ReactNode; testId: string }) {
  return (
    <Card data-testid={testId}>
      <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">{title}</CardTitle></CardHeader>
      <CardContent><dl className="grid gap-3 sm:grid-cols-2">{children}</dl></CardContent>
    </Card>
  );
}

/**
 * Configuración de una versión en solo lectura: exactamente los campos que guarda el backend (AgentConfig).
 * Los canales salen únicamente de `config.channels` de la versión mostrada.
 */
export function AgentConfigSummary({ config: cfg }: { config: AgentConfig }) {
  return (
    <div className="space-y-4">
      <Section title="Identidad y objetivo" testId="cfg-identity">
        <Field label="Rol">{text(cfg.identity?.role)}</Field>
        <Field label="Qué hace">{text(cfg.objective?.what)}</Field>
        <Field label="Audiencia">{text(cfg.objective?.audience)}</Field>
        <Field label="Resultado esperado">{text(cfg.objective?.expectedOutcome)}</Field>
      </Section>
      <Section title="Personalidad" testId="cfg-personality">
        <Field label="Tono">{text(cfg.personality?.tone)}</Field>
        <Field label="Estilo">{text(cfg.personality?.style)}</Field>
        <Field label="Idioma">{text(cfg.personality?.language)}</Field>
        <Field label="Formalidad">{text(cfg.personality?.formality)}</Field>
      </Section>
      <Section title="Comportamiento y contexto" testId="cfg-behavior">
        <Field label="Instrucciones">{text(cfg.behavior?.instructions)}</Field>
        <Field label="Contexto del negocio">{text(cfg.businessContext)}</Field>
        <Field label="Reglas"><Chips items={cfg.behavior?.rules} /></Field>
        <Field label="Restricciones"><Chips items={cfg.behavior?.restrictions} /></Field>
        <Field label="Evitar"><Chips items={cfg.behavior?.avoid} /></Field>
      </Section>
      <Section title="Modelo y parámetros" testId="cfg-model">
        <Field label="Proveedor">{text(cfg.model?.provider)}</Field>
        <Field label="Modelo">{text(cfg.model?.model)}</Field>
        <Field label="Temperatura">{String(cfg.parameters?.temperature ?? "—")}</Field>
        <Field label="Tokens máx. de salida">{String(cfg.parameters?.maxOutputTokens ?? "—")}</Field>
        <Field label="Rondas de herramientas">{String(cfg.parameters?.maxToolRounds ?? "—")}</Field>
        <Field label="Mensajes de historial">{String(cfg.parameters?.maxHistoryMessages ?? "—")}</Field>
      </Section>
      <Section title="Conocimiento, herramientas y permisos" testId="cfg-tools">
        <Field label="Conocimiento del workspace">{cfg.knowledge?.workspace ? "Todo el conocimiento activo" : "Solo entradas seleccionadas"}</Field>
        <Field label="Categorías"><Chips items={cfg.knowledge?.categories} /></Field>
        <Field label="Herramientas de lectura"><Chips items={cfg.tools?.read} /></Field>
        <Field label="Herramientas de acción"><Chips items={cfg.tools?.write} /></Field>
        <Field label="Las acciones piden confirmación">{cfg.permissions?.writesRequireConfirmation === false ? "No" : "Sí"}</Field>
      </Section>
      <Section title="Canales" testId="cfg-channels">
        <Field label="Canales de esta versión"><Chips items={cfg.channels?.map(channelLabel)} empty="Ninguno" /></Field>
      </Section>
    </div>
  );
}
