const versions = new Map<number, number>();

export function bumpOrgModuleVersion(orgId: number): number {
  const next = (versions.get(orgId) ?? 0) + 1;
  versions.set(orgId, next);
  return next;
}

export function getOrgModuleVersion(orgId: number): number {
  return versions.get(orgId) ?? 0;
}
