import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

/**
 * Hosted quiz page: https://<shop>/apps/ritfit-quiz/q/<quizId>
 * Renders inside the store's theme (header, footer, fonts). Handy for ads, emails and QR codes.
 * Needs the "RitFit Quiz" app embed switched on in the theme, which loads the quiz script.
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { liquid } = await authenticate.public.appProxy(request);
  const id = (params.quizId ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
  return liquid(
    `<div class="rq-root" data-ritfit-quiz="${id}"><p class="rq-loading">Loading quiz…</p></div>`,
  );
};
