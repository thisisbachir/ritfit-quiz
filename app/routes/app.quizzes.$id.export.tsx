import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getQuiz } from "../lib/quizzes.server";
import { responsesCsv } from "../lib/analytics.server";

/** CSV of every response for a quiz. Fetched by the Results page (session token attached). */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const quiz = await getQuiz(session.shop, params.id!);
  if (!quiz) throw new Response("Quiz not found", { status: 404 });
  const csv = await responsesCsv(session.shop, quiz.id, quiz.draft);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="quiz-${quiz.id}-responses.csv"`,
    },
  });
};
