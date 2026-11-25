// Rutas PÚBLICAS de Omni Review (sin sesión; la autenticación es el token aleatorio de cada mensaje):
//   GET  /r/:token  → registra el clic y redirige 302 a la URL de reseña de Google del establecimiento.
//   GET  /u/:token  → página de confirmación de baja (un GET NO da de baja: los escáneres de correo y las
//                     vistas previas de enlaces siguen los GET y darían de baja a gente sin querer).
//   POST /u/:token  → da de baja (formulario y baja de un clic RFC 8058).
// Nunca redirige a una URL recibida del cliente: solo a la guardada en el establecimiento.
import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { unsubscribeContact } from "./consent";
import { TOKEN_RE } from "./links";

export const reviewPublicRouter: IRouter = Router();

const BOT_RE = /bot|crawl|spider|preview|facebookexternalhit|whatsapp|slackbot|telegram|google-?(image|read|inspection|safety)|bingpreview|headless|curl\/|wget\/|python-requests|go-http-client|mimecast|proofpoint|barracuda|safelinks/i;
export const isLikelyBot = (ua: string | undefined) => !ua || BOT_RE.test(ua);

interface Hit { id: number; org_id: number; contact_id: number; review_url: string | null }

async function lookup(token: string): Promise<Hit | null> {
  if (!TOKEN_RE.test(token)) return null;
  const r = await db.execute(sql`
    SELECT m.id, m.org_id, m.contact_id, l.google_review_url AS review_url
    FROM review_messages m JOIN review_campaigns c ON c.id = m.campaign_id JOIN review_locations l ON l.id = c.location_id
    WHERE m.tracking_token = ${token}::text LIMIT 1`);
  return (r as unknown as { rows: Hit[] }).rows[0] ?? null;
}

const page = (title: string, body: string) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#222}button{font-size:1rem;padding:.7rem 1.2rem;border:0;border-radius:.5rem;background:#222;color:#fff;cursor:pointer}</style></head><body>${body}</body></html>`;
function html(res: Response, status: number, content: string) {
  res.status(status).set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" }).send(content);
}
const notFound = (res: Response) => html(res, 404, page("No encontrado", "<h1>Enlace no válido</h1><p>Este enlace no existe o ha caducado.</p>"));

reviewPublicRouter.get("/r/:token", async (req: Request, res: Response) => {
  const hit = await lookup(String(req.params["token"]));
  if (!hit || !hit.review_url) { notFound(res); return; }
  if (!isLikelyBot(req.get("user-agent"))) {
    await db.execute(sql`UPDATE review_messages SET first_clicked_at = COALESCE(first_clicked_at, now()), updated_at = now() WHERE id = ${hit.id}::integer`).catch(() => {});
    await db.execute(sql`INSERT INTO review_events (org_id, message_id, contact_id, type, payload) VALUES (${hit.org_id}::integer, ${hit.id}::integer, ${hit.contact_id}::integer, 'click', '{}'::jsonb)`).catch(() => {});
  }
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }).redirect(302, hit.review_url);
});

reviewPublicRouter.get("/u/:token", async (req, res) => {
  const hit = await lookup(String(req.params["token"]));
  if (!hit) { notFound(res); return; }
  html(res, 200, page("Darse de baja", `<h1>¿Quieres dejar de recibir estos mensajes?</h1><p>Confirma tu baja y no volverás a recibir solicitudes de opinión.</p><form method="post"><button type="submit">Confirmar baja</button></form>`));
});

reviewPublicRouter.post("/u/:token", async (req, res) => {
  const hit = await lookup(String(req.params["token"]));
  if (!hit) { notFound(res); return; }
  await unsubscribeContact(hit.org_id, hit.contact_id, { source: "omni_review_link" });
  html(res, 200, page("Baja confirmada", "<h1>Baja confirmada</h1><p>No volverás a recibir estos mensajes.</p>"));
});
