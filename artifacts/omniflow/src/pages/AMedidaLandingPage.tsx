/**
 * Public landing page for "A Medida" (montaje de cocinas, muebles, portes y
 * mudanzas) — accessible via /a-medida, no auth required.
 *
 * Rendered as a full-bleed iframe with the standalone HTML in
 * amedidaLandingHtml.ts. Using srcDoc keeps this page's CSS/JS completely
 * isolated from the rest of the CRM SPA (its class names — .card, .cat,
 * .stat, .field — are generic and would otherwise leak into/collide with
 * the app's own global styles), and lets the page keep working exactly as
 * designed without rewriting it into React/Tailwind.
 */
import { AMEDIDA_LANDING_HTML } from "@/pages/amedidaLandingHtml";

export default function AMedidaLandingPage() {
  return (
    <iframe
      title="A Medida — presupuesto de montaje, portes y mudanzas"
      srcDoc={AMEDIDA_LANDING_HTML}
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        border: "none",
      }}
    />
  );
}
