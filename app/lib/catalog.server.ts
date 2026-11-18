import prisma from "../db.server";
import type { CatalogProduct } from "./quiz/engine";

/** Anything with a `graphql()` method: admin context from authenticate.admin / appProxy / unauthenticated.admin */
export interface AdminGraphql {
  graphql: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response>;
}

const CATALOG_TTL_MS = 15 * 60 * 1000;

const CATALOG_QUERY = `#graphql
  query QuizCatalog($first: Int!, $after: String) {
    products(first: $first, after: $after, query: "status:active AND -product_type:giftcard") {
      pageInfo { hasNextPage endCursor }
      nodes {
        id handle title productType tags
        collections(first: 25) { nodes { handle } }
        priceRangeV2 { minVariantPrice { amount currencyCode } }
        compareAtPriceRange { minVariantCompareAtPrice { amount } }
        featuredMedia { preview { image { url altText } } }
        variants(first: 50) { nodes { id availableForSale price } }
      }
    }
  }`;

interface RawProduct {
  id: string;
  handle: string;
  title: string;
  productType: string;
  tags: string[];
  collections: { nodes: { handle: string }[] };
  priceRangeV2: { minVariantPrice: { amount: string; currencyCode: string } };
  compareAtPriceRange: { minVariantCompareAtPrice: { amount: string } | null } | null;
  featuredMedia: { preview: { image: { url: string; altText: string | null } | null } | null } | null;
  variants: { nodes: { id: string; availableForSale: boolean; price: string }[] };
}

export function toCatalogProduct(p: RawProduct): CatalogProduct {
  const availableVariants = p.variants.nodes.filter((v) => v.availableForSale);
  const cheapest = [...(availableVariants.length ? availableVariants : p.variants.nodes)].sort(
    (a, b) => Number(a.price) - Number(b.price),
  )[0];
  const compareAt = p.compareAtPriceRange?.minVariantCompareAtPrice?.amount;
  const price = cheapest ? Number(cheapest.price) : Number(p.priceRangeV2.minVariantPrice.amount);
  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    productType: p.productType,
    tags: p.tags,
    collections: p.collections.nodes.map((c) => c.handle),
    price,
    compareAtPrice: compareAt && Number(compareAt) > price ? Number(compareAt) : null,
    currency: p.priceRangeV2.minVariantPrice.currencyCode,
    available: availableVariants.length > 0,
    variantId: availableVariants[0]?.id ?? null,
    imageUrl: p.featuredMedia?.preview?.image?.url ?? null,
    imageAlt: p.featuredMedia?.preview?.image?.altText ?? null,
  };
}

export async function fetchCatalog(admin: AdminGraphql): Promise<CatalogProduct[]> {
  const out: CatalogProduct[] = [];
  let after: string | null = null;
  // RitFit-sized catalogs are a few hundred products; cap at 40 pages as a safety net.
  for (let page = 0; page < 40; page++) {
    const res = await admin.graphql(CATALOG_QUERY, { variables: { first: 100, after } });
    const json = (await res.json()) as {
      data?: { products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawProduct[] } };
      errors?: unknown;
    };
    if (!json.data) throw new Error(`Catalog query failed: ${JSON.stringify(json.errors)}`);
    out.push(...json.data.products.nodes.map(toCatalogProduct));
    if (!json.data.products.pageInfo.hasNextPage) break;
    after = json.data.products.pageInfo.endCursor;
  }
  return out;
}

export async function refreshCatalog(shop: string, admin: AdminGraphql) {
  const products = await fetchCatalog(admin);
  const syncedAt = new Date();
  await prisma.catalogCache.upsert({
    where: { shop },
    create: { shop, products: products as object[], syncedAt },
    update: { products: products as object[], syncedAt },
  });
  return products;
}

/** Cached catalog; refreshes when older than the TTL (or when `force`). */
export async function getCatalog(shop: string, admin: AdminGraphql, force = false) {
  if (!force) {
    const cached = await prisma.catalogCache.findUnique({ where: { shop } });
    if (cached && Date.now() - cached.syncedAt.getTime() < CATALOG_TTL_MS) {
      return cached.products as unknown as CatalogProduct[];
    }
  }
  return refreshCatalog(shop, admin);
}

/** Mark the cache stale so the next request refetches (used by product webhooks). */
export async function invalidateCatalog(shop: string) {
  await prisma.catalogCache.updateMany({ where: { shop }, data: { syncedAt: new Date(0) } });
}
