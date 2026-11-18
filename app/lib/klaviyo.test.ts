import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProfileProperties, syncQuizToKlaviyo, type KlaviyoQuizPayload } from "./klaviyo.server";

const payload: KlaviyoQuizPayload = {
  email: "a@example.com",
  consent: true,
  listId: "LIST1",
  eventName: "Completed Product Quiz",
  quizTitle: "Home gym builder",
  quizId: "q1",
  responseId: "r1",
  answers: { "Main goal?": ["Build strength"], "Owned?": ["Bench", "Barbell"] },
  recommended: [{ id: "gid://shopify/Product/1", title: "PPC Rack", url: "https://x/products/ppc", imageUrl: null, price: 899 }],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("klaviyo", () => {
  it("builds readable profile properties", () => {
    expect(buildProfileProperties(payload)).toEqual({
      "Quiz: Last Completed": "Home gym builder",
      "Quiz: Top Recommendation": "PPC Rack",
      "Quiz: Main goal?": "Build strength",
      "Quiz: Owned?": "Bench, Barbell",
    });
  });

  it("sends the event, then subscribes only with consent", async () => {
    vi.stubEnv("KLAVIYO_PRIVATE_API_KEY", "pk_test");
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await syncQuizToKlaviyo(payload);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      "https://a.klaviyo.com/api/events",
      "https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs",
    ]);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Klaviyo-API-Key pk_test");
    const sub = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(sub.data.relationships.list.data.id).toBe("LIST1");

    fetchMock.mockClear();
    await syncQuizToKlaviyo({ ...payload, consent: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces API errors", async () => {
    vi.stubEnv("KLAVIYO_PRIVATE_API_KEY", "pk_test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad", { status: 400 })));
    await expect(syncQuizToKlaviyo(payload)).rejects.toThrow(/400/);
  });
});
