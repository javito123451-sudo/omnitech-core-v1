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
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://placeholder@localhost:5432/placeholder",
    },
  },
});
