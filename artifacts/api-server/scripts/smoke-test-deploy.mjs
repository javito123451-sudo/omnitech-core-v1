#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Post-deploy smoke test — run this against the LIVE API right after every
// deploy (see docs/smoke-tests.md for the full explanation and history).
//
// Every check here is safe to run against production: no real Telegram
// secret / WhatsApp verify token will ever match, so nothing gets processed
// or sent — we're only confirming the routes are mounted and the app
// actually booted, not exercising business logic.
//
// Usage:
//   node scripts/smoke-test-deploy.mjs
//   BASE_URL=https://omnitech-core-api.onrender.com node scripts/smoke-test-deploy.mjs
// ═══════════════════════════════════════════════════════════════════════════

const BASE_URL = process.env.BASE_URL ?? "https://omnitech-core-api.onrender.com";
// Render's free plan spins the instance down after inactivity — a cold
// start can take 50s+ before the first response (see the dashboard's own
// warning, and commit "fix: reintento automático ante arranque en frío del
// backend (Render free)"). Right after a *deploy* the process is already
// running, so this is mostly a concern when running this script ad hoc
// between deploys, not right after one — but size the timeout for the
// worst case either way instead of a flaky short one.
const TIMEOUT_MS = 60_000;

let failures = 0;

async function check(name, fn) {
  const start = Date.now();
  try {
    await fn();
    console.log(`✅ ${name} (${Date.now() - start}ms)`);
  } catch (err) {
    failures++;
    console.error(`❌ ${name} (${Date.now() - start}ms)\n   ${err.message}`);
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
  ]);
}

async function main() {
  console.log(`Smoke-testing ${BASE_URL}\n`);

  await check("API is up (GET /api/healthz → 200)", async () => {
    const res = await withTimeout(fetch(`${BASE_URL}/api/healthz`), TIMEOUT_MS);
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
  });

  await check(
    "Telegram webhook route is mounted and responds (POST /api/telegram/webhook/:bogus-secret → 200)",
    async () => {
      // Telegram requires an immediate 200 regardless of secret validity — the
      // app looks the secret up asynchronously and just logs+ignores unknown
      // ones (see routes/telegram.ts). A bogus secret here never touches a
      // real org or triggers AVA — it's the same as Telegram probing a stale URL.
      const res = await withTimeout(
        fetch(`${BASE_URL}/api/telegram/webhook/__smoke_test_${Date.now()}__`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
        TIMEOUT_MS,
      );
      if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
    },
  );

  await check(
    "WhatsApp webhook verify route is mounted and rejects a bad token (GET /api/whatsapp/webhook → 403)",
    async () => {
      // A wrong hub.verify_token correctly returning 403 proves the route is
      // live and the verify-token check is running — it's the expected,
      // safe response, not an error condition for this check.
      const url = `${BASE_URL}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=__smoke_test_invalid__&hub.challenge=1234`;
      const res = await withTimeout(fetch(url), TIMEOUT_MS);
      if (res.status !== 403) throw new Error(`expected 403, got ${res.status}`);
    },
  );

  console.log("");
  if (failures > 0) {
    console.error(`${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("All checks passed.");
  console.log(
    "\nNote: this only proves the routes are mounted and the app booted — it does NOT prove\n" +
    "a specific org's Telegram/WhatsApp webhook is actually registered with the provider.\n" +
    "For that, see the manual per-org check in docs/smoke-tests.md (GET /api/telegram/webhook-info).",
  );
}

main();
