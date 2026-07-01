/**
 * CreativeStudio — OmniAds AI Creative Generation
 *
 * Architecture:
 *  - AICreativeService: singleton con adapter pattern intercambiable.
 *    Registrar un proveedor real vía AICreativeService.setAdapter(adapter).
 *    Compatible con: OpenAI DALL-E, Google Veo, Runway, Luma, Pika, Kling,
 *    Hailuo, Minimax, Fal AI, Replicate — a través de AICreativeAdapter.
 *
 * Componentes exportados:
 *  - CreativeGeneratorModal  — modal con campos específicos por tipo
 *  - CreativeProgress        — barra de progreso animada con pasos
 *  - CreativeResult          — tarjeta de resultado con acciones
 *  - CreativeHistory         — historial paginado de creativos
 */

import { useState, useEffect, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useToast } from "@/hooks/use-toast";
import {
  X, Sparkles, Image, Video, Layout, Film, MonitorPlay, Mail,
  CheckCircle2, AlertCircle, Eye, Download, Edit3, Send, Copy,
  Trash2, Loader2,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─────────────────────────────────────────────────────────────────────────────
// TypeScript Interfaces — preparadas para futuras integraciones de IA
// ─────────────────────────────────────────────────────────────────────────────

export type CreativeType = "image" | "video" | "carousel" | "reel" | "story" | "email";
export type GenerationStatus = "idle" | "loading" | "success" | "error";

export interface BaseCreativeRequest {
  type:        CreativeType;
  objective:   string;
  product:     string;
  audience:    string;
  platform:    string;
  language:    string;
  cta:         string;
  campaignId?: number;
}

export interface VideoGenerationRequest extends BaseCreativeRequest {
  type:     "video" | "reel" | "story";
  duration: string;
  style:    string;
}

export interface ImageGenerationRequest extends BaseCreativeRequest {
  type:   "image";
  format: string;
  style:  string;
}

export interface CarouselGenerationRequest extends BaseCreativeRequest {
  type:       "carousel";
  slideCount: string;
  theme:      string;
}

export interface EmailGenerationRequest extends BaseCreativeRequest {
  type:    "email";
  subject: string;
  tone:    string;
}

export type CreativeGenerationRequest =
  | VideoGenerationRequest
  | ImageGenerationRequest
  | CarouselGenerationRequest
  | EmailGenerationRequest;

export interface CreativeGenerationResult {
  id:           number;
  type:         CreativeType;
  status:       "ready" | "error";
  previewUrl:   string | null;
  downloadUrl:  string | null;
  thumbnail:    string | null;
  provider:     string;
  createdAt:    string;
  title:        string;
  campaignId:   number | null;
  errorMessage?: string;
}

export interface StoredCreative {
  id:                number;
  campaign_id:       number | null;
  org_id:            number;
  type:              string;
  platform:          string | null;
  title:             string | null;
  content:           Record<string, unknown>;
  status:            "draft" | "ready" | "published";
  generation_status: string;
  preview_url:       string | null;
  download_url:      string | null;
  thumbnail:         string | null;
  provider_name:     string | null;
  created_at:        string;
}

// ─────────────────────────────────────────────────────────────────────────────
// AICreativeService — adapter pattern, proveedor intercambiable
// ─────────────────────────────────────────────────────────────────────────────

export interface AICreativeAdapter {
  readonly providerName: string;
  /**
   * Genera el creativo. Actualmente mock — conectar con:
   * OpenAI DALL-E, Google Veo, Runway, Luma, Pika, Kling,
   * Hailuo, Minimax, Fal AI, Replicate
   */
  generate(req: CreativeGenerationRequest): Promise<{
    previewUrl:  string | null;
    downloadUrl: string | null;
    thumbnail:   string | null;
  }>;
}

const mockAdapter: AICreativeAdapter = {
  providerName: "mock",
  async generate(_req) {
    await new Promise(r => setTimeout(r, 100));
    return { previewUrl: null, downloadUrl: null, thumbnail: null };
  },
};

class _AICreativeService {
  private adapter: AICreativeAdapter = mockAdapter;

  /** Intercambiar proveedor de IA — llamar al inicio de la app */
  setAdapter(adapter: AICreativeAdapter) { this.adapter = adapter; }

  getProviderName(): string { return this.adapter.providerName; }

  async generate(req: CreativeGenerationRequest) {
    return this.adapter.generate(req);
  }
}

/** Servicio singleton — importar y llamar setAdapter() para cambiar proveedor */
export const AICreativeService = new _AICreativeService();

// ─────────────────────────────────────────────────────────────────────────────
// Configuración por tipo
// ─────────────────────────────────────────────────────────────────────────────

type FieldKey =
  | "objective" | "product" | "audience" | "platform" | "language" | "cta"
  | "duration"  | "style"   | "format"   | "slideCount" | "theme"
  | "subject"   | "tone";

interface TypeConfig {
  title:    string;
  btnLabel: string;
  gradient: string;
  icon:     React.ElementType;
  fields:   FieldKey[];
}

const TYPE_CONFIG: Record<CreativeType, TypeConfig> = {
  video: {
    title: "Crear vídeo con IA", btnLabel: "Generar vídeo",
    gradient: "from-purple-600 to-blue-600", icon: Video,
    fields: ["objective", "product", "audience", "platform", "duration", "style", "language", "cta"],
  },
  image: {
    title: "Crear imagen con IA", btnLabel: "Generar imagen",
    gradient: "from-blue-600 to-cyan-600", icon: Image,
    fields: ["objective", "product", "audience", "platform", "format", "style", "language", "cta"],
  },
  carousel: {
    title: "Crear carrusel con IA", btnLabel: "Generar carrusel",
    gradient: "from-pink-600 to-purple-600", icon: Layout,
    fields: ["objective", "product", "audience", "platform", "slideCount", "theme", "language", "cta"],
  },
  reel: {
    title: "Crear reel con IA", btnLabel: "Generar reel",
    gradient: "from-pink-600 to-red-600", icon: Film,
    fields: ["objective", "product", "audience", "platform", "duration", "style", "language", "cta"],
  },
  story: {
    title: "Crear story con IA", btnLabel: "Generar story",
    gradient: "from-amber-600 to-orange-600", icon: MonitorPlay,
    fields: ["objective", "product", "audience", "platform", "duration", "language", "cta"],
  },
  email: {
    title: "Crear email con IA", btnLabel: "Generar email",
    gradient: "from-emerald-600 to-teal-600", icon: Mail,
    fields: ["objective", "product", "audience", "subject", "tone", "language", "cta"],
  },
};

const PROGRESS_STEPS = [
  "Analizando negocio...",
  "Creando estrategia...",
  "Generando guion...",
  "Preparando prompts IA...",
  "Conectando con proveedor...",
];

const TYPE_LABELS: Record<CreativeType, string> = {
  video: "Vídeo", image: "Imagen", carousel: "Carrusel",
  reel: "Reel", story: "Story", email: "Email",
};

const STEP_MS = 620;
const TOTAL_MS = PROGRESS_STEPS.length * STEP_MS + 400;

// ─────────────────────────────────────────────────────────────────────────────
// Shared small UI helpers
// ─────────────────────────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-slate-400 mb-1.5">{children}</label>;
}

function FieldInput({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-[#0d1320] border border-[#1e2d40] rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500 transition-colors"
    />
  );
}

function FieldSelect({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-[#0d1320] border border-[#1e2d40] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors appearance-none cursor-pointer"
    >
      <option value="">Seleccionar...</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function RadioGroup({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            value === o.value
              ? "bg-blue-600 border-blue-500 text-white"
              : "bg-[#0d1320] border-[#1e2d40] text-slate-400 hover:border-blue-500/50 hover:text-slate-200"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CreativeProgress — barra de progreso animada con pasos
// ─────────────────────────────────────────────────────────────────────────────

export function CreativeProgress({ currentStep, type }: { currentStep: number; type: CreativeType }) {
  const config = TYPE_CONFIG[type];
  const pct = Math.min(100, Math.round(((currentStep + 1) / PROGRESS_STEPS.length) * 100));

  return (
    <div className="py-8 px-2 space-y-6">
      {/* Spinner icon */}
      <div className="flex justify-center">
        <div className="relative w-16 h-16">
          <div className="w-16 h-16 border-2 border-slate-700 rounded-full" />
          <div className="absolute inset-0 w-16 h-16 border-2 border-t-blue-500 border-r-blue-500 border-transparent rounded-full animate-spin" />
          <Sparkles className="absolute inset-0 m-auto text-blue-400" size={22} />
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-xs text-slate-500 mb-1.5">
          <span>Generando {TYPE_LABELS[type].toLowerCase()}…</span>
          <span>{pct}%</span>
        </div>
        <div className="w-full h-1.5 bg-[#1e2d40] rounded-full overflow-hidden">
          <div
            className={`h-full bg-gradient-to-r ${config.gradient} rounded-full transition-all duration-700`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Steps */}
      <ul className="space-y-2">
        {PROGRESS_STEPS.map((step, i) => (
          <li key={i} className={`flex items-center gap-2.5 text-sm transition-colors ${
            i < currentStep  ? "text-emerald-400" :
            i === currentStep ? "text-white" :
            "text-slate-600"
          }`}>
            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              i < currentStep  ? "bg-emerald-400" :
              i === currentStep ? "bg-blue-400 shadow-[0_0_6px_#3b82f6]" :
              "bg-slate-700"
            }`} />
            {i === currentStep ? (
              <span className="flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin text-blue-400" />
                {step}
              </span>
            ) : step}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CreativeResult — tarjeta de éxito con botones de acción
// ─────────────────────────────────────────────────────────────────────────────

export function CreativeResult({
  result,
  type,
  onEdit,
  onClose,
}: {
  result: CreativeGenerationResult;
  type:   CreativeType;
  onEdit: () => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const config = TYPE_CONFIG[type];
  const Icon = config.icon;

  const publishMut = useMutation({
    mutationFn: () =>
      authFetch(`${BASE}/api/ads/creatives/${result.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "published" }),
      }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Creativo publicado" });
      qc.invalidateQueries({ queryKey: ["ads-creatives"] });
    },
  });

  const duplicateMut = useMutation({
    mutationFn: () =>
      authFetch(`${BASE}/api/ads/creatives`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: result.campaignId ?? undefined,
          type,
          platform: null,
          title: `${result.title} (copia)`,
          content: {},
        }),
      }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Creativo duplicado" });
      qc.invalidateQueries({ queryKey: ["ads-creatives"] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: () =>
      authFetch(`${BASE}/api/ads/creatives/${result.id}`, { method: "DELETE" }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Creativo eliminado" });
      qc.invalidateQueries({ queryKey: ["ads-creatives"] });
      onClose();
    },
  });

  return (
    <div className="py-4 space-y-4">
      {/* Success badge */}
      <div className="flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/25 rounded-lg">
        <CheckCircle2 className="text-emerald-400 shrink-0" size={16} />
        <span className="text-sm text-emerald-300 font-medium">{TYPE_LABELS[type]} generado correctamente</span>
      </div>

      {/* Thumbnail / Preview */}
      <div className={`w-full h-36 rounded-xl bg-gradient-to-br ${config.gradient} flex flex-col items-center justify-center gap-2 relative overflow-hidden`}>
        <div className="absolute inset-0 opacity-20 bg-[repeating-linear-gradient(45deg,#fff_0,#fff_1px,transparent_0,transparent_50%)] bg-[length:12px_12px]" />
        <Icon size={36} className="text-white/80 relative z-10" />
        <span className="text-xs text-white/70 relative z-10 font-medium">
          {result.provider === "mock" ? "Vista previa disponible con IA real" : result.provider}
        </span>
      </div>

      {/* Title */}
      <div>
        <p className="text-white font-semibold text-sm">{result.title}</p>
        <p className="text-[11px] text-slate-500 mt-0.5">
          {new Date(result.createdAt).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}
          {" · "}
          <span className="text-slate-400">{TYPE_LABELS[type]}</span>
        </p>
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => toast({ title: "Vista previa", description: "Disponible al conectar proveedor de IA" })}
          className="flex flex-col items-center gap-1 py-2.5 bg-[#1e2d40] hover:bg-[#253449] rounded-xl text-xs text-slate-300 hover:text-white transition-colors"
        >
          <Eye size={15} /> Ver
        </button>
        <button
          onClick={onEdit}
          className="flex flex-col items-center gap-1 py-2.5 bg-[#1e2d40] hover:bg-[#253449] rounded-xl text-xs text-slate-300 hover:text-white transition-colors"
        >
          <Edit3 size={15} /> Editar
        </button>
        <button
          onClick={() => toast({ title: "Descarga", description: "Disponible al conectar proveedor de IA" })}
          className="flex flex-col items-center gap-1 py-2.5 bg-[#1e2d40] hover:bg-[#253449] rounded-xl text-xs text-slate-300 hover:text-white transition-colors"
        >
          <Download size={15} /> Descargar
        </button>
        <button
          onClick={() => publishMut.mutate()}
          disabled={publishMut.isPending}
          className="flex flex-col items-center gap-1 py-2.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-600/30 rounded-xl text-xs text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-50"
        >
          <Send size={15} /> Publicar
        </button>
        <button
          onClick={() => duplicateMut.mutate()}
          disabled={duplicateMut.isPending}
          className="flex flex-col items-center gap-1 py-2.5 bg-[#1e2d40] hover:bg-[#253449] rounded-xl text-xs text-slate-300 hover:text-white transition-colors disabled:opacity-50"
        >
          <Copy size={15} /> Duplicar
        </button>
        <button
          onClick={() => deleteMut.mutate()}
          disabled={deleteMut.isPending}
          className="flex flex-col items-center gap-1 py-2.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-xl text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
        >
          <Trash2 size={15} /> Eliminar
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Form state
// ─────────────────────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  objective: "", product: "", audience: "", platform: "",
  language: "Español", cta: "", duration: "15", style: "",
  format: "1:1", slideCount: "5", theme: "", subject: "", tone: "Profesional",
};

type FormState = typeof EMPTY_FORM;

// ─────────────────────────────────────────────────────────────────────────────
// CreativeGeneratorModal — modal principal con campos por tipo
// ─────────────────────────────────────────────────────────────────────────────

export function CreativeGeneratorModal({
  type,
  campaignId,
  onClose,
}: {
  type:        CreativeType;
  campaignId?: number | null;
  onClose:     () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const config  = TYPE_CONFIG[type];
  const Icon    = config.icon;

  const [status,      setStatus]      = useState<GenerationStatus>("idle");
  const [form,        setForm]        = useState<FormState>(EMPTY_FORM);
  const [progressStep,setProgressStep]= useState(0);
  const [result,      setResult]      = useState<CreativeGenerationResult | null>(null);
  const [errorMsg,    setErrorMsg]    = useState("");

  const has = useCallback((f: FieldKey) => config.fields.includes(f), [config.fields]);

  const buildTitle = (): string => {
    const base = form.product.trim() || form.objective || TYPE_LABELS[type];
    return `${TYPE_LABELS[type]} — ${base}`;
  };

  const buildRequest = (): CreativeGenerationRequest => {
    const base: BaseCreativeRequest = {
      type, objective: form.objective, product: form.product,
      audience: form.audience, platform: form.platform,
      language: form.language, cta: form.cta,
      ...(campaignId ? { campaignId } : {}),
    };
    if (type === "image")    return { ...base, type, format: form.format, style: form.style } as ImageGenerationRequest;
    if (type === "carousel") return { ...base, type, slideCount: form.slideCount, theme: form.theme } as CarouselGenerationRequest;
    if (type === "email")    return { ...base, type, subject: form.subject, tone: form.tone } as EmailGenerationRequest;
    return { ...base, type, duration: form.duration, style: form.style } as VideoGenerationRequest;
  };

  const handleGenerate = async () => {
    if (!form.product.trim() && !form.objective) {
      toast({ title: "Completa el formulario", description: "Indica el producto/servicio y objetivo", variant: "destructive" });
      return;
    }
    setStatus("loading");
    setProgressStep(0);
    setErrorMsg("");

    let step = 0;
    const timer = setInterval(() => {
      step++;
      if (step >= PROGRESS_STEPS.length) { clearInterval(timer); return; }
      setProgressStep(step);
    }, STEP_MS);

    try {
      await new Promise(r => setTimeout(r, TOTAL_MS));
      clearInterval(timer);

      const reqParams  = buildRequest();
      const aiResult   = await AICreativeService.generate(reqParams);
      const titleStr   = buildTitle();

      const res = await authFetch(`${BASE}/api/ads/creatives`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId:   campaignId ?? undefined,
          type,
          platform:     form.platform || null,
          title:        titleStr,
          content: {
            request:    reqParams,
            previewUrl: aiResult.previewUrl,
            downloadUrl:aiResult.downloadUrl,
            thumbnail:  aiResult.thumbnail,
            provider:   AICreativeService.getProviderName(),
          },
        }),
      });
      const data = await res.json() as { ok?: boolean; creative?: StoredCreative; error?: string };
      if (!res.ok || !data.creative) throw new Error(data.error ?? "Error al crear creativo");

      setResult({
        id:          data.creative.id,
        type,
        status:      "ready",
        previewUrl:  aiResult.previewUrl,
        downloadUrl: aiResult.downloadUrl,
        thumbnail:   aiResult.thumbnail,
        provider:    AICreativeService.getProviderName(),
        createdAt:   data.creative.created_at,
        title:       titleStr,
        campaignId:  campaignId ?? null,
      });
      setStatus("success");
      qc.invalidateQueries({ queryKey: ["ads-creatives"] });
    } catch (err) {
      clearInterval(timer);
      setErrorMsg(String(err));
      setStatus("error");
    }
  };

  const resetToForm = () => {
    setStatus("idle");
    setResult(null);
    setProgressStep(0);
    setErrorMsg("");
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-[#0d1320] border border-[#1e2d40] rounded-2xl max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e2d40] shrink-0">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl bg-gradient-to-br ${config.gradient}`}>
              <Icon size={18} className="text-white" />
            </div>
            <div>
              <h2 className="font-semibold text-white text-sm">{config.title}</h2>
              {status === "success" && result && (
                <p className="text-[11px] text-slate-500">Generado con {result.provider}</p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#1e2d40] text-slate-400 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {/* Loading */}
          {status === "loading" && (
            <CreativeProgress currentStep={progressStep} type={type} />
          )}

          {/* Success */}
          {status === "success" && result && (
            <CreativeResult
              result={result}
              type={type}
              onEdit={resetToForm}
              onClose={onClose}
            />
          )}

          {/* Error */}
          {status === "error" && (
            <div className="py-8 space-y-4">
              <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/25 rounded-xl">
                <AlertCircle className="text-red-400 shrink-0 mt-0.5" size={16} />
                <div>
                  <p className="text-sm text-red-300 font-medium">Error al generar</p>
                  <p className="text-xs text-slate-400 mt-1">{errorMsg}</p>
                </div>
              </div>
              <button onClick={resetToForm} className="w-full py-2.5 bg-[#1e2d40] hover:bg-[#253449] text-white text-sm rounded-xl transition-colors">
                Volver al formulario
              </button>
            </div>
          )}

          {/* Form */}
          {status === "idle" && (
            <div className="space-y-4">

              {has("objective") && (
                <div>
                  <FieldLabel>Objetivo</FieldLabel>
                  <FieldSelect
                    value={form.objective}
                    onChange={v => setForm(f => ({ ...f, objective: v }))}
                    options={[
                      { value: "customers",  label: "Conseguir clientes" },
                      { value: "sales",      label: "Generar ventas" },
                      { value: "branding",   label: "Branding" },
                      { value: "leads",      label: "Captar leads" },
                    ]}
                  />
                </div>
              )}

              {has("product") && (
                <div>
                  <FieldLabel>Producto o servicio <span className="text-red-400">*</span></FieldLabel>
                  <FieldInput
                    value={form.product}
                    onChange={v => setForm(f => ({ ...f, product: v }))}
                    placeholder="Ej: Software de gestión empresarial"
                  />
                </div>
              )}

              {has("audience") && (
                <div>
                  <FieldLabel>Público objetivo</FieldLabel>
                  <FieldInput
                    value={form.audience}
                    onChange={v => setForm(f => ({ ...f, audience: v }))}
                    placeholder="Ej: Empresarios de 30-50 años"
                  />
                </div>
              )}

              {has("platform") && (
                <div>
                  <FieldLabel>Plataforma</FieldLabel>
                  <FieldSelect
                    value={form.platform}
                    onChange={v => setForm(f => ({ ...f, platform: v }))}
                    options={[
                      { value: "facebook",  label: "Facebook" },
                      { value: "instagram", label: "Instagram" },
                      { value: "tiktok",    label: "TikTok" },
                      { value: "google",    label: "Google Ads" },
                      { value: "linkedin",  label: "LinkedIn" },
                      { value: "youtube",   label: "YouTube" },
                    ]}
                  />
                </div>
              )}

              {has("duration") && (
                <div>
                  <FieldLabel>Duración</FieldLabel>
                  <RadioGroup
                    value={form.duration}
                    onChange={v => setForm(f => ({ ...f, duration: v }))}
                    options={
                      type === "story"
                        ? [
                            { value: "9",  label: "9 segundos" },
                            { value: "15", label: "15 segundos" },
                          ]
                        : [
                            { value: "15", label: "15 segundos" },
                            { value: "30", label: "30 segundos" },
                            { value: "60", label: "60 segundos" },
                          ]
                    }
                  />
                </div>
              )}

              {has("style") && (
                <div>
                  <FieldLabel>Estilo</FieldLabel>
                  <FieldSelect
                    value={form.style}
                    onChange={v => setForm(f => ({ ...f, style: v }))}
                    options={[
                      { value: "ugc",        label: "UGC" },
                      { value: "influencer", label: "Influencer" },
                      { value: "cinematic",  label: "Cinemático" },
                      { value: "professional", label: "Profesional" },
                      { value: "humor",      label: "Humor" },
                      { value: "viral",      label: "Viral" },
                      { value: "minimal",    label: "Minimalista" },
                    ]}
                  />
                </div>
              )}

              {has("format") && (
                <div>
                  <FieldLabel>Formato</FieldLabel>
                  <RadioGroup
                    value={form.format}
                    onChange={v => setForm(f => ({ ...f, format: v }))}
                    options={[
                      { value: "1:1",  label: "Cuadrado 1:1" },
                      { value: "16:9", label: "Horizontal 16:9" },
                      { value: "4:5",  label: "Vertical 4:5" },
                      { value: "9:16", label: "Story 9:16" },
                    ]}
                  />
                </div>
              )}

              {has("slideCount") && (
                <div>
                  <FieldLabel>Número de diapositivas</FieldLabel>
                  <RadioGroup
                    value={form.slideCount}
                    onChange={v => setForm(f => ({ ...f, slideCount: v }))}
                    options={[
                      { value: "3",  label: "3 slides" },
                      { value: "5",  label: "5 slides" },
                      { value: "7",  label: "7 slides" },
                      { value: "10", label: "10 slides" },
                    ]}
                  />
                </div>
              )}

              {has("theme") && (
                <div>
                  <FieldLabel>Tema del carrusel</FieldLabel>
                  <FieldInput
                    value={form.theme}
                    onChange={v => setForm(f => ({ ...f, theme: v }))}
                    placeholder="Ej: Beneficios del producto, Pasos de uso..."
                  />
                </div>
              )}

              {has("subject") && (
                <div>
                  <FieldLabel>Asunto del email</FieldLabel>
                  <FieldInput
                    value={form.subject}
                    onChange={v => setForm(f => ({ ...f, subject: v }))}
                    placeholder="Ej: ¡Oferta especial solo hoy!"
                  />
                </div>
              )}

              {has("tone") && (
                <div>
                  <FieldLabel>Tono</FieldLabel>
                  <FieldSelect
                    value={form.tone}
                    onChange={v => setForm(f => ({ ...f, tone: v }))}
                    options={[
                      { value: "Profesional",  label: "Profesional" },
                      { value: "Cercano",      label: "Cercano" },
                      { value: "Urgente",      label: "Urgente" },
                      { value: "Informativo",  label: "Informativo" },
                    ]}
                  />
                </div>
              )}

              {has("language") && (
                <div>
                  <FieldLabel>Idioma</FieldLabel>
                  <FieldInput
                    value={form.language}
                    onChange={v => setForm(f => ({ ...f, language: v }))}
                    placeholder="Español"
                  />
                </div>
              )}

              {has("cta") && (
                <div>
                  <FieldLabel>CTA (Call to action)</FieldLabel>
                  <FieldInput
                    value={form.cta}
                    onChange={v => setForm(f => ({ ...f, cta: v }))}
                    placeholder="Ej: Solicitar demo gratis"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {status === "idle" && (
          <div className="px-5 py-4 border-t border-[#1e2d40] shrink-0">
            <button
              onClick={handleGenerate}
              className={`w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r ${config.gradient} hover:opacity-90 text-white font-semibold text-sm rounded-xl transition-opacity`}
            >
              <Sparkles size={16} />
              {config.btnLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CreativeHistory — historial de creativos con filtros
// ─────────────────────────────────────────────────────────────────────────────

const HISTORY_FILTERS: { id: string; label: string }[] = [
  { id: "all",      label: "Todos" },
  { id: "image",    label: "Imagen" },
  { id: "video",    label: "Vídeo" },
  { id: "carousel", label: "Carrusel" },
  { id: "reel",     label: "Reel" },
  { id: "story",    label: "Story" },
  { id: "email",    label: "Email" },
];

const STATUS_BADGE: Record<string, string> = {
  draft:     "bg-slate-500/15 text-slate-400 border-slate-500/25",
  ready:     "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  published: "bg-blue-500/15 text-blue-400 border-blue-500/25",
};

const STATUS_TEXT: Record<string, string> = {
  draft: "Borrador", ready: "Listo", published: "Publicado",
};

export function CreativeHistory({ campaignId }: { campaignId?: number | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filterType, setFilterType] = useState("all");

  const { data, isLoading } = useQuery({
    queryKey: ["ads-creatives", campaignId],
    queryFn: () =>
      authFetch(`${BASE}/api/ads/creatives${campaignId ? `?campaignId=${campaignId}` : ""}`)
        .then(r => r.json()) as Promise<{ creatives: StoredCreative[] }>,
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) =>
      authFetch(`${BASE}/api/ads/creatives/${id}`, { method: "DELETE" }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Creativo eliminado" });
      qc.invalidateQueries({ queryKey: ["ads-creatives"] });
    },
  });

  const allCreatives = data?.creatives ?? [];
  const filtered = filterType === "all"
    ? allCreatives
    : allCreatives.filter(c => c.type === filterType);

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="animate-spin text-blue-400" size={22} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-white">Historial de creativos</h3>
        <span className="text-xs text-slate-500">{allCreatives.length} creativo{allCreatives.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Type filter tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none">
        {HISTORY_FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilterType(f.id)}
            className={`px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors shrink-0 ${
              filterType === f.id
                ? "bg-blue-600 text-white"
                : "bg-[#111827] text-slate-400 hover:text-slate-200 border border-[#1e2d40]"
            }`}
          >
            {f.label}
            {f.id !== "all" && (
              <span className="ml-1 text-[10px] opacity-60">
                {allCreatives.filter(c => c.type === f.id).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-[#1e2d40] rounded-xl">
          <Sparkles size={28} className="text-slate-600 mx-auto mb-2" />
          <p className="text-slate-500 text-sm">Sin creativos todavía</p>
          <p className="text-slate-600 text-xs mt-1">Pulsa una tarjeta para crear tu primer creativo</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(cr => {
            const iconConfig = TYPE_CONFIG[cr.type as CreativeType];
            const CrIcon = iconConfig?.icon ?? Layout;
            return (
              <div key={cr.id} className="bg-[#111827] border border-[#1e2d40] rounded-xl px-4 py-3 flex items-center gap-3 hover:border-[#2a3f5f] transition-colors group">

                {/* Type icon */}
                <div className={`p-2 rounded-lg bg-gradient-to-br ${iconConfig?.gradient ?? "from-slate-600 to-slate-700"} shrink-0`}>
                  <CrIcon size={14} className="text-white" />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium truncate">{cr.title ?? TYPE_LABELS[cr.type as CreativeType] ?? cr.type}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[11px] text-slate-500">
                      {new Date(cr.created_at).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}
                    </span>
                    {cr.platform && (
                      <span className="text-[11px] text-slate-600">· {cr.platform}</span>
                    )}
                  </div>
                </div>

                {/* Status */}
                <span className={`text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${STATUS_BADGE[cr.status] ?? STATUS_BADGE["draft"]}`}>
                  {STATUS_TEXT[cr.status] ?? cr.status}
                </span>

                {/* Delete */}
                <button
                  onClick={() => deleteMut.mutate(cr.id)}
                  disabled={deleteMut.isPending}
                  className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-30"
                  title="Eliminar"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
