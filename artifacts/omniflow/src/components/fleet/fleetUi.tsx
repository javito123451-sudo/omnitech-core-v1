// Piezas de interfaz compartidas por los paneles de Omni Fleet (mismo estilo slate que el resto de la página).
import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

export const inputCls = "w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-blue-500";
export const primaryBtn = "px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors";
export const ghostBtn = "px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors";

const BADGE: Record<string, string> = {
  available: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  on_route: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  in_progress: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  en_route: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  completed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  delivered: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  leave: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  maintenance: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  incident: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  failed: "bg-red-500/20 text-red-400 border-red-500/30",
  cancelled: "bg-red-500/20 text-red-400 border-red-500/30",
  inactive: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  pending: "bg-slate-500/20 text-slate-400 border-slate-500/30",
};

export function StatusBadge({ status, labels }: { status: string; labels: Record<string, string> }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${BADGE[status] ?? BADGE["pending"]}`}>
      {labels[status] ?? status}
    </span>
  );
}

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-slate-400 mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return <p role="alert" className="text-sm text-red-400 bg-red-900/20 border border-red-700/40 rounded-lg px-3 py-2">{message}</p>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-md bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">{title}</h3>
          <button onClick={onClose} aria-label="Cerrar" className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="py-10 text-center">
      <p className="text-sm text-slate-500 mb-4">{text}</p>
      {action}
    </div>
  );
}
