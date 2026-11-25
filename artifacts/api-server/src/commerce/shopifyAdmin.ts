/**
 * Marca en Shopify al cliente autorizado (etiqueta `autorizado`) para que el tema le muestre el botón de contratar.
 * Es solo una comodidad de la tienda: la barrera real es server-side (activation.ts exige la autorización).
 * Best-effort y sin credenciales → se omite. NO probado contra una tienda real.
 */
const API_VERSION = "2025-10";
export async function tagCustomerAuthorized(email: string): Promise<string> {
  const domain = process.env["SHOPIFY_SHOP_DOMAIN"]; const token = process.env["SHOPIFY_ADMIN_TOKEN"];
  if (!domain || !token) return "skipped:no_credentials";
  const gql = async (query: string, variables: object) => {
    const r = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, { method: "POST", headers: { "content-type": "application/json", "x-shopify-access-token": token }, body: JSON.stringify({ query, variables }) });
    const j = await r.json() as any; if (!r.ok || j.errors) throw new Error(JSON.stringify(j.errors ?? j)); return j.data;
  };
  try {
    const f = await gql(`query($q:String!){ customers(first:1, query:$q){ nodes{ id } } }`, { q: `email:${email}` });
    let id = f.customers.nodes[0]?.id;
    if (!id) {
      const c = await gql(`mutation($i:CustomerInput!){ customerCreate(input:$i){ customer{ id } userErrors{ message } } }`, { i: { email, tags: ["autorizado"] } });
      if (c.customerCreate.userErrors?.length) return `error:${c.customerCreate.userErrors[0].message}`;
      return "ok:created";
    }
    const t = await gql(`mutation($id:ID!,$tags:[String!]!){ tagsAdd(id:$id, tags:$tags){ userErrors{ message } } }`, { id, tags: ["autorizado"] });
    return t.tagsAdd.userErrors?.length ? `error:${t.tagsAdd.userErrors[0].message}` : "ok:tagged";
  } catch (e) { return `error:${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`; }
}
