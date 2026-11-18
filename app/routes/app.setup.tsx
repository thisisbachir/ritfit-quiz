import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { refreshCatalog } from "../lib/catalog.server";
import { klaviyoConfigured } from "../lib/klaviyo.server";
import { createQuiz } from "../lib/quizzes.server";
import { quizDefinitionSchema } from "../lib/quiz/schema";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const cache = await prisma.catalogCache.findUnique({ where: { shop: session.shop } });
  return {
    shop: session.shop,
    klaviyoReady: klaviyoConfigured(),
    catalog: cache
      ? { count: (cache.products as unknown[]).length, syncedAt: cache.syncedAt.toISOString() }
      : null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "refresh") {
    const products = await refreshCatalog(session.shop, admin);
    return { ok: true, message: `Synced ${products.length} products` };
  }

  if (intent === "import") {
    try {
      const raw = JSON.parse(String(form.get("json")));
      const def = quizDefinitionSchema.parse(raw.definition ?? raw);
      const quiz = await createQuiz(session.shop, String(raw.title ?? "Imported quiz"), def);
      return redirect(`/app/quizzes/${quiz.id}`);
    } catch (e) {
      return { ok: false, message: `Import failed: ${String(e).slice(0, 300)}` };
    }
  }
  return { ok: false, message: "Unknown action" };
};

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);

export default function Setup() {
  const { shop, klaviyoReady, catalog } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [json, setJson] = useState("");
  const storeHandle = shop.replace(".myshopify.com", "");

  return (
    <s-page heading="Setup">
      {fetcher.data?.message && (
        <s-banner tone={fetcher.data.ok ? "success" : "critical"}>{fetcher.data.message}</s-banner>
      )}

      <s-section heading="1. Turn on the app embed">
        <s-stack gap="base">
          <s-paragraph>
            The app embed loads the quiz script on your store. It powers popups, the hosted quiz page and the
            optional floating button.
          </s-paragraph>
          <s-box>
            <s-button
              href={`https://admin.shopify.com/store/${storeHandle}/themes/current/editor?context=apps`}
              target="_blank"
            >
              Open theme app embeds
            </s-button>
          </s-box>
        </s-stack>
      </s-section>

      <s-section heading="2. Add a quiz to a page">
        <s-paragraph>
          In the theme editor, open the page where the quiz should live, click Add block → Apps → Product quiz,
          and paste the quiz ID from the quiz&apos;s page in this app.
        </s-paragraph>
      </s-section>

      <s-section heading="3. Klaviyo">
        {klaviyoReady ? (
          <s-banner tone="success">Klaviyo is connected (private API key is set).</s-banner>
        ) : (
          <s-banner tone="warning" heading="Klaviyo is not connected">
            Create a private API key in Klaviyo (Settings → API keys) with full access to Events, Profiles,
            Lists and Subscriptions. Then add it as KLAVIYO_PRIVATE_API_KEY in the app&apos;s Railway variables.
          </s-banner>
        )}
      </s-section>

      <s-section heading="Product catalog">
        <s-stack gap="base">
          <s-paragraph>
            {catalog
              ? `${catalog.count} products cached, last synced ${new Date(catalog.syncedAt).toLocaleString()}.`
              : "Not synced yet."}{" "}
            The catalog refreshes automatically when products change.
          </s-paragraph>
          <s-box>
            <s-button
              loading={fetcher.state !== "idle" && fetcher.formData?.get("intent") === "refresh"}
              onClick={() => fetcher.submit({ intent: "refresh" }, { method: "post" })}
            >
              Sync now
            </s-button>
          </s-box>
        </s-stack>
      </s-section>

      <s-section heading="Import a quiz (JSON)">
        <s-stack gap="base">
          <s-paragraph>Paste a quiz definition exported from this app to recreate it.</s-paragraph>
          <s-text-area label="Quiz JSON" rows={6} value={json} onInput={(e) => setJson(e.currentTarget.value)} />
          <s-box>
            <s-button
              disabled={!json.trim()}
              loading={fetcher.state !== "idle" && fetcher.formData?.get("intent") === "import"}
              onClick={() => fetcher.submit({ intent: "import", json }, { method: "post" })}
            >
              Import
            </s-button>
          </s-box>
        </s-stack>
      </s-section>
    </s-page>
  );
}
