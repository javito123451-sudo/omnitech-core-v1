import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 15_000,
    // Importing skills/index.ts pulls in @workspace/db, which throws at
    // import time if DATABASE_URL is unset at all. Tests that don't touch
    // the database (e.g. skillChannelFilter.test.ts) just need this to be
    // *some* string; tests that do (guestAppointments.integration.test.ts)
    // check for the real value themselves and skip cleanly without it.
    // Set DATABASE_URL yourself (e.g. in a local .env.test, gitignored) to
    // point at a disposable test database to run the DB-backed tests too.
    //
    // Same idea for OPENAI_API_KEY: routes/leads.ts builds an OpenAI client
    // at module-import time (`new OpenAI({...})`), which throws immediately
    // if no key is present at all — regardless of whether the test that
    // imports it ever calls the AI-dependent endpoints. A placeholder here
    // only unblocks import; it is never sent to a real OpenAI call.
    env: {
      DATABASE_URL:   process.env.DATABASE_URL   ?? "postgres://placeholder@localhost:5432/placeholder",
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "sk-placeholder-test-key",
    },
  },
});
