import { ReactNode, useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Users, MessageSquare, CalendarDays, BarChart3,
  LogOut, Hexagon, Settings, Brain, FileText, Zap, Cpu, Puzzle,
  MoreHorizontal, X, ChevronRight, Shield, ShieldCheck, Sparkles, Bot, BookOpen,
  Eye, ArrowLeft, Library, Receipt, Target, UserCheck, TrendingUp,
  Ticket, Rocket, LogOut as LogOutIcon, Megaphone, Radio, ScanSearch,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useClerk, useUser } from "@clerk/react";
import { useOrg, clearSidebarCacheForOrg } from "@/lib/orgContext";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { authFetch } from "@/lib/authFetch";
import { AvaProvider } from "@/components/ava/AvaContext";
import AvaFloatingButton from "@/components/ava/AvaFloatingButton";
import AvaPanel from "@/components/ava/AvaPanel";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Nav structure ─────────────────────────────────────────────────────────────
// moduleKey: if set, item is hidden when that module is disabled.
// No moduleKey (or undefined) = always visible.

interface NavItem {
  icon: React.ElementType;
  label: string;
  href: string;
  moduleKey?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const primaryNav: NavItem[] = [
  { icon: Cpu,      label: "Dashboard",    href: "/executive-dashboard" },
  { icon: Users,    label: "Clientes",     href: "/clients",  moduleKey: "crm" },
  { icon: FileText, label: "Presupuestos", href: "/quotes",   moduleKey: "crm" },
];

const sidebarGroups: NavGroup[] = [
  {
    label: "Principal",
    items: [
      { icon: Cpu,             label: "Dashboard",    href: "/executive-dashboard" },
      { icon: LayoutDashboard, label: "Panel CRM",     href: "/dashboard",          moduleKey: "crm" },
      { icon: Users,           label: "Clientes",     href: "/clients",            moduleKey: "crm" },
      { icon: FileText,        label: "Presupuestos", href: "/quotes",             moduleKey: "crm" },
    ],
  },
  {
    label: "Trabajo",
    items: [
      { icon: MessageSquare, label: "Asistente",     href: "/assistant",      moduleKey: "ai_agents" },
      { icon: CalendarDays,  label: "Calendario",    href: "/calendar",       moduleKey: "crm" },
      { icon: Bot,           label: "Conversaciones", href: "/telegram-inbox", moduleKey: "ai_agents" },
    ],
  },
  {
    label: "Análisis",
    items: [
      { icon: Zap,       label: "Intelligence", href: "/executive",  moduleKey: "analytics" },
      { icon: BarChart3, label: "Estadísticas", href: "/statistics", moduleKey: "analytics" },
      { icon: Target,    label: "Pipeline",     href: "/pipeline",   moduleKey: "crm" },
    ],
  },
  {
    label: "Finanzas",
    items: [
      { icon: Receipt,     label: "Contabilidad", href: "/accounting", moduleKey: "omni_accounting" },
      { icon: ShieldCheck, label: "OmniTax",      href: "/tax",        moduleKey: "omni_tax" },
    ],
  },
  {
    label: "Marketing",
    items: [
      { icon: Megaphone,  label: "Omni Marketing Hub", href: "/marketing", moduleKey: "omni_marketing" },
      { icon: Radio,      label: "OmniAds",            href: "/ads",       moduleKey: "omni_ads" },
      { icon: ScanSearch, label: "OmniLeads AI",       href: "/leads",     moduleKey: "omni_leads" },
    ],
  },
  {
    label: "Sistema",
    items: [
      { icon: Zap,      label: "Ava Autopilot",  href: "/automations",   moduleKey: "automations" },
      { icon: Sparkles, label: "Omni Import AI", href: "/import",        moduleKey: "omni_import_ai" },
      { icon: Brain,    label: "Memoria",        href: "/memory",        moduleKey: "ai_agents" },
      { icon: BookOpen, label: "Base de Conoc.", href: "/knowledge-base", moduleKey: "ai_agents" },
      { icon: Library,  label: "Manual",         href: "/manual" },
      { icon: Puzzle,   label: "Integraciones",  href: "/integrations",  moduleKey: "integrations" },
      { icon: Ticket,   label: "Soporte",        href: "/support" },
      { icon: Rocket,   label: "Onboarding",     href: "/onboarding" },
    ],
  },
  {
    label: "Admin",
    items: [
      { icon: Users,        label: "Clientes asignados", href: "/my-clients",   moduleKey: "crm" },
    ],
  },
  {
    label: "Vendedor",
    items: [
      { icon: Target,       label: "Mis Prospectos",   href: "/my-prospects",   moduleKey: "crm" },
      { icon: UserCheck,    label: "Mi cartera",       href: "/my-customers",   moduleKey: "crm" },
      { icon: TrendingUp,   label: "Mis Comisiones",   href: "/my-commissions", moduleKey: "crm" },
    ],
  },
];

interface MoreItem extends NavItem {
  group: string;
}

const moreItems: MoreItem[] = [
  { icon: LayoutDashboard, label: "Panel",           href: "/dashboard",      group: "Principal",  moduleKey: "crm" },
  { icon: MessageSquare,   label: "Asistente",       href: "/assistant",      group: "Trabajo",    moduleKey: "ai_agents" },
  { icon: CalendarDays,    label: "Calendario",      href: "/calendar",       group: "Trabajo",    moduleKey: "crm" },
  { icon: Bot,             label: "Conversaciones",  href: "/telegram-inbox", group: "Trabajo",    moduleKey: "ai_agents" },
  { icon: BookOpen,        label: "Base de Conoc.",  href: "/knowledge-base", group: "Sistema",    moduleKey: "ai_agents" },
  { icon: Zap,             label: "Intelligence",    href: "/executive",      group: "Análisis",   moduleKey: "analytics" },
  { icon: BarChart3,       label: "Estadísticas",    href: "/statistics",     group: "Análisis",   moduleKey: "analytics" },
  { icon: Sparkles,        label: "Omni Import AI",  href: "/import",         group: "Sistema",    moduleKey: "omni_import_ai" },
  { icon: Brain,           label: "Memoria",         href: "/memory",         group: "Sistema",    moduleKey: "ai_agents" },
  { icon: Library,         label: "Manual",          href: "/manual",         group: "Sistema" },
  { icon: Puzzle,          label: "Integraciones",   href: "/integrations",   group: "Sistema",    moduleKey: "integrations" },
  { icon: Ticket,          label: "Soporte",         href: "/support",        group: "Sistema" },
  { icon: Rocket,          label: "Onboarding",      href: "/onboarding",     group: "Sistema" },
  { icon: Settings,        label: "Configuración",   href: "/settings",       group: "Sistema" },
  { icon: Zap,             label: "Ava Autopilot",   href: "/automations",    group: "Sistema",    moduleKey: "automations" },
  { icon: Receipt,         label: "Contabilidad",    href: "/accounting",     group: "Finanzas",   moduleKey: "omni_accounting" },
  { icon: Target,          label: "Pipeline",        href: "/pipeline",       group: "Análisis",   moduleKey: "crm" },
  { icon: Megaphone,       label: "Omni Marketing Hub", href: "/marketing",   group: "Marketing",  moduleKey: "omni_marketing" },
  { icon: Radio,           label: "OmniAds",            href: "/ads",         group: "Marketing",  moduleKey: "omni_ads" },
  { icon: ScanSearch,      label: "OmniLeads AI",        href: "/leads",       group: "Marketing",  moduleKey: "omni_leads" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function isInMore(location: string, items: MoreItem[]) {
  return items.some((item) => location.startsWith(item.href));
}

// ── More Drawer (mobile) ──────────────────────────────────────────────────────

function MobileMoreDrawer({
  open,
  onClose,
  location,
  visibleMoreItems,
}: {
  open: boolean;
  onClose: () => void;
  location: string;
  visibleMoreItems: MoreItem[];
}) {
  const groups = visibleMoreItems.reduce<Record<string, MoreItem[]>>((acc, item) => {
    acc[item.group] ??= [];
    acc[item.group].push(item);
    return acc;
  }, {});

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          <motion.div
            className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border rounded-t-2xl max-h-[75dvh] flex flex-col"
            style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                <span className="font-semibold text-sm">Más secciones</span>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted/40 text-muted-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5 scrollbar-thin">
              {Object.entries(groups).map(([groupLabel, items]) => (
                <div key={groupLabel}>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 px-2 mb-1.5">
                    {groupLabel}
                  </p>
                  <div className="space-y-0.5">
                    {items.map((item) => {
                      const active = location.startsWith(item.href);
                      return (
                        <Link key={item.href} href={item.href}>
                          <div
                            onClick={onClose}
                            className={cn(
                              "flex items-center gap-3 px-3 py-3 rounded-xl transition-colors",
                              active
                                ? "bg-primary/10 text-primary"
                                : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
                            )}
                          >
                            <item.icon className={cn("w-5 h-5 shrink-0", active ? "text-primary" : "")} />
                            <span className="font-medium text-sm flex-1">{item.label}</span>
                            <ChevronRight className="w-3.5 h-3.5 opacity-40" />
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Main layout ───────────────────────────────────────────────────────────────

export default function MainLayout({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const { signOut } = useClerk();
  const { user: clerkUser } = useUser();
  const { org, canAccessModule } = useOrg();
  const [moreOpen, setMoreOpen] = useState(false);
  const { isSuperAdmin } = useSuperAdmin();
  const [wsOverrideName, setWsOverrideName] = useState<string | null>(null);

  useEffect(() => {
    const name = localStorage.getItem("wsOverrideName");
    setWsOverrideName(name);
  }, [location]);

  const handleSignOut = async () => {
    try {
      await authFetch(`${import.meta.env.BASE_URL}api/auth/logout-event`, { method: "POST" });
    } catch { /* non-critical */ }
    signOut({ redirectUrl: `${basePath}/` });
  };

  // ── Exit support mode ──────────────────────────────────────────────────
  const handleExitSupportMode = async () => {
    try {
      await authFetch(`${basePath}/api/control-center/support-session/exit`, { method: "POST" });
    } catch { /* non-critical */ }

    // Clear the override workspace's cache entry so its stale data does not
    // resurface when the admin's own workspace is loaded next.
    const overrideOrgId = localStorage.getItem("wsOverride");
    if (overrideOrgId && clerkUser?.id) {
      clearSidebarCacheForOrg(clerkUser.id, overrideOrgId);
    }

    localStorage.removeItem("wsOverride");
    localStorage.removeItem("wsOverrideName");
    localStorage.removeItem("wsSupportReason");
    setWsOverrideName(null);
    window.location.href = `${basePath}/control-center`;
  };

  // ── Filter nav items by module access ────────────────────────────────────
  const visiblePrimaryNav = primaryNav.filter(
    (item) => !item.moduleKey || canAccessModule(item.moduleKey),
  );

  const orgRole = org?.role ?? "member";

  const visibleSidebarGroups = sidebarGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.moduleKey && !canAccessModule(item.moduleKey)) return false;
        // Admin-only nav items
        if (group.label === "Admin" && !["owner", "admin"].includes(orgRole)) return false;
        // Vendedor-only nav items
        if (group.label === "Vendedor" && orgRole !== "vendedor") return false;
        return true;
      }),
    }))
    .filter((group) => group.items.length > 0);

  const visibleMoreItems = moreItems.filter(
    (item) => !item.moduleKey || canAccessModule(item.moduleKey),
  );

  return (
    <AvaProvider>
    <div className="flex h-dvh w-full max-w-full bg-background overflow-hidden text-foreground">

      {/* ── Desktop Sidebar ───────────────────────────────────────────── */}
      <aside className="hidden md:flex w-60 border-r border-border bg-card flex-col shrink-0">
        <div className="h-14 flex items-center px-5 border-b border-border">
          <Link href="/dashboard" className="flex items-center gap-2 group cursor-pointer">
            <div className="text-primary group-hover:drop-shadow-[0_0_8px_rgba(59,130,246,0.8)] transition-all">
              <Hexagon className="w-5 h-5 fill-primary/20" />
            </div>
            <span className="font-bold text-base tracking-tight">OMNITECH</span>
          </Link>
        </div>

        {org && (
          <div className="px-4 py-2.5 border-b border-border">
            <div className="text-xs font-semibold text-primary/80 uppercase tracking-wider truncate">
              {org.name}
            </div>
            <div className="text-[10px] text-muted-foreground capitalize">{org.plan}</div>
          </div>
        )}

        {/* Grouped sidebar nav — filtered by module access */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto scrollbar-thin space-y-5">
          {visibleSidebarGroups.map((group) => (
            <div key={group.label}>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 px-3 mb-1.5">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = location.startsWith(item.href);
                  return (
                    <Link key={item.href} href={item.href}>
                      <div className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-md transition-all cursor-pointer group",
                        isActive
                          ? "bg-primary/10 text-primary border border-primary/20"
                          : "text-muted-foreground hover:bg-white/5 hover:text-foreground border border-transparent",
                      )}>
                        <item.icon className={cn(
                          "w-4 h-4 shrink-0",
                          isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                        )} />
                        <span className="font-medium text-sm">{item.label}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom: settings + user + logout */}
        <div className="p-3 border-t border-border space-y-1">
          <Link href="/settings">
            <div className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md transition-all cursor-pointer group",
              location.startsWith("/settings")
                ? "bg-primary/10 text-primary border border-primary/20"
                : "text-muted-foreground hover:bg-white/5 hover:text-foreground border border-transparent",
            )}>
              <Settings className={cn(
                "w-4 h-4 shrink-0",
                location.startsWith("/settings") ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
              )} />
              <span className="font-medium text-sm">Configuración</span>
            </div>
          </Link>

          {clerkUser && (
            <div className="px-3 py-2 rounded-md flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-primary">
                  {(clerkUser.firstName ?? clerkUser.emailAddresses[0]?.emailAddress ?? "U")[0].toUpperCase()}
                </span>
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground truncate">
                  {clerkUser.firstName ?? clerkUser.emailAddresses[0]?.emailAddress}
                </div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {clerkUser.emailAddresses[0]?.emailAddress}
                </div>
              </div>
            </div>
          )}

          {isSuperAdmin && (
            <Link href="/control-center">
              <div className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md transition-all cursor-pointer group",
                location.startsWith("/control-center")
                  ? "bg-violet-500/20 text-violet-400 border border-violet-500/30"
                  : "text-muted-foreground hover:bg-violet-500/10 hover:text-violet-400 border border-transparent",
              )}>
                <Shield className="w-4 h-4 shrink-0 text-violet-500" />
                <span className="font-medium text-sm">Control Center</span>
              </div>
            </Link>
          )}

          <button
            type="button"
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-muted-foreground hover:bg-white/5 hover:text-foreground cursor-pointer transition-all"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span className="font-medium text-sm">Cerrar sesión</span>
          </button>
        </div>
      </aside>

      {/* ── Main Content ─────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col h-dvh relative overflow-hidden min-w-0">

        {/* Mobile top bar */}
        <header
          className="md:hidden flex items-center justify-between px-4 border-b border-border bg-card/95 backdrop-blur-sm shrink-0 z-10"
          style={{ height: "calc(3rem + env(safe-area-inset-top, 0px))", paddingTop: "env(safe-area-inset-top, 0px)" }}
        >
          <Link href="/dashboard" className="flex items-center gap-2">
            <Hexagon className="w-5 h-5 text-primary fill-primary/20" />
            <span className="font-bold text-sm tracking-tight">OMNITECH</span>
          </Link>
          <button
            type="button"
            className="flex items-center justify-center w-10 h-10 text-muted-foreground hover:text-foreground transition-colors rounded-lg touch-manipulation"
            onClick={handleSignOut}
            aria-label="Cerrar sesión"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </header>

        {/* Ambient gradient */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background pointer-events-none" />

        {/* Modo Soporte banner */}
        {wsOverrideName && (
          <div className="relative z-20 flex items-center justify-between gap-3 px-4 py-2 bg-amber-600/20 border-b border-amber-500/30 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <Shield size={14} className="text-amber-400 shrink-0" />
              <span className="text-amber-300 text-xs font-medium truncate">
                <strong className="text-white">MODO SOPORTE</strong> — {wsOverrideName}
              </span>
            </div>
            <button
              onClick={handleExitSupportMode}
              className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-white bg-amber-500/20 hover:bg-amber-500/40 border border-amber-500/30 px-3 py-1 rounded-lg transition-all shrink-0"
            >
              <ArrowLeft size={12} /> Salir del modo soporte
            </button>
          </div>
        )}

        {/* Scrollable content */}
        <div className="relative z-10 flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6 pb-nav md:pb-6 scrollbar-thin">
          {children}
        </div>

        {/* ── Mobile Bottom Navigation — filtered by module access ─── */}
        <nav
          className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-stretch bg-card/95 backdrop-blur-md border-t border-border"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          {visiblePrimaryNav.map((item) => {
            const isActive = location.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className="flex-1">
                <div className="relative flex flex-col items-center justify-center gap-0.5 py-2 h-14 cursor-pointer touch-manipulation select-none">
                  <AnimatePresence>
                    {isActive && (
                      <motion.div
                        layoutId="active-nav-pill"
                        className="absolute top-1.5 left-1 right-1 h-8 rounded-xl bg-primary/12 border border-primary/20"
                        initial={{ opacity: 0, scale: 0.85 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.85 }}
                        transition={{ type: "spring", stiffness: 380, damping: 30 }}
                      />
                    )}
                  </AnimatePresence>
                  <item.icon className={cn(
                    "w-5 h-5 relative z-10 transition-all duration-200",
                    isActive ? "text-primary scale-110" : "text-muted-foreground",
                  )} />
                  <span className={cn(
                    "text-[9px] font-semibold leading-none relative z-10 transition-colors duration-200",
                    isActive ? "text-primary" : "text-muted-foreground",
                  )}>
                    {item.label}
                  </span>
                </div>
              </Link>
            );
          })}

          {/* Más button */}
          <button
            className="flex-1 touch-manipulation select-none"
            onClick={() => setMoreOpen(true)}
          >
            <div className="relative flex flex-col items-center justify-center gap-0.5 py-2 h-14">
              <AnimatePresence>
                {(moreOpen || isInMore(location, visibleMoreItems)) && (
                  <motion.div
                    layoutId="active-nav-pill"
                    className="absolute top-1.5 left-1 right-1 h-8 rounded-xl bg-primary/12 border border-primary/20"
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
              </AnimatePresence>
              <MoreHorizontal className={cn(
                "w-5 h-5 relative z-10 transition-all duration-200",
                (moreOpen || isInMore(location, visibleMoreItems)) ? "text-primary scale-110" : "text-muted-foreground",
              )} />
              <span className={cn(
                "text-[9px] font-semibold leading-none relative z-10 transition-colors duration-200",
                (moreOpen || isInMore(location, visibleMoreItems)) ? "text-primary" : "text-muted-foreground",
              )}>
                Más
              </span>
            </div>
          </button>
        </nav>

        {/* More drawer */}
        <MobileMoreDrawer
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
          location={location}
          visibleMoreItems={visibleMoreItems}
        />
      </main>
    </div>

    {/* ── Ava floating assistant ──────────────────────────────────── */}
    <AvaFloatingButton />
    <AvaPanel />
    </AvaProvider>
  );
}
