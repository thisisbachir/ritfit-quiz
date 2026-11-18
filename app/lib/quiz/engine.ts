import type { Answer, QuizDefinition } from "./schema";

/** The slice of a Shopify product the engine and storefront need. */
export interface CatalogProduct {
  id: string; // gid://shopify/Product/123
  handle: string;
  title: string;
  productType: string;
  tags: string[];
  collections: string[]; // collection handles
  price: number; // lowest available variant price
  compareAtPrice: number | null;
  currency: string;
  available: boolean;
  variantId: string | null; // first available variant GID
  imageUrl: string | null;
  imageAlt: string | null;
}

/** questionId -> selected answer ids */
export type AnswerSelection = Record<string, string[]>;

export interface ScoredProduct {
  product: CatalogProduct;
  score: number;
  /** answer labels that contributed points — used for "why we picked this" */
  reasons: string[];
}

export interface RecommendationResult {
  products: ScoredProduct[];
  usedFallback: boolean;
}

const norm = (s: string) => s.trim().toLowerCase();

function selectedAnswers(def: QuizDefinition, selection: AnswerSelection): Answer[] {
  const out: Answer[] = [];
  for (const q of def.questions) {
    const picked = new Set(selection[q.id] ?? []);
    for (const a of q.answers) if (picked.has(a.id)) out.push(a);
  }
  return out;
}

function passesFilters(p: CatalogProduct, answers: Answer[]): boolean {
  const tags = new Set(p.tags.map(norm));
  for (const a of answers) {
    for (const f of a.filters) {
      switch (f.kind) {
        case "exclude_tag":
          if (tags.has(norm(f.value))) return false;
          break;
        case "require_tag":
          if (!tags.has(norm(f.value))) return false;
          break;
        case "max_price":
          if (p.price > Number(f.value)) return false;
          break;
        case "min_price":
          if (p.price < Number(f.value)) return false;
          break;
      }
    }
  }
  return true;
}

function matches(p: CatalogProduct, targetType: string, target: string): boolean {
  switch (targetType) {
    case "tag":
      return p.tags.some((t) => norm(t) === norm(target));
    case "product_type":
      return norm(p.productType) === norm(target);
    case "collection":
      return p.collections.some((c) => norm(c) === norm(target));
    case "product":
      return p.id === target;
    default:
      return false;
  }
}

export function recommend(
  def: QuizDefinition,
  selection: AnswerSelection,
  catalog: CatalogProduct[],
): RecommendationResult {
  const answers = selectedAnswers(def, selection);
  const max = def.results.maxProducts;

  const pool = catalog.filter(
    (p) => (!def.results.hideOutOfStock || p.available) && passesFilters(p, answers),
  );

  const scored: ScoredProduct[] = pool.map((product) => {
    let score = 0;
    const reasons: string[] = [];
    for (const a of answers) {
      let gained = 0;
      for (const r of a.rules) if (matches(product, r.targetType, r.target)) gained += r.points;
      if (gained !== 0) {
        score += gained;
        if (gained > 0) reasons.push(a.label);
      }
    }
    return { product, score, reasons };
  });

  const ranked = scored
    .filter((s) => s.score > 0)
    // highest score first; ties go to the product matched by more answers, then the cheaper one
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.reasons.length - a.reasons.length ||
        a.product.price - b.product.price,
    )
    .slice(0, max);

  if (ranked.length > 0) return { products: ranked, usedFallback: false };

  const byId = new Map(catalog.map((p) => [p.id, p]));
  const fallback = def.results.fallbackProductIds
    .map((id) => byId.get(id))
    .filter((p): p is CatalogProduct => !!p && (!def.results.hideOutOfStock || p.available))
    .slice(0, max)
    .map((product) => ({ product, score: 0, reasons: [] }));
  return { products: fallback, usedFallback: true };
}

/** Validate a storefront submission against the definition. Returns an error message or null. */
export function validateSelection(def: QuizDefinition, selection: AnswerSelection): string | null {
  for (const q of def.questions) {
    if (q.type === "email") continue;
    const picked = selection[q.id] ?? [];
    const valid = new Set(q.answers.map((a) => a.id));
    if (picked.some((id) => !valid.has(id))) return `Unknown answer for "${q.title}"`;
    if (q.required && picked.length === 0) return `"${q.title}" is required`;
    if (q.type === "single" && picked.length > 1) return `"${q.title}" allows one answer`;
  }
  return null;
}

/** { "Question title": ["Answer label", ...] } — readable form for exports and Klaviyo. */
export function labelSelection(def: QuizDefinition, selection: AnswerSelection) {
  const out: Record<string, string[]> = {};
  for (const q of def.questions) {
    if (q.type === "email") continue;
    const picked = new Set(selection[q.id] ?? []);
    const labels = q.answers.filter((a) => picked.has(a.id)).map((a) => a.label);
    if (labels.length) out[q.title] = labels;
  }
  return out;
}
