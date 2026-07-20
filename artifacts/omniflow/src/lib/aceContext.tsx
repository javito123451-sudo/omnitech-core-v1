/**
 * Ava Context Engine (ACE) — Frontend Provider & Hook
 *
 * AceProvider maintains a live mirror of the user's session context.
 * It wraps pages inside MainLayout and extends (not replaces) OrgContext.
 *
 * Responsibilities:
 *  - Sync identity from OrgContext on mount
 *  - Accept entity/page/module updates from any component via useAce()
 *  - Debounce PATCH calls to the backend (300 ms) to avoid flooding
 *  - Expose typed setters so consumers never construct raw payloads
 *
 * What ACE does NOT do:
 *  - Business logic
 *  - AI calls
 *  - Modify OrgContext
 *  - Block renders — all backend syncs are fire-and-forget
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import { useOrg } from "@/lib/orgContext";
import { authFetch } from "@/lib/authFetch";

// ── Types (mirrored from backend ace/types.ts — kept in sync manually) ────

export type AceEntityType =
  | "client"
  | "project"
  | "conversation"
  | "quote"
  | "work_order"
  | "invoice"
  | "campaign";

export interface AceEntity {
  id:   number;
  name: string;
  type: AceEntityType;
}

export interface AceWorkday {
  entryId:    number;
  clockInAt:  string;
  breakCount: number;
}

export type AceClockStatus = "clocked_in" | "on_break" | "clocked_out";
export type AceClockMethod  = "manual" | "web" | "mobile" | "ava";

export interface AceContextSnapshot {
  activePage:         string;
  activeModule:       string | null;
  activeClient:       AceEntity | null;
  activeProject:      AceEntity | null;
  activeConversation: AceEntity | null;
  activeQuote:        AceEntity | null;
  activeWorkOrder:    AceEntity | null;
  activeWorkday:      AceWorkday | null;
  clockStatus:        AceClockStatus | null;
  clockMethod:        AceClockMethod | null;
  timezone:           string | null;
  language:           string | null;
  device:             string | null;
  browser:            string | null;
}

interface AceContextValue {
  // Current snapshot (local state — always available synchronously)
  snapshot: AceContextSnapshot;

  // Setters — update local state + debounce backend sync
  setActivePage:         (path: string) => void;
  setActiveModule:       (module: string | null) => void;
  setActiveClient:       (entity: AceEntity | null) => void;
  setActiveProject:      (entity: AceEntity | null) => void;
  setActiveConversation: (entity: AceEntity | null) => void;
  setActiveQuote:        (entity: AceEntity | null) => void;
  setActiveWorkOrder:    (entity: AceEntity | null) => void;
  setClockStatus:        (status: AceClockStatus | null, method?: AceClockMethod) => void;
  setWorkday:            (workday: AceWorkday | null) => void;

  // Bulk update (used by usePageTracker)
  updateSnapshot: (partial: Partial<AceContextSnapshot>) => void;

  // Full clear (called on logout — AceProvider itself calls this via useEffect)
  clearAceContext: () => void;
}

// ── Defaults ──────────────────────────────────────────────────────────────

const DEFAULT_SNAPSHOT: AceContextSnapshot = {
  activePage:         "/",
  activeModule:       null,
  activeClient:       null,
  activeProject:      null,
  activeConversation: null,
  activeQuote:        null,
  activeWorkOrder:    null,
  activeWorkday:      null,
  clockStatus:        null,
  clockMethod:        null,
  timezone:           Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
  language:           navigator.language ?? null,
  device:             /Mobi|Android/i.test(navigator.userAgent) ? "mobile"
                        : /Tablet|iPad/i.test(navigator.userAgent) ? "tablet"
                        : "desktop",
  browser:            parseBrowser(),
};

// ── Context ───────────────────────────────────────────────────────────────

const AceContext = createContext<AceContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 300;

export function AceProvider({ children }: { children: ReactNode }) {
  const { org, isLoaded } = useOrg();

  const [snapshot, setSnapshot] = useState<AceContextSnapshot>({
    ...DEFAULT_SNAPSHOT,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
    language: navigator.language ?? null,
  });

  // Debounce timer ref — cleared and reset on every update
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Backend sync ─────────────────────────────────────────────────────────

  const syncToBackend = useCallback(
    (partial: Partial<AceContextSnapshot>) => {
      if (!isLoaded || !org) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void authFetch("/api/ace/context", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(partial),
        }).catch(() => {
          // Fire-and-forget — ACE never blocks the UI on network errors
        });
      }, DEBOUNCE_MS);
    },
    [isLoaded, org],
  );

  // ── Initialise context on first load ──────────────────────────────────────

  useEffect(() => {
    if (!isLoaded || !org) return;
    void authFetch("/api/ace/context").catch(() => {});
  }, [isLoaded, org]);

  // ── Update helper ─────────────────────────────────────────────────────────

  const updateSnapshot = useCallback(
    (partial: Partial<AceContextSnapshot>) => {
      setSnapshot(prev => {
        const next = { ...prev, ...partial };
        syncToBackend(partial);
        return next;
      });
    },
    [syncToBackend],
  );

  // ── Typed setters ─────────────────────────────────────────────────────────

  const setActivePage = useCallback(
    (path: string) => updateSnapshot({ activePage: path }),
    [updateSnapshot],
  );

  const setActiveModule = useCallback(
    (module: string | null) => updateSnapshot({ activeModule: module }),
    [updateSnapshot],
  );

  const setActiveClient = useCallback(
    (entity: AceEntity | null) => updateSnapshot({ activeClient: entity }),
    [updateSnapshot],
  );

  const setActiveProject = useCallback(
    (entity: AceEntity | null) => updateSnapshot({ activeProject: entity }),
    [updateSnapshot],
  );

  const setActiveConversation = useCallback(
    (entity: AceEntity | null) => updateSnapshot({ activeConversation: entity }),
    [updateSnapshot],
  );

  const setActiveQuote = useCallback(
    (entity: AceEntity | null) => updateSnapshot({ activeQuote: entity }),
    [updateSnapshot],
  );

  const setActiveWorkOrder = useCallback(
    (entity: AceEntity | null) => updateSnapshot({ activeWorkOrder: entity }),
    [updateSnapshot],
  );

  const setClockStatus = useCallback(
    (status: AceClockStatus | null, method?: AceClockMethod) => {
      updateSnapshot({
        clockStatus: status,
        ...(method ? { clockMethod: method } : {}),
      });
    },
    [updateSnapshot],
  );

  const setWorkday = useCallback(
    (workday: AceWorkday | null) => updateSnapshot({ activeWorkday: workday }),
    [updateSnapshot],
  );

  const clearAceContext = useCallback(() => {
    setSnapshot({ ...DEFAULT_SNAPSHOT });
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  return (
    <AceContext.Provider
      value={{
        snapshot,
        setActivePage,
        setActiveModule,
        setActiveClient,
        setActiveProject,
        setActiveConversation,
        setActiveQuote,
        setActiveWorkOrder,
        setClockStatus,
        setWorkday,
        updateSnapshot,
        clearAceContext,
      }}
    >
      {children}
    </AceContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────

export function useAce(): AceContextValue {
  const ctx = useContext(AceContext);
  if (!ctx) {
    throw new Error("useAce() must be used inside <AceProvider>");
  }
  return ctx;
}

// ── Utility ───────────────────────────────────────────────────────────────

function parseBrowser(): string | null {
  const ua = navigator.userAgent;
  if (ua.includes("Chrome"))  return "Chrome";
  if (ua.includes("Firefox")) return "Firefox";
  if (ua.includes("Safari"))  return "Safari";
  if (ua.includes("Edge"))    return "Edge";
  return "Unknown";
}
