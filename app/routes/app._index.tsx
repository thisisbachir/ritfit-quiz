import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { archiveQuiz, createQuiz, duplicateQuiz, listQuizzes } from "../lib/quizzes.server";
import { templates, type TemplateKey } from "../lib/quiz/templates";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { quizzes: await listQuizzes(session.shop) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const id = String(form.get("id") ?? "");

  if (intent === "create") {
    const key = (String(form.get("template")) in templates ? form.get("template") : "blank") as TemplateKey;
    const quiz = await createQuiz(
      session.shop,
      key === "home-gym" ? "Home gym builder" : "Untitled quiz",
      templates[key].build(),
    );
    return redirect(`/app/quizzes/${quiz.id}`);
  }
  if (intent === "duplicate") {
    const quiz = await duplicateQuiz(session.shop, id);
    return redirect(`/app/quizzes/${quiz.id}`);
  }
  if (intent === "archive") {
    await archiveQuiz(session.shop, id);
    return { ok: true };
  }
  return { ok: false };
};

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export default function Index() {
  const { quizzes } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const busy = fetcher.state !== "idle";

  const create = (template: TemplateKey) =>
    fetcher.submit({ intent: "create", template }, { method: "post" });

  return (
    <s-page heading="Quizzes">
      <s-button slot="primary-action" variant="primary" loading={busy} onClick={() => create("home-gym")}>
        New quiz from RitFit template
      </s-button>
      <s-button slot="secondary-actions" onClick={() => create("blank")}>
        New blank quiz
      </s-button>

      {quizzes.length === 0 ? (
        <s-section>
          <s-stack gap="base" alignItems="center">
            <s-heading>Create your first quiz</s-heading>
            <s-paragraph>
              Start from the RitFit home gym template (goal, experience, space, ceiling height,
              equipment, budget, email) and point the answers at your products.
            </s-paragraph>
            <s-button variant="primary" loading={busy} onClick={() => create("home-gym")}>
              Use RitFit template
            </s-button>
          </s-stack>
        </s-section>
      ) : (
        <s-section padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Quiz</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header format="numeric">Completions</s-table-header>
              <s-table-header format="numeric">Orders</s-table-header>
              <s-table-header format="numeric">Revenue</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {quizzes.map((q) => (
                <s-table-row key={q.id}>
                  <s-table-cell>
                    <s-link href={`/app/quizzes/${q.id}`}>{q.title}</s-link>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={q.status === "published" ? "success" : "neutral"}>
                      {q.status === "published" ? "Live" : "Draft"}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>{q.completions}</s-table-cell>
                  <s-table-cell>{q.orders}</s-table-cell>
                  <s-table-cell>{money(q.revenue)}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-200">
                      <s-button variant="tertiary" onClick={() => navigate(`/app/quizzes/${q.id}/results`)}>
                        Results
                      </s-button>
                      <s-button
                        variant="tertiary"
                        onClick={() => fetcher.submit({ intent: "duplicate", id: q.id }, { method: "post" })}
                      >
                        Duplicate
                      </s-button>
                      <s-button
                        variant="tertiary"
                        tone="critical"
                        onClick={() => {
                          if (confirm(`Archive "${q.title}"? It will stop showing on the store.`)) {
                            fetcher.submit({ intent: "archive", id: q.id }, { method: "post" });
                          }
                        }}
                      >
                        Archive
                      </s-button>
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
