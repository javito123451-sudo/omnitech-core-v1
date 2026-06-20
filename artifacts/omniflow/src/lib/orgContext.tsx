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
  refetch: () => void;
}

const OrgContext = createContext<OrgContextValue>({
  org: null,
  user: null,
  loading: true,
  needsSetup: false,
  modules: {},
  canAccessModule: () => true,
  refetch: () => {},
});

export function useOrg() {
  return useContext(OrgContext);
}

export function OrgProvider({ children }: { children: ReactNode }) {
  const { isSignedIn, isLoaded } = useUser();
  const { getToken } = useAuth();
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [modules, setModules] = useState<Record<string, boolean>>({});
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

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      setOrg(null);
      setUser(null);
      setNeedsSetup(false);
      setModules({});
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
          modules: Record<string, boolean>;
        }>;
      })
      .then(({ user: u, organization, modules: mods }) => {
        setUser(u);
        setOrg(organization);
        setNeedsSetup(!organization);
        setModules({ ...mods, crm: true });
      })
      .catch((err) => {
        console.error("OrgProvider: failed to load user", err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isSignedIn, isLoaded, tick]);

  return (
    <OrgContext.Provider value={{ org, user, loading, needsSetup, modules, canAccessModule, refetch }}>
      {children}
    </OrgContext.Provider>
  );
}
