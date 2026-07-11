import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useOrg } from "@/lib/orgContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Zap, Check, X, Crown, Rocket, Building2, Users, Brain,
  BarChart3, Puzzle, MessageSquare, Receipt, Shield, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface PlanInfo {
  key: string;
  name: string;
  price: string;
  description: string;
  icon: React.ElementType;
  color: string;
  users: number;
  modules: string[];
}

const PLANS: PlanInfo[] = [
  {
    key: "starter",
    name: "Starter",
    price: "99€/mes",
    description: "Para freelancers y autónomos",
    icon: Zap,
    color: "blue",
    users: 3,
    modules: ["crm", "whatsapp", "omni_marketing", "knowledge_base", "omni_accounting", "ai_agents", "quotes", "portal_cliente"],
  },
  {
    key: "professional",
    name: "Professional",
    price: "149€/mes",
    description: "Para equipos en crecimiento",
    icon: Rocket,
    color: "violet",
    users: 10,
    modules: ["crm", "whatsapp", "omni_marketing", "knowledge_base", "omni_accounting", "ai_agents", "quotes", "portal_cliente", "automations", "integrations", "analytics", "omni_docs"],
  },
  {
    key: "business",
    name: "Business",
    price: "299€/mes",
    description: "Para empresas consolidadas",
    icon: Crown,
    color: "amber",
    users: 25,
    modules: ["crm", "whatsapp", "omni_marketing", "knowledge_base", "omni_accounting", "ai_agents", "quotes", "portal_cliente", "automations", "integrations", "analytics", "omni_docs", "omni_import_ai", "omni_ads", "omni_leads", "omni_tax", "omni_diagnostics", "omni_security"],
  },
  {
    key: "enterprise",
    name: "Enterprise",
    price: "1.000€+/mes",
    description: "Para grandes organizaciones",
    icon: Building2,
    color: "rose",
    users: 999,
    modules: ["crm", "whatsapp", "omni_marketing", "knowledge_base", "omni_accounting", "ai_agents", "quotes", "portal_cliente", "automations", "integrations", "analytics", "omni_docs", "omni_import_ai", "omni_ads", "omni_leads", "omni_tax", "omni_diagnostics", "omni_security"],
  },
];

const ALL_MODULES = [
  { key: "crm",            label: "CRM & Clientes",    icon: Users },
  { key: "quotes",         label: "Presupuestos",       icon: Sparkles },
  { key: "ai_agents",      label: "AI Agents",          icon: Brain },
  { key: "whatsapp",       label: "WhatsApp Business",  icon: MessageSquare },
  { key: "omni_marketing", label: "Marketing Hub",      icon: Shield },
  { key: "omni_accounting",label: "Contabilidad",       icon: Receipt },
  { key: "knowledge_base", label: "Base de Conocimiento", icon: Shield },
  { key: "portal_cliente", label: "Portal Cliente",     icon: Users },
  { key: "analytics",      label: "Analytics",          icon: BarChart3 },
  { key: "integrations",   label: "Integraciones",      icon: Puzzle },
  { key: "automations",    label: "Automatizaciones",   icon: Zap },
  { key: "omni_docs",      label: "Documentación",      icon: Shield },
  { key: "omni_import_ai", label: "Omni Import AI",     icon: Sparkles },
  { key: "omni_ads",       label: "OmniAds",            icon: BarChart3 },
  { key: "omni_leads",     label: "OmniLeads AI",       icon: Users },
  { key: "omni_tax",       label: "OmniTax",            icon: Receipt },
  { key: "omni_security",  label: "Seguridad",          icon: Shield },
];

export default function PlansPage() {
  const { org, canAccessModule } = useOrg();
  const currentPlan = org?.plan ?? "free";

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold text-white">Planes y Módulos</h1>
        <p className="text-sm text-muted-foreground">
          Gestiona tu plan y activa módulos según tus necesidades
        </p>
        <Badge variant="outline" className="text-primary border-primary/30">
          Plan actual: <span className="capitalize font-semibold ml-1">{currentPlan}</span>
        </Badge>
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {PLANS.map(plan => {
          const isCurrent = plan.key === currentPlan;
          const Icon = plan.icon;
          return (
            <Card
              key={plan.key}
              className={cn(
                "bg-card border-border transition-all",
                isCurrent && "ring-1 ring-primary/30 border-primary/20",
              )}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", `bg-${plan.color}-500/15 text-${plan.color}-400`)}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <CardTitle className="text-base">{plan.name}</CardTitle>
                  {isCurrent && (
                    <Badge variant="outline" className="text-[10px] h-5 border-emerald-500/30 text-emerald-400 ml-auto">
                      Activo
                    </Badge>
                  )}
                </div>
                <p className="text-2xl font-bold text-white">{plan.price}</p>
                <p className="text-xs text-muted-foreground">{plan.description}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Users className="w-3.5 h-3.5" />
                  Hasta {plan.users} usuarios
                </div>
                <div className="space-y-1.5">
                  {ALL_MODULES.map(mod => {
                    const hasModule = plan.modules.includes(mod.key);
                    const ModIcon = mod.icon;
                    return (
                      <div key={mod.key} className="flex items-center gap-2 text-xs">
                        {hasModule ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <X className="w-3.5 h-3.5 text-muted-foreground/30" />
                        )}
                        <ModIcon className={cn("w-3.5 h-3.5", hasModule ? "text-foreground" : "text-muted-foreground/30")} />
                        <span className={hasModule ? "text-foreground" : "text-muted-foreground/40"}>{mod.label}</span>
                      </div>
                    );
                  })}
                </div>
                <Button
                  variant={isCurrent ? "outline" : "default"}
                  className="w-full text-xs h-8"
                  disabled={isCurrent}
                >
                  {isCurrent ? "Plan Actual" : "Seleccionar"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Module activation status */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-sm">Estado de Módulos</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {ALL_MODULES.map(mod => {
              const ModIcon = mod.icon;
              const enabled = canAccessModule(mod.key);
              return (
                <div key={mod.key} className={cn(
                  "flex items-center gap-2 p-2.5 rounded-lg border",
                  enabled ? "bg-emerald-500/5 border-emerald-500/15" : "bg-muted/30 border-border",
                )}>
                  <ModIcon className={cn("w-4 h-4", enabled ? "text-emerald-400" : "text-muted-foreground/40")} />
                  <span className={cn("text-xs", enabled ? "text-foreground" : "text-muted-foreground/40")}>{mod.label}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
