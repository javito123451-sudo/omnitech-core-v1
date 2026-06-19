type TokenGetter = () => Promise<string | null>;

let _getToken: TokenGetter | null = null;

export function registerTokenGetter(getter: TokenGetter | null): void {
  _getToken = getter;
}

/**
 * Drop-in replacement for fetch() that automatically:
 * - Sends credentials: "include" (cookie fallback)
 * - Attaches a fresh Clerk Bearer token as Authorization header
 *
 * Registered via ClerkTokenSync in App.tsx. Safe to call before
 * registration — falls back to cookie-only if no getter is set yet.
 */
export async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = _getToken ? await _getToken() : null;
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  // SUPER_ADMIN workspace supervision override
  const wsOverride = typeof localStorage !== "undefined"
    ? localStorage.getItem("wsOverride")
    : null;
  if (wsOverride) headers.set("x-ws-override", wsOverride);

  return fetch(url, {
    credentials: "include",
    ...init,
    headers,
  });
}
