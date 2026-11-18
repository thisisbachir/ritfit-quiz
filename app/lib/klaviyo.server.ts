/**
 * Klaviyo sync. Needs KLAVIYO_PRIVATE_API_KEY (a private key with Events, Profiles,
 * Lists and Subscriptions write scopes) set on Railway.
 *
 * On quiz completion with an email we:
 *  1. send an event (default "Completed Product Quiz") carrying answers + recommended
 *     products — use it as a Flow trigger in Klaviyo;
 *  2. save each answer onto the profile as `Quiz: <question>` properties for segmentation;
 *  3. if the shopper ticked the consent box and the quiz has a list id, subscribe them
 *     to that list for email marketing.
 */

const KLAVIYO_API = "https://a.klaviyo.com/api";
const REVISION = "2024-10-15";

export interface KlaviyoQuizPayload {
  email: string;
  consent: boolean;
  listId: string;
  eventName: string;
  quizTitle: string;
  quizId: string;
  responseId: string;
  answers: Record<string, string[]>;
  recommended: { id: string; title: string; url: string; imageUrl: string | null; price: number }[];
}

export function klaviyoConfigured() {
  return Boolean(process.env.KLAVIYO_PRIVATE_API_KEY);
}

async function call(path: string, body: unknown) {
  const res = await fetch(`${KLAVIYO_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Klaviyo-API-Key ${process.env.KLAVIYO_PRIVATE_API_KEY}`,
      revision: REVISION,
      "content-type": "application/vnd.api+json",
      accept: "application/vnd.api+json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Klaviyo ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

export function buildProfileProperties(p: KlaviyoQuizPayload) {
  const props: Record<string, string> = {
    "Quiz: Last Completed": p.quizTitle,
    "Quiz: Top Recommendation": p.recommended[0]?.title ?? "",
  };
  for (const [question, labels] of Object.entries(p.answers)) {
    props[`Quiz: ${question}`.slice(0, 100)] = labels.join(", ");
  }
  return props;
}

export async function syncQuizToKlaviyo(p: KlaviyoQuizPayload) {
  if (!klaviyoConfigured()) throw new Error("KLAVIYO_PRIVATE_API_KEY is not set");

  await call("/events", {
    data: {
      type: "event",
      attributes: {
        unique_id: p.responseId,
        properties: {
          quiz_id: p.quizId,
          quiz_title: p.quizTitle,
          answers: p.answers,
          recommended_products: p.recommended,
          top_recommendation: p.recommended[0]?.title ?? null,
        },
        metric: { data: { type: "metric", attributes: { name: p.eventName } } },
        profile: {
          data: {
            type: "profile",
            attributes: { email: p.email, properties: buildProfileProperties(p) },
          },
        },
      },
    },
  });

  if (p.consent && p.listId) {
    await call("/profile-subscription-bulk-create-jobs", {
      data: {
        type: "profile-subscription-bulk-create-job",
        attributes: {
          custom_source: `Product quiz: ${p.quizTitle}`,
          profiles: {
            data: [
              {
                type: "profile",
                attributes: {
                  email: p.email,
                  subscriptions: { email: { marketing: { consent: "SUBSCRIBED" } } },
                },
              },
            ],
          },
        },
        relationships: { list: { data: { type: "list", id: p.listId } } },
      },
    });
  }
}
