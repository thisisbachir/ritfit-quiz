import { describe, expect, it } from "vitest";
import { labelSelection, recommend, validateSelection, type CatalogProduct } from "./engine";
import { quizDefinitionSchema } from "./schema";

const product = (over: Partial<CatalogProduct>): CatalogProduct => ({
  id: "gid://shopify/Product/0",
  handle: "p",
  title: "P",
  productType: "",
  tags: [],
  collections: [],
  price: 100,
  compareAtPrice: null,
  currency: "USD",
  available: true,
  variantId: "gid://shopify/ProductVariant/0",
  imageUrl: null,
  imageAlt: null,
  ...over,
});

const catalog = [
  product({ id: "smith", title: "M1 PRO Smith Machine", tags: ["smith-machine", "tall"], price: 2399.99 }),
  product({ id: "rack", title: "PPC Power Rack", tags: ["power-rack", "tall"], price: 799 }),
  product({ id: "bench", title: "1600LB Bench", productType: "Bench", price: 359.99 }),
  product({ id: "bands", title: "Resistance Bands", tags: ["accessory"], collections: ["cardio"], price: 39 }),
  product({ id: "soldout", title: "Sold Out Rack", tags: ["power-rack"], price: 500, available: false }),
];

const def = quizDefinitionSchema.parse({
  intro: {},
  results: { maxProducts: 3, fallbackProductIds: ["bench"] },
  klaviyo: {},
  questions: [
    {
      id: "goal",
      type: "single",
      title: "Main goal?",
      answers: [
        {
          id: "strength",
          label: "Strength",
          rules: [
            { id: "r1", targetType: "tag", target: "Power-Rack", points: 5 },
            { id: "r2", targetType: "tag", target: "smith-machine", points: 4 },
            { id: "r3", targetType: "product_type", target: "bench", points: 2 },
          ],
        },
        {
          id: "cardio",
          label: "Weight loss",
          rules: [{ id: "r4", targetType: "collection", target: "cardio", points: 5 }],
        },
        { id: "nothing", label: "Not sure" },
      ],
    },
    {
      id: "ceiling",
      type: "single",
      title: "Ceiling height?",
      answers: [
        { id: "low", label: "Under 7ft", filters: [{ id: "f1", kind: "exclude_tag", value: "tall" }] },
        { id: "high", label: "Over 8ft" },
      ],
    },
    {
      id: "budget",
      type: "single",
      title: "Budget?",
      required: false,
      answers: [
        { id: "b1000", label: "Under $1,000", filters: [{ id: "f2", kind: "max_price", value: "1000" }] },
        { id: "bany", label: "No limit" },
      ],
    },
    { id: "email", type: "email", title: "Email", required: false },
  ],
});

describe("recommend", () => {
  it("ranks by points, case-insensitive matching", () => {
    const r = recommend(def, { goal: ["strength"], ceiling: ["high"] }, catalog);
    expect(r.usedFallback).toBe(false);
    expect(r.products.map((p) => p.product.id)).toEqual(["rack", "smith", "bench"]);
    expect(r.products[0].reasons).toEqual(["Strength"]);
  });

  it("hides sold-out products", () => {
    const r = recommend(def, { goal: ["strength"], ceiling: ["high"] }, catalog);
    expect(r.products.find((p) => p.product.id === "soldout")).toBeUndefined();
  });

  it("applies tag and price filters", () => {
    const low = recommend(def, { goal: ["strength"], ceiling: ["low"] }, catalog);
    expect(low.products.map((p) => p.product.id)).toEqual(["bench"]);

    const cheap = recommend(def, { goal: ["strength"], ceiling: ["high"], budget: ["b1000"] }, catalog);
    expect(cheap.products.map((p) => p.product.id)).toEqual(["rack", "bench"]);
  });

  it("matches collections", () => {
    const r = recommend(def, { goal: ["cardio"], ceiling: ["high"] }, catalog);
    expect(r.products.map((p) => p.product.id)).toEqual(["bands"]);
  });

  it("falls back when nothing scores", () => {
    const r = recommend(def, { goal: ["nothing"], ceiling: ["high"] }, catalog);
    expect(r.usedFallback).toBe(true);
    expect(r.products.map((p) => p.product.id)).toEqual(["bench"]);
  });

  it("respects maxProducts", () => {
    const one = { ...def, results: { ...def.results, maxProducts: 1 } };
    expect(recommend(one, { goal: ["strength"], ceiling: ["high"] }, catalog).products).toHaveLength(1);
  });
});

describe("validateSelection", () => {
  it("accepts a valid selection", () => {
    expect(validateSelection(def, { goal: ["strength"], ceiling: ["low"] })).toBeNull();
  });
  it("rejects missing required answers", () => {
    expect(validateSelection(def, { goal: ["strength"] })).toMatch(/Ceiling/);
  });
  it("rejects unknown and multiple answers on single questions", () => {
    expect(validateSelection(def, { goal: ["nope"], ceiling: ["low"] })).toMatch(/Unknown/);
    expect(validateSelection(def, { goal: ["strength", "cardio"], ceiling: ["low"] })).toMatch(/one answer/);
  });
});

describe("labelSelection", () => {
  it("maps ids to readable labels", () => {
    expect(labelSelection(def, { goal: ["strength"], ceiling: ["low"] })).toEqual({
      "Main goal?": ["Strength"],
      "Ceiling height?": ["Under 7ft"],
    });
  });
});
