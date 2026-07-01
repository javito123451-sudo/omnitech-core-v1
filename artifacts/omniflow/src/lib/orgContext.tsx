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

interface SidebarCache {
  modules: Record<string, boolean>;
  org: OrgInfo | null;
  expiresAt: number;
  version: number;
}

function getCacheKey(clerkId: string) {
  return `omni_sidebar_${clerkId}`;
}

function readSidebarCache(clerkId: string): { modules: Record<string, boolean>; org: OrgInfo | null; version: number } | null {
  try {
    const raw = localStorage.getItem(getCacheKey(clerkId));
    if (!raw) return null;
    const parsed: SidebarCache = JSON.parse(raw);
    if (Date.now() > parsed.expiresAt) {
      localStorage.removeItem(getCacheKey(clerkId));
      return null;
    }
    return { modules: parsed.modules, org: parsed.org ?? null, version: parsed.version ?? 0 };
  } catch {
    return null;
  }
}

function writeSidebarCache(clerkId: string, modules: Record<string, boolean>, org: OrgInfo | null, version: number) {
  try {
    const entry: SidebarCache = {
      modules,
      org,
      expiresAt: Date.now() + MODULES_CACHE_TTL_MS,
      version,
    };
    localStorage.setItem(getCacheKey(clerkId), JSON.stringify(entry));
    // Remove the old key if it exists (migration from previous cache shape)
    localStorage.removeItem(`omni_modules_${clerkId}`);
  } catch {
    // localStorage may be unavailable (private browsing, quota exceeded) — ignore
  }
}

function clearSidebarCache(clerkId: string) {
  try {
    localStorage.removeItem(getCacheKey(clerkId));
    localStorage.removeItem(`omni_modules_${clerkId}`);
  } catch {
    // ignore
  }
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
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [organizations, setOrganizations] = useState<OrgInfo[]>([]);

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
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !clerkUser?.id) return;
    const cached = readSidebarCache(clerkUser.id);
    if (cached) {
      setModules((prev) =>
        Object.keys(prev).length === 0 ? { ...cached.modules, crm: true } : prev,
      );
      setOrg((prev) => (prev === null && cached.org ? cached.org : prev));
    }
  }, [isLoaded, isSignedIn, clerkUser?.id]);

  useEffect(() => {
    if (!isLoaded) return;

    const currentClerkId = clerkUser?.id ?? null;
    if (!isSignedIn) {
      if (currentClerkId) clearSidebarCache(currentClerkId);
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
        if (u?.clerkId) {
          const cached = readSidebarCache(u.clerkId);
          if (!cached || cached.version < version) {
            clearSidebarCache(u.clerkId);
          }
          writeSidebarCache(u.clerkId, freshModules, organization, version);
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
