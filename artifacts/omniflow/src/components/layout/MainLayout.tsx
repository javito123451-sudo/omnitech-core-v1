import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, Users, MessageSquare, CalendarDays, BarChart3, LogOut, Hexagon } from "lucide-react";
import { cn } from "@/lib/utils";

export default function MainLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();

  const navItems = [
    { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
    { icon: Users, label: "Clients", href: "/clients" },
    { icon: MessageSquare, label: "Assistant", href: "/assistant" },
    { icon: CalendarDays, label: "Calendar", href: "/calendar" },
    { icon: BarChart3, label: "Statistics", href: "/statistics" },
  ];

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden text-foreground">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-card flex flex-col transition-all duration-300">
        <div className="h-16 flex items-center px-6 border-b border-border">
          <Link href="/dashboard" className="flex items-center gap-2 group cursor-pointer">
            <div className="text-primary group-hover:drop-shadow-[0_0_8px_rgba(59,130,246,0.8)] transition-all">
              <Hexagon className="w-6 h-6 fill-primary/20" />
            </div>
            <span className="font-bold text-lg tracking-tight">OMNIFLOW</span>
          </Link>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md transition-all cursor-pointer group",
                    isActive
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                  )}
                >
                  <item.icon className={cn("w-5 h-5", isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
                  <span className="font-medium text-sm">{item.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-3 px-3 py-2 rounded-md text-muted-foreground hover:bg-white/5 hover:text-foreground cursor-pointer transition-all" onClick={() => setLocation("/")}>
            <LogOut className="w-5 h-5" />
            <span className="font-medium text-sm">Sign Out</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background pointer-events-none" />
        <div className="relative z-10 flex-1 overflow-y-auto p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
