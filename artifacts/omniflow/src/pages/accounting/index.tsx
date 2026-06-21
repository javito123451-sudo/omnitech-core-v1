import { useState } from "react";
import { Receipt, CreditCard, TrendingDown, FileX, BarChart3, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import AccountingDashboard from "./Dashboard";
import InvoicesList from "./InvoicesList";
import PaymentsList from "./PaymentsList";
import ExpensesList from "./ExpensesList";
import CreditNotesList from "./CreditNotesList";

type Tab = "dashboard" | "invoices" | "payments" | "expenses" | "credit-notes";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "dashboard",    label: "Resumen",        icon: BarChart3   },
  { id: "invoices",     label: "Facturas",        icon: Receipt     },
  { id: "payments",     label: "Cobros",          icon: CreditCard  },
  { id: "expenses",     label: "Gastos",          icon: TrendingDown},
  { id: "credit-notes", label: "Notas Crédito",   icon: FileX       },
];

export default function AccountingPage() {
  const [tab, setTab] = useState<Tab>("dashboard");

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
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
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
      {tab === "dashboard"    && <AccountingDashboard onNavigate={setTab} />}
      {tab === "invoices"     && <InvoicesList />}
      {tab === "payments"     && <PaymentsList />}
      {tab === "expenses"     && <ExpensesList />}
      {tab === "credit-notes" && <CreditNotesList />}
    </div>
  );
}
