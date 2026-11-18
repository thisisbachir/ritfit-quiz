import prisma from "../db.server";
import type { QuizDefinition } from "./quiz/schema";

export async function quizAnalytics(shop: string, quizId: string, def: QuizDefinition, since: Date) {
  const where = { quizId, shop, createdAt: { gte: since } };

  const [eventCounts, visitorCounts, responses, purchases, recent] = await Promise.all([
    prisma.event.groupBy({ by: ["type"], where, _count: true }),
    // unique visitors per funnel step
    prisma.event.findMany({ where, distinct: ["type", "visitorId"], select: { type: true } }),
    prisma.response.findMany({ where, select: { answers: true, email: true, emailConsent: true } }),
    prisma.response.aggregate({
      where: { ...where, purchasedAt: { not: null } },
      _count: true,
      _sum: { orderTotal: true },
    }),
    prisma.response.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        createdAt: true,
        email: true,
        answerLabels: true,
        recommendedIds: true,
        orderName: true,
        orderTotal: true,
        klaviyoError: true,
      },
    }),
  ]);

  const count = (type: string) => eventCounts.find((e) => e.type === type)?._count ?? 0;
  const unique = (type: string) => visitorCounts.filter((e) => e.type === type).length;

  // answer distribution, computed from responses so it matches what was submitted
  const distribution = def.questions
    .filter((q) => q.type !== "email")
    .map((q) => {
      const tally = new Map<string, number>(q.answers.map((a) => [a.id, 0]));
      let answered = 0;
      for (const r of responses) {
        const picked = ((r.answers as Record<string, string[]>)[q.id] ?? []) as string[];
        if (picked.length) answered++;
        for (const id of picked) if (tally.has(id)) tally.set(id, tally.get(id)! + 1);
      }
      return {
        question: q.title,
        answered,
        answers: q.answers.map((a) => ({ label: a.label, count: tally.get(a.id) ?? 0 })),
      };
    });

  const completions = responses.length;
  return {
    funnel: {
      views: unique("view"),
      starts: unique("start"),
      completions,
      addToCarts: unique("add_to_cart"),
      orders: purchases._count,
    },
    rawCounts: { views: count("view"), starts: count("start") },
    revenue: Number(purchases._sum.orderTotal ?? 0),
    emails: responses.filter((r) => r.email).length,
    subscribed: responses.filter((r) => r.emailConsent).length,
    distribution,
    recent: recent.map((r) => ({
      ...r,
      orderTotal: r.orderTotal ? Number(r.orderTotal) : null,
      answerLabels: r.answerLabels as Record<string, string[]>,
    })),
  };
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // also neutralise spreadsheet formula injection
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function responsesCsv(shop: string, quizId: string, def: QuizDefinition) {
  const rows = await prisma.response.findMany({
    where: { shop, quizId },
    orderBy: { createdAt: "desc" },
    take: 50000,
  });
  const questions = def.questions.filter((q) => q.type !== "email");
  const header = [
    "Date",
    "Email",
    "Marketing consent",
    ...questions.map((q) => q.title),
    "Recommended product IDs",
    "Order",
    "Order total",
  ];
  const lines = rows.map((r) => {
    const labels = r.answerLabels as Record<string, string[]>;
    return [
      r.createdAt.toISOString(),
      r.email ?? "",
      r.emailConsent ? "yes" : "no",
      ...questions.map((q) => (labels[q.title] ?? []).join("; ")),
      (r.recommendedIds as string[]).map((id) => id.split("/").pop()).join("; "),
      r.orderName ?? "",
      r.orderTotal?.toString() ?? "",
    ]
      .map(csvCell)
      .join(",");
  });
  return [header.map(csvCell).join(","), ...lines].join("\n");
}
