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
    authFetch(`${BASE_URL}/api/control-center/check`)
      .then(r => r.ok ? r.json() : { isSuperAdmin: false, role: null })
      .then((data: SuperAdminStatus) => setStatus(data))
      .catch(() => setStatus({ isSuperAdmin: false, role: null }))
      .finally(() => setLoading(false));
  }, [isSignedIn]);

  return { ...status, loading };
}
