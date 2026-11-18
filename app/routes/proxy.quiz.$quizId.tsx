import type { LoaderFunctionArgs } from "react-router";
import { toPublicQuiz } from "../lib/quizzes.server";
import { loadStorefrontQuiz } from "../lib/preview.server";
import { json, proxyContext } from "../lib/proxy.server";

/** GET /apps/ritfit-quiz/quiz/:quizId — the storefront-safe quiz definition. */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop } = await proxyContext(request);
  const preview = new URL(request.url).searchParams.get("preview");
  const quiz = await loadStorefrontQuiz(shop, params.quizId!, preview);
  if (!quiz) return json({ error: "Quiz not found or not published" }, 404);
  return json({ ...toPublicQuiz(quiz.id, quiz.title, quiz.def), preview: quiz.preview });
};
