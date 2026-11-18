import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import prisma from "../db.server";
import { cleanVisitorId, json, proxyContext } from "../lib/proxy.server";

const bodySchema = z.object({
  quizId: z.string().min(1),
  type: z.enum(["view", "start", "add_to_cart"]),
  visitorId: z.string().optional(),
  responseId: z.string().optional(),
});

/** POST /apps/ritfit-quiz/event — funnel tracking from the storefront widget. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await proxyContext(request);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid event" }, 400);
  const { quizId, type, responseId } = parsed.data;

  const quiz = await prisma.quiz.findFirst({ where: { id: quizId, shop }, select: { id: true } });
  if (!quiz) return json({ error: "Quiz not found" }, 404);

  await prisma.event.create({
    data: { quizId, shop, type, visitorId: cleanVisitorId(parsed.data.visitorId), responseId: responseId ?? null },
  });
  return json({ ok: true });
};
