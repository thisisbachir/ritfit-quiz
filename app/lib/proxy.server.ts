import { authenticate } from "../shopify.server";

/** Verifies the App Proxy signature. Throws a 401/404 Response when the call isn't usable. */
export async function proxyContext(request: Request) {
  const ctx = await authenticate.public.appProxy(request);
  if (!ctx.session || !ctx.admin) {
    throw Response.json({ error: "App is not installed on this shop" }, { status: 404 });
  }
  return { shop: ctx.session.shop, admin: ctx.admin };
}

export const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

/** Visitor ids come from the browser: keep them short and boring. */
export function cleanVisitorId(v: unknown): string {
  return typeof v === "string" && /^[a-zA-Z0-9_-]{6,64}$/.test(v) ? v : "anonymous";
}
