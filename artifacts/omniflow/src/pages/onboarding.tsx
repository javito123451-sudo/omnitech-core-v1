import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2, Circle, Rocket, User, Plug, Users, FileText,
  ChevronRight, SkipForward, Sparkles,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface OnboardingStatus {
  orgId: number;
  orgName: string;
  plan: string;
  status: string;
  step: number;
  stepLabel: string;
  completedAt: string | null;
  steps: { id: number; label: string; completed: boolean }[];
}

async function fetchOnboarding(): Promise<OnboardingStatus> {
  const res = await authFetch(`${BASE}/api/onboarding/status`);
  if (!res.ok) throw new Error("Error cargando onboarding");
  return res.json();
}

async function advanceOnboarding(step: number) {
  const res = await authFetch(`${BASE}/api/onboarding/progress`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ step }),
  });
  if (!res.ok) throw new Error("Error actualizando onboarding");
  return res.json();
}

const STEP_CONFIG = [
  { id: 1, label: "Bienvenida", icon: Sparkles, description: "Configura tu perfil y conoce OmniTech" },
  { id: 2, label: "Perfil de empresa", icon: User, description: "Añade tu logo y datos de contacto" },
  { id: 3, label: "Integraciones", icon: Plug, description: "Conecta WhatsApp, Telegram, Calendario" },
  { id: 4, label: "Primer cliente", icon: Users, description: "Registra tu primer cliente en el CRM" },
  { id: 5, label: "Primer presupuesto", icon: FileText, description: "Crea y envía tu primer presupuesto" },
  { id: 6, label: "Workspace activado", icon: Rocket, description: "¡Todo listo! Empieza a trabajar" },
];

export default function OnboardingPage() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { data, isLoading } = useQuery({ queryKey: ["onboarding"], queryFn: fetchOnboarding });
  const [activeStep, setActiveStep] = useState(0);

  const mutation = useMutation({
    mutationFn: advanceOnboarding,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["onboarding"] }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const currentStep = data?.step ?? 0;
  const progress = currentStep >= 6 ? 100 : Math.round((currentStep / 6) * 100);
  const isComplete = currentStep >= 6;

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold text-white">
          {isComplete ? "¡Onboarding Completado!" : "Bienvenido a OmniTech"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {data?.orgName} • Plan <span className="capitalize">{data?.plan}</span>
        </p>
      </div>

      <Card className="bg-card border-border">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">Progreso</span>
            <span className="text-xs font-medium text-white">{progress}%</span>
          </div>
          <Progress value={progress} className="h-2" />
        </CardContent>
      </Card>

      <div className="space-y-3">
        {STEP_CONFIG.map((step) => {
          const isDone = currentStep >= step.id;
          const isCurrent = currentStep + 1 === step.id;
          const Icon = step.icon;
          return (
            <Card
              key={step.id}
              className={cn(
                "bg-card border-border transition-all",
                isCurrent && "border-primary/30 ring-1 ring-primary/20",
                isDone && "opacity-80",
              )}
            >
              <CardContent className="p-4 flex items-start gap-4">
                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                  isDone ? "bg-emerald-500/15 text-emerald-400" :
                  isCurrent ? "bg-primary/15 text-primary" :
                  "bg-muted text-muted-foreground",
                )}>
                  {isDone ? <CheckCircle2 className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-white">{step.label}</h3>
                    {isDone && <Badge variant="outline" className="text-[10px] h-4 border-emerald-500/30 text-emerald-400">Hecho</Badge>}
                    {isCurrent && <Badge variant="outline" className="text-[10px] h-4 border-primary/30 text-primary">Actual</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                  {isCurrent && !mutation.isPending && (
                    <div className="flex items-center gap-2 mt-3">
                      <Button size="sm" className="h-7 text-xs" onClick={() => mutation.mutate(step.id)}>
                        Completar <ChevronRight className="w-3 h-3 ml-1" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => mutation.mutate(step.id)}>
                        <SkipForward className="w-3 h-3 mr-1" /> Saltar
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {isComplete && (
        <div className="text-center pt-4">
          <Button onClick={() => setLocation("/dashboard")}>
            <Rocket className="w-4 h-4 mr-2" /> Ir al Dashboard
          </Button>
        </div>
      )}
    </div>
  );
}
