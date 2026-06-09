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
// Development: accept all origins.
// Production:  only origins listed in ALLOWED_ORIGINS (comma-separated env var).
const rawOrigins = process.env["ALLOWED_ORIGINS"] ?? "";
const allowedOrigins = rawOrigins
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => {
      // Same-origin requests and non-browser clients (curl, mobile) have no Origin header
      if (!origin) return callback(null, true);
      // Development: unrestricted
      if (process.env["NODE_ENV"] !== "production") return callback(null, true);
      // Production: enforce allowlist
      if (allowedOrigins.length === 0) {
        // No allowlist configured → log and deny
        logger.warn({ origin }, "CORS: ALLOWED_ORIGINS not set — request denied in production");
        return callback(new Error("CORS policy: no allowed origins configured"));
      }
      if (allowedOrigins.includes(origin)) return callback(null, true);
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
