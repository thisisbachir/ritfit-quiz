# RitFit Quiz

A product recommendation quiz app for the RitFit Shopify store. Shoppers answer a few questions and get matching products, which they can add to their cart in one click. Answers sync to Klaviyo, and each quiz has its own funnel and revenue numbers.

Built as a **custom Shopify app** (React Router + Polaris web components + Prisma/Postgres), hosted on **Railway**.

## What's inside

| Area | What it does |
|---|---|
| **Quiz builder** (admin) | Questions (single choice, multiple choice, email), image answers, intro and results screens, draft → publish, preview on the live theme before publishing, duplicate and archive |
| **Recommendation rules** | Each answer gives points to products by **tag, collection, product type or specific product**. **Filters** remove products (tag excluded or required, max or min price). The highest scores win. Sold-out products are hidden. Fallback products appear when nothing matches |
| **Storefront** | Theme app block (inline), popup (any link to `#quiz-<id>`), floating button, and a hosted page at `/apps/ritfit-quiz/q/<id>` for ads and emails. Styled to the RitFit brand guideline and accessible |
| **Cart & attribution** | "Add to Cart" and "Add All to Cart". The cart is tagged with the quiz response, so orders are attributed through the `orders/create` webhook |
| **Klaviyo** | An event (default `Completed Product Quiz`) with answers and recommended products, `Quiz: …` profile properties, and a list subscription when the shopper ticks the consent box |
| **Analytics** | Viewed → started → completed → added to cart → ordered, revenue and AOV, answer distribution, recent responses, CSV export |

## How recommendations work

```
for each product (in stock, passing every filter of the chosen answers):
    score = sum of points from rules of the chosen answers that match the product
show the top N products with score > 0  (ties: matched by more answers, then cheaper)
if none: show the quiz's fallback products
```

Example: "Under 7 ft ceiling" → filter *Hide products tagged `tall`*. "Build strength" → *Products tagged `power-rack` +5*.
Negative points push products down. For example, "I already own a bench" → *bench −10*.

Keep RitFit's product tags consistent (`power-rack`, `smith-machine`, `tall`, …). The builder offers dropdowns of the store's real tags, collections and product types.

## Project layout

```
app/lib/quiz/schema.ts      quiz definition (zod) — the JSON the builder edits
app/lib/quiz/engine.ts      scoring + filtering (pure, unit tested)
app/lib/quiz/templates.ts   RitFit "home gym builder" starter quiz
app/lib/catalog.server.ts   product catalog cache (15 min TTL + product webhooks)
app/lib/klaviyo.server.ts   Klaviyo events, profile properties, subscriptions
app/lib/preview.server.ts   signed preview links for drafts
app/routes/app.*            admin: quiz list, builder, results, setup
app/routes/proxy.*          storefront API via Shopify App Proxy (/apps/ritfit-quiz/*)
app/routes/webhooks.*       orders/create (attribution), products/* (catalog), app lifecycle
extensions/quiz-theme/      theme app extension: block, app embed, widget JS/CSS
prisma/schema.prisma        Quiz, Response, Event, CatalogCache, Session
```

## First-time setup

1. **Create the app** in the [Shopify Partner Dashboard](https://partners.shopify.com) → Apps → Create app → *Create app manually*. Set the distribution to **Custom distribution** for RitFit's store.
2. **Protected customer data**: in the Partner Dashboard → API access → *Protected customer data access*, request access and select the reason "Analytics". This is required for the `orders/create` webhook.
3. **Link the config** locally:
   ```bash
   npm install
   npm run config:link
   ```
4. **Railway**: create a project with a **Postgres** database and a service from this repo (it uses the `Dockerfile` and `railway.json`). Set these variables:
   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
   | `SHOPIFY_API_KEY` | Client ID |
   | `SHOPIFY_API_SECRET` | Client secret |
   | `SHOPIFY_APP_URL` | `https://<service>.up.railway.app` |
   | `SCOPES` | `read_products,read_orders` |
   | `KLAVIYO_PRIVATE_API_KEY` | Klaviyo private key (Events, Profiles, Lists, Subscriptions: write) |

   Migrations run automatically on every deploy (`npm run docker-start`).
5. In `shopify.app.toml`, set `application_url` and `redirect_urls` to the Railway URL, then deploy the config and theme extension:
   ```bash
   npm run deploy
   ```
6. **Install** the app on the store through the custom distribution link, then follow the app's **Setup** page: turn on the app embed and add the *Product quiz* block.

## Local development

```bash
cp .env.example .env
npm install
npm run dev
```

`.env` needs a local Postgres `DATABASE_URL`. `npm run dev` runs the Shopify CLI, which creates a tunnel and a dev store preview.

```bash
npm test
npm run typecheck
npm run lint
```

## Notes

- **Brand**: the storefront follows the RitFit guideline: `#CD001A` CTA red (hover `#A30015`), Montserrat, 8px radius, buttons ≥120×40, Title Case CTAs, sentence-case headings, no all caps, focus ring `2px #CD001A` with 2px offset, `prefers-reduced-motion`.
- **Preview**: "Preview on store" opens the draft on the live theme through a signed link. Preview runs are never recorded.
- **Privacy**: the storefront API never exposes scoring rules. Emails are stored only for responses with an email step, and every request is checked against the App Proxy signature.
