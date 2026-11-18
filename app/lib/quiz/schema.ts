import { z } from "zod";

/**
 * The quiz definition — everything a merchant edits in the builder.
 * Stored as JSON on Quiz.draft / Quiz.published.
 *
 * Recommendation model (deliberately simple):
 *  - Each answer can GIVE POINTS to products that match a target
 *    (a tag, a product type, a collection, or one specific product).
 *  - Each answer can also apply FILTERS that remove products entirely
 *    (e.g. "budget under $500" removes everything over $500).
 *  - The highest scoring products that survive the filters are recommended.
 */

export const ruleTargetTypes = ["tag", "product_type", "collection", "product"] as const;
export type RuleTargetType = (typeof ruleTargetTypes)[number];

export const scoreRuleSchema = z.object({
  id: z.string(),
  targetType: z.enum(ruleTargetTypes),
  /** tag text, product type, collection handle, or product GID */
  target: z.string().trim().min(1),
  /** label for product targets so the builder can show a title instead of a GID */
  targetLabel: z.string().optional(),
  points: z.number().int().min(-100).max(100),
});
export type ScoreRule = z.infer<typeof scoreRuleSchema>;

export const filterKinds = [
  "exclude_tag",
  "require_tag",
  "max_price",
  "min_price",
] as const;
export type FilterKind = (typeof filterKinds)[number];

export const filterSchema = z.object({
  id: z.string(),
  kind: z.enum(filterKinds),
  /** tag text for tag filters, a number (as string) for price filters */
  value: z.string().trim().min(1),
});
export type Filter = z.infer<typeof filterSchema>;

export const answerSchema = z.object({
  id: z.string(),
  label: z.string().trim().min(1, "Answer text is required"),
  description: z.string().optional().default(""),
  imageUrl: z.string().optional().default(""),
  rules: z.array(scoreRuleSchema).default([]),
  filters: z.array(filterSchema).default([]),
});
export type Answer = z.infer<typeof answerSchema>;

export const questionTypes = ["single", "multiple", "email"] as const;
export type QuestionType = (typeof questionTypes)[number];

export const questionSchema = z.object({
  id: z.string(),
  type: z.enum(questionTypes),
  title: z.string().trim().min(1, "Question text is required"),
  subtitle: z.string().optional().default(""),
  required: z.boolean().default(true),
  answers: z.array(answerSchema).default([]),
  /** email questions only */
  consentLabel: z.string().optional().default(""),
});
export type Question = z.infer<typeof questionSchema>;

export const quizDefinitionSchema = z.object({
  version: z.literal(1).default(1),
  intro: z.object({
    enabled: z.boolean().default(true),
    heading: z.string().default(""),
    text: z.string().default(""),
    imageUrl: z.string().default(""),
    buttonLabel: z.string().default("Start Quiz"),
  }),
  questions: z.array(questionSchema),
  results: z.object({
    heading: z.string().default("Your perfect match"),
    text: z.string().default(""),
    /** how many products to show in total (1 best match + alternatives) */
    maxProducts: z.number().int().min(1).max(12).default(4),
    /** hide sold-out products */
    hideOutOfStock: z.boolean().default(true),
    showAddAll: z.boolean().default(true),
    /** shown when nothing scores above 0 */
    fallbackProductIds: z.array(z.string()).default([]),
    fallbackProductLabels: z.array(z.string()).default([]),
  }),
  klaviyo: z.object({
    enabled: z.boolean().default(false),
    listId: z.string().default(""),
    /** sent as the Klaviyo metric name, use it to trigger a flow */
    eventName: z.string().default("Completed Product Quiz"),
  }),
});
export type QuizDefinition = z.infer<typeof quizDefinitionSchema>;

/** Extra checks that zod can't express on its own. Returns human readable problems. */
export function lintDefinition(def: QuizDefinition): string[] {
  const problems: string[] = [];
  if (def.questions.length === 0) problems.push("Add at least one question.");
  def.questions.forEach((q, i) => {
    const name = `Question ${i + 1}`;
    if (q.type !== "email" && q.answers.length < 2) {
      problems.push(`${name} needs at least two answers.`);
    }
    for (const a of q.answers) {
      for (const f of a.filters) {
        if ((f.kind === "max_price" || f.kind === "min_price") && Number.isNaN(Number(f.value))) {
          problems.push(`${name}, answer "${a.label}": price filter must be a number.`);
        }
      }
    }
  });
  if (def.klaviyo.enabled && !def.questions.some((q) => q.type === "email")) {
    problems.push("Klaviyo sync is on, but the quiz has no email question.");
  }
  return problems;
}

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyDefinition(): QuizDefinition {
  return quizDefinitionSchema.parse({
    intro: {
      heading: "Find your perfect home gym",
      text: "Answer a few quick questions and we'll recommend the right RitFit equipment for your space, goals and budget.",
    },
    questions: [],
    results: {},
    klaviyo: {},
  });
}
