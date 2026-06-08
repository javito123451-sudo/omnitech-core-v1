import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useUser, useAuth } from "@clerk/react";
import { useLocation } from "wouter";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

interface OrgInfo {
  id: number;
  name: string;
  slug: string;
  plan: string;
  role: string;
}

interface UserInfo {
  id: number;
  clerkId: string;
  email: string;
  name: string | null;
}

interface OrgContextValue {
  org: OrgInfo | null;
  user: UserInfo | null;
  loading: boolean;
  refetch: () => void;
}

const OrgContext = createContext<OrgContextValue>({
  org: null,
  user: null,
  loading: true,
  refetch: () => {},
});

export function useOrg() {
  return useContext(OrgContext);
}

export function OrgProvider({ children }: { children: ReactNode }) {
  const { isSignedIn, isLoaded } = useUser();
  const { getToken } = useAuth();
  const [, setLocation] = useLocation();
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const refetch = () => setTick((t) => t + 1);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setOrg(null);
      setUser(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    fetch(`${BASE_URL}/api/auth/me`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json() as Promise<{ user: UserInfo; organization: OrgInfo | null }>;
      })
      .then(({ user: u, organization }) => {
        setUser(u);
        setOrg(organization);
        if (!organization) {
          setLocation("/setup");
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
    <OrgContext.Provider value={{ org, user, loading, refetch }}>
      {children}
    </OrgContext.Provider>
  );
}
