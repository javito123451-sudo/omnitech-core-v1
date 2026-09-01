type TokenGetter = () => Promise<string | null>;

let _getToken: TokenGetter | null = null;

export function registerTokenGetter(getter: TokenGetter | null): void {
  _getToken = getter;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * True when a response looks like it came from an infra layer (Vercel's
 * rewrite proxy, a gateway) giving up on a Render free-tier cold start,
 * rather than a real answer from our Express API — which always returns
 * JSON, even for errors (see routes/*.ts). A non-JSON 404/502/503/504 is
 * the fingerprint of "the backend was asleep and didn't wake up in time".
 */
function looksLikeColdStartFailure(res: Response): boolean {
  if (![404, 502, 503, 504].includes(res.status)) return false;
  const contentType = res.headers.get("content-type") ?? "";
  return !contentType.includes("application/json");
}

/**
 * Drop-in replacement for fetch() that automatically:
 * - Sends credentials: "include" (cookie fallback)
 * - Attaches a fresh Clerk Bearer token as Authorization header
 * - Retries once or twice, with a delay, if the backend looks like it was
 *   asleep (Render free tier spins down after 15min idle and takes ~20-25s
 *   to wake up — the first request after that can be dropped by Vercel's
 *   proxy before the cold start finishes). A real API error (401, 403,
 *   validation, etc.) always comes back as JSON and is never retried.
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
  if (wsOverride) {
    headers.set("x-ws-override", wsOverride);
    const wsSupportReason = localStorage.getItem("wsSupportReason");
    if (wsSupportReason) headers.set("x-support-reason", wsSupportReason);
  }

  // Multi-workspace: active workspace selection
  const activeWorkspace = typeof localStorage !== "undefined"
    ? localStorage.getItem("activeWorkspace")
    : null;
  if (activeWorkspace) headers.set("x-active-workspace", activeWorkspace);

  const retryDelaysMs = [4000, 8000];
  let lastError: unknown;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    try {
      const res = await fetch(url, {
        credentials: "include",
        ...init,
        headers,
      });
      if (attempt < retryDelaysMs.length && looksLikeColdStartFailure(res)) {
        await sleep(retryDelaysMs[attempt]);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < retryDelaysMs.length) {
        await sleep(retryDelaysMs[attempt]);
        continue;
      }
    }
  }
  throw lastError;
}
