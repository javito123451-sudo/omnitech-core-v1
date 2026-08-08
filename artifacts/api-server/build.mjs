import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm, rename } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

// Trigger de redeploy tras completar variables de entorno en Vercel (ago 2026):
// Clerk, OpenAI, WhatsApp, Telegram, Neon (DATABASE_URL pooled), CRON_SECRET.

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  const commonOptions = {
    platform: "node",
    bundle: true,
    format: "esm",
    logLevel: "info",
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
      "pdfkit",
      "fontkit",
      "pdf-parse",
      "exceljs",
      "multer",
      "csv-parse",
    ],
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  };

  // Build tradicional: servidor persistente para Replit/local (node ./dist/index.mjs).
  // Incluye app.listen() y arranca los schedulers en proceso.
  await esbuild({
    ...commonOptions,
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    sourcemap: "linked",
  });

  // Build para Vercel: SOLO la app de Express (sin listen, sin schedulers),
  // como función serverless en api/index.mjs. Generado directamente aquí con
  // esbuild — sin comprobación de tipos — para no arrastrar al compilador de
  // funciones de Vercel los errores de TypeScript preexistentes en el resto
  // del árbol de rutas (ver auditoría de migración, ago 2026). Este archivo
  // es un artefacto de build, no se comitea (ver .gitignore).
  //
  // outdir (no outfile): el plugin de pino genera varios archivos worker
  // internamente (pino-worker.mjs, pino-file.mjs, etc.), y esbuild exige
  // outdir en cuanto hay más de un archivo de salida. El entrypoint se
  // llama app.mjs por defecto (mismo nombre que src/app.ts) — se renombra
  // a index.mjs después, que es el nombre que Vercel espera para /api.
  const apiDir = path.resolve(artifactDir, "api");
  await esbuild({
    ...commonOptions,
    entryPoints: [path.resolve(artifactDir, "src/app.ts")],
    outdir: apiDir,
    outExtension: { ".js": ".mjs" },
    sourcemap: false,
  });
  await rename(path.resolve(apiDir, "app.mjs"), path.resolve(apiDir, "index.mjs"));
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
