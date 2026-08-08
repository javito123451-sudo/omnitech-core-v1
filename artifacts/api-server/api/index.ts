/**
 * Punto de entrada de Vercel — Migración a hosting serverless.
 *
 * NO reemplaza a src/index.ts (que sigue siendo el arranque tradicional
 * para desarrollo local / un futuro Reserved VM si hiciera falta). Este
 * archivo es exclusivo del despliegue en Vercel.
 *
 * Vercel detecta cualquier archivo bajo /api como una función serverless.
 * Una app de Express es, en sí misma, una función (req, res) => void — el
 * mismo contrato que espera el runtime de Node de Vercel. Por eso basta con
 * reexportar la app tal cual: cero cambios en app.ts, cero cambios en las
 * rutas, cero cambios en middlewares. Todo lo que ya funciona sigue
 * funcionando exactamente igual.
 *
 * vercel.json (junto a este archivo) reescribe TODAS las rutas hacia esta
 * función, para que Express siga viendo la URL completa (incluido el
 * prefijo /api que ya usan sus propias rutas internas).
 *
 * Nota de despliegue: el proyecto en Vercel debe tener Framework Preset =
 * "Other" (no "Express") para que reconozca esta carpeta /api como
 * funciones serverless en vez de intentar compilar todo src/ con tsc.
 */
export { default } from "../src/app";
