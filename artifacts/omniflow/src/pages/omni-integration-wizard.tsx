import { useState, useEffect, useCallback } from "react";
import { useLocation, useRoute } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageCircle, ChevronRight, ChevronLeft, CheckCircle2, AlertCircle, AlertTriangle,
  Loader2, Wand2, Shield, ClipboardList, Send, RefreshCw, Rocket,
  Smartphone, Cloud, HelpCircle, ArrowRight, CheckCheck, X,
  Copy, ExternalLink, Bot, Globe, Zap, Sparkles, Phone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/authFetch";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type WizardStep =
  | "welcome"
  | "detect"
  | "migration"
  | "meta-connect"
  | "capture"
  | "health"
  | "test"
  | "report"
  | "production";

interface WizardState {
  step: WizardStep;
  detectChoice: "yes" | "no" | "unknown" | null;
  locationChoice: "app" | "cloud" | "unknown" | null;
  credentials: Record<string, string>;
  displayName: string;
  healthResults: HealthCheckItem[];
  testPhone: string;
  testResult: { success: boolean; message?: string } | null;
  report: ReportData | null;
  testMessage: string;
  errors: string[];
  warnings: string[];
  completedSteps: WizardStep[];
}

interface HealthCheckItem {
  name: string;
  status: "pass" | "fail" | "skip";
  message: string;
  durationMs: number;
}

interface ReportData {
  status: string;
  mode: string;
  issues: string[];
  pendingActions: string[];
  lastEvents: Array<{ eventType: string; status: string; summary: string; createdAt: string }>;
}

const STEP_ORDER: WizardStep[] = [
  "welcome", "detect", "migration", "meta-connect", "capture",
  "health", "test", "report", "production",
];

const STEP_LABELS: Record<WizardStep, { label: string; subtitle: string }> = {
  welcome:       { label: "Bienvenida",      subtitle: "Comenzar" },
  detect:        { label: "Detección",      subtitle: "Situación actual" },
  migration:     { label: "Migración",      subtitle: "Preparar número" },
  "meta-connect": { label: "Meta Connect", subtitle: "Conectar con Meta" },
  capture:       { label: "Captura",        subtitle: "Guardar credenciales" },
  health:        { label: "Health Check",    subtitle: "Verificar sistema" },
  test:          { label: "Prueba",         subtitle: "Enviar mensaje de prueba" },
  report:        { label: "Informe",        subtitle: "Resultados" },
  production:    { label: "Producción",     subtitle: "Activar" },
};

const STEP_META: Record<WizardStep, { icon: React.ReactNode; color: string; bg: string }> = {
  welcome:       { icon: <Sparkles className="w-4 h-4" />, color: "text-violet-400", bg: "bg-violet-500/10" },
  detect:        { icon: <HelpCircle className="w-4 h-4" />, color: "text-blue-400", bg: "bg-blue-500/10" },
  migration:     { icon: <ClipboardList className="w-4 h-4" />, color: "text-amber-400", bg: "bg-amber-500/10" },
  "meta-connect": { icon: <ExternalLink className="w-4 h-4" />, color: "text-cyan-400", bg: "bg-cyan-500/10" },
  capture:       { icon: <Shield className="w-4 h-4" />, color: "text-emerald-400", bg: "bg-emerald-500/10" },
  health:        { icon: <RefreshCw className="w-4 h-4" />, color: "text-green-400", bg: "bg-green-500/10" },
  test:          { icon: <Send className="w-4 h-4" />, color: "text-pink-400", bg: "bg-pink-500/10" },
  report:        { icon: <CheckCheck className="w-4 h-4" />, color: "text-indigo-400", bg: "bg-indigo-500/10" },
  production:    { icon: <Rocket className="w-4 h-4" />, color: "text-orange-400", bg: "bg-orange-500/10" },
};

const REQUIRED_FIELDS: Record<string, { key: string; label: string; hint: string }[]> = {
  whatsapp: [
    { key: "phoneNumberId", label: "Phone Number ID", hint: "Meta Business › WhatsApp › Configuración › Número de teléfono" },
    { key: "accessToken",   label: "Access Token",    hint: "Meta Business › Desarrolladores › Tokens de acceso" },
    { key: "verifyToken",   label: "Verify Token",      hint: "Crea uno seguro (ej: omni-whatsapp-2024)" },
  ],
  telegram: [
    { key: "botToken", label: "Bot Token", hint: "@BotFather → /newbot → copia el token" },
  ],
};

export default function OmniIntegrationWizard() {
  const [, params] = useRoute("/integrations/wizard/:slug");
  const slug = params?.slug ?? "whatsapp";
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [state, setState] = useState<WizardState>({
    step: "welcome",
    detectChoice: null,
    locationChoice: null,
    credentials: {},
    displayName: "",
    healthResults: [],
    testPhone: "",
    testResult: null,
    report: null,
    testMessage: "",
    errors: [],
    warnings: [],
    completedSteps: [],
  });

  const [loading, setLoading] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [productionLoading, setProductionLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const stepIndex = STEP_ORDER.indexOf(state.step);

  const setStep = (step: WizardStep) => {
    setState((s) => ({ ...s, step, completedSteps: [...s.completedSteps, s.step] }));
  };

  const prevStep = () => {
    const idx = STEP_ORDER.indexOf(state.step);
    if (idx > 0) setStep(STEP_ORDER[idx - 1]);
  };

  const nextStep = () => {
    const idx = STEP_ORDER.indexOf(state.step);
    if (idx < STEP_ORDER.length - 1) setStep(STEP_ORDER[idx + 1]);
  };

  const setCred = (key: string, val: string) => {
    setState((s) => ({ ...s, credentials: { ...s.credentials, [key]: val } }));
  };

  const setDetect = (choice: WizardState["detectChoice"]) => {
    setState((s) => ({ ...s, detectChoice: choice }));
    if (choice === "no") {
      nextStep(); // skip migration
      nextStep(); // skip meta-connect (brief pause then auto)
    } else {
      nextStep();
    }
  };

  const setLocationChoice = (choice: WizardState["locationChoice"]) => {
    setState((s) => ({ ...s, locationChoice: choice }));
    nextStep();
  };

  const handleHealth = useCallback(async () => {
    setHealthLoading(true);
    setState((s) => ({ ...s, errors: [], warnings: [] }));
    try {
      const res = await authFetch(`${BASE}/api/integrations/${slug}/health`);
      const data = await res.json() as {
        success: boolean;
        health?: { overall: string; results: HealthCheckItem[] };
        error?: string;
      };
      if (data.success && data.health) {
        setState((s) => ({
          ...s,
          healthResults: data.health!.results,
          errors: data.health!.results.filter((r) => r.status === "fail").map((r) => r.message),
          warnings: data.health!.results.filter((r) => r.status === "skip").map((r) => r.message),
        }));
      } else {
        setState((s) => ({ ...s, errors: [data.error ?? "Health check failed"] }));
      }
    } catch {
      setState((s) => ({ ...s, errors: ["Error ejecutando health check"] }));
    } finally {
      setHealthLoading(false);
    }
  }, [slug]);

  const handleTest = useCallback(async () => {
    if (!state.testPhone.trim()) {
      toast({ title: "Introduce un número de teléfono", variant: "destructive" });
      return;
    }
    setTestSending(true);
    setState((s) => ({ ...s, testResult: null, testMessage: "" }));
    try {
      const res = await authFetch(`${BASE}/api/integrations/${slug}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testNumber: state.testPhone }),
      });
      const data = await res.json() as { success: boolean; message?: string; sendTest?: { success: boolean; error?: string } };
      const success = data.success && (!data.sendTest || data.sendTest.success);
      setState((s) => ({
        ...s,
        testResult: {
          success,
          message: data.sendTest?.error ?? data.message ?? "",
        },
        testMessage: success
          ? "🤖 Prueba Omni Integration Hub — mensaje de validación enviado correctamente."
          : "",
      }));
      toast({
        title: success ? "✅ Test exitoso" : "⚠️ Test fallido",
        description: data.message ?? "",
        variant: success ? "default" : "destructive",
      });
    } catch {
      setState((s) => ({ ...s, testResult: { success: false, message: "Error de red" } }));
      toast({ title: "Error de red", variant: "destructive" });
    } finally {
      setTestSending(false);
    }
  }, [slug, state.testPhone, toast]);

  const handleReport = useCallback(async () => {
    try {
      const res = await authFetch(`${BASE}/api/integrations/${slug}/report`);
      const data = await res.json() as ReportData;
      setState((s) => ({ ...s, report: data }));
    } catch {
      toast({ title: "Error cargando informe", variant: "destructive" });
    }
  }, [slug, toast]);

  const handleProduction = useCallback(async () => {
    setProductionLoading(true);
    try {
      const res = await authFetch(`${BASE}/api/integrations/${slug}/production`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "production" }),
      });
      const data = await res.json() as { success: boolean };
      if (data.success) {
        toast({ title: "✅ Integración en PRODUCCIÓN", description: "WhatsApp Business está activo." });
      } else {
        toast({ title: "⚠️ No se pudo activar", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error al activar", variant: "destructive" });
    } finally {
      setProductionLoading(false);
    }
  }, [slug, toast]);

  const handleSaveCredentials = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${BASE}/api/integrations/${slug}/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credentials: state.credentials,
          displayName: state.displayName || undefined,
        }),
      });
      const data = await res.json() as { success: boolean; error?: string };
      if (data.success) {
        toast({ title: "✅ Credenciales guardadas", description: "Integración configurada correctamente." });
        nextStep();
      } else {
        throw new Error(data.error ?? "Error");
      }
    } catch (err) {
      toast({ title: "Error al guardar", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [slug, state.credentials, state.displayName, toast]);

  const isStepComplete = (step: WizardStep) => state.completedSteps.includes(step);

  const webhookUrl = `${window.location.origin}${BASE}/api/${slug}/webhook`;

  const copyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Step 1: Welcome ──────────────────────────────────────────────────────────
  const WelcomeStep = () => (
    <div className="space-y-6">
      <div className="text-center space-y-3">
        <div className="w-16 h-16 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto">
          <Wand2 className="w-8 h-8 text-green-400" />
        </div>
        <h2 className="text-xl font-bold text-foreground">Omni Integration Wizard</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
          Asistente paso a paso para conectar tu <strong>WhatsApp Business</strong> con OmniTech Core.
          No necesitas conocimientos técnicos. Duración estimada: <strong>5 minutos</strong>.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { icon: <Shield className="w-5 h-5" />, label: "Seguro", desc: "Tus datos se guardan cifrados en tu Workspace" },
          { icon: <Zap className="w-5 h-5" />, label: "Rápido", desc: "Health check automático y prueba en vivo" },
          { icon: <Globe className="w-5 h-5" />, label: "Completo", desc: "Conexión, verificación y producción en un solo flujo" },
        ].map((f) => (
          <div key={f.label} className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] text-center space-y-2">
            <div className="text-primary mx-auto">{f.icon}</div>
            <div className="text-sm font-semibold text-foreground">{f.label}</div>
            <div className="text-[11px] text-muted-foreground">{f.desc}</div>
          </div>
        ))}
      </div>

      <div className="flex justify-center">
        <button
          onClick={() => setStep("detect")}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors"
        >
          Comenzar <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  // ── Step 2: Detect ─────────────────────────────────────────────────────────────
  const DetectStep = () => (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-lg font-bold text-foreground">¿Ya tienes un número de WhatsApp Business?</h2>
        <p className="text-sm text-muted-foreground">Esto nos ayuda a adaptar el flujo a tu situación.</p>
      </div>

      <div className="space-y-3">
        {[
          { key: "yes" as const, icon: <CheckCircle2 className="w-5 h-5" />, label: "Sí", desc: "Ya tengo un número de WhatsApp Business configurado" },
          { key: "no" as const, icon: <X className="w-5 h-5" />, label: "No", desc: "Aún no tengo WhatsApp Business, necesito crear uno" },
          { key: "unknown" as const, icon: <HelpCircle className="w-5 h-5" />, label: "No lo sé", desc: "No estoy seguro de qué tipo de cuenta tengo" },
        ].map((opt) => (
          <button
            key={opt.key}
            onClick={() => {
              setState((s) => ({ ...s, detectChoice: opt.key }));
              if (opt.key === "yes") nextStep();
              else if (opt.key === "no") {
                setStep("meta-connect");
              } else {
                nextStep();
              }
            }}
            className={cn(
              "w-full flex items-center gap-4 p-4 rounded-xl border text-left transition-all",
              state.detectChoice === opt.key
                ? "bg-primary/10 border-primary/30 text-primary"
                : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04] text-foreground",
            )}
          >
            <div className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border",
              state.detectChoice === opt.key ? "bg-primary/15 border-primary/25" : "bg-white/[0.04] border-white/[0.08]",
            )}>
              {opt.icon}
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold">{opt.label}</div>
              <div className="text-[11px] text-muted-foreground">{opt.desc}</div>
            </div>
            <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  );

  // ── Step 3: Migration ──────────────────────────────────────────────────────────
  const MigrationStep = () => (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-lg font-bold text-foreground">Asistente de Migración</h2>
        <p className="text-sm text-muted-foreground">
          ¿Dónde está tu número de WhatsApp Business actualmente?</p>
      </div>

      <div className="space-y-3">
        {[
          { key: "app" as const, icon: <Smartphone className="w-5 h-5" />, label: "WhatsApp Business App", desc: "La app en tu móvil. Necesitas migrar a la API Cloud." },
          { key: "cloud" as const, icon: <Cloud className="w-5 h-5" />, label: "WhatsApp Cloud API", desc: "Ya estás en la API Cloud. Perfecto, continúemos." },
          { key: "unknown" as const, icon: <HelpCircle className="w-5 h-5" />, label: "No lo sé", desc: "Te ayudaremos a identificarlo en los próximos pasos." },
        ].map((opt) => (
          <button
            key={opt.key}
            onClick={() => setLocationChoice(opt.key)}
            className={cn(
              "w-full flex items-center gap-4 p-4 rounded-xl border text-left transition-all",
              state.locationChoice === opt.key
                ? "bg-primary/10 border-primary/30 text-primary"
                : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04] text-foreground",
            )}
          >
            <div className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border",
              state.locationChoice === opt.key ? "bg-primary/15 border-primary/25" : "bg-white/[0.04] border-white/[0.08]",
            )}>
              {opt.icon}
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold">{opt.label}</div>
              <div className="text-[11px] text-muted-foreground">{opt.desc}</div>
            </div>
            <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>

      {state.locationChoice === "app" && (
        <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/15 space-y-3">
          <div className="flex items-center gap-2 text-amber-400 text-sm font-semibold">
            <AlertCircle className="w-4 h-4" /> Checklist de Migración
          </div>
          <ul className="space-y-2 text-[11px] text-muted-foreground">
            {[
              "Haz una copia de seguridad de tus chats en WhatsApp → Configuración → Chats → Copia de seguridad",
              "Registra tu número en la WhatsApp Business Platform (Meta for Developers)",
              "El número pasará a ser gestionado por la API Cloud; la app móvil dejará de funcionar",
              "No perderás tus contactos, pero el historial de chats quedará en la copia de seguridad",
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-amber-400/60 mt-0.5 shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  // ── Step 4: Meta Connect ───────────────────────────────────────────────────────
  const MetaConnectStep = () => (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-lg font-bold text-foreground">Conexión con Meta</h2>
        <p className="text-sm text-muted-foreground">
          Te guiamos paso a paso para obtener tus credenciales desde Meta Business.</p>
      </div>

      <div className="space-y-4">
        {[
          {
            num: 1,
            title: "Accede a Meta Business Suite",
            desc: "Ve a business.facebook.com e inicia sesión con tu cuenta de Facebook.",
            action: { label: "Abrir Meta Business", url: "https://business.facebook.com" },
          },
          {
            num: 2,
            title: "Crea o selecciona tu app de WhatsApp",
            desc: "En el panel, ve a Configuración → Cuentas de WhatsApp Business. Si no tienes, crea una nueva app.",
            action: { label: "Crear App", url: "https://developers.facebook.com/apps/creation/" },
          },
          {
            num: 3,
            title: "Obtén tu Phone Number ID",
            desc: "En WhatsApp → Configuración → Números de teléfono. Copia el ID del número.",
          },
          {
            num: 4,
            title: "Genera tu Access Token",
            desc: "En Desarrolladores → Tokens de acceso. Genera un token permanente con permisos de WhatsApp Business.",
          },
          {
            num: 5,
            title: "Configura el Webhook",
            desc: "Copia la URL del webhook y el Verify Token que usarás.",
            action: { label: "Copiar URL del webhook", onClick: copyWebhook },
          },
        ].map((step) => (
          <div key={step.num} className="flex items-start gap-3 p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
            <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-[11px] font-bold text-primary shrink-0 mt-0.5">
              {step.num}
            </div>
            <div className="flex-1 space-y-1">
              <div className="text-sm font-semibold text-foreground">{step.title}</div>
              <div className="text-[11px] text-muted-foreground">{step.desc}</div>
              {step.action && (
                <div className="pt-1">
                  {step.action.url ? (
                    <a href={step.action.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                      {step.action.label} <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : (
                    <button
                      onClick={step.action.onClick}
                      className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                    >
                      {step.action.label} {copied ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/15 flex items-start gap-3">
        <InfoIcon className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
        <div className="text-[11px] text-muted-foreground">
          <strong className="text-blue-400">Consejo:</strong> Mantén abierta Meta Business en otra pestaña.
          Cuando tengas los datos, pulsa <strong>Continuar</strong> para guardarlos.
        </div>
      </div>

      <div className="flex justify-center">
        <button
          onClick={() => setStep("capture")}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors"
        >
          Continuar <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  // ── Step 5: Capture ───────────────────────────────────────────────────────────
  const CaptureStep = () => {
    const fields = REQUIRED_FIELDS[slug] ?? REQUIRED_FIELDS["whatsapp"];
    const allFilled = fields.every((f) => state.credentials[f.key]?.trim());

    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-lg font-bold text-foreground">Guardar Credenciales</h2>
          <p className="text-sm text-muted-foreground">
            Introduce los datos obtenidos de Meta. Se guardan cifrados en tu Workspace.
          </p>
        </div>

        <div className="space-y-4">
          {fields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground uppercase tracking-wider">
                {f.label}
              </label>
              <input
                type={f.key === "accessToken" ? "password" : "text"}
                value={state.credentials[f.key] ?? ""}
                onChange={(e) => setCred(f.key, e.target.value)}
                placeholder={f.hint}
                className="w-full bg-slate-900/60 border border-white/10 rounded-xl px-4 py-3 text-sm text-foreground outline-none focus:border-emerald-500/40 transition-colors placeholder:text-muted-foreground/50"
              />
              <p className="text-[10px] text-muted-foreground">{f.hint}</p>
            </div>
          ))}

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground uppercase tracking-wider">
              Nombre de la integración (opcional)
            </label>
            <input
              type="text"
              value={state.displayName}
              onChange={(e) => setState((s) => ({ ...s, displayName: e.target.value }))}
              placeholder="Ej: WhatsApp Oficial OmniTech"
              className="w-full bg-slate-900/60 border border-white/10 rounded-xl px-4 py-3 text-sm text-foreground outline-none focus:border-emerald-500/40 transition-colors placeholder:text-muted-foreground/50"
            />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/15 flex items-start gap-3">
          <Shield className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
          <div className="text-[11px] text-muted-foreground">
            <strong className="text-emerald-400">Seguridad:</strong> Los datos se cifran con AES-256 antes de guardarse.
            Nunca se almacenan en variables globales ni en archivos de configuración.
          </div>
        </div>

        <div className="flex justify-center">
          <button
            onClick={() => void handleSaveCredentials()}
            disabled={!allFilled || loading}
            className={cn(
              "flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-colors",
              allFilled && !loading
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-white/[0.04] text-white/20 cursor-not-allowed",
            )}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
            {loading ? "Guardando..." : "Guardar credenciales"}
          </button>
        </div>
      </div>
    );
  };

  // ── Step 6: Health ────────────────────────────────────────────────────────────
  const HealthStep = () => {
    useEffect(() => {
      if (state.healthResults.length === 0 && !healthLoading) {
        void handleHealth();
      }
    }, []);

    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-lg font-bold text-foreground">Health Check</h2>
          <p className="text-sm text-muted-foreground">
            Verificando conexión con Meta, token, webhook y sistema interno.
          </p>
        </div>

        {healthLoading && (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="relative">
              <div className="w-14 h-14 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center">
                <RefreshCw className="w-6 h-6 text-green-400 animate-spin" />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">Ejecutando verificaciones...</p>
          </div>
        )}

        {!healthLoading && state.healthResults.length > 0 && (
          <div className="space-y-2">
            {state.healthResults.map((r) => (
              <div
                key={r.name}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-xl border text-sm",
                  r.status === "pass" && "bg-green-500/5 border-green-500/15",
                  r.status === "fail" && "bg-red-500/5 border-red-500/15",
                  r.status === "skip" && "bg-white/[0.02] border-white/[0.06]",
                )}
              >
                <div className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center shrink-0",
                  r.status === "pass" && "bg-green-500/15 text-green-400",
                  r.status === "fail" && "bg-red-500/15 text-red-400",
                  r.status === "skip" && "bg-white/[0.04] text-muted-foreground",
                )}>
                  {r.status === "pass" ? <CheckCircle2 className="w-3.5 h-3.5" /> : r.status === "fail" ? <X className="w-3.5 h-3.5" /> : <HelpCircle className="w-3.5 h-3.5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground">{r.name}</div>
                  <div className="text-[11px] text-muted-foreground">{r.message}</div>
                </div>
                <div className="text-[10px] text-muted-foreground tabular-nums">{r.durationMs}ms</div>
              </div>
            ))}
          </div>
        )}

        {!healthLoading && state.errors.length > 0 && (
          <div className="p-4 rounded-xl bg-red-500/5 border border-red-500/15 space-y-2">
            <div className="flex items-center gap-2 text-red-400 text-sm font-semibold">
              <AlertCircle className="w-4 h-4" /> Errores detectados
            </div>
            <ul className="space-y-1 text-[11px] text-muted-foreground">
              {state.errors.map((e, i) => <li key={i}>• {e}</li>)}
            </ul>
          </div>
        )}

        {!healthLoading && (
          <div className="flex justify-center gap-3">
            <button
              onClick={() => void handleHealth()}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 text-xs text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Re-ejecutar
            </button>
            <button
              onClick={() => {
                void handleReport();
                nextStep();
              }}
              disabled={state.errors.length > 0}
              className={cn(
                "flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-xs transition-colors",
                state.errors.length === 0
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-white/[0.04] text-white/20 cursor-not-allowed",
              )}
            >
              Continuar <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    );
  };

  // ── Step 7: Test ───────────────────────────────────────────────────────────────
  const TestStep = () => (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-lg font-bold text-foreground">Prueba Automática</h2>
        <p className="text-sm text-muted-foreground">
          Enviaremos un mensaje de prueba para validar el recorrido completo.
        </p>
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground uppercase tracking-wider">
            Número de teléfono de prueba
          </label>
          <div className="flex gap-2">
            <input
              type="tel"
              value={state.testPhone}
              onChange={(e) => setState((s) => ({ ...s, testPhone: e.target.value }))}
              placeholder="+34 612 345 678"
              className="flex-1 bg-slate-900/60 border border-white/10 rounded-xl px-4 py-3 text-sm text-foreground outline-none focus:border-emerald-500/40 transition-colors placeholder:text-muted-foreground/50"
            />
            <button
              onClick={() => void handleTest()}
              disabled={testSending || !state.testPhone.trim()}
              className={cn(
                "flex items-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm transition-colors shrink-0",
                state.testPhone.trim() && !testSending
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-white/[0.04] text-white/20 cursor-not-allowed",
              )}
            >
              {testSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {testSending ? "Enviando..." : "Probar"}
            </button>
          </div>
        </div>
      </div>

      {state.testResult && (
        <div className={cn(
          "p-4 rounded-xl border space-y-2",
          state.testResult.success
            ? "bg-green-500/5 border-green-500/15"
            : "bg-red-500/5 border-red-500/15",
        )}>
          <div className={cn(
            "flex items-center gap-2 text-sm font-semibold",
            state.testResult.success ? "text-green-400" : "text-red-400",
          )}>
            {state.testResult.success ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {state.testResult.success ? "Mensaje enviado correctamente" : "Error en el envío"}
          </div>
          {state.testMessage && (
            <div className="text-[11px] text-muted-foreground bg-white/[0.02] rounded-lg px-3 py-2 border border-white/[0.06]">
              {state.testMessage}
            </div>
          )}
          {state.testResult.message && !state.testResult.success && (
            <div className="text-[11px] text-red-400/80">{state.testResult.message}</div>
          )}
        </div>
      )}

      <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/15">
        <div className="text-[11px] text-muted-foreground space-y-1">
          <div className="flex items-center gap-1.5 text-blue-400 font-semibold text-xs mb-2">
            <Bot className="w-3.5 h-3.5" /> Recorrido validado
          </div>
          {["Cliente → Canal → Integration Hub → Intent Engine → Skill Engine → CRM → Respuesta"].map((step, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-[8px] text-blue-400 font-bold">{i + 1}</div>
              <span>{step}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-center">
        <button
          onClick={() => {
            void handleReport();
            nextStep();
          }}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors"
        >
          Ver informe <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  // ── Step 8: Report ───────────────────────────────────────────────────────────
  const ReportStep = () => {
    useEffect(() => {
      if (!state.report) void handleReport();
    }, []);

    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-lg font-bold text-foreground">Informe Final</h2>
          <p className="text-sm text-muted-foreground">Resumen del estado de la integración.</p>
        </div>

        {state.report ? (
          <div className="space-y-4">
            {/* Status card */}
            <div className={cn(
              "p-4 rounded-xl border flex items-center gap-4",
              state.report.status === "active" || state.report.status === "connected"
                ? "bg-green-500/5 border-green-500/15"
                : state.report.status === "error"
                ? "bg-red-500/5 border-red-500/15"
                : "bg-white/[0.02] border-white/[0.06]",
            )}>
              <div className={cn(
                "w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border",
                state.report.status === "active" || state.report.status === "connected"
                  ? "bg-green-500/10 border-green-500/20"
                  : state.report.status === "error"
                  ? "bg-red-500/10 border-red-500/20"
                  : "bg-white/[0.04] border-white/[0.08]",
              )}>
                {state.report.status === "active" || state.report.status === "connected"
                  ? <CheckCircle2 className="w-6 h-6 text-green-400" />
                  : state.report.status === "error"
                  ? <AlertCircle className="w-6 h-6 text-red-400" />
                  : <HelpCircle className="w-6 h-6 text-muted-foreground" />
                }
              </div>
              <div>
                <div className="text-sm font-semibold text-foreground">
                  Estado: {state.report.status === "active" || state.report.status === "connected" ? "Conectado" : state.report.status === "error" ? "Error" : state.report.status}
                </div>
                <div className="text-[11px] text-muted-foreground">Modo: {state.report.mode?.toUpperCase() ?? "STAGING"}</div>
              </div>
            </div>

            {/* Issues */}
            {state.report.issues && state.report.issues.length > 0 && (
              <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/15 space-y-2">
                <div className="flex items-center gap-2 text-amber-400 text-sm font-semibold">
                  <AlertTriangle className="w-4 h-4" /> Problemas detectados
                </div>
                <ul className="space-y-1 text-[11px] text-muted-foreground">
                  {state.report.issues.map((issue, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <AlertCircle className="w-3 h-3 text-amber-400/60 mt-0.5 shrink-0" />
                      {issue}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Pending */}
            {state.report.pendingActions && state.report.pendingActions.length > 0 && (
              <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/15 space-y-2">
                <div className="flex items-center gap-2 text-blue-400 text-sm font-semibold">
                  <ClipboardList className="w-4 h-4" /> Acciones pendientes
                </div>
                <ul className="space-y-1 text-[11px] text-muted-foreground">
                  {state.report.pendingActions.map((a, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <ChevronRight className="w-3 h-3 text-blue-400/60 mt-0.5 shrink-0" />
                      {a}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Last events */}
            {state.report.lastEvents && state.report.lastEvents.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Últimos eventos
                </div>
                <div className="space-y-1.5">
                  {state.report.lastEvents.slice(0, 5).map((e, i) => (
                    <div key={i} className="flex items-center gap-2 p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.06]">
                      <div className={cn(
                        "w-2 h-2 rounded-full shrink-0",
                        e.status === "processed" ? "bg-green-500" : "bg-red-500",
                      )} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-medium text-foreground truncate">{e.summary}</div>
                        <div className="text-[10px] text-muted-foreground">{e.eventType} • {new Date(e.createdAt).toLocaleString("es-ES")}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
          </div>
        )}

        <div className="flex justify-center">
          <button
            onClick={() => nextStep()}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors"
          >
            Activar producción <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  };

  // ── Step 9: Production ───────────────────────────────────────────────────────
  const ProductionStep = () => (
    <div className="space-y-6">
      <div className="text-center space-y-3">
        <div className="w-16 h-16 rounded-2xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center mx-auto">
          <Rocket className="w-8 h-8 text-orange-400" />
        </div>
        <h2 className="text-xl font-bold text-foreground">¡Listo para producción!</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Tu integración de WhatsApp Business ha pasado todas las verificaciones.
          Pulsa el botón para activar el modo producción.
        </p>
      </div>

      <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-3">
        <div className="text-sm font-semibold text-foreground">Resumen de la integración</div>
        <div className="space-y-2 text-[11px] text-muted-foreground">
          <div className="flex justify-between">
            <span>Canal</span>
            <span className="text-foreground font-medium">WhatsApp Business</span>
          </div>
          <div className="flex justify-between">
            <span>Health Check</span>
            <span className="text-green-400 font-medium">
              {state.errors.length === 0 ? "✓ OK" : `${state.errors.length} errores`}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Prueba de envío</span>
            <span className={cn("font-medium", state.testResult?.success ? "text-green-400" : "text-amber-400")}>
              {state.testResult?.success ? "✓ OK" : "Pendiente"}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Modo actual</span>
            <span className="text-foreground font-medium">{state.report?.mode?.toUpperCase() ?? "STAGING"}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center gap-3">
        <button
          onClick={() => void handleProduction()}
          disabled={productionLoading}
          className={cn(
            "flex items-center gap-2 px-8 py-4 rounded-xl font-bold text-base transition-colors shadow-lg",
            productionLoading
              ? "bg-white/[0.04] text-white/20 cursor-not-allowed"
              : "bg-orange-500 text-white hover:bg-orange-400 shadow-orange-500/20",
          )}
        >
          {productionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Rocket className="w-5 h-5" />}
          {productionLoading ? "Activando..." : "Marcar como PRODUCCIÓN"}
        </button>

        <button
          onClick={() => setLocation("/integrations")}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Volver al panel de integraciones
        </button>
      </div>
    </div>
  );

  // ── Main render ──────────────────────────────────────────────────────────────
  const stepComponents: Record<WizardStep, () => React.ReactNode> = {
    welcome:       WelcomeStep,
    detect:        DetectStep,
    migration:     MigrationStep,
    "meta-connect": MetaConnectStep,
    capture:       CaptureStep,
    health:        HealthStep,
    test:          TestStep,
    report:        ReportStep,
    production:    ProductionStep,
  };

  const CurrentStep = stepComponents[state.step];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <MessageCircle className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">Omni Integration Wizard</h1>
            <p className="text-xs text-muted-foreground">WhatsApp Business → paso {stepIndex + 1} de {STEP_ORDER.length}</p>
          </div>
          <button
            onClick={() => setLocation("/integrations")}
            className="ml-auto w-8 h-8 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-1 mb-8">
          {STEP_ORDER.map((step, i) => {
            const done = isStepComplete(step) || i < stepIndex;
            const active = step === state.step;
            const meta = STEP_META[step];
            return (
              <div key={step} className="flex-1 flex flex-col items-center gap-1.5">
                <div className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center border text-xs transition-all",
                  done
                    ? "bg-green-500/15 border-green-500/25 text-green-400"
                    : active
                    ? "bg-primary/15 border-primary/25 text-primary"
                    : "bg-white/[0.04] border-white/[0.08] text-muted-foreground",
                )}>
                  {done ? <CheckCircle2 className="w-4 h-4" /> : meta.icon}
                </div>
                <div className={cn(
                  "text-[9px] font-medium text-center leading-tight hidden sm:block",
                  active ? "text-primary" : done ? "text-green-400" : "text-muted-foreground",
                )}>
                  {STEP_LABELS[step].label}
                </div>
              </div>
            );
          })}
        </div>

        {/* Step content */}
        <div className="min-h-[400px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={state.step}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              <CurrentStep />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer nav */}
        <div className="flex items-center justify-between mt-8 pt-6 border-t border-border">
          <button
            onClick={prevStep}
            disabled={stepIndex === 0}
            className={cn(
              "flex items-center gap-1.5 text-xs font-medium transition-colors",
              stepIndex === 0 ? "text-muted-foreground/30 cursor-not-allowed" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Anterior
          </button>
          <div className="text-[10px] text-muted-foreground">
            {stepIndex + 1} / {STEP_ORDER.length}
          </div>
          <button
            onClick={nextStep}
            disabled={stepIndex === STEP_ORDER.length - 1 || state.step === "capture" || state.step === "health" || state.step === "production"}
            className={cn(
              "flex items-center gap-1.5 text-xs font-medium transition-colors",
              stepIndex === STEP_ORDER.length - 1 || state.step === "capture" || state.step === "health" || state.step === "production"
                ? "text-muted-foreground/30 cursor-not-allowed"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Siguiente <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Small icon helper ──────────────────────────────────────────────────────────
function InfoIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}
