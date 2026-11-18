import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import prisma from "../db.server";
import { getCatalog } from "../lib/catalog.server";
import { labelSelection, recommend, validateSelection } from "../lib/quiz/engine";
import { loadStorefrontQuiz } from "../lib/preview.server";
import { cleanVisitorId, json, proxyContext } from "../lib/proxy.server";
import { klaviyoConfigured, syncQuizToKlaviyo } from "../lib/klaviyo.server";

const bodySchema = z.object({
  quizId: z.string().min(1),
  visitorId: z.string().optional(),
  answers: z.record(z.array(z.string()).max(50)),
  email: z.string().trim().toLowerCase().email().max(254).optional().or(z.literal("")),
  consent: z.boolean().optional(),
});

/** POST /apps/ritfit-quiz/submit — score answers, store the response, return products. */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const { shop, admin } = await proxyContext(request);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid submission" }, 400);
  const body = parsed.data;

  const preview = new URL(request.url).searchParams.get("preview");
  const quiz = await loadStorefrontQuiz(shop, body.quizId, preview);
  if (!quiz) return json({ error: "Quiz not found" }, 404);

  const problem = validateSelection(quiz.def, body.answers);
  if (problem) return json({ error: problem }, 400);

  const catalog = await getCatalog(shop, admin);
  const result = recommend(quiz.def, body.answers, catalog);
  const answerLabels = labelSelection(quiz.def, body.answers);
  const visitorId = cleanVisitorId(body.visitorId);
  const email = body.email || null;

  const products = result.products.map(({ product, reasons }) => ({
    id: product.id,
    handle: product.handle,
    title: product.title,
    url: `/products/${product.handle}`,
    price: product.price,
    compareAtPrice: product.compareAtPrice,
    currency: product.currency,
    variantId: product.variantId?.split("/").pop() ?? null,
    imageUrl: product.imageUrl,
    imageAlt: product.imageAlt ?? product.title,
    reasons,
  }));

  // Preview runs from the admin are not recorded anywhere.
  if (quiz.preview) return json({ responseId: null, usedFallback: result.usedFallback, products });

  const response = await prisma.response.create({
    data: {
      quizId: quiz.id,
      shop,
      visitorId,
      answers: body.answers,
      answerLabels,
      email,
      emailConsent: Boolean(email && body.consent),
      recommendedIds: result.products.map((p) => p.product.id),
    },
  });
  await prisma.event.create({
    data: { quizId: quiz.id, shop, type: "complete", visitorId, responseId: response.id },
  });

  if (email && quiz.def.klaviyo.enabled && klaviyoConfigured()) {
    try {
      await syncQuizToKlaviyo({
        email,
        consent: Boolean(body.consent),
        listId: quiz.def.klaviyo.listId,
        eventName: quiz.def.klaviyo.eventName,
        quizTitle: quiz.title,
        quizId: quiz.id,
        responseId: response.id,
        answers: answerLabels,
        recommended: products.map((p) => ({
          id: p.id,
          title: p.title,
          url: `https://${shop}${p.url}`,
          imageUrl: p.imageUrl,
          price: p.price,
        })),
      });
      await prisma.response.update({ where: { id: response.id }, data: { klaviyoSyncedAt: new Date() } });
    } catch (err) {
      // Never block the shopper's results on an email sync problem; keep the error for the admin.
      console.error("Klaviyo sync failed", err);
      await prisma.response.update({
        where: { id: response.id },
        data: { klaviyoError: String(err).slice(0, 500) },
      });
    }
  }

  return json({ responseId: response.id, usedFallback: result.usedFallback, products });
};
