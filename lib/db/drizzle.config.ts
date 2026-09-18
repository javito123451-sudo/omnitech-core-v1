import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

// drizzle-kit's glob matcher expects forward slashes; path.join() emits
// backslashes on Windows, which silently matches zero files there.
const toPosix = (p: string) => p.split(path.sep).join("/");

export default defineConfig({
  schema: toPosix(path.join(__dirname, "./src/schema/*.ts")),
  // Relativo (no absoluto): un `out` absoluto en Windows hace que drizzle-kit
  // duplique el prefijo al leer los snapshots existentes en `generate`
  // incremental (ENOENT con la ruta repetida dos veces) — solo se manifiesta
  // a partir de la segunda migración, no en la primera (`push`/generate en
  // blanco no leen snapshots previos).
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
