/**
 * usePageTracker — Automatic page & module tracking for ACE
 *
 * Mounted once inside MainLayout. Observes route changes via wouter's
 * useLocation() and updates the ACE context whenever the path changes.
 *
 * What it does:
 *  - Maps the current path to an activeModule slug
 *  - Extracts entity IDs from parametrised routes (e.g. /clients/42)
 *  - Calls updateSnapshot() — never blocks render, never throws
 *
 * What it does NOT do:
 *  - Business logic
 *  - API calls (updateSnapshot handles the debounced sync)
 *  - Modify any state outside of ACE
 */

import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAce } from "@/lib/aceContext";
import type { AceEntity } from "@/lib/aceContext";

// ── Route → module slug mapping ────────────────────────────────────────────

const ROUTE_MODULE_MAP: Array<{ pattern: RegExp; module: string }> = [
  { pattern: /^\/clients/,           module: "crm" },
  { pattern: /^\/dashboard/,         module: "crm" },
  { pattern: /^\/quotes/,            module: "crm" },
  { pattern: /^\/pipeline/,          module: "crm" },
  { pattern: /^\/calendar/,          module: "crm" },
  { pattern: /^\/telegram-inbox/,    module: "ai_agents" },
  { pattern: /^\/memory/,            module: "ai_agents" },
  { pattern: /^\/knowledge-base/,    module: "knowledge_base" },
  { pattern: /^\/executive/,         module: "analytics" },
  { pattern: /^\/statistics/,        module: "analytics" },
  { pattern: /^\/executive-dashboard/, module: "analytics" },
  { pattern: /^\/accounting/,        module: "omni_accounting" },
  { pattern: /^\/tax/,               module: "omni_tax" },
  { pattern: /^\/marketing/,         module: "omni_marketing" },
  { pattern: /^\/ads/,               module: "omni_ads" },
  { pattern: /^\/leads/,             module: "omni_leads" },
  { pattern: /^\/import/,            module: "omni_import_ai" },
  { pattern: /^\/automations/,       module: "automations" },
  { pattern: /^\/integrations/,      module: "integrations" },
  { pattern: /^\/manual/,            module: "omni_docs" },
  { pattern: /^\/time/,              module: "omni_time" },
  { pattern: /^\/control-center/,    module: "platform" },
  { pattern: /^\/assistant/,         module: "ai_agents" },
];

// ── Entity extraction from parametrised paths ─────────────────────────────
// Returns the entity that can be inferred from the URL alone.
// Richer context (name, etc.) is set by individual page components via useAce().

interface ExtractedEntity {
  field: "activeClient" | "activeProject" | "activeQuote";
  entity: Pick<AceEntity, "id" | "type">;
}

function extractEntityFromPath(path: string): ExtractedEntity | null {
  const clientMatch = path.match(/^\/clients\/(\d+)/);
  if (clientMatch) {
    return {
      field: "activeClient",
      entity: { id: parseInt(clientMatch[1]!, 10), type: "client" },
    };
  }
  const quoteMatch = path.match(/^\/quotes\/(\d+)/);
  if (quoteMatch) {
    return {
      field: "activeQuote",
      entity: { id: parseInt(quoteMatch[1]!, 10), type: "quote" },
    };
  }
  return null;
}

function resolveModule(path: string): string | null {
  for (const { pattern, module } of ROUTE_MODULE_MAP) {
    if (pattern.test(path)) return module;
  }
  return null;
}

// ── Hook ──────────────────────────────────────────────────────────────────

export function usePageTracker(): void {
  const [location] = useLocation();
  const { updateSnapshot } = useAce();

  useEffect(() => {
    const activeModule = resolveModule(location);
    const extracted    = extractEntityFromPath(location);

    const update: Parameters<typeof updateSnapshot>[0] = {
      activePage:   location,
      activeModule: activeModule,
    };

    // When navigating away from an entity route, clear the active entity.
    // When navigating to one, set the id (name is filled by the page component).
    if (extracted) {
      update[extracted.field] = { ...extracted.entity, name: "" } as AceEntity;
    } else {
      // Clear entity context when the path has no entity component
      // but only clear client/quote if the path has changed away from them.
      if (!/^\/clients/.test(location)) update.activeClient       = null;
      if (!/^\/quotes/.test(location))  update.activeQuote        = null;
    }

    updateSnapshot(update);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);
}
