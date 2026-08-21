/**
 * Public landing page for "A Medida" (montaje de cocinas, muebles, portes y
 * mudanzas) — accessible via /a-medida when the SPA handles the route
 * client-side (e.g. an in-app link), no auth required.
 *
 * SEO note: on a direct/external navigation (Google, a shared link, a hard
 * refresh) the static file at public/a-medida/index.html is served directly
 * by the host — it never reaches this React component or the SPA shell, so
 * Google indexes real HTML with its own <title>/meta/canonical/JSON-LD,
 * not this app's generic shell. This component exists only so that
 * client-side navigation from elsewhere in the SPA (wouter intercepting a
 * same-origin link click, no server round-trip) still renders the same
 * page. It loads that exact static file via <iframe src>, so there is a
 * single source of truth for the HTML/CSS/JS — no duplicated content to
 * drift out of sync.
 */
export default function AMedidaLandingPage() {
  return (
    <iframe
      title="A Medida — presupuesto de montaje, portes y mudanzas"
      src={`${import.meta.env.BASE_URL}a-medida/index.html`}
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
