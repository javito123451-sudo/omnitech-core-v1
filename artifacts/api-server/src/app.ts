import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// ── CORS ──────────────────────────────────────────────────────────────────────
// Allowed origins are built from three sources (union, deduplicated):
//   1. ALLOWED_ORIGINS env var — explicit comma-separated list (optional)
//   2. REPLIT_DOMAINS env var  — comma-separated hostnames injected by Replit runtime
//   3. REPLIT_DEV_DOMAIN env var — single dev-preview hostname injected by Replit
// In addition, any origin matching *.replit.app or *.replit.dev is always allowed
// so that Replit preview iframes and deployed apps work without extra configuration.
function buildAllowedOrigins(): Set<string> {
  const set = new Set<string>();
  const add = (raw: string | undefined) => {
    if (!raw) return;
    for (const part of raw.split(",")) {
      const host = part.trim();
      if (!host) continue;
      // Accept bare hostnames (REPLIT_DOMAINS) and full origins (ALLOWED_ORIGINS)
      set.add(host.startsWith("http") ? host : `https://${host}`);
    }
  };
  add(process.env["ALLOWED_ORIGINS"]);
  add(process.env["REPLIT_DOMAINS"]);
  add(process.env["REPLIT_DEV_DOMAIN"]);
  return set;
}

const allowedOrigins = buildAllowedOrigins();

/** Returns true for any *.replit.app or *.replit.dev origin. */
function isReplitOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname.endsWith(".replit.app") || hostname.endsWith(".replit.dev");
  } catch {
    return false;
  }
}

app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => {
      // Same-origin requests and non-browser clients (curl, mobile) have no Origin header
      if (!origin) return callback(null, true);
      // Development: unrestricted
      if (process.env["NODE_ENV"] !== "production") return callback(null, true);
      // Always allow any Replit-platform origin (dev previews + deployed apps)
      if (isReplitOrigin(origin)) return callback(null, true);
      // Explicit allowlist from env vars
      if (allowedOrigins.has(origin)) return callback(null, true);
      logger.warn({ origin }, "CORS: origin not in allowlist — request denied");
      callback(new Error(`CORS policy: origin ${origin} not allowed`));
    },
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

// ── Global rate limit (200 req/min/IP, skips Clerk proxy) ─────────────────────
const limiter = rateLimit({
  windowMs: 60_000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
  skip: (req) => req.url.startsWith(CLERK_PROXY_PATH),
});

app.use("/api", limiter);
app.use("/api", router);

export default app;
