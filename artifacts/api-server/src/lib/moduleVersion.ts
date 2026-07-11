// Use Unix-seconds at startup as the base for every org's version.
// This guarantees that any version cached by the client BEFORE this deploy
// (which was a small incrementing integer) is always LESS than the new base,
// so the frontend always clears its localStorage cache after a server restart.
const DEPLOY_BASE = Math.floor(Date.now() / 1000);

const versions = new Map<number, number>();

export function bumpOrgModuleVersion(orgId: number): number {
  const current = versions.get(orgId) ?? DEPLOY_BASE;
  const next = current + 1;
  versions.set(orgId, next);
  return next;
}

export function getOrgModuleVersion(orgId: number): number {
  return versions.get(orgId) ?? DEPLOY_BASE;
}
