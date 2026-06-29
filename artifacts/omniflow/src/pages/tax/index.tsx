import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ShieldCheck, LayoutDashboard, CalendarDays, Calculator,
  FileText, FileDigit, Percent, Wallet, Receipt,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/authFetch";
import TaxDashboard from "./Dashboard";
import TaxCalendar from "./Calendar";
import SimulatorIVA from "./SimulatorIVA";
import SimulatorIRPF from "./SimulatorIRPF";
import SimulatorRenta from "./SimulatorRenta";
import TaxDocuments from "./Documents";

type Tab =
  | "dashboard"
  | "calendar"
  | "simulator-iva"
  | "simulator-irpf"
  | "simulator-renta"
  | "documents";

const ALL_TABS: { id: Tab; label: string; icon: React.ElementType; minRole: string }[] = [
  { id: "dashboard",       label: "Dashboard",     icon: LayoutDashboard, minRole: "member" },
  { id: "calendar",        label: "Calendario",    icon: CalendarDays,    minRole: "member" },
  { id: "simulator-iva",   label: "IVA",           icon: Percent,         minRole: "member" },
  { id: "simulator-irpf",  label: "IRPF",          icon: Wallet,          minRole: "member" },
  { id: "simulator-renta", label: "Renta",         icon: Receipt,         minRole: "member" },
  { id: "documents",       label: "Documentos",    icon: FileText,        minRole: "member" },
];

const ROLE_LEVEL: Record<string, number> = {
  member: 0, read_only: 0, vendedor: 0, manager: 1, admin: 2, owner: 2, SUPER_ADMIN: 2,
};

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function TaxPage() {
  const [tab, setTab] = useState<Tab>("dashboard");

  const { data: me } = useQuery<{ organization: { role: string } | null }>({
    queryKey: ["auth-me"],
    queryFn: async () => {
      const r = await authFetch(`${BASE}/api/auth/me`);
      if (!r.ok) return { organization: null };
      return r.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const orgRole = me?.organization?.role ?? "member";
  const roleLevel = ROLE_LEVEL[orgRole] ?? 0;
  const visibleTabs = ALL_TABS.filter((t) => roleLevel >= (ROLE_LEVEL[t.minRole] ?? 0));
  const activeTab = visibleTabs.find((t) => t.id === tab) ? tab : visibleTabs[0]?.id ?? "dashboard";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-emerald-400" />
            OmniTax
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Motor fiscal, calendario, simuladores y gestión documental
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-800/60 rounded-xl border border-white/5 w-fit overflow-x-auto">
        {visibleTabs.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap",
                active
                  ? "bg-emerald-600 text-white shadow"
                  : "text-slate-400 hover:text-white hover:bg-white/5",
              )}
            >
              <Icon size={16} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="min-h-[400px]">
        {activeTab === "dashboard" && <TaxDashboard />}
        {activeTab === "calendar" && <TaxCalendar />}
        {activeTab === "simulator-iva" && <SimulatorIVA />}
        {activeTab === "simulator-irpf" && <SimulatorIRPF />}
        {activeTab === "simulator-renta" && <SimulatorRenta />}
        {activeTab === "documents" && <TaxDocuments />}
      </div>
    </div>
  );
}
