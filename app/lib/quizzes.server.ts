import prisma from "../db.server";
import { quizDefinitionSchema, type QuizDefinition } from "./quiz/schema";

export async function listQuizzes(shop: string) {
  const quizzes = await prisma.quiz.findMany({
    where: { shop, status: { not: "archived" } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, status: true, updatedAt: true, publishedAt: true },
  });
  const ids = quizzes.map((q) => q.id);
  const [completes, purchases] = await Promise.all([
    prisma.response.groupBy({ by: ["quizId"], where: { quizId: { in: ids } }, _count: true }),
    prisma.response.groupBy({
      by: ["quizId"],
      where: { quizId: { in: ids }, purchasedAt: { not: null } },
      _count: true,
      _sum: { orderTotal: true },
    }),
  ]);
  return quizzes.map((q) => {
    const p = purchases.find((x) => x.quizId === q.id);
    return {
      ...q,
      completions: completes.find((x) => x.quizId === q.id)?._count ?? 0,
      orders: p?._count ?? 0,
      revenue: Number(p?._sum.orderTotal ?? 0),
    };
  });
}

export async function getQuiz(shop: string, id: string) {
  const quiz = await prisma.quiz.findFirst({ where: { id, shop } });
  if (!quiz) return null;
  return { ...quiz, draft: quizDefinitionSchema.parse(quiz.draft) };
}

export async function createQuiz(shop: string, title: string, def: QuizDefinition) {
  return prisma.quiz.create({ data: { shop, title, draft: def } });
}

export async function saveDraft(shop: string, id: string, title: string, def: QuizDefinition) {
  return prisma.quiz.updateMany({ where: { id, shop }, data: { title, draft: def } });
}

export async function publishQuiz(shop: string, id: string) {
  const quiz = await prisma.quiz.findFirst({ where: { id, shop } });
  if (!quiz) throw new Error("Quiz not found");
  return prisma.quiz.update({
    where: { id },
    data: { published: quiz.draft ?? undefined, publishedAt: new Date(), status: "published" },
  });
}

export async function unpublishQuiz(shop: string, id: string) {
  return prisma.quiz.updateMany({ where: { id, shop }, data: { status: "draft" } });
}

export async function archiveQuiz(shop: string, id: string) {
  return prisma.quiz.updateMany({ where: { id, shop }, data: { status: "archived" } });
}

export async function duplicateQuiz(shop: string, id: string) {
  const quiz = await getQuiz(shop, id);
  if (!quiz) throw new Error("Quiz not found");
  return createQuiz(shop, `${quiz.title} (copy)`, quiz.draft);
}

/** The storefront-safe view of a published quiz: no scoring rules or filters. */
export function toPublicQuiz(id: string, title: string, def: QuizDefinition) {
  return {
    id,
    title,
    intro: def.intro,
    questions: def.questions.map((q) => ({
      id: q.id,
      type: q.type,
      title: q.title,
      subtitle: q.subtitle,
      required: q.required,
      consentLabel: q.consentLabel,
      answers: q.answers.map((a) => ({
        id: a.id,
        label: a.label,
        description: a.description,
        imageUrl: a.imageUrl,
      })),
    })),
    results: {
      heading: def.results.heading,
      text: def.results.text,
      showAddAll: def.results.showAddAll,
    },
  };
}

export async function getPublishedQuiz(shop: string, id: string) {
  const quiz = await prisma.quiz.findFirst({ where: { id, shop, status: "published" } });
  if (!quiz?.published) return null;
  return { id: quiz.id, title: quiz.title, def: quizDefinitionSchema.parse(quiz.published) };
}
