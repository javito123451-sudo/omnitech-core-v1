import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2, ChevronRight, ChevronLeft, CheckCircle2, Circle,
  Save, Loader2, Plus, Trash2, FileSpreadsheet, Upload, User,
  Briefcase, Home, Heart, UtensilsCrossed, ShoppingBag, Scale,
  Megaphone, Settings, Sparkles, Crown, Users, Receipt, ShieldCheck,
  Bot, Zap, Plug, MessageSquare, Phone, Mail, CalendarDays, CreditCard,
  FileSignature, Brain, Globe, Percent, Wallet, AlertCircle,
  X, CheckCheck, ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/authFetch";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const STEPS = [
  { id: 1, label: "Datos de empresa",      icon: Building2,      description: "Nombre, CIF, contacto, logo" },
  { id: 2, label: "Crear Workspace",       icon: CheckCircle2,   description: "Workspace y organizacion base" },
  { id: 3, label: "Plan contratado",       icon: Crown,          description: "Seleccionar plan de licencia" },
  { id: 4, label: "Modulos",               icon: Zap,            description: "Activar modulos por feature flags" },
  { id: 5, label: "Administrador",         icon: User,           description: "Crear usuario admin principal" },
  { id: 6, label: "Equipo",                icon: Users,          description: "Invitar miembros del equipo" },
  { id: 7, label: "Clientes",              icon: Users,          description: "Importar o crear clientes" },
  { id: 8, label: "Configuracion fiscal",  icon: Receipt,        description: "Tipo empresa, regimen, IVA, IRPF" },
  { id: 9, label: "Integraciones",         icon: Plug,           description: "WhatsApp, Telegram, Email, Stripe" },
  { id: 10, label: "IA Ava",               icon: Bot,            description: "Configurar asistente virtual" },
];

const PLANS = [
  { slug: "free",      name: "Free",      modules: ["crm","quotes"],                             maxUsers: 2,  maxClients: 50,  color: "bg-slate-500" },
  { slug: "starter",   name: "Starter",   modules: ["crm","quotes","omni_accounting","omni_tax"],  maxUsers: 5,  maxClients: 200, color: "bg-emerald-500" },
  { slug: "growth",    name: "Growth",    modules: ["crm","quotes","omni_accounting","omni_tax","ai_agents","whatsapp","automations"], maxUsers: 15, maxClients: 1000, color: "bg-blue-500" },
  { slug: "scale",     name: "Scale",     modules: ["crm","quotes","omni_accounting","omni_tax","ai_agents","whatsapp","automations","analytics","integrations","knowledge_base","portal_cliente"], maxUsers: 50, maxClients: 5000, color: "bg-violet-500" },
  { slug: "enterprise",name: "Enterprise", modules: ["crm","quotes","omni_accounting","omni_tax","ai_agents","whatsapp","automations","analytics","integrations","knowledge_base","portal_cliente","omni_docs"], maxUsers: 999, maxClients: 99999, color: "bg-amber-500" },
];

const ALL_MODULES = [
  { slug: "crm",           name: "CRM",                icon: Users,          group: "Core" },
  { slug: "quotes",        name: "Presupuestos",       icon: Receipt,        group: "Core" },
  { slug: "omni_accounting", name: "Contabilidad",     icon: Receipt,        group: "Finanzas" },
  { slug: "omni_tax",      name: "OmniTax",            icon: ShieldCheck,    group: "Finanzas" },
  { slug: "ai_agents",     name: "IA Ava",            icon: Brain,          group: "Inteligencia" },
  { slug: "automations",   name: "Automatizaciones",   icon: Zap,            group: "Inteligencia" },
  { slug: "analytics",     name: "Analytics",          icon: Sparkles,       group: "Inteligencia" },
  { slug: "integrations",  name: "Integraciones",      icon: Plug,           group: "Conectividad" },
  { slug: "whatsapp",      name: "WhatsApp",           icon: MessageSquare,  group: "Conectividad" },
  { slug: "telegram",      name: "Telegram",           icon: MessageSquare,  group: "Conectividad" },
  { slug: "email",         name: "Email",              icon: Mail,           group: "Conectividad" },
  { slug: "omni_import_ai", name: "Omni Import AI",    icon: Upload,         group: "Herramientas" },
  { slug: "knowledge_base", name: "Base de Conocimiento", icon: Brain,         group: "Herramientas" },
  { slug: "portal_cliente", name: "Portal Cliente",      icon: Users,          group: "Herramientas" },
  { slug: "omni_docs",     name: "Documentos",         icon: FileSignature,  group: "Herramientas" },
  { slug: "firma",         name: "Firma electronica",  icon: FileSignature,  group: "Herramientas" },
];

const TEMPLATE_ICONS: Record<string, React.ElementType> = {
  User, Building2, Megaphone, Home, Heart, UtensilsCrossed, ShoppingBag, Scale, Briefcase, Settings,
};

const TEAM_ROLES = [
  "admin", "manager", "comercial", "vendedor", "contabilidad",
  "gestor", "marketing", "atencion_cliente", "soporte", "member",
];

interface WizardData {
  companyName: string; legalName: string; taxId: string;
  country: string; address: string; phone: string; email: string;
  website: string; timezone: string; language: string; currency: string;
  slug: string; plan: string; modules: string[];
  adminName: string; adminEmail: string; adminPassword: string; sendInvite: boolean;
  team: Array<{ name: string; email: string; role: string }>;
  clients: Array<{ name: string; email: string; phone: string; source: string }>;
  companyType: string; regime: string; vat: boolean; irpf: boolean; fiscalCountry: string;
  integrations: string[];
  aiName: string; aiLanguage: string; aiPersonality: string; aiAutomationLevel: string;
  templateSlug: string | null;
}

const EMPTY_WIZARD: WizardData = {
  companyName: "", legalName: "", taxId: "", country: "ES", address: "", phone: "", email: "", website: "",
  timezone: "Europe/Madrid", language: "es", currency: "EUR",
  slug: "", plan: "starter", modules: ["crm","quotes"],
  adminName: "", adminEmail: "", adminPassword: "", sendInvite: true,
  team: [], clients: [],
  companyType: "autonomo", regime: "estimacion_directa", vat: true, irpf: true, fiscalCountry: "ES",
  integrations: [],
  aiName: "Ava", aiLanguage: "es", aiPersonality: "profesional", aiAutomationLevel: "media",
  templateSlug: null,
};

interface OnboardTemplate {
  id: number; slug: string; name: string; description: string;
  icon: string; defaultModules: string[]; defaultFiscal: Record<string, unknown>;
  recommendedPlan: string; defaultRoles: Array<{ role: string; count: number }>;
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Step 1 — Datos de empresa
   ═══════════════════════════════════════════════════════════════════════════════ */
function StepCompany({ data, setData, onNext }: { data: WizardData; setData: (d: WizardData) => void; onNext: () => void }) {
  const valid = data.companyName.length >= 2;
  return (
    <div className="space-y-5 max-w-2xl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2"><Label>Nombre comercial *</Label><Input value={data.companyName} onChange={e => setData({ ...data, companyName: e.target.value })} placeholder="Mi Empresa S.L." /></div>
        <div className="space-y-2"><Label>Razon social</Label><Input value={data.legalName} onChange={e => setData({ ...data, legalName: e.target.value })} placeholder="Mi Empresa Sociedad Limitada" /></div>
        <div className="space-y-2"><Label>CIF / NIF</Label><Input value={data.taxId} onChange={e => setData({ ...data, taxId: e.target.value })} placeholder="B12345678" /></div>
        <div className="space-y-2"><Label>Pais</Label>
          <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={data.country} onChange={e => setData({ ...data, country: e.target.value })}>
            <option value="ES">Espana</option><option value="MX">Mexico</option><option value="AR">Argentina</option><option value="CO">Colombia</option><option value="CL">Chile</option><option value="PE">Peru</option><option value="US">Estados Unidos</option><option value="UK">Reino Unido</option><option value="FR">Francia</option><option value="DE">Alemania</option><option value="PT">Portugal</option><option value="IT">Italia</option>
          </select>
        </div>
        <div className="space-y-2 md:col-span-2"><Label>Direccion</Label><Input value={data.address} onChange={e => setData({ ...data, address: e.target.value })} placeholder="Calle Mayor 123, Madrid" /></div>
        <div className="space-y-2"><Label>Telefono</Label><Input value={data.phone} onChange={e => setData({ ...data, phone: e.target.value })} placeholder="+34 600 000 000" /></div>
        <div className="space-y-2"><Label>Email corporativo</Label><Input value={data.email} onChange={e => setData({ ...data, email: e.target.value })} placeholder="info@miempresa.com" type="email" /></div>
        <div className="space-y-2"><Label>Web</Label><Input value={data.website} onChange={e => setData({ ...data, website: e.target.value })} placeholder="https://miempresa.com" /></div>
        <div className="space-y-2"><Label>Zona horaria</Label>
          <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={data.timezone} onChange={e => setData({ ...data, timezone: e.target.value })}>
            <option value="Europe/Madrid">Europe/Madrid</option><option value="America/Mexico_City">America/Mexico City</option><option value="America/Buenos_Aires">America/Buenos Aires</option><option value="America/Bogota">America/Bogota</option><option value="America/Santiago">America/Santiago</option><option value="America/Lima">America/Lima</option><option value="America/New_York">America/New York</option><option value="Europe/London">Europe/London</option><option value="Europe/Paris">Europe/Paris</option><option value="Europe/Berlin">Europe/Berlin</option>
          </select>
        </div>
        <div className="space-y-2"><Label>Idioma</Label>
          <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={data.language} onChange={e => setData({ ...data, language: e.target.value })}>
            <option value="es">Espanol</option><option value="en">English</option><option value="fr">Francais</option><option value="de">Deutsch</option><option value="pt">Portugues</option><option value="it">Italiano</option>
          </select>
        </div>
        <div className="space-y-2"><Label>Moneda</Label>
          <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={data.currency} onChange={e => setData({ ...data, currency: e.target.value })}>
            <option value="EUR">EUR (&euro;)</option><option value="USD">USD ($)</option><option value="GBP">GBP (&pound;)</option><option value="MXN">MXN ($)</option><option value="ARS">ARS ($)</option><option value="COP">COP ($)</option><option value="CLP">CLP ($)</option><option value="PEN">PEN (S/)</option>
          </select>
        </div>
      </div>
      <div className="flex justify-end pt-4">
        <Button onClick={onNext} disabled={!valid} className="gap-2">Siguiente <ChevronRight size={16} /></Button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Step 2 — Workspace
   ═══════════════════════════════════════════════════════════════════════════════ */
function StepWorkspace({ data, setData, onNext, onBack }: { data: WizardData; setData: (d: WizardData) => void; onNext: () => void; onBack: () => void }) {
  const autoSlug = data.companyName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  useEffect(() => {
    if (!data.slug && data.companyName) setData({ ...data, slug: autoSlug });
  }, [data.companyName]);
  return (
    <div className="space-y-5 max-w-xl">
      <Card className="border-violet-500/20">
        <CardHeader><CardTitle className="text-base">Resumen del Workspace</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Nombre</span><span className="font-medium">{data.companyName || "—"}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Slug</span><span className="font-medium font-mono">{data.slug || autoSlug || "—"}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Pais</span><span className="font-medium">{data.country}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Zona horaria</span><span className="font-medium">{data.timezone}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Moneda</span><span className="font-medium">{data.currency}</span></div>
        </CardContent>
      </Card>
      <div className="space-y-2">
        <Label>Slug personalizado (opcional)</Label>
        <Input value={data.slug} onChange={e => setData({ ...data, slug: e.target.value })} placeholder={autoSlug} />
        <p className="text-xs text-muted-foreground">Identificador unico en la URL. Solo letras, numeros y guiones.</p>
      </div>
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack} className="gap-2"><ChevronLeft size={16} /> Atras</Button>
        <Button onClick={onNext} className="gap-2">Siguiente <ChevronRight size={16} /></Button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Step 3 — Plan
   ═══════════════════════════════════════════════════════════════════════════════ */
function StepPlan({ data, setData, onNext, onBack }: { data: WizardData; setData: (d: WizardData) => void; onNext: () => void; onBack: () => void }) {
  const plan = PLANS.find(p => p.slug === data.plan) ?? PLANS[1]!;
  useEffect(() => {
    // sincronizar modulos con plan
    const planModules = new Set(plan.modules);
    const current = data.modules.filter(m => planModules.has(m) || !PLANS.some(pp => pp.modules.includes(m)));
    const missing = plan.modules.filter(m => !current.includes(m));
    if (missing.length > 0) setData({ ...data, modules: [...current, ...missing] });
  }, [data.plan]);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {PLANS.map(p => (
          <div key={p.slug} onClick={() => setData({ ...data, plan: p.slug })} className={cn(
            "cursor-pointer rounded-xl border-2 p-4 transition-all hover:shadow-md",
            data.plan === p.slug ? "border-violet-500 bg-violet-500/5" : "border-border hover:border-violet-300",
          )}>
            <div className={cn("w-3 h-3 rounded-full mb-2", p.color)} />
            <h4 className="font-semibold text-sm">{p.name}</h4>
            <p className="text-xs text-muted-foreground mt-1">Hasta {p.maxUsers} usuarios</p>
            <p className="text-xs text-muted-foreground">{p.maxClients} clientes</p>
            <div className="flex flex-wrap gap-1 mt-2">
              {p.modules.slice(0, 3).map(m => (
                <Badge key={m} variant="secondary" className="text-[10px] px-1 py-0">{ALL_MODULES.find(am => am.slug === m)?.name ?? m}</Badge>
              ))}
              {p.modules.length > 3 && <Badge variant="outline" className="text-[10px] px-1 py-0">+{p.modules.length - 3}</Badge>}
            </div>
          </div>
        ))}
      </div>
      <Card className="border-violet-500/20">
        <CardHeader><CardTitle className="text-base">Modulos incluidos en {plan.name}</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {plan.modules.map(m => (
              <Badge key={m} className={cn("gap-1", data.modules.includes(m) ? "bg-violet-600" : "bg-slate-500")}>
                <CheckCircle2 size={12} /> {ALL_MODULES.find(am => am.slug === m)?.name ?? m}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack} className="gap-2"><ChevronLeft size={16} /> Atras</Button>
        <Button onClick={onNext} className="gap-2">Siguiente <ChevronRight size={16} /></Button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Step 4 — Modulos (Feature Flags)
   ═══════════════════════════════════════════════════════════════════════════════ */
function StepModules({ data, setData, onNext, onBack }: { data: WizardData; setData: (d: WizardData) => void; onNext: () => void; onBack: () => void }) {
  const groups = [...new Set(ALL_MODULES.map(m => m.group))];
  const toggle = (slug: string) => {
    const set = new Set(data.modules);
    if (set.has(slug)) set.delete(slug); else set.add(slug);
    setData({ ...data, modules: Array.from(set) });
  };
  return (
    <div className="space-y-5">
      {groups.map(group => (
        <div key={group}>
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">{group}</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {ALL_MODULES.filter(m => m.group === group).map(m => {
              const enabled = data.modules.includes(m.slug);
              return (
                <div key={m.slug} onClick={() => toggle(m.slug)} className={cn(
                  "cursor-pointer flex items-center gap-3 rounded-xl border p-3 transition-all hover:shadow-sm",
                  enabled ? "border-violet-500 bg-violet-500/5" : "border-border hover:border-violet-300",
                )}>
                  <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", enabled ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-500")}>
                    <m.icon size={16} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{m.name}</p>
                  </div>
                  <Switch checked={enabled} onCheckedChange={() => toggle(m.slug)} />
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack} className="gap-2"><ChevronLeft size={16} /> Atras</Button>
        <Button onClick={onNext} className="gap-2">Siguiente <ChevronRight size={16} /></Button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Step 5 — Admin Principal
   ═══════════════════════════════════════════════════════════════════════════════ */
function StepAdmin({ data, setData, onNext, onBack }: { data: WizardData; setData: (d: WizardData) => void; onNext: () => void; onBack: () => void }) {
  const valid = data.adminName.length >= 2 && data.adminEmail.includes("@");
  return (
    <div className="space-y-5 max-w-xl">
      <div className="space-y-2"><Label>Nombre completo *</Label><Input value={data.adminName} onChange={e => setData({ ...data, adminName: e.target.value })} placeholder="Juan Garcia" /></div>
      <div className="space-y-2"><Label>Email *</Label><Input value={data.adminEmail} onChange={e => setData({ ...data, adminEmail: e.target.value })} placeholder="juan@empresa.com" type="email" /></div>
      <div className="space-y-2"><Label>Telefono</Label><Input value={data.adminPassword} onChange={e => setData({ ...data, adminPassword: e.target.value })} placeholder="+34 600 000 000" /></div>
      <div className="flex items-center gap-3 pt-2">
        <Switch checked={data.sendInvite} onCheckedChange={v => setData({ ...data, sendInvite: v })} />
        <Label className="cursor-pointer">Enviar invitacion por email</Label>
      </div>
      <p className="text-xs text-muted-foreground">Se asignara automaticamente el rol OWNER del Workspace.</p>
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack} className="gap-2"><ChevronLeft size={16} /> Atras</Button>
        <Button onClick={onNext} disabled={!valid} className="gap-2">Siguiente <ChevronRight size={16} /></Button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Step 6 — Equipo
   ═══════════════════════════════════════════════════════════════════════════════ */
function StepTeam({ data, setData, onNext, onBack }: { data: WizardData; setData: (d: WizardData) => void; onNext: () => void; onBack: () => void }) {
  const addMember = () => setData({ ...data, team: [...data.team, { name: "", email: "", role: "member" }] });
  const removeMember = (idx: number) => setData({ ...data, team: data.team.filter((_, i) => i !== idx) });
  const updateMember = (idx: number, field: string, value: string) => {
    const t = [...data.team];
    (t[idx] as Record<string, string>)[field] = value;
    setData({ ...data, team: t });
  };
  return (
    <div className="space-y-4 max-w-2xl">
      {data.team.map((m, i) => (
        <div key={i} className="flex items-end gap-3">
          <div className="flex-1 space-y-1"><Label className="text-xs">Nombre</Label><Input value={m.name} onChange={e => updateMember(i, "name", e.target.value)} placeholder="Nombre" size={20} className="h-9" /></div>
          <div className="flex-1 space-y-1"><Label className="text-xs">Email</Label><Input value={m.email} onChange={e => updateMember(i, "email", e.target.value)} placeholder="email@empresa.com" type="email" className="h-9" /></div>
          <div className="w-36 space-y-1"><Label className="text-xs">Rol</Label>
            <select className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm" value={m.role} onChange={e => updateMember(i, "role", e.target.value)}>
              {TEAM_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <Button variant="ghost" size="sm" onClick={() => removeMember(i)} className="h-9 text-red-500"><Trash2 size={14} /></Button>
        </div>
      ))}
      <Button variant="outline" onClick={addMember} className="gap-2"><Plus size={14} /> Anadir miembro</Button>
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack} className="gap-2"><ChevronLeft size={16} /> Atras</Button>
        <Button onClick={onNext} className="gap-2">Siguiente <ChevronRight size={16} /></Button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Step 7 — Clientes
   ═══════════════════════════════════════════════════════════════════════════════ */
function StepClients({ data, setData, onNext, onBack }: { data: WizardData; setData: (d: WizardData) => void; onNext: () => void; onBack: () => void }) {
  const addClient = (source: string) => setData({ ...data, clients: [...data.clients, { name: "", email: "", phone: "", source }] });
  const removeClient = (idx: number) => setData({ ...data, clients: data.clients.filter((_, i) => i !== idx) });
  const updateClient = (idx: number, field: string, value: string) => {
    const c = [...data.clients];
    (c[idx] as Record<string, string>)[field] = value;
    setData({ ...data, clients: c });
  };
  const addDemo = () => setData({ ...data, clients: [...data.clients, { name: "Cliente de Prueba", email: "demo@cliente.com", phone: "+34 600 000 001", source: "demo" }] });
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => addClient("manual")} className="gap-1"><Plus size={14} /> Manual</Button>
        <Button variant="outline" size="sm" onClick={addDemo} className="gap-1"><User size={14} /> Demo</Button>
        <Button variant="outline" size="sm" disabled className="gap-1 opacity-50"><FileSpreadsheet size={14} /> Excel (prox.)</Button>
        <Button variant="outline" size="sm" disabled className="gap-1 opacity-50"><Upload size={14} /> CSV (prox.)</Button>
      </div>
      {data.clients.map((c, i) => (
        <div key={i} className="flex items-end gap-3">
          <div className="flex-1 space-y-1"><Label className="text-xs">Nombre *</Label><Input value={c.name} onChange={e => updateClient(i, "name", e.target.value)} placeholder="Nombre cliente" className="h-9" /></div>
          <div className="flex-1 space-y-1"><Label className="text-xs">Email</Label><Input value={c.email} onChange={e => updateClient(i, "email", e.target.value)} placeholder="cliente@email.com" type="email" className="h-9" /></div>
          <div className="flex-1 space-y-1"><Label className="text-xs">Telefono</Label><Input value={c.phone} onChange={e => updateClient(i, "phone", e.target.value)} placeholder="+34..." className="h-9" /></div>
          <Button variant="ghost" size="sm" onClick={() => removeClient(i)} className="h-9 text-red-500"><Trash2 size={14} /></Button>
        </div>
      ))}
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack} className="gap-2"><ChevronLeft size={16} /> Atras</Button>
        <Button onClick={onNext} className="gap-2">Siguiente <ChevronRight size={16} /></Button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Step 8 — Configuracion Fiscal
   ═══════════════════════════════════════════════════════════════════════════════ */
function StepFiscal({ data, setData, onNext, onBack }: { data: WizardData; setData: (d: WizardData) => void; onNext: () => void; onBack: () => void }) {
  return (
    <div className="space-y-5 max-w-xl">
      <div className="space-y-2"><Label>Tipo de empresa</Label>
        <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={data.companyType} onChange={e => setData({ ...data, companyType: e.target.value })}>
          <option value="autonomo">Autonomo / Freelance</option>
          <option value="sociedad">Sociedad (SL / SA)</option>
          <option value="comunidad">Comunidad de Bienes</option>
          <option value="cooperativa">Cooperativa</option>
          <option value="asociacion">Asociacion / Fundacion</option>
        </select>
      </div>
      <div className="space-y-2"><Label>Regimen fiscal</Label>
        <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={data.regime} onChange={e => setData({ ...data, regime: e.target.value })}>
          <option value="estimacion_directa">Estimacion Directa</option>
          <option value="estimacion_objetiva">Estimacion Objetiva (Modulos)</option>
          <option value="simplificado">Regimen Simplificado</option>
          <option value="especial_agricola">Regimen Especial Agricola</option>
        </select>
      </div>
      <div className="flex items-center gap-6 pt-2">
        <div className="flex items-center gap-2"><Switch checked={data.vat} onCheckedChange={v => setData({ ...data, vat: v })} /><Label>IVA</Label></div>
        <div className="flex items-center gap-2"><Switch checked={data.irpf} onCheckedChange={v => setData({ ...data, irpf: v })} /><Label>IRPF</Label></div>
      </div>
      <div className="space-y-2"><Label>Pais fiscal</Label>
        <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={data.fiscalCountry} onChange={e => setData({ ...data, fiscalCountry: e.target.value })}>
          <option value="ES">Espana</option><option value="MX">Mexico</option><option value="AR">Argentina</option><option value="CO">Colombia</option><option value="CL">Chile</option><option value="PE">Peru</option>
        </select>
      </div>
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack} className="gap-2"><ChevronLeft size={16} /> Atras</Button>
        <Button onClick={onNext} className="gap-2">Siguiente <ChevronRight size={16} /></Button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Step 9 — Integraciones
   ═══════════════════════════════════════════════════════════════════════════════ */
function StepIntegrations({ data, setData, onNext, onBack }: { data: WizardData; setData: (d: WizardData) => void; onNext: () => void; onBack: () => void }) {
  const INTEGRATIONS = [
    { slug: "whatsapp", name: "WhatsApp Business", icon: MessageSquare, desc: "Mensajeria con clientes" },
    { slug: "telegram", name: "Telegram",          icon: MessageSquare, desc: "Bot de Telegram" },
    { slug: "email",    name: "Email (Resend)",    icon: Mail,          desc: "Envio de correos" },
    { slug: "calendar", name: "Calendario",        icon: CalendarDays,  desc: "Sincronizacion de citas" },
    { slug: "stripe",   name: "Stripe",            icon: CreditCard,    desc: "Pagos online" },
    { slug: "firma",    name: "Firma electronica",  icon: FileSignature, desc: "Firma de documentos" },
  ];
  const toggle = (slug: string) => {
    const set = new Set(data.integrations);
    if (set.has(slug)) set.delete(slug); else set.add(slug);
    setData({ ...data, integrations: Array.from(set) });
  };
  return (
    <div className="space-y-5 max-w-2xl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {INTEGRATIONS.map(int => {
          const enabled = data.integrations.includes(int.slug);
          return (
            <div key={int.slug} onClick={() => toggle(int.slug)} className={cn(
              "cursor-pointer flex items-center gap-3 rounded-xl border p-3 transition-all",
              enabled ? "border-violet-500 bg-violet-500/5" : "border-border hover:border-violet-300",
            )}>
              <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", enabled ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-500")}>
                <int.icon size={16} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">{int.name}</p>
                <p className="text-xs text-muted-foreground">{int.desc}</p>
              </div>
              <Switch checked={enabled} onCheckedChange={() => toggle(int.slug)} />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack} className="gap-2"><ChevronLeft size={16} /> Atras</Button>
        <Button onClick={onNext} className="gap-2">Siguiente <ChevronRight size={16} /></Button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Step 10 — IA Ava
   ═══════════════════════════════════════════════════════════════════════════════ */
function StepAI({ data, setData, onNext, onBack }: { data: WizardData; setData: (d: WizardData) => void; onNext: () => void; onBack: () => void }) {
  return (
    <div className="space-y-5 max-w-xl">
      <div className="space-y-2"><Label>Nombre del asistente</Label><Input value={data.aiName} onChange={e => setData({ ...data, aiName: e.target.value })} placeholder="Ava" /></div>
      <div className="space-y-2"><Label>Idioma</Label>
        <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={data.aiLanguage} onChange={e => setData({ ...data, aiLanguage: e.target.value })}>
          <option value="es">Espanol</option><option value="en">English</option><option value="fr">Francais</option><option value="de">Deutsch</option><option value="pt">Portugues</option>
        </select>
      </div>
      <div className="space-y-2"><Label>Personalidad</Label>
        <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={data.aiPersonality} onChange={e => setData({ ...data, aiPersonality: e.target.value })}>
          <option value="profesional">Profesional y formal</option>
          <option value="amigable">Amigable y cercana</option>
          <option value="directa">Directa y concisa</option>
          <option value="creativa">Creativa y entusiasta</option>
        </select>
      </div>
      <div className="space-y-2"><Label>Nivel de automatizacion</Label>
        <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={data.aiAutomationLevel} onChange={e => setData({ ...data, aiAutomationLevel: e.target.value })}>
          <option value="baja">Baja — solo sugerencias</option>
          <option value="media">Media — sugerencias + acciones confirmadas</option>
          <option value="alta">Alta — acciones automaticas</option>
        </select>
      </div>
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack} className="gap-2"><ChevronLeft size={16} /> Atras</Button>
        <Button onClick={onNext} className="gap-2">Ver resumen <ArrowRight size={16} /></Button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Resumen
   ═══════════════════════════════════════════════════════════════════════════════ */
function StepSummary({ data, onSubmit, onBack, submitting }: { data: WizardData; onSubmit: () => void; onBack: () => void; submitting: boolean }) {
  return (
    <div className="space-y-5 max-w-2xl">
      <Card className="border-violet-500/20">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><CheckCheck size={18} className="text-emerald-500" /> Resumen de creacion</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div><span className="text-muted-foreground">Empresa:</span> <span className="font-medium">{data.companyName}</span></div>
            <div><span className="text-muted-foreground">Slug:</span> <span className="font-medium font-mono">{data.slug}</span></div>
            <div><span className="text-muted-foreground">Plan:</span> <span className="font-medium">{PLANS.find(p => p.slug === data.plan)?.name ?? data.plan}</span></div>
            <div><span className="text-muted-foreground">Pais:</span> <span className="font-medium">{data.country}</span></div>
            <div><span className="text-muted-foreground">Admin:</span> <span className="font-medium">{data.adminName} ({data.adminEmail})</span></div>
            <div><span className="text-muted-foreground">Equipo:</span> <span className="font-medium">{data.team.length} miembros</span></div>
            <div><span className="text-muted-foreground">Clientes:</span> <span className="font-medium">{data.clients.length}</span></div>
            <div><span className="text-muted-foreground">Fiscal:</span> <span className="font-medium">{data.companyType} / {data.regime}</span></div>
          </div>
          <div>
            <span className="text-muted-foreground">Modulos activos:</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {data.modules.map(m => <Badge key={m} variant="secondary" className="text-[10px]">{ALL_MODULES.find(am => am.slug === m)?.name ?? m}</Badge>)}
            </div>
          </div>
          {data.integrations.length > 0 && (
            <div>
              <span className="text-muted-foreground">Integraciones:</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {data.integrations.map(i => <Badge key={i} variant="outline" className="text-[10px]">{i}</Badge>)}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack} className="gap-2"><ChevronLeft size={16} /> Atras</Button>
        <Button onClick={onSubmit} disabled={submitting} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
          {submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
          Finalizar y crear
        </Button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Plantilla selector
   ═══════════════════════════════════════════════════════════════════════════════ */
function TemplateSelector({ templates, onSelect }: { templates: OnboardTemplate[]; onSelect: (t: OnboardTemplate) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
      {templates.map(t => {
        const IconComp = TEMPLATE_ICONS[t.icon] ?? Building2;
        return (
          <div key={t.slug} onClick={() => onSelect(t)} className="cursor-pointer rounded-xl border border-border hover:border-violet-400 hover:shadow-md transition-all p-4 flex flex-col items-center text-center gap-2 bg-card">
            <div className="w-10 h-10 rounded-xl bg-violet-600/10 flex items-center justify-center">
              <IconComp size={20} className="text-violet-500" />
            </div>
            <h4 className="font-semibold text-sm">{t.name}</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">{t.description}</p>
            <Badge variant="secondary" className="text-[10px] mt-auto">{t.recommendedPlan}</Badge>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════════════════════════════════════ */
export default function OnboardWizardPage() {
  const [step, setStep] = useState<"templates" | number>("templates");
  const [data, setData] = useState<WizardData>(EMPTY_WIZARD);
  const [templates, setTemplates] = useState<OnboardTemplate[]>([]);
  const [drafts, setDrafts] = useState<Array<{ id: number; name: string; currentStep: number }>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [showDrafts, setShowDrafts] = useState(false);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  useEffect(() => {
    fetchTemplates();
    fetchDrafts();
  }, []);

  async function fetchTemplates() {
    const r = await authFetch(`${BASE}/api/control-center/onboard-wizard/templates`);
    if (r.ok) {
      const j = await r.json();
      setTemplates(j.templates ?? []);
    }
  }

  async function fetchDrafts() {
    const r = await authFetch(`${BASE}/api/control-center/onboard-wizard/drafts`);
    if (r.ok) {
      const j = await r.json();
      setDrafts(j.drafts ?? []);
    }
  }

  function selectTemplate(t: OnboardTemplate) {
    const newData: WizardData = {
      ...EMPTY_WIZARD,
      companyName: t.name,
      plan: t.recommendedPlan,
      modules: t.defaultModules,
      templateSlug: t.slug,
      companyType: (t.defaultFiscal?.companyType as string) ?? "autonomo",
      regime: (t.defaultFiscal?.regime as string) ?? "estimacion_directa",
      vat: (t.defaultFiscal?.vat as boolean) ?? true,
      irpf: (t.defaultFiscal?.irpf as boolean) ?? true,
      fiscalCountry: (t.defaultFiscal?.country as string) ?? "ES",
    };
    // Pre-popular team desde defaultRoles
    if (t.defaultRoles && Array.isArray(t.defaultRoles)) {
      for (const roleDef of t.defaultRoles) {
        const r = roleDef as { role: string; count: number };
        for (let i = 0; i < (r.count ?? 1); i++) {
          newData.team.push({ name: "", email: "", role: r.role });
        }
      }
    }
    setData(newData);
    setStep(1);
  }

  async function saveDraft() {
    const r = await authFetch(`${BASE}/api/control-center/onboard-wizard/drafts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: data.companyName || "Borrador", wizardData: data, currentStep: typeof step === "number" ? step : 1 }),
    });
    if (r.ok) {
      toast({ title: "Borrador guardado", description: "Puedes continuar mas tarde." });
      fetchDrafts();
    } else {
      toast({ title: "Error", description: "No se pudo guardar el borrador.", variant: "destructive" });
    }
  }

  async function submitWizard() {
    setSubmitting(true);
    const r = await authFetch(`${BASE}/api/control-center/onboard-wizard/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyName: data.companyName, slug: data.slug, legalName: data.legalName, taxId: data.taxId,
        country: data.country, address: data.address, phone: data.phone, email: data.email,
        website: data.website, timezone: data.timezone, language: data.language, currency: data.currency,
        plan: data.plan, modules: data.modules,
        admin: { name: data.adminName, email: data.adminEmail, password: data.adminPassword, sendInvite: data.sendInvite },
        team: data.team.filter(m => m.email), clients: data.clients.filter(c => c.name),
        fiscal: { companyType: data.companyType, regime: data.regime, vat: data.vat, irpf: data.irpf, fiscalCountry: data.fiscalCountry },
        integrations: data.integrations,
        aiConfig: { name: data.aiName, language: data.aiLanguage, personality: data.aiPersonality, automationLevel: data.aiAutomationLevel },
        templateSlug: data.templateSlug,
      }),
    });
    setSubmitting(false);
    if (r.ok) {
      const j = await r.json();
      toast({ title: "Workspace creado", description: `${j.orgName} creado con exito.` });
      setLocation(`${BASE}/control-center/workspaces`);
    } else {
      const err = await r.json().catch(() => ({ error: "Error desconocido" }));
      toast({ title: "Error al crear", description: err.error ?? "Error desconocido", variant: "destructive" });
    }
  }

  const currentStepNum = typeof step === "number" ? step : 0;
  const progress = step === "templates" ? 0 : Math.round((currentStepNum / 11) * 100);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Wizard de Creacion de Empresa</h1>
          <p className="text-slate-400 text-sm mt-1">Configura un nuevo Workspace en menos de 5 minutos.</p>
        </div>
        {typeof step === "number" && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={saveDraft} className="gap-1"><Save size={14} /> Guardar borrador</Button>
            <Button variant="ghost" size="sm" onClick={() => setShowDrafts(!showDrafts)} className="gap-1">Borradores ({drafts.length})</Button>
          </div>
        )}
      </div>

      {/* Progress */}
      {typeof step === "number" && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Paso {currentStepNum} de 11</span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
      )}

      {/* Drafts panel */}
      {showDrafts && drafts.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <h4 className="text-sm font-semibold">Borradores guardados</h4>
          {drafts.map(d => (
            <div key={d.id} className="flex items-center justify-between text-sm py-1 border-b border-border/50 last:border-0">
              <span>{d.name}</span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { /* cargar borrador */ }}>Continuar</Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs text-red-500" onClick={async () => {
                  await authFetch(`${BASE}/api/control-center/onboard-wizard/drafts/${d.id}`, { method: "DELETE" });
                  fetchDrafts();
                }}><Trash2 size={12} /></Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      <AnimatePresence mode="wait">
        {step === "templates" ? (
          <motion.div key="templates" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
            <h3 className="text-lg font-semibold">Elige una plantilla para empezar</h3>
            <TemplateSelector templates={templates} onSelect={selectTemplate} />
            <div className="text-center">
              <Button variant="ghost" onClick={() => { setData(EMPTY_WIZARD); setStep(1); }} className="gap-2">
                <Settings size={16} /> Empezar desde cero
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div key={currentStepNum} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
            {/* Step label */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center shadow-lg">
                {(() => {
                  const StepIcon = STEPS[currentStepNum - 1]?.icon ?? Circle;
                  return <StepIcon size={18} className="text-white" />;
                })()}
              </div>
              <div>
                <h3 className="text-lg font-semibold">{STEPS[currentStepNum - 1]?.label ?? "Resumen"}</h3>
                <p className="text-sm text-muted-foreground">{STEPS[currentStepNum - 1]?.description ?? ""}</p>
              </div>
            </div>

            {/* Step body */}
            {currentStepNum === 1 && <StepCompany data={data} setData={setData} onNext={() => setStep(2)} />}
            {currentStepNum === 2 && <StepWorkspace data={data} setData={setData} onNext={() => setStep(3)} onBack={() => setStep(1)} />}
            {currentStepNum === 3 && <StepPlan data={data} setData={setData} onNext={() => setStep(4)} onBack={() => setStep(2)} />}
            {currentStepNum === 4 && <StepModules data={data} setData={setData} onNext={() => setStep(5)} onBack={() => setStep(3)} />}
            {currentStepNum === 5 && <StepAdmin data={data} setData={setData} onNext={() => setStep(6)} onBack={() => setStep(4)} />}
            {currentStepNum === 6 && <StepTeam data={data} setData={setData} onNext={() => setStep(7)} onBack={() => setStep(5)} />}
            {currentStepNum === 7 && <StepClients data={data} setData={setData} onNext={() => setStep(8)} onBack={() => setStep(6)} />}
            {currentStepNum === 8 && <StepFiscal data={data} setData={setData} onNext={() => setStep(9)} onBack={() => setStep(7)} />}
            {currentStepNum === 9 && <StepIntegrations data={data} setData={setData} onNext={() => setStep(10)} onBack={() => setStep(8)} />}
            {currentStepNum === 10 && <StepAI data={data} setData={setData} onNext={() => setStep(11)} onBack={() => setStep(9)} />}
            {currentStepNum === 11 && <StepSummary data={data} onSubmit={submitWizard} onBack={() => setStep(10)} submitting={submitting} />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
