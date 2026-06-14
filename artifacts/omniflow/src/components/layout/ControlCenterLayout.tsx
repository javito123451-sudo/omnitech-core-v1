import { ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Shield, LayoutDashboard, Building2, Users, Puzzle,
  Lock, CreditCard, ChevronRight, LogOut, Menu, X,
  Hexagon, Database,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useClerk } from "@clerk/react";
import { motion, AnimatePresence } from "framer-motion";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const ccNav = [
  { icon: LayoutDashboard, label: "Dashboard",    href: "/control-center" },
  { icon: Building2,       label: "Workspaces",   href: "/control-center/workspaces" },
  { icon: Users,           label: "Usuarios",     href: "/control-center/users" },
  { icon: Puzzle,          label: "Módulos",      href: "/control-center/modules" },
  { icon: Lock,            label: "Seguridad",    href: "/control-center/security" },
  { icon: CreditCard,      label: "Licencias",    href: "/control-center/licenses" },
  { icon: Database,        label: "Diagnóstico",  href: "/control-center/diagnostics" },
  { icon: Hexagon,         label: "AI Center",    href: "/control-center/ai-center" },
];

function NavItem({ icon: Icon, label, href, currentLocation, onClick }: {
  icon: React.ElementType;
  label: string;
  href: string;
  currentLocation: string;
  onClick?: () => void;
}) {
  const isActive = currentLocation === href || (href !== "/control-center" && currentLocation.startsWith(href));
  return (
    <Link href={`${basePath}${href}`} onClick={onClick}>
      <div className={cn(
        "flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer",
        isActive
          ? "bg-violet-600 text-white shadow-lg shadow-violet-500/25"
          : "text-slate-400 hover:text-white hover:bg-white/5",
      )}>
        <Icon size={18} />
        <span className="flex-1">{label}</span>
        {isActive && <ChevronRight size={14} className="opacity-60" />}
      </div>
    </Link>
  );
}

function Sidebar({ location, onClose }: { location: string; onClose?: () => void }) {
  const { signOut } = useClerk();
  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-violet-600 flex items-center justify-center shadow-lg">
            <Shield size={18} className="text-white" />
          </div>
          <div>
            <p className="text-white font-bold text-sm leading-tight">Control Center</p>
            <p className="text-violet-400 text-xs">OmniTech Platform</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 mb-3">Administración</p>
        {ccNav.map(item => (
          <NavItem key={item.href} {...item} currentLocation={location} onClick={onClose} />
        ))}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-white/10 space-y-2">
        <Link href={`${basePath}/executive-dashboard`} onClick={onClose}>
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm text-slate-400 hover:text-white hover:bg-white/5 cursor-pointer transition-all">
            <Hexagon size={18} />
            <span>Volver al CRM</span>
          </div>
        </Link>
        <button
          onClick={() => signOut()}
          className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
        >
          <LogOut size={18} />
          <span>Cerrar sesión</span>
        </button>
      </div>
    </div>
  );
}

export default function ControlCenterLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Strip basePath for active matching
  const strippedLocation = basePath && location.startsWith(basePath) ? location.slice(basePath.length) || "/" : location;

  return (
    <div className="flex h-screen bg-[#0a0b14] text-white overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-64 flex-col bg-[#0d0e1e] border-r border-white/[0.06] flex-shrink-0">
        <Sidebar location={strippedLocation} />
      </aside>

      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-30 bg-[#0d0e1e] border-b border-white/[0.06] px-4 py-3 flex items-center gap-3">
        <button onClick={() => setMobileOpen(true)} className="text-slate-400 hover:text-white">
          <Menu size={22} />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center">
            <Shield size={14} className="text-white" />
          </div>
          <span className="text-white font-semibold text-sm">Control Center</span>
        </div>
      </div>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              className="lg:hidden fixed top-0 left-0 bottom-0 z-50 w-72 bg-[#0d0e1e] border-r border-white/[0.06] flex flex-col"
              initial={{ x: -288 }} animate={{ x: 0 }} exit={{ x: -288 }}
              transition={{ type: "spring", stiffness: 400, damping: 35 }}
            >
              <button
                onClick={() => setMobileOpen(false)}
                className="absolute top-4 right-4 text-slate-400 hover:text-white"
              >
                <X size={20} />
              </button>
              <Sidebar location={strippedLocation} onClose={() => setMobileOpen(false)} />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto lg:mt-0 mt-14">
        {children}
      </main>
    </div>
  );
}
