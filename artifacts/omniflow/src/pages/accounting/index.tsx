import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Receipt, CreditCard, TrendingDown, FileX, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/authFetch";
import AccountingDashboard from "./Dashboard";
import InvoicesList from "./InvoicesList";
import PaymentsList from "./PaymentsList";
import ExpensesList from "./ExpensesList";
import CreditNotesList from "./CreditNotesList";

type Tab = "dashboard" | "invoices" | "payments" | "expenses" | "credit-notes";

const ALL_TABS: { id: Tab; label: string; icon: React.ElementType; minRole: "member" | "manager" | "admin" }[] = [
  { id: "dashboard",    label: "Resumen",        icon: BarChart3,    minRole: "member"  },
  { id: "invoices",     label: "Facturas",        icon: Receipt,      minRole: "member"  },
  { id: "payments",     label: "Cobros",          icon: CreditCard,   minRole: "admin"   },
  { id: "expenses",     label: "Gastos",          icon: TrendingDown, minRole: "admin"   },
  { id: "credit-notes", label: "Notas Crédito",   icon: FileX,        minRole: "admin"   },
];

const ROLE_LEVEL: Record<string, number> = {
  member: 0,
  manager: 1,
  admin: 2,
  owner: 2,
  SUPER_ADMIN: 2,
};

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function AccountingPage() {
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

  const visibleTabs = ALL_TABS.filter(t => roleLevel >= (ROLE_LEVEL[t.minRole] ?? 0));

  // If current tab is no longer visible (role changed), fall back to first visible
  const activeTab = visibleTabs.find(t => t.id === tab) ? tab : (visibleTabs[0]?.id ?? "dashboard");

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Receipt className="w-6 h-6 text-cyan-400" />
            Omni Accounting
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Facturación, cobros, gastos y análisis financiero
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
                  ? "bg-cyan-600 text-white shadow"
                  : "text-slate-400 hover:text-white hover:bg-white/5",
              )}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === "dashboard"    && <AccountingDashboard onNavigate={setTab} />}
      {activeTab === "invoices"     && <InvoicesList />}
      {activeTab === "payments"     && <PaymentsList />}
      {activeTab === "expenses"     && <ExpensesList />}
      {activeTab === "credit-notes" && <CreditNotesList />}
    </div>
  );
}
