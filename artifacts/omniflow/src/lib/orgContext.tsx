import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { useUser, useAuth } from "@clerk/react";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

const MODULES_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface OrgInfo {
  id: number;
  name: string;
  slug: string;
  plan: string;
  role: string;
  logoUrl?: string | null;
}

export interface UserInfo {
  id: number;
  clerkId: string;
  email: string;
  name: string | null;
  avatarUrl?: string | null;
  platformRole?: string;
}

interface SidebarCache {
  modules: Record<string, boolean>;
  org: OrgInfo | null;
  expiresAt: number;
  version: number;
  /** Platform role cached so HomeRedirect fires with the correct value even before the API responds */
  platformRole?: string;
}

/** Points to the orgId whose cache entry is "current" for this user. */
function getPointerKey(clerkId: string) {
  return `omni_sidebar_ptr_${clerkId}`;
}

/** Per-workspace cache entry key — includes the org ID so each workspace is isolated. */
function getCacheKey(clerkId: string, orgId: string | number) {
  return `omni_sidebar_${clerkId}_${orgId}`;
}

function readCurrentOrgId(clerkId: string): string | null {
  try {
    return localStorage.getItem(getPointerKey(clerkId));
  } catch {
    return null;
  }
}

function readSidebarCache(clerkId: string): { modules: Record<string, boolean>; org: OrgInfo | null; version: number; platformRole?: string } | null {
  try {
    // When a workspace override is active (support mode), use that org ID as
    // the cache key so the correct workspace's data is served immediately on
    // first paint — before the API response arrives. wsOverride stores the
    // numeric org ID as a string (set by workspaces.tsx / workspace-detail.tsx).
    const wsOverride = localStorage.getItem("wsOverride");
    const orgId = wsOverride ?? readCurrentOrgId(clerkId);
    if (!orgId) return null;
    const raw = localStorage.getItem(getCacheKey(clerkId, orgId));
    if (!raw) return null;
    const parsed: SidebarCache = JSON.parse(raw);
    if (Date.now() > parsed.expiresAt) {
      localStorage.removeItem(getCacheKey(clerkId, orgId));
      return null;
    }
    return { modules: parsed.modules, org: parsed.org ?? null, version: parsed.version ?? 0, platformRole: parsed.platformRole };
  } catch {
    return null;
  }
}

function writeSidebarCache(clerkId: string, modules: Record<string, boolean>, org: OrgInfo | null, version: number, platformRole?: string) {
  try {
    // Use a sentinel when org is null so the slot is still written and the
    // pointer is not left pointing at a different workspace.
    const newOrgId = org ? String(org.id) : "no-org";
    const newKey = getCacheKey(clerkId, newOrgId);

    const entry: SidebarCache = {
      modules,
      org,
      expiresAt: Date.now() + MODULES_CACHE_TTL_MS,
      version,
      platformRole,
    };
    localStorage.setItem(newKey, JSON.stringify(entry));

    // Only advance the pointer when NOT in support/override mode.
    // The pointer is the fallback `readSidebarCache` uses after `wsOverride`
    // is cleared (e.g. after exiting support mode). It must always reflect the
    // user's own workspace — never the overridden one — so that a full-page
    // reload after exit immediately serves the correct workspace's data.
    const wsOverride = localStorage.getItem("wsOverride");
    if (!wsOverride) {
      localStorage.setItem(getPointerKey(clerkId), newOrgId);
    }

    // Prune every other per-workspace entry for this user so that support-mode
    // visits across many workspaces never accumulate orphan keys in localStorage.
    // We keep only the entry we just wrote; the pointer key is left intact.
    const prefix = `omni_sidebar_${clerkId}_`;
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix) && key !== newKey) keysToRemove.push(key);
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));

    // Remove legacy keys from previous cache shape.
    localStorage.removeItem(`omni_sidebar_${clerkId}`);
    localStorage.removeItem(`omni_modules_${clerkId}`);
  } catch {
    // localStorage may be unavailable (private browsing, quota exceeded) — ignore
  }
}

/** Remove the cache entry for a single specific org (used when exiting support mode). */
export function clearSidebarCacheForOrg(clerkId: string, orgId: string | number) {
  try {
    localStorage.removeItem(getCacheKey(clerkId, String(orgId)));
  } catch {
    // ignore
  }
}

function clearSidebarCache(clerkId: string) {
  try {
    // Enumerate and remove every per-workspace entry for this user so that
    // logout leaves no stale data regardless of how many workspaces were visited.
    const prefix = `omni_sidebar_${clerkId}_`;
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) keysToRemove.push(key);
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
    localStorage.removeItem(getPointerKey(clerkId));
    // Legacy keys from previous cache shape
    localStorage.removeItem(`omni_sidebar_${clerkId}`);
    localStorage.removeItem(`omni_modules_${clerkId}`);
  } catch {
    // ignore
  }
}

interface OrgContextValue {
  org: OrgInfo | null;
  user: UserInfo | null;
  loading: boolean;
  /** True until the API has responded at least once this session. Use this
   *  (not `loading`) as the gate for platform-role-based routing decisions,
   *  so a cached-but-stale platformRole never triggers a premature redirect. */
  platformRoleLoading: boolean;
  needsSetup: boolean;
  modules: Record<string, boolean>;
  canAccessModule: (key: string) => boolean;
  /** Granular permissions from the backend (e.g. ["crm.read", "quotes.write"]) */
  permissions: string[];
  /** Check if the current user has a specific permission */
  hasPermission: (perm: string) => boolean;
  /** All organizations this user belongs to (multi-workspace) */
  organizations: OrgInfo[];
  /** Global platform role (SUPER_ADMIN / STAFF_OMNITECH / NONE / etc.) */
  platformRole: string;
  refetch: () => void;
}

const OrgContext = createContext<OrgContextValue>({
  org: null,
  user: null,
  loading: true,
  platformRoleLoading: true,
  needsSetup: false,
  modules: {},
  canAccessModule: () => true,
  permissions: [],
  hasPermission: () => false,
  organizations: [],
  platformRole: "NONE",
  refetch: () => {},
});

export function useOrg() {
  return useContext(OrgContext);
}

export function OrgProvider({ children }: { children: ReactNode }) {
  const { isSignedIn, isLoaded, user: clerkUser } = useUser();
  const { getToken } = useAuth();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  // platformRoleLoading stays true until the API has responded at least once
  // this session. Unlike `loading` it is NOT cleared by the cache-seeding
  // effect, so HomeRedirect and SuperAdminRoute won't fire based on a
  // potentially stale platformRole that was cached from a previous session.
  const [platformRoleLoading, setPlatformRoleLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [organizations, setOrganizations] = useState<OrgInfo[]>([]);
  const [platformRole, setPlatformRole] = useState<string>("NONE");

  const hasPermission = useCallback(
    (perm: string): boolean => permissions.includes(perm),
    [permissions],
  );

  // Eagerly seed both modules and org from cache so the sidebar renders on
  // the very first paint — before Clerk finishes initializing.
  const [modules, setModules] = useState<Record<string, boolean>>(() => {
    if (typeof window !== "undefined" && clerkUser?.id) {
      return readSidebarCache(clerkUser.id)?.modules ?? {};
    }
    return {};
  });

  const [org, setOrg] = useState<OrgInfo | null>(() => {
    if (typeof window !== "undefined" && clerkUser?.id) {
      return readSidebarCache(clerkUser.id)?.org ?? null;
    }
    return null;
  });

  const [tick, setTick] = useState(0);

  /**
   * Set to true as soon as cache data is seeded into state.
   * When true, the background refresh runs silently — loading is never set
   * back to true so the cached sidebar stays fully visible during slow fetches.
   */
  const hasCachedData = useRef(false);

  /**
   * Tracks the last wsOverride value seen by the fetch effect so we can
   * detect support-mode transitions and immediately wipe stale org state
   * before the new workspace's API response arrives.
   */
  const prevWsOverrideRef = useRef<string | null>(
    typeof window !== "undefined" ? localStorage.getItem("wsOverride") : null,
  );

  const refetch = () => setTick((t) => t + 1);

  const canAccessModule = useCallback(
    (key: string): boolean => {
      // crm is always on — never gated
      if (key === "crm") return true;
      // If the key has an explicit entry, use it; otherwise fail-open (true)
      // so newly-added modules don't break before being configured
      return modules[key] !== false;
    },
    [modules],
  );

  // Seed modules + org from cache as soon as we know the Clerk user ID (handles
  // the cold-login case where clerkUser.id wasn't available during useState init).
  // When cache data is found we also optimistically unlock loading so the sidebar
  // stays visible while the background refresh is in flight.
  // hasCachedData.current is set to !!cached so a cache miss for the current
  // user explicitly clears a value left by a previous session.
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !clerkUser?.id) return;
    const cached = readSidebarCache(clerkUser.id);
    hasCachedData.current = !!cached;
    if (cached) {
      setModules((prev) =>
        Object.keys(prev).length === 0 ? { ...cached.modules, crm: true } : prev,
      );
      setOrg((prev) => (prev === null && cached.org ? cached.org : prev));

      // Restore platformRole optimistically from cache if present.
      // The API response always overwrites this with the authoritative live
      // value from platform_roles table. platformRoleLoading is intentionally
      // NOT cleared here — only the API response clears it (see fetch effect).
      if (cached.platformRole !== undefined) {
        setPlatformRole(cached.platformRole);
      }
      setLoading(false);
    }
  }, [isLoaded, isSignedIn, clerkUser?.id]);

  useEffect(() => {
    if (!isLoaded) return;

    const currentClerkId = clerkUser?.id ?? null;
    if (!isSignedIn) {
      if (currentClerkId) clearSidebarCache(currentClerkId);
      // Reset so a future sign-in starts fresh — a previous session's cached
      // data must not prevent the loading state from appearing when there is
      // no cache for the new session.
      hasCachedData.current = false;
      setOrg(null);
      setUser(null);
      setNeedsSetup(false);
      setModules({});
      setPermissions([]);
      setOrganizations([]);
      setPlatformRole("NONE");
      setLoading(false);
      setPlatformRoleLoading(true); // Reset so next sign-in waits for API
      return;
    }

    // Detect support-mode (wsOverride) transitions so stale org data from the
    // previous workspace is never shown while the new workspace's fetch is in
    // flight. We compare against the value seen on the last run of this effect.
    const wsOverrideNow = localStorage.getItem("wsOverride");
    if (wsOverrideNow !== prevWsOverrideRef.current) {
      // wsOverride changed (entered or exited support mode mid-session).
      // Wipe in-memory org/modules immediately so the sidebar renders nothing
      // rather than stale data until the API response arrives.
      prevWsOverrideRef.current = wsOverrideNow;
      hasCachedData.current = false;
      setOrg(null);
      setModules({});
    }

    // Only block the UI with a spinner when there is nothing cached to show.
    // If we already seeded from cache, the fetch runs as a silent background
    // refresh — the sidebar stays fully visible regardless of how slow the
    // server is. This effect runs after the cache-seeding effect (defined
    // earlier in the file), so hasCachedData.current is already up-to-date.
    if (!hasCachedData.current) {
      setLoading(true);
    }

    getToken()
      .then(token => {
        const headers: HeadersInit = {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Cache-Control": "no-cache",
          "Pragma": "no-cache",
        };
        return fetch(`${BASE_URL}/api/auth/me`, { credentials: "include", headers, cache: "no-store" });
      })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json() as Promise<{
          user: UserInfo;
          organization: OrgInfo | null;
          organizations: OrgInfo[];
          modules: Record<string, boolean>;
          modulesVersion: number;
          permissions: string[];
          platformRole?: string;
        }>;
      })
      .then(({ user: u, organization, organizations: orgs, modules: mods, permissions: perms, modulesVersion: serverVersion, platformRole: pRole }) => {
        const freshModules = { ...mods, crm: true };
        const version = serverVersion ?? 0;
        setUser(u);
        setOrg(organization);
        setOrganizations(orgs ?? []);
        setNeedsSetup(!organization);
        setModules(freshModules);
        setPermissions(perms ?? []);
        const resolvedRole = pRole ?? u?.platformRole ?? "NONE";
        setPlatformRole(resolvedRole);
        if (u?.clerkId) {
          const cached = readSidebarCache(u.clerkId);
          if (!cached || cached.version < version) {
            clearSidebarCache(u.clerkId);
          }
          writeSidebarCache(u.clerkId, freshModules, organization, version, resolvedRole);
        }
      })
      .catch((err) => {
        // Background refresh failed — keep showing cached data as-is.
        // Only log so the user sees no visible error state.
        console.error("OrgProvider: background refresh failed", err);
      })
      .finally(() => {
        setLoading(false);
        setPlatformRoleLoading(false); // API has responded — platformRole is now authoritative
      });
  }, [isSignedIn, isLoaded, tick]);

  return (
    <OrgContext.Provider value={{ org, user, loading, platformRoleLoading, needsSetup, modules, canAccessModule, permissions, hasPermission, organizations, platformRole, refetch }}>
      {children}
    </OrgContext.Provider>
  );
}
