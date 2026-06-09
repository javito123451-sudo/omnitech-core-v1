import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, Users, MessageSquare, CalendarDays, BarChart3, LogOut, Hexagon, Settings, Brain, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useClerk, useUser } from "@clerk/react";
import { useOrg } from "@/lib/orgContext";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const navItems = [
  { icon: LayoutDashboard, label: "Panel",          href: "/dashboard" },
  { icon: Users,           label: "Clientes",       href: "/clients" },
  { icon: FileText,        label: "Presupuestos",   href: "/quotes" },
  { icon: MessageSquare,   label: "Asistente",      href: "/assistant" },
  { icon: CalendarDays,    label: "Calendario",     href: "/calendar" },
  { icon: BarChart3,       label: "Estadísticas",   href: "/statistics" },
  { icon: Brain,           label: "Memoria",        href: "/memory" },
];

export default function MainLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { signOut } = useClerk();
  const { user: clerkUser } = useUser();
  const { org } = useOrg();

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

        <nav className="flex-1 px-3 py-5 space-y-0.5 overflow-y-auto scrollbar-thin">
          {navItems.map((item) => {
            const isActive = location.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href}>
                <div className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md transition-all cursor-pointer group",
                  isActive
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground border border-transparent"
                )}>
                  <item.icon className={cn(
                    "w-4 h-4 shrink-0",
                    isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                  )} />
                  <span className="font-medium text-sm">{item.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-border space-y-1">
          <Link href="/settings">
            <div className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md transition-all cursor-pointer group",
              location.startsWith("/settings")
                ? "bg-primary/10 text-primary border border-primary/20"
                : "text-muted-foreground hover:bg-white/5 hover:text-foreground border border-transparent"
            )}>
              <Settings className={cn(
                "w-4 h-4 shrink-0",
                location.startsWith("/settings") ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
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
          <div className="flex items-center gap-1">
            <Link href="/settings">
              <div className={cn("flex items-center justify-center w-10 h-10 rounded-lg transition-colors", location.startsWith("/settings") ? "text-primary" : "text-muted-foreground hover:text-foreground")}>
                <Settings className="w-4 h-4" />
              </div>
            </Link>
            <button
              type="button"
              className="flex items-center justify-center w-10 h-10 text-muted-foreground hover:text-foreground transition-colors rounded-lg touch-manipulation"
              onClick={handleSignOut}
              aria-label="Cerrar sesión"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Ambient gradient */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background pointer-events-none" />

        {/* Scrollable content */}
        <div className="relative z-10 flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6 pb-nav md:pb-6 scrollbar-thin">
          {children}
        </div>

        {/* ── Mobile Bottom Navigation ────────────────────────────────── */}
        <nav
          className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-stretch bg-card/95 backdrop-blur-md border-t border-border"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          {navItems.map((item) => {
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
                    isActive ? "text-primary scale-110" : "text-muted-foreground"
                  )} />
                  <span className={cn(
                    "text-[9px] font-semibold leading-none relative z-10 transition-colors duration-200",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )}>
                    {item.label}
                  </span>
                </div>
              </Link>
            );
          })}
        </nav>
      </main>
    </div>
  );
}
