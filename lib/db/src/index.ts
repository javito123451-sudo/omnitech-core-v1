import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// En serverless (Vercel), cada contenedor frío crea su propio Pool — si cada
// uno abre hasta el máximo por defecto (10), unos pocos contenedores
// concurrentes agotan el límite de conexiones de Postgres. Un pool pequeño
// por instancia es la práctica recomendada; el pooler real (PgBouncer) lo
// aporta Neon en el propio connection string (host con sufijo "-pooler").
// En Replit/local, sigue igual que siempre — sin cambio de comportamiento.
const isServerless = Boolean(process.env.VERCEL);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: isServerless ? 1 : 10,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
