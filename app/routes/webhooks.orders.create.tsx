import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

/** Must match RESPONSE_ATTRIBUTE in extensions/quiz-theme/assets/ritfit-quiz.js */
const RESPONSE_ATTRIBUTE = "_quiz_response_id";

interface OrderPayload {
  admin_graphql_api_id: string;
  name: string;
  current_total_price?: string;
  total_price?: string;
  currency: string;
  note_attributes?: { name: string; value: string }[];
}

/** Attributes a purchase to the quiz response stored on the cart by the storefront widget. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const order = payload as OrderPayload;
  const responseId = order.note_attributes?.find((a) => a.name === RESPONSE_ATTRIBUTE)?.value;
  if (!responseId) return new Response(null, { status: 200 });

  const response = await prisma.response.findFirst({ where: { id: responseId, shop } });
  // Already attributed (webhooks can be delivered more than once) or unknown id.
  if (!response || response.orderId) return new Response(null, { status: 200 });

  const total = order.current_total_price ?? order.total_price ?? "0";
  await prisma.$transaction([
    prisma.response.update({
      where: { id: response.id },
      data: {
        orderId: order.admin_graphql_api_id,
        orderName: order.name,
        orderTotal: total,
        orderCurrency: order.currency,
        purchasedAt: new Date(),
      },
    }),
    prisma.event.create({
      data: {
        quizId: response.quizId,
        shop,
        type: "purchase",
        visitorId: response.visitorId,
        responseId: response.id,
        value: total,
      },
    }),
  ]);
  return new Response(null, { status: 200 });
};
