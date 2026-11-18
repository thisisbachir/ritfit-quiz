import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useSearchParams } from "react-router";
import { useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getQuiz } from "../lib/quizzes.server";
import { quizAnalytics } from "../lib/analytics.server";

const RANGES = { "7": 7, "30": 30, "90": 90, "365": 365 } as const;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const quiz = await getQuiz(session.shop, params.id!);
  if (!quiz) throw new Response("Quiz not found", { status: 404 });
  const rangeParam = new URL(request.url).searchParams.get("days") ?? "30";
  const days = RANGES[rangeParam as keyof typeof RANGES] ?? 30;
  const since = new Date(Date.now() - days * 86400000);
  const stats = await quizAnalytics(session.shop, quiz.id, quiz.draft, since);
  return { quiz: { id: quiz.id, title: quiz.title }, days, stats };
};

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);

const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "–");
const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

function Stat(props: { label: string; value: string | number; hint?: string }) {
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack gap="small-100">
        <s-text color="subdued">{props.label}</s-text>
        <s-heading>{String(props.value)}</s-heading>
        {props.hint && <s-text color="subdued">{props.hint}</s-text>}
      </s-stack>
    </s-box>
  );
}

export default function QuizResults() {
  const { quiz, days, stats } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [, setParams] = useSearchParams();
  const [downloading, setDownloading] = useState(false);
  const f = stats.funnel;

  // Inside the Shopify admin, fetch() carries the session token automatically.
  const downloadCsv = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`/app/quizzes/${quiz.id}/export`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${quiz.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-responses.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <s-page heading={`Results: ${quiz.title}`}>
      <s-link slot="breadcrumb-actions" href="/app">
        Quizzes
      </s-link>
      <s-button slot="primary-action" onClick={() => navigate(`/app/quizzes/${quiz.id}`)}>
        Edit quiz
      </s-button>
      <s-button slot="secondary-actions" loading={downloading} onClick={downloadCsv}>
        Export CSV
      </s-button>

      <s-section>
        <s-select label="Date range" value={String(days)} onChange={(e) => setParams({ days: e.currentTarget.value })}>
          <s-option value="7">Last 7 days</s-option>
          <s-option value="30">Last 30 days</s-option>
          <s-option value="90">Last 90 days</s-option>
          <s-option value="365">Last 12 months</s-option>
        </s-select>
      </s-section>

      <s-section heading="Funnel">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(150px, 1fr))" gap="base">
          <Stat label="Viewed" value={f.views} hint="unique visitors" />
          <Stat label="Started" value={f.starts} hint={`${pct(f.starts, f.views)} of views`} />
          <Stat label="Completed" value={f.completions} hint={`${pct(f.completions, f.starts)} of starts`} />
          <Stat label="Added to cart" value={f.addToCarts} hint={`${pct(f.addToCarts, f.completions)} of completions`} />
          <Stat label="Orders" value={f.orders} hint={`${pct(f.orders, f.completions)} of completions`} />
          <Stat label="Revenue" value={money(stats.revenue)} hint={f.orders ? `${money(stats.revenue / f.orders)} AOV` : undefined} />
          <Stat label="Emails captured" value={stats.emails} hint={`${stats.subscribed} subscribed`} />
        </s-grid>
      </s-section>

      <s-section heading="Answers">
        <s-stack gap="large">
          {stats.distribution.map((q) => (
            <s-stack key={q.question} gap="small-200">
              <s-heading>{q.question}</s-heading>
              {q.answers.map((a) => {
                const share = q.answered ? a.count / q.answered : 0;
                return (
                  <s-grid key={a.label} gridTemplateColumns="200px 1fr 80px" gap="base" alignItems="center">
                    <s-text>{a.label}</s-text>
                    <s-box background="subdued" borderRadius="base" blockSize="12px">
                      <div
                        style={{
                          width: `${Math.round(share * 100)}%`,
                          height: "12px",
                          borderRadius: "6px",
                          background: "#CD001A",
                        }}
                      />
                    </s-box>
                    <s-text>
                      {a.count} ({Math.round(share * 100)}%)
                    </s-text>
                  </s-grid>
                );
              })}
            </s-stack>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Recent responses" padding="none">
        {stats.recent.length === 0 ? (
          <s-box padding="base">
            <s-text color="subdued">No responses in this period yet.</s-text>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Date</s-table-header>
              <s-table-header>Email</s-table-header>
              <s-table-header>Answers</s-table-header>
              <s-table-header>Order</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {stats.recent.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell>{new Date(r.createdAt).toLocaleString()}</s-table-cell>
                  <s-table-cell>
                    {r.email ?? "–"}
                    {r.klaviyoError && (
                      <s-badge tone="critical">Klaviyo sync failed</s-badge>
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    {Object.values(r.answerLabels)
                      .map((v) => v.join(", "))
                      .join(" · ")}
                  </s-table-cell>
                  <s-table-cell>{r.orderName ? `${r.orderName} · ${money(r.orderTotal ?? 0)}` : "–"}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}
