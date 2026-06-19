import { useAuth } from "@clerk/react";
import { useState, useEffect } from "react";
import { authFetch } from "@/lib/authFetch";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

interface SuperAdminStatus {
  isSuperAdmin: boolean;
  role: string | null;
}

export function useSuperAdmin() {
  const { isSignedIn } = useAuth();
  const [status, setStatus] = useState<SuperAdminStatus>({ isSuperAdmin: false, role: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSignedIn) { setLoading(false); return; }
    let cancelled = false;

    const doFetch = (delay: number) => {
      setTimeout(async () => {
        if (cancelled) return;
        try {
          const r    = await authFetch(`${BASE_URL}/api/control-center/check`);
          const data = r.ok
            ? (await r.json()) as SuperAdminStatus
            : { isSuperAdmin: false, role: null };
          if (!cancelled) {
            setStatus(data);
            setLoading(false);
          }
        } catch {
          if (!cancelled) setLoading(false);
        }
      }, delay);
    };

    // Fire immediately then again after 1.5 s to survive Clerk token race-condition
    doFetch(0);
    doFetch(1500);

    return () => { cancelled = true; };
  }, [isSignedIn]);

  return { ...status, loading };
}
