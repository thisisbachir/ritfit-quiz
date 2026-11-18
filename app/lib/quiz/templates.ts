import { emptyDefinition, newId, quizDefinitionSchema, type QuizDefinition } from "./schema";

/**
 * Starter quiz for RitFit. The tags used below (power-rack, smith-machine, …) are
 * placeholders: after creating the quiz, point each answer at RitFit's real tags,
 * collections or products in the builder.
 */
export function homeGymTemplate(): QuizDefinition {
  const tag = (target: string, points: number) => ({
    id: newId("r"),
    targetType: "tag" as const,
    target,
    points,
  });
  const maxPrice = (value: string) => ({ id: newId("f"), kind: "max_price" as const, value });
  const answer = (label: string, extra: Record<string, unknown> = {}) => ({ id: newId("a"), label, ...extra });

  return quizDefinitionSchema.parse({
    intro: {
      enabled: true,
      heading: "Build your home gym",
      text: "Answer 6 quick questions and we'll match you with the right RitFit equipment for your goals, space and budget.",
      buttonLabel: "Start Quiz",
    },
    questions: [
      {
        id: newId("q"),
        type: "single",
        title: "What's your main training goal?",
        answers: [
          answer("Build strength", { rules: [tag("power-rack", 5), tag("smith-machine", 4), tag("barbell", 3)] }),
          answer("Build muscle", { rules: [tag("smith-machine", 5), tag("cable-machine", 4), tag("bench", 3)] }),
          answer("Lose weight & tone", { rules: [tag("dumbbells", 4), tag("accessories", 3), tag("bench", 2)] }),
          answer("Stay active", { rules: [tag("dumbbells", 3), tag("accessories", 3)] }),
        ],
      },
      {
        id: newId("q"),
        type: "single",
        title: "How experienced are you with weight training?",
        answers: [
          answer("Beginner", { rules: [tag("smith-machine", 2), tag("beginner", 3)] }),
          answer("Intermediate", { rules: [tag("power-rack", 2)] }),
          answer("Advanced", { rules: [tag("power-rack", 3), tag("barbell", 2)] }),
        ],
      },
      {
        id: newId("q"),
        type: "single",
        title: "How much space do you have?",
        subtitle: "Think about the floor area you can dedicate to your gym.",
        answers: [
          answer("A small corner", {
            rules: [tag("compact", 4), tag("dumbbells", 2)],
            filters: [{ id: newId("f"), kind: "exclude_tag", value: "large-footprint" }],
          }),
          answer("Single garage bay", { rules: [tag("power-rack", 2), tag("smith-machine", 2)] }),
          answer("A full room or garage", { rules: [tag("smith-machine", 3), tag("cable-machine", 3)] }),
        ],
      },
      {
        id: newId("q"),
        type: "single",
        title: "What's your ceiling height?",
        answers: [
          answer("Under 7 ft", {
            filters: [{ id: newId("f"), kind: "exclude_tag", value: "tall" }],
            rules: [tag("short-ceiling", 3)],
          }),
          answer("7 to 8 ft"),
          answer("Over 8 ft"),
        ],
      },
      {
        id: newId("q"),
        type: "multiple",
        title: "What equipment do you already have?",
        required: false,
        answers: [
          answer("Barbell", { rules: [tag("barbell", -10)] }),
          answer("Weight plates", { rules: [tag("weight-plates", -10)] }),
          answer("Bench", { rules: [tag("bench", -10)] }),
          answer("Dumbbells", { rules: [tag("dumbbells", -10)] }),
        ],
      },
      {
        id: newId("q"),
        type: "single",
        title: "What's your budget?",
        answers: [
          answer("Under $500", { filters: [maxPrice("500")] }),
          answer("$500 – $1,500", { filters: [maxPrice("1500")] }),
          answer("$1,500 – $3,000", { filters: [maxPrice("3000")] }),
          answer("$3,000+"),
        ],
      },
      {
        id: newId("q"),
        type: "email",
        title: "Where should we send your plan?",
        subtitle: "Get your recommendations and setup tips by email.",
        required: false,
        consentLabel: "Email me offers and training tips from RitFit.",
      },
    ],
    results: {
      heading: "Your RitFit home gym",
      text: "Based on your answers, here's the setup we recommend.",
      maxProducts: 4,
    },
    klaviyo: { enabled: true, eventName: "Completed Product Quiz" },
  });
}

export const templates = {
  blank: { label: "Blank quiz", build: emptyDefinition },
  "home-gym": { label: "Home gym builder (RitFit starter)", build: homeGymTemplate },
} as const;
export type TemplateKey = keyof typeof templates;
