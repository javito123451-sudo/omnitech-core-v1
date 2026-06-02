import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, Users, MessageSquare, CalendarDays, BarChart3, LogOut, Hexagon } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { icon: LayoutDashboard, label: "Panel", href: "/dashboard" },
  { icon: Users, label: "Clientes", href: "/clients" },
  { icon: MessageSquare, label: "Asistente", href: "/assistant" },
  { icon: CalendarDays, label: "Calendario", href: "/calendar" },
  { icon: BarChart3, label: "Estadísticas", href: "/statistics" },
];

export default function MainLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden text-foreground">
      {/* Sidebar — desktop only */}
      <aside className="hidden md:flex w-60 border-r border-border bg-card flex-col transition-all duration-300 shrink-0">
        <div className="h-14 flex items-center px-5 border-b border-border">
          <Link href="/dashboard" className="flex items-center gap-2 group cursor-pointer">
            <div className="text-primary group-hover:drop-shadow-[0_0_8px_rgba(59,130,246,0.8)] transition-all">
              <Hexagon className="w-5 h-5 fill-primary/20" />
            </div>
            <span className="font-bold text-base tracking-tight">OMNIFLOW</span>
          </Link>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href}>
                <div className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md transition-all cursor-pointer group",
                  isActive
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                )}>
                  <item.icon className={cn("w-4 h-4 shrink-0", isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
                  <span className="font-medium text-sm">{item.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-border">
          <div
            className="flex items-center gap-3 px-3 py-2.5 rounded-md text-muted-foreground hover:bg-white/5 hover:text-foreground cursor-pointer transition-all"
            onClick={() => setLocation("/")}
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span className="font-medium text-sm">Cerrar sesión</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full relative overflow-hidden min-w-0">
        {/* Mobile top bar */}
        <header className="md:hidden flex items-center justify-between px-4 h-12 border-b border-border bg-card shrink-0 z-10">
          <Link href="/dashboard" className="flex items-center gap-2">
            <Hexagon className="w-5 h-5 text-primary fill-primary/20" />
            <span className="font-bold text-sm tracking-tight">OMNIFLOW</span>
          </Link>
          <div
            className="text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
            onClick={() => setLocation("/")}
          >
            <LogOut className="w-4 h-4" />
          </div>
        </header>

        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background pointer-events-none" />

        <div className="relative z-10 flex-1 overflow-y-auto p-4 md:p-6 pb-20 md:pb-6">
          {children}
        </div>

        {/* Mobile Bottom Nav */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border flex items-center justify-around px-1 py-1">
          {navItems.map((item) => {
            const isActive = location.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href}>
                <div className={cn(
                  "flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer min-w-[52px]",
                  isActive ? "text-primary" : "text-muted-foreground"
                )}>
                  <item.icon className={cn("w-5 h-5", isActive ? "text-primary" : "text-muted-foreground")} />
                  <span className="text-[9px] font-medium leading-none">{item.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>
      </main>
    </div>
  );
}
