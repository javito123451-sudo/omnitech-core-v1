import { useOrg } from "@/lib/orgContext";

export function useSuperAdmin() {
  const { platformRole, loading, platformRoleLoading } = useOrg();
  const isSuperAdmin = platformRole === "SUPER_ADMIN";
  const role = platformRole !== "NONE" ? platformRole : null;
  return { isSuperAdmin, role, loading, platformRoleLoading };
}
