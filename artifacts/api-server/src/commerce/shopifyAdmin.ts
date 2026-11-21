// Cliente mínimo de la Admin GraphQL API de Shopify (solo servidor).
// Credenciales SOLO por variables de entorno del backend; nunca llegan al frontend.
//   SHOPIFY_SHOP_DOMAIN         omnitech-core.myshopify.com
//   SHOPIFY_ADMIN_ACCESS_TOKEN  token de la app (shpat_…)
//   SHOPIFY_API_VERSION         versión estable vigente (p. ej. 2026-10) — ver docs/omnicommerce

export function isAdminApiConfigured(env = process.env): boolean {
  return !!(env["SHOPIFY_SHOP_DOMAIN"] && env["SHOPIFY_ADMIN_ACCESS_TOKEN"] && env["SHOPIFY_API_VERSION"]);
}

async function adminGraphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const shop = process.env["SHOPIFY_SHOP_DOMAIN"]!;
  const version = process.env["SHOPIFY_API_VERSION"]!;
  const res = await fetch(`https://${shop}/admin/api/${version}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": process.env["SHOPIFY_ADMIN_ACCESS_TOKEN"]!,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Shopify Admin API HTTP ${res.status}`);
  const body = (await res.json()) as { data?: T; errors?: unknown };
  if (body.errors || !body.data) throw new Error(`Shopify Admin API error: ${JSON.stringify(body.errors ?? "sin datos")}`);
  return body.data;
}

/**
 * Re-verifica en Shopify (fuente de verdad) que un pedido está pagado,
 * en el momento de aprobar. Defensa extra frente a un webhook mal procesado.
 */
export async function fetchOrderPaymentState(externalOrderId: string): Promise<{ paid: boolean; test: boolean; financialStatus: string }> {
  const data = await adminGraphql<{ order: { displayFinancialStatus: string; test: boolean } | null }>(
    `query OrderPayment($id: ID!) { order(id: $id) { displayFinancialStatus test } }`,
    { id: `gid://shopify/Order/${externalOrderId}` },
  );
  if (!data.order) throw new Error(`El pedido ${externalOrderId} no existe en Shopify`);
  return {
    paid: data.order.displayFinancialStatus === "PAID",
    test: data.order.test,
    financialStatus: data.order.displayFinancialStatus,
  };
}
