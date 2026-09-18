import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { useLocation } from "wouter";

interface AvaContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  moduleLabel: string;
  injectMessage: (msg: string) => void;
  pendingMessage: string | null;
  clearPendingMessage: () => void;
  // True while browsing Control Center — AvaChat routes messages to the new
  // AVA CORE engine (context: "super_admin") instead of the legacy /api/chat
  // while here. Everywhere else keeps using the existing chat unchanged.
  useAvaCoreSuperAdmin: boolean;
}

const Ctx = createContext<AvaContextValue | null>(null);

const ROUTE_LABELS: Array<[string, string]> = [
  ["/control-center",      "Control Center"],
  ["/executive-dashboard", "Dashboard Ejecutivo"],
  ["/executive",           "Intelligence"],
  ["/dashboard",           "Panel CRM"],
  ["/clients",             "Clientes"],
  ["/quotes",              "Presupuestos"],
  ["/calendar",            "Calendario"],
  ["/accounting",          "Contabilidad"],
  ["/pipeline",            "Pipeline"],
  ["/statistics",          "Estadísticas"],
  ["/marketing",           "Marketing Hub"],
  ["/ads",                 "OmniAds"],
  ["/leads",               "OmniLeads AI"],
  ["/memory",              "Memoria"],
  ["/automations",         "Ava Autopilot"],
  ["/telegram-inbox",      "Conversaciones"],
  ["/knowledge-base",      "Base de Conocimiento"],
  ["/import",              "Omni Import AI"],
  ["/integrations",        "Integraciones"],
  ["/settings",            "Configuración"],
  ["/manual",              "Manual"],
  ["/support",             "Soporte"],
  ["/onboarding",          "Onboarding"],
  ["/plans",               "Planes"],
];

function resolveLabel(path: string): string {
  for (const [prefix, label] of ROUTE_LABELS) {
    if (path === prefix || path.startsWith(prefix + "/")) return label;
  }
  return "";
}

export function AvaProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen]           = useState(false);
  const [pendingMessage, setPending]  = useState<string | null>(null);
  const [location]                    = useLocation();

  const open   = useCallback(() => setIsOpen(true),            []);
  const close  = useCallback(() => setIsOpen(false),           []);
  const toggle = useCallback(() => setIsOpen(v => !v),         []);

  const injectMessage = useCallback((msg: string) => {
    setIsOpen(true);
    setPending(msg);
  }, []);

  const clearPendingMessage = useCallback(() => setPending(null), []);

  const moduleLabel = resolveLabel(location);
  const useAvaCoreSuperAdmin = location === "/control-center" || location.startsWith("/control-center/");

  return (
    <Ctx.Provider value={{ isOpen, open, close, toggle, moduleLabel, injectMessage, pendingMessage, clearPendingMessage, useAvaCoreSuperAdmin }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAva(): AvaContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAva must be used inside AvaProvider");
  return ctx;
}
