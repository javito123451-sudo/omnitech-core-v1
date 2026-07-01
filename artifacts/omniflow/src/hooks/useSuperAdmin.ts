import { useOrg } from "@/lib/orgContext";

export function useSuperAdmin() {
  const { platformRole, loading } = useOrg();
  const isSuperAdmin = platformRole === "SUPER_ADMIN";
  const role = platformRole !== "NONE" ? platformRole : null;
  return { isSuperAdmin, role, loading };
}
