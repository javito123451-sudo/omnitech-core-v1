import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { useUser, useAuth } from "@clerk/react";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

const MODULES_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface ModulesCache {
  modules: Record<string, boolean>;
  expiresAt: number;
  version: number;
}

function getCacheKey(clerkId: string) {
  return `omni_modules_${clerkId}`;
}

function readModulesCache(clerkId: string): { modules: Record<string, boolean>; version: number } | null {
  try {
    const raw = localStorage.getItem(getCacheKey(clerkId));
    if (!raw) return null;
    const parsed: ModulesCache = JSON.parse(raw);
    if (Date.now() > parsed.expiresAt) {
      localStorage.removeItem(getCacheKey(clerkId));
      return null;
    }
    return { modules: parsed.modules, version: parsed.version ?? 0 };
  } catch {
    return null;
  }
}

function writeModulesCache(clerkId: string, modules: Record<string, boolean>, version: number) {
  try {
    const entry: ModulesCache = {
      modules,
      expiresAt: Date.now() + MODULES_CACHE_TTL_MS,
      version,
    };
    localStorage.setItem(getCacheKey(clerkId), JSON.stringify(entry));
  } catch {
    // localStorage may be unavailable (private browsing, quota exceeded) — ignore
  }
}

function clearModulesCache(clerkId: string) {
  try {
    localStorage.removeItem(getCacheKey(clerkId));
  } catch {
    // ignore
  }
}

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
}

interface OrgContextValue {
  org: OrgInfo | null;
  user: UserInfo | null;
  loading: boolean;
  needsSetup: boolean;
  modules: Record<string, boolean>;
  canAccessModule: (key: string) => boolean;
  /** Granular permissions from the backend (e.g. ["crm.read", "quotes.write"]) */
  permissions: string[];
  /** Check if the current user has a specific permission */
  hasPermission: (perm: string) => boolean;
  /** All organizations this user belongs to (multi-workspace) */
  organizations: OrgInfo[];
  refetch: () => void;
}

const OrgContext = createContext<OrgContextValue>({
  org: null,
  user: null,
  loading: true,
  needsSetup: false,
  modules: {},
  canAccessModule: () => true,
  permissions: [],
  hasPermission: () => false,
  organizations: [],
  refetch: () => {},
});

export function useOrg() {
  return useContext(OrgContext);
}

export function OrgProvider({ children }: { children: ReactNode }) {
  const { isSignedIn, isLoaded, user: clerkUser } = useUser();
  const { getToken } = useAuth();
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [organizations, setOrganizations] = useState<OrgInfo[]>([]);

  const hasPermission = useCallback(
    (perm: string): boolean => permissions.includes(perm),
    [permissions],
  );

  const [modules, setModules] = useState<Record<string, boolean>>(() => {
    // Eagerly seed from cache if the Clerk user ID is already known at init time.
    // This covers the common case where the page is refreshed while still logged in.
    // The ID may not yet be available on the very first render after a cold login —
    // in that case we fall back to {} and re-seed once the effect runs.
    if (typeof window !== "undefined" && clerkUser?.id) {
      return readModulesCache(clerkUser.id)?.modules ?? {};
    }
    return {};
  });
  const [tick, setTick] = useState(0);

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

  // Seed modules from cache as soon as we know the Clerk user ID (handles
  // the cold-login case where clerkUser.id wasn't available during useState init).
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !clerkUser?.id) return;
    const cached = readModulesCache(clerkUser.id);
    if (cached) {
      setModules((prev) =>
        // Only apply if modules is still empty (server fetch hasn't completed yet)
        Object.keys(prev).length === 0 ? { ...cached.modules, crm: true } : prev,
      );
    }
  }, [isLoaded, isSignedIn, clerkUser?.id]);

  useEffect(() => {
    if (!isLoaded) return;

    const currentClerkId = clerkUser?.id ?? null;
    if (!isSignedIn) {
      if (currentClerkId) clearModulesCache(currentClerkId);
      setOrg(null);
      setUser(null);
      setNeedsSetup(false);
      setModules({});
      setPermissions([]);
      setOrganizations([]);
      setLoading(false);
      return;
    }

    setLoading(true);
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
        }>;
      })
      .then(({ user: u, organization, organizations: orgs, modules: mods, permissions: perms, modulesVersion: serverVersion }) => {
        const freshModules = { ...mods, crm: true };
        const version = serverVersion ?? 0;
        setUser(u);
        setOrg(organization);
        setOrganizations(orgs ?? []);
        setNeedsSetup(!organization);
        setModules(freshModules);
        setPermissions(perms ?? []);
        // If the server version is newer than what was cached, the stale cache entry
        // is superseded by the fresh server data. Write the new version so future
        // page loads won't re-seed with outdated modules.
        if (u?.clerkId) {
          const cached = readModulesCache(u.clerkId);
          if (!cached || cached.version < version) {
            clearModulesCache(u.clerkId);
          }
          writeModulesCache(u.clerkId, freshModules, version);
        }
      })
      .catch((err) => {
        console.error("OrgProvider: failed to load user", err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isSignedIn, isLoaded, tick]);

  return (
    <OrgContext.Provider value={{ org, user, loading, needsSetup, modules, canAccessModule, permissions, hasPermission, organizations, refetch }}>
      {children}
    </OrgContext.Provider>
  );
}
