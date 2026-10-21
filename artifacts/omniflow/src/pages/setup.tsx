import { useState } from "react";
import { useOrg } from "@/lib/orgContext";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { useLocation } from "wouter";
import {
  Hexagon, Building2, Users, Sparkles, ArrowRight, ArrowLeft, Loader2, ShieldOff,
  Home, GraduationCap, HeartPulse, LayoutGrid, SprayCan, User, Briefcase, Check, Copy, CheckCheck,
} from "lucide-react";
import {
  resolveChooserSelection,
  type ExperienceType,
  type PersonaNeed,
  type A3ServiceType,
  type A3ClientSegment,
} from "@/lib/experienceChooser";

type Step = "name" | "branch" | "persona-needs" | "a3-service" | "a3-client" | "result";

export default function Setup() {
  const { org, loading } = useOrg();
  const { isSuperAdmin, loading: adminLoading } = useSuperAdmin();
  const [, setLocation] = useLocation();

  const [step, setStep] = useState<Step>("name");
  const [clientName, setClientName] = useState("");
  const [experienceType, setExperienceType] = useState<ExperienceType | null>(null);
  const [personaNeeds, setPersonaNeeds] = useState<Set<PersonaNeed>>(new Set());
  const [a3ServiceTypes, setA3ServiceTypes] = useState<Set<A3ServiceType>>(new Set());
  const [a3ClientSegment, setA3ClientSegment] = useState<A3ClientSegment | null>(null);
  const [copied, setCopied] = useState(false);

  if (org) {
    setLocation("/dashboard");
    return null;
  }

  if (loading || adminLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!isSuperAdmin) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
        <div className="w-full max-w-md text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-destructive/10 border border-destructive/20 mb-6">
            <ShieldOff className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-3">Sin acceso</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            No tienes un workspace asignado.
            <br />
            Contacta con tu administrador para recibir una invitación.
          </p>
        </div>
      </div>
    );
  }

  const togglePersonaNeed = (need: PersonaNeed) => {
    setPersonaNeeds((prev) => {
      const next = new Set(prev);
      if (next.has(need)) next.delete(need);
      else next.add(need);
      return next;
    });
  };

  const toggleA3Service = (svc: A3ServiceType) => {
    setA3ServiceTypes((prev) => {
      const next = new Set(prev);
      if (next.has(svc)) next.delete(svc);
      else next.add(svc);
      return next;
    });
  };

  const goToBranchResult = (branch: ExperienceType) => {
    setExperienceType(branch);
    setPersonaNeeds(new Set());
    setA3ServiceTypes(new Set());
    setA3ClientSegment(null);
    if (branch === "business") {
      setStep("result");
    } else if (branch === "personal") {
      setStep("persona-needs");
    } else {
      setStep("a3-service");
    }
  };

  const result =
    experienceType && step === "result"
      ? resolveChooserSelection({
          clientName,
          experienceType,
          personaNeeds: Array.from(personaNeeds),
          a3ServiceTypes: Array.from(a3ServiceTypes),
          a3ClientSegment,
        })
      : null;

  const handleCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.instructions);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard puede fallar sin https/permiso — no bloquea el flujo
    }
  };

  const resetAll = () => {
    setStep("name");
    setClientName("");
    setExperienceType(null);
    setPersonaNeeds(new Set());
    setA3ServiceTypes(new Set());
    setA3ClientSegment(null);
    setCopied(false);
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10">
      <div className={step === "result" ? "w-full max-w-2xl" : "w-full max-w-md"}>
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 mb-4">
            <Hexagon className="w-7 h-7 text-primary fill-primary/20" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">
            {step === "result" ? "Ficha lista" : "Nueva experiencia"}
          </h1>
          <p className="text-muted-foreground text-sm">
            {step === "result"
              ? "Esto no crea nada todavía — usa la ficha para darlo de alta en Control Center."
              : "Cuéntame para quién es, y elegimos juntos qué experiencia le encaja."}
          </p>
        </div>

        {step === "name" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (clientName.trim()) setStep("branch");
            }}
            className="bg-card border border-border rounded-2xl p-6 space-y-4"
          >
            <div className="space-y-2">
              <label htmlFor="clientName" className="block text-sm font-medium text-foreground">
                Nombre del cliente o workspace
              </label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  id="clientName"
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Ej: Clínica Dental Sonrisa, Ana García..."
                  maxLength={80}
                  required
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-[hsl(220,20%,18%)] border border-border text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-all text-sm"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={!clientName.trim()}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continuar
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        )}

        {step === "branch" && (
          <div className="space-y-3">
            <BranchCard
              icon={<Building2 className="w-6 h-6" />}
              title="Empresa"
              description="Experiencia de negocio completa — CRM, facturación, automatizaciones."
              onClick={() => goToBranchResult("business")}
            />
            <BranchCard
              icon={<Users className="w-6 h-6" />}
              title="Persona"
              description="Hogar, aprendizaje y bienestar — combinables."
              onClick={() => goToBranchResult("personal")}
            />
            <BranchCard
              icon={<Sparkles className="w-6 h-6" />}
              title="A3"
              description="Ordenación de espacios y limpieza profesional."
              onClick={() => goToBranchResult("a3")}
            />
            <BackLink onClick={() => setStep("name")} />
          </div>
        )}

        {step === "persona-needs" && (
          <div className="space-y-3">
            <ToggleCard
              icon={<Home className="w-5 h-5" />}
              title="Hogar"
              selected={personaNeeds.has("home")}
              onClick={() => togglePersonaNeed("home")}
            />
            <ToggleCard
              icon={<GraduationCap className="w-5 h-5" />}
              title="Aprender"
              selected={personaNeeds.has("learn")}
              onClick={() => togglePersonaNeed("learn")}
            />
            <ToggleCard
              icon={<HeartPulse className="w-5 h-5" />}
              title="Bienestar"
              selected={personaNeeds.has("wellness")}
              onClick={() => togglePersonaNeed("wellness")}
            />
            <div className="flex items-center gap-3 pt-2">
              <BackLink onClick={() => setStep("branch")} />
              <button
                type="button"
                disabled={personaNeeds.size === 0}
                onClick={() => setStep("result")}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continuar
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {step === "a3-service" && (
          <div className="space-y-3">
            <ToggleCard
              icon={<LayoutGrid className="w-5 h-5" />}
              title="Ordenación de espacios"
              selected={a3ServiceTypes.has("organization")}
              onClick={() => toggleA3Service("organization")}
            />
            <ToggleCard
              icon={<SprayCan className="w-5 h-5" />}
              title="Limpieza profesional"
              selected={a3ServiceTypes.has("cleaning")}
              onClick={() => toggleA3Service("cleaning")}
            />
            <div className="flex items-center gap-3 pt-2">
              <BackLink onClick={() => setStep("branch")} />
              <button
                type="button"
                disabled={a3ServiceTypes.size === 0}
                onClick={() => setStep("a3-client")}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continuar
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {step === "a3-client" && (
          <div className="space-y-3">
            <ToggleCard
              icon={<User className="w-5 h-5" />}
              title="Particular"
              selected={a3ClientSegment === "individual"}
              onClick={() => setA3ClientSegment("individual")}
            />
            <ToggleCard
              icon={<Briefcase className="w-5 h-5" />}
              title="Profesional"
              selected={a3ClientSegment === "professional"}
              onClick={() => setA3ClientSegment("professional")}
            />
            <div className="flex items-center gap-3 pt-2">
              <BackLink onClick={() => setStep("a3-service")} />
              <button
                type="button"
                disabled={!a3ClientSegment}
                onClick={() => setStep("result")}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continuar
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {step === "result" && result && (
          <div className="space-y-4">
            <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-2 text-primary">
                <Check className="w-5 h-5" />
                <span className="font-semibold text-sm">{clientName}</span>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Experiencia</p>
                <p className="text-foreground font-medium">{result.branchLabel}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Plan recomendado</p>
                <p className="text-foreground font-medium">{result.recommendedPlan}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Módulos</p>
                <div className="flex flex-wrap gap-2">
                  {result.modules.map((m) => (
                    <span
                      key={m.slug}
                      className={
                        "text-xs px-2.5 py-1 rounded-full border " +
                        (m.isNew
                          ? "border-amber-500/40 text-amber-400 bg-amber-500/10"
                          : "border-primary/30 text-primary bg-primary/10")
                      }
                    >
                      {m.label}{m.isNew ? " · nuevo" : ""}
                    </span>
                  ))}
                </div>
                {result.hasNewModules && (
                  <p className="text-xs text-amber-400/80 mt-2">
                    Los módulos marcados "nuevo" aún no existen en el catálogo del backend — la ficha de abajo explica cómo activarlos a mano mientras tanto.
                  </p>
                )}
              </div>
            </div>

            <div className="bg-card border border-border rounded-2xl p-6 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Instrucción de alta</p>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  {copied ? <CheckCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? "Copiado" : "Copiar"}
                </button>
              </div>
              <pre className="whitespace-pre-wrap text-xs text-foreground/90 bg-[hsl(220,20%,14%)] border border-border rounded-lg p-4 font-mono leading-relaxed">
                {result.instructions}
              </pre>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={resetAll}
                className="flex items-center gap-2 py-2.5 px-4 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 text-sm transition-all"
              >
                <ArrowLeft className="w-4 h-4" />
                Nueva ficha
              </button>
              <a
                href="/control-center/onboard-wizard"
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm transition-all"
              >
                Ir a Onboard Wizard
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BranchCard({
  icon, title, description, onClick,
}: { icon: React.ReactNode; title: string; description: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-card border border-border rounded-2xl p-5 flex items-start gap-4 hover:border-primary/50 hover:bg-primary/5 transition-all group"
    >
      <div className="shrink-0 w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary group-hover:bg-primary/20 transition-colors">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
      </div>
      <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 ml-auto mt-3 group-hover:text-primary transition-colors" />
    </button>
  );
}

function ToggleCard({
  icon, title, selected, onClick,
}: { icon: React.ReactNode; title: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "w-full text-left rounded-2xl p-4 flex items-center gap-3 border transition-all " +
        (selected
          ? "border-primary bg-primary/10"
          : "border-border bg-card hover:border-primary/40")
      }
    >
      <div
        className={
          "shrink-0 w-9 h-9 rounded-lg flex items-center justify-center border transition-colors " +
          (selected ? "bg-primary/20 border-primary/40 text-primary" : "bg-muted/30 border-border text-muted-foreground")
        }
      >
        {icon}
      </div>
      <span className={"font-medium flex-1 " + (selected ? "text-foreground" : "text-foreground/90")}>{title}</span>
      {selected && <Check className="w-4 h-4 text-primary shrink-0" />}
    </button>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors py-2.5 px-3"
    >
      <ArrowLeft className="w-4 h-4" />
      Atrás
    </button>
  );
}
