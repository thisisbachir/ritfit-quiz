import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { invalidateCatalog } from "../lib/catalog.server";

/** Any product change makes the cached catalog stale; it is refetched on the next quiz submit. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);
  await invalidateCatalog(shop);
  return new Response(null, { status: 200 });
};
