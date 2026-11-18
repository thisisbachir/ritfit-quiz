import { createHmac, timingSafeEqual } from "node:crypto";
import prisma from "../db.server";
import { quizDefinitionSchema } from "./quiz/schema";
import { getPublishedQuiz } from "./quizzes.server";

/** Signed token that lets the storefront load a quiz's DRAFT (for "Preview on store"). */
export function previewToken(shop: string, quizId: string) {
  return createHmac("sha256", process.env.SHOPIFY_API_SECRET || "dev-secret")
    .update(`preview:${shop}:${quizId}`)
    .digest("hex")
    .slice(0, 32);
}

function validPreview(shop: string, quizId: string, token: string | null) {
  if (!token || !/^[a-f0-9]{32}$/.test(token)) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(previewToken(shop, quizId)));
}

/**
 * Published quiz for normal visitors; the draft when a valid preview token is given.
 * In preview mode nothing is recorded (no responses, events, or Klaviyo sync).
 */
export async function loadStorefrontQuiz(shop: string, quizId: string, token: string | null) {
  if (validPreview(shop, quizId, token)) {
    const quiz = await prisma.quiz.findFirst({ where: { id: quizId, shop } });
    if (!quiz) return null;
    return { id: quiz.id, title: quiz.title, def: quizDefinitionSchema.parse(quiz.draft), preview: true };
  }
  const quiz = await getPublishedQuiz(shop, quizId);
  return quiz ? { ...quiz, preview: false } : null;
}
