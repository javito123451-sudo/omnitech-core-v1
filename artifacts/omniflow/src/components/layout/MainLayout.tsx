import { ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Users, MessageSquare, CalendarDays, BarChart3,
  LogOut, Hexagon, Settings, Brain, FileText, Zap, Cpu, Puzzle,
  MoreHorizontal, X, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useClerk, useUser } from "@clerk/react";
import { useOrg } from "@/lib/orgContext";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Nav structure ────────────────────────────────────────────────────────────

const primaryNav = [
  { icon: LayoutDashboard, label: "Panel",        href: "/dashboard" },
  { icon: Users,           label: "Clientes",     href: "/clients" },
  { icon: FileText,        label: "Presupuestos", href: "/quotes" },
];

const sidebarGroups = [
  {
    label: "Principal",
    items: [
      { icon: LayoutDashboard, label: "Panel",        href: "/dashboard" },
      { icon: Users,           label: "Clientes",     href: "/clients" },
      { icon: FileText,        label: "Presupuestos", href: "/quotes" },
    ],
  },
  {
    label: "Trabajo",
    items: [
      { icon: MessageSquare, label: "Asistente",  href: "/assistant" },
      { icon: CalendarDays,  label: "Calendario", href: "/calendar" },
    ],
  },
  {
    label: "Análisis",
    items: [
      { icon: Cpu,      label: "Exec Dashboard", href: "/executive-dashboard" },
      { icon: Zap,      label: "Intelligence",   href: "/executive" },
      { icon: BarChart3, label: "Estadísticas",  href: "/statistics" },
    ],
  },
  {
    label: "Sistema",
    items: [
      { icon: Brain,   label: "Memoria",       href: "/memory" },
      { icon: Puzzle,  label: "Integraciones", href: "/integrations" },
    ],
  },
];

const moreItems = [
  { icon: MessageSquare, label: "Asistente",       href: "/assistant",            group: "Trabajo" },
  { icon: CalendarDays,  label: "Calendario",      href: "/calendar",             group: "Trabajo" },
  { icon: Cpu,           label: "Exec Dashboard",  href: "/executive-dashboard",  group: "Análisis" },
  { icon: Zap,           label: "Intelligence",    href: "/executive",            group: "Análisis" },
  { icon: BarChart3,     label: "Estadísticas",    href: "/statistics",           group: "Análisis" },
  { icon: Brain,         label: "Memoria",         href: "/memory",               group: "Sistema" },
  { icon: Puzzle,        label: "Integraciones",   href: "/integrations",         group: "Sistema" },
  { icon: Settings,      label: "Configuración",   href: "/settings",             group: "Sistema" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function isInMore(location: string) {
  return moreItems.some((item) => location.startsWith(item.href));
}

// ── More Drawer (mobile) ─────────────────────────────────────────────────────

function MobileMoreDrawer({
  open,
  onClose,
  location,
}: {
  open: boolean;
  onClose: () => void;
  location: string;
}) {
  // group moreItems by group label
  const groups = moreItems.reduce<Record<string, typeof moreItems>>((acc, item) => {
    acc[item.group] ??= [];
    acc[item.group].push(item);
    return acc;
  }, {});

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Sheet from bottom */}
          <motion.div
            className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border rounded-t-2xl max-h-[75dvh] flex flex-col"
            style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
          >
            {/* Handle + header */}
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

            {/* Scrollable list */}
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

// ── Main layout ──────────────────────────────────────────────────────────────

export default function MainLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { signOut } = useClerk();
  const { user: clerkUser } = useUser();
  const { org } = useOrg();
  const [moreOpen, setMoreOpen] = useState(false);

  const handleSignOut = () => {
    signOut({ redirectUrl: `${basePath}/` });
  };

  return (
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

        {/* Grouped sidebar nav */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto scrollbar-thin space-y-5">
          {sidebarGroups.map((group) => (
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

        {/* Scrollable content */}
        <div className="relative z-10 flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6 pb-nav md:pb-6 scrollbar-thin">
          {children}
        </div>

        {/* ── Mobile Bottom Navigation — 4 items only ─────────────── */}
        <nav
          className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-stretch bg-card/95 backdrop-blur-md border-t border-border"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          {/* Primary 3 items */}
          {primaryNav.map((item) => {
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
                {(moreOpen || isInMore(location)) && (
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
                (moreOpen || isInMore(location)) ? "text-primary scale-110" : "text-muted-foreground",
              )} />
              <span className={cn(
                "text-[9px] font-semibold leading-none relative z-10 transition-colors duration-200",
                (moreOpen || isInMore(location)) ? "text-primary" : "text-muted-foreground",
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
        />
      </main>
    </div>
  );
}
