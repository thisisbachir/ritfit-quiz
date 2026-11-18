import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getCatalog } from "../lib/catalog.server";
import { klaviyoConfigured } from "../lib/klaviyo.server";
import { previewToken } from "../lib/preview.server";
import { getQuiz, publishQuiz, saveDraft, unpublishQuiz } from "../lib/quizzes.server";
import {
  lintDefinition,
  newId,
  quizDefinitionSchema,
  type Answer,
  type Filter,
  type FilterKind,
  type Question,
  type QuestionType,
  type QuizDefinition,
  type RuleTargetType,
  type ScoreRule,
} from "../lib/quiz/schema";

/* ------------------------------------------------------------------ server */

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const quiz = await getQuiz(session.shop, params.id!);
  if (!quiz) throw new Response("Quiz not found", { status: 404 });

  // Real tags / types / collections from the store power the rule dropdowns.
  let catalogError: string | null = null;
  let tags: string[] = [];
  let productTypes: string[] = [];
  let collections: string[] = [];
  let productCount = 0;
  try {
    const catalog = await getCatalog(session.shop, admin);
    productCount = catalog.length;
    const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b));
    tags = uniq(catalog.flatMap((p) => p.tags));
    productTypes = uniq(catalog.map((p) => p.productType));
    collections = uniq(catalog.flatMap((p) => p.collections));
  } catch (e) {
    catalogError = String(e);
  }

  return {
    quiz: {
      id: quiz.id,
      title: quiz.title,
      status: quiz.status,
      publishedAt: quiz.publishedAt,
      updatedAt: quiz.updatedAt,
      draft: quiz.draft,
      hasUnpublishedChanges:
        quiz.status === "published" && JSON.stringify(quiz.draft) !== JSON.stringify(quiz.published),
    },
    options: { tags, productTypes, collections, productCount, catalogError },
    previewUrl: `https://${session.shop}/apps/ritfit-quiz/q/${quiz.id}?quiz_preview=${previewToken(session.shop, quiz.id)}`,
    liveUrl: `https://${session.shop}/apps/ritfit-quiz/q/${quiz.id}`,
    klaviyoReady: klaviyoConfigured(),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const id = params.id!;

  if (intent === "unpublish") {
    await unpublishQuiz(session.shop, id);
    return { ok: true, message: "Quiz unpublished" };
  }

  const title = String(form.get("title") ?? "").trim() || "Untitled quiz";
  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get("definition")));
  } catch {
    return { ok: false, errors: ["Could not read the quiz. Please reload and try again."] };
  }
  const parsed = quizDefinitionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(" › ")}: ${i.message}`) };
  }
  await saveDraft(session.shop, id, title, parsed.data);

  if (intent === "publish") {
    const problems = lintDefinition(parsed.data);
    if (problems.length) return { ok: false, errors: problems, message: "Saved, but not published" };
    await publishQuiz(session.shop, id);
    return { ok: true, message: "Quiz published" };
  }
  return { ok: true, message: "Draft saved" };
};

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);

/* ------------------------------------------------------------------ helpers */

type Options = Awaited<ReturnType<typeof loader>>["options"];
type PickProducts = (multiple: boolean) => Promise<{ id: string; title: string }[]>;

const val = (e: Event) => (e.currentTarget as HTMLInputElement).value;
const checked = (e: Event) => (e.currentTarget as HTMLInputElement).checked;

const targetTypeLabels: Record<RuleTargetType, string> = {
  tag: "Products tagged",
  collection: "Products in collection",
  product_type: "Product type",
  product: "Specific product",
};
const filterLabels: Record<FilterKind, string> = {
  exclude_tag: "Hide products tagged",
  require_tag: "Only show products tagged",
  max_price: "Hide products over ($)",
  min_price: "Hide products under ($)",
};
const questionTypeLabels: Record<QuestionType, string> = {
  single: "Single choice",
  multiple: "Multiple choice",
  email: "Email capture",
};

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const copy = list.slice();
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

/** Select listing known values, keeping the current value even if it no longer exists in the store. */
function ValueSelect(props: { label: string; value: string; values: string[]; onChange: (v: string) => void }) {
  const values = props.value && !props.values.includes(props.value) ? [props.value, ...props.values] : props.values;
  return (
    <s-select label={props.label} value={props.value} onChange={(e) => props.onChange(val(e))}>
      <s-option value="">Choose…</s-option>
      {values.map((v) => (
        <s-option key={v} value={v}>
          {v}
        </s-option>
      ))}
    </s-select>
  );
}

/* ------------------------------------------------------------------ rule + filter rows */

function RuleRow(props: {
  rule: ScoreRule;
  options: Options;
  pickProducts: PickProducts;
  onChange: (r: ScoreRule) => void;
  onRemove: () => void;
}) {
  const { rule, options } = props;
  const values =
    rule.targetType === "tag"
      ? options.tags
      : rule.targetType === "collection"
        ? options.collections
        : options.productTypes;

  return (
    <s-grid gridTemplateColumns="1fr 1.4fr 100px auto" gap="small-200" alignItems="end">
      <s-select
        label="Recommend"
        value={rule.targetType}
        onChange={(e) =>
          props.onChange({ ...rule, targetType: val(e) as RuleTargetType, target: "", targetLabel: undefined })
        }
      >
        {Object.entries(targetTypeLabels).map(([k, label]) => (
          <s-option key={k} value={k}>
            {label}
          </s-option>
        ))}
      </s-select>
      {rule.targetType === "product" ? (
        <s-stack gap="small-100">
          <s-text>{rule.targetLabel || "No product chosen"}</s-text>
          <s-button
            onClick={async () => {
              const [p] = await props.pickProducts(false);
              if (p) props.onChange({ ...rule, target: p.id, targetLabel: p.title });
            }}
          >
            {rule.target ? "Change product" : "Choose product"}
          </s-button>
        </s-stack>
      ) : (
        <ValueSelect
          label={targetTypeLabels[rule.targetType]}
          value={rule.target}
          values={values}
          onChange={(target) => props.onChange({ ...rule, target })}
        />
      )}
      <s-number-field
        label="Points"
        value={String(rule.points)}
        min={-100}
        max={100}
        step={1}
        onChange={(e) => props.onChange({ ...rule, points: Math.round(Number(val(e)) || 0) })}
      />
      <s-button variant="tertiary" tone="critical" icon="delete" accessibilityLabel="Remove recommendation" onClick={props.onRemove} />
    </s-grid>
  );
}

function FilterRow(props: { filter: Filter; options: Options; onChange: (f: Filter) => void; onRemove: () => void }) {
  const { filter } = props;
  const isPrice = filter.kind === "max_price" || filter.kind === "min_price";
  return (
    <s-grid gridTemplateColumns="1fr 1.4fr auto" gap="small-200" alignItems="end">
      <s-select
        label="Filter"
        value={filter.kind}
        onChange={(e) => props.onChange({ ...filter, kind: val(e) as FilterKind, value: "" })}
      >
        {Object.entries(filterLabels).map(([k, label]) => (
          <s-option key={k} value={k}>
            {label}
          </s-option>
        ))}
      </s-select>
      {isPrice ? (
        <s-number-field
          label="Price"
          value={filter.value}
          min={0}
          prefix="$"
          onChange={(e) => props.onChange({ ...filter, value: val(e) })}
        />
      ) : (
        <ValueSelect
          label="Tag"
          value={filter.value}
          values={props.options.tags}
          onChange={(value) => props.onChange({ ...filter, value })}
        />
      )}
      <s-button variant="tertiary" tone="critical" icon="delete" accessibilityLabel="Remove filter" onClick={props.onRemove} />
    </s-grid>
  );
}

/* ------------------------------------------------------------------ answer */

function AnswerEditor(props: {
  answer: Answer;
  index: number;
  total: number;
  options: Options;
  pickProducts: PickProducts;
  onChange: (a: Answer) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { answer } = props;
  const [open, setOpen] = useState(answer.rules.length === 0 && answer.filters.length === 0 ? false : true);
  const set = (patch: Partial<Answer>) => props.onChange({ ...answer, ...patch });
  const summary = [
    answer.rules.length ? `${answer.rules.length} recommendation${answer.rules.length > 1 ? "s" : ""}` : null,
    answer.filters.length ? `${answer.filters.length} filter${answer.filters.length > 1 ? "s" : ""}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <s-box border="base" borderRadius="base" padding="base" background="subdued">
      <s-stack gap="base">
        <s-grid gridTemplateColumns="1fr auto" gap="small-200" alignItems="end">
          <s-text-field
            label={`Answer ${props.index + 1}`}
            value={answer.label}
            onInput={(e) => set({ label: val(e) })}
          />
          <s-stack direction="inline" gap="small-100">
            <s-button variant="tertiary" icon="arrow-up" accessibilityLabel="Move answer up" disabled={props.index === 0} onClick={() => props.onMove(-1)} />
            <s-button variant="tertiary" icon="arrow-down" accessibilityLabel="Move answer down" disabled={props.index === props.total - 1} onClick={() => props.onMove(1)} />
            <s-button variant="tertiary" tone="critical" icon="delete" accessibilityLabel="Remove answer" onClick={props.onRemove} />
          </s-stack>
        </s-grid>

        <s-button variant="tertiary" onClick={() => setOpen(!open)}>
          {open ? "Hide details" : `Details & logic${summary ? ` (${summary})` : ""}`}
        </s-button>

        {open && (
          <s-stack gap="base">
            <s-grid gridTemplateColumns="1fr 1fr" gap="small-200">
              <s-text-field
                label="Description (optional)"
                value={answer.description}
                onInput={(e) => set({ description: val(e) })}
              />
              <s-url-field
                label="Image URL (optional)"
                details="Upload in Shopify Content → Files, then paste the link"
                value={answer.imageUrl}
                onInput={(e) => set({ imageUrl: val(e) })}
              />
            </s-grid>

            <s-stack gap="small-200">
              <s-heading>Recommendations</s-heading>
              <s-text color="subdued">Products that match get these points when a shopper picks this answer.</s-text>
              {answer.rules.map((rule, i) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  options={props.options}
                  pickProducts={props.pickProducts}
                  onChange={(r) => set({ rules: answer.rules.map((x, j) => (j === i ? r : x)) })}
                  onRemove={() => set({ rules: answer.rules.filter((_, j) => j !== i) })}
                />
              ))}
              <s-box>
                <s-button
                  icon="plus"
                  onClick={() =>
                    set({ rules: [...answer.rules, { id: newId("r"), targetType: "tag", target: "", points: 3 }] })
                  }
                >
                  Add recommendation
                </s-button>
              </s-box>
            </s-stack>

            <s-stack gap="small-200">
              <s-heading>Filters</s-heading>
              <s-text color="subdued">Remove products from the results completely, e.g. by ceiling height or budget.</s-text>
              {answer.filters.map((filter, i) => (
                <FilterRow
                  key={filter.id}
                  filter={filter}
                  options={props.options}
                  onChange={(f) => set({ filters: answer.filters.map((x, j) => (j === i ? f : x)) })}
                  onRemove={() => set({ filters: answer.filters.filter((_, j) => j !== i) })}
                />
              ))}
              <s-box>
                <s-button
                  icon="plus"
                  onClick={() =>
                    set({ filters: [...answer.filters, { id: newId("f"), kind: "max_price", value: "" }] })
                  }
                >
                  Add filter
                </s-button>
              </s-box>
            </s-stack>
          </s-stack>
        )}
      </s-stack>
    </s-box>
  );
}

/* ------------------------------------------------------------------ question */

function QuestionEditor(props: {
  question: Question;
  index: number;
  total: number;
  options: Options;
  pickProducts: PickProducts;
  onChange: (q: Question) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { question: q } = props;
  const set = (patch: Partial<Question>) => props.onChange({ ...q, ...patch });

  return (
    <s-section heading={`${props.index + 1}. ${q.title || "New question"}`}>
      <s-stack direction="inline" gap="small-100" slot="secondary-actions">
        <s-button variant="tertiary" icon="arrow-up" accessibilityLabel="Move question up" disabled={props.index === 0} onClick={() => props.onMove(-1)} />
        <s-button variant="tertiary" icon="arrow-down" accessibilityLabel="Move question down" disabled={props.index === props.total - 1} onClick={() => props.onMove(1)} />
      </s-stack>
      <s-stack gap="base">
        <s-grid gridTemplateColumns="2fr 1fr" gap="base">
          <s-text-field label="Question" value={q.title} onInput={(e) => set({ title: val(e) })} />
          <s-select
            label="Type"
            value={q.type}
            onChange={(e) => {
              const type = val(e) as QuestionType;
              set({ type, answers: type === "email" ? [] : q.answers });
            }}
          >
            {Object.entries(questionTypeLabels).map(([k, label]) => (
              <s-option key={k} value={k}>
                {label}
              </s-option>
            ))}
          </s-select>
        </s-grid>
        <s-text-field
          label="Helper text (optional)"
          value={q.subtitle}
          onInput={(e) => set({ subtitle: val(e) })}
        />
        <s-checkbox
          label={q.type === "email" ? "Email is required to see results" : "Shoppers must answer this question"}
          checked={q.required}
          onChange={(e) => set({ required: checked(e) })}
        />

        {q.type === "email" ? (
          <s-text-field
            label="Marketing consent checkbox text"
            details="Shoppers who tick it are subscribed to your Klaviyo list."
            value={q.consentLabel}
            onInput={(e) => set({ consentLabel: val(e) })}
          />
        ) : (
          <s-stack gap="small-200">
            {q.answers.map((a, i) => (
              <AnswerEditor
                key={a.id}
                answer={a}
                index={i}
                total={q.answers.length}
                options={props.options}
                pickProducts={props.pickProducts}
                onChange={(next) => set({ answers: q.answers.map((x, j) => (j === i ? next : x)) })}
                onMove={(dir) => set({ answers: move(q.answers, i, i + dir) })}
                onRemove={() => set({ answers: q.answers.filter((_, j) => j !== i) })}
              />
            ))}
            <s-box>
              <s-button
                icon="plus"
                onClick={() =>
                  set({
                    answers: [
                      ...q.answers,
                      { id: newId("a"), label: "", description: "", imageUrl: "", rules: [], filters: [] },
                    ],
                  })
                }
              >
                Add answer
              </s-button>
            </s-box>
          </s-stack>
        )}

        <s-divider />
        <s-box>
          <s-button
            tone="critical"
            variant="tertiary"
            icon="delete"
            onClick={() => {
              if (confirm(`Delete question "${q.title || props.index + 1}"?`)) props.onRemove();
            }}
          >
            Delete question
          </s-button>
        </s-box>
      </s-stack>
    </s-section>
  );
}

/* ------------------------------------------------------------------ page */

export default function QuizBuilder() {
  const { quiz, options, previewUrl, liveUrl, klaviyoReady } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const fetcher = useFetcher<typeof action>();

  const [title, setTitle] = useState(quiz.title);
  const [def, setDef] = useState<QuizDefinition>(quiz.draft as QuizDefinition);
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify([quiz.title, quiz.draft]));
  const dirty = JSON.stringify([title, def]) !== savedSnapshot;
  const problems = useMemo(() => lintDefinition(def), [def]);
  const busyIntent = fetcher.state !== "idle" ? fetcher.formData?.get("intent") : null;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.message) {
      shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
    }
  }, [fetcher.state, fetcher.data, shopify]);

  const submit = (intent: "save" | "publish" | "unpublish") => {
    // The draft is saved on every intent except "unpublish" (even when publishing fails validation).
    if (intent !== "unpublish") setSavedSnapshot(JSON.stringify([title, def]));
    fetcher.submit({ intent, title, definition: JSON.stringify(def) }, { method: "post" });
  };

  const pickProducts: PickProducts = async (multiple) => {
    const picked = await shopify.resourcePicker({ type: "product", multiple, action: "select" });
    return (picked ?? []).map((p) => ({ id: p.id, title: p.title }));
  };

  const setQuestions = (questions: Question[]) => setDef({ ...def, questions });
  const addQuestion = (type: QuestionType) =>
    setQuestions([
      ...def.questions,
      {
        id: newId("q"),
        type,
        title: "",
        subtitle: "",
        required: type !== "email",
        consentLabel: type === "email" ? "Email me offers and training tips from RitFit." : "",
        answers:
          type === "email"
            ? []
            : [1, 2].map(() => ({ id: newId("a"), label: "", description: "", imageUrl: "", rules: [], filters: [] })),
      },
    ]);

  const serverErrors = fetcher.data && !fetcher.data.ok ? (fetcher.data.errors ?? []) : [];
  const status = quiz.status === "published" ? (quiz.hasUnpublishedChanges ? "Live · unpublished changes" : "Live") : "Draft";

  return (
    <s-page heading={title || "Untitled quiz"} inlineSize="base">
      <s-button slot="primary-action" variant="primary" loading={busyIntent === "publish"} onClick={() => submit("publish")}>
        {quiz.status === "published" ? "Publish changes" : "Publish"}
      </s-button>
      <s-button slot="secondary-actions" loading={busyIntent === "save"} disabled={!dirty} onClick={() => submit("save")}>
        Save draft
      </s-button>
      <s-button slot="secondary-actions" href={previewUrl} target="_blank">
        Preview on store
      </s-button>
      <s-button slot="secondary-actions" onClick={() => navigate(`/app/quizzes/${quiz.id}/results`)}>
        Results
      </s-button>
      <s-link slot="breadcrumb-actions" href="/app">
        Quizzes
      </s-link>

      <s-stack gap="base">
        <s-stack direction="inline" gap="small-200">
          <s-badge tone={quiz.status === "published" ? "success" : "neutral"}>{status}</s-badge>
          {dirty && <s-badge tone="caution">Unsaved changes</s-badge>}
        </s-stack>

        {serverErrors.length > 0 && (
          <s-banner tone="critical" heading="Fix these before publishing">
            <s-unordered-list>
              {serverErrors.map((e) => (
                <s-list-item key={e}>{e}</s-list-item>
              ))}
            </s-unordered-list>
          </s-banner>
        )}
        {serverErrors.length === 0 && problems.length > 0 && (
          <s-banner tone="warning" heading="Before you publish">
            <s-unordered-list>
              {problems.map((e) => (
                <s-list-item key={e}>{e}</s-list-item>
              ))}
            </s-unordered-list>
          </s-banner>
        )}
        {options.catalogError && (
          <s-banner tone="warning" heading="Couldn't load your products">
            Tag and collection lists are empty. {options.catalogError}
          </s-banner>
        )}
      </s-stack>

      <s-section heading="Basics">
        <s-stack gap="base">
          <s-text-field label="Quiz name (internal)" value={title} onInput={(e) => setTitle(val(e))} />
          <s-checkbox
            label="Show an intro screen"
            checked={def.intro.enabled}
            onChange={(e) => setDef({ ...def, intro: { ...def.intro, enabled: checked(e) } })}
          />
          {def.intro.enabled && (
            <>
              <s-text-field
                label="Intro heading"
                value={def.intro.heading}
                onInput={(e) => setDef({ ...def, intro: { ...def.intro, heading: val(e) } })}
              />
              <s-text-area
                label="Intro text"
                rows={3}
                value={def.intro.text}
                onInput={(e) => setDef({ ...def, intro: { ...def.intro, text: val(e) } })}
              />
              <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                <s-url-field
                  label="Intro image URL (optional)"
                  value={def.intro.imageUrl}
                  onInput={(e) => setDef({ ...def, intro: { ...def.intro, imageUrl: val(e) } })}
                />
                <s-text-field
                  label="Start button label"
                  details="Use Title Case, e.g. Start Quiz"
                  value={def.intro.buttonLabel}
                  onInput={(e) => setDef({ ...def, intro: { ...def.intro, buttonLabel: val(e) } })}
                />
              </s-grid>
            </>
          )}
        </s-stack>
      </s-section>

      {def.questions.map((q, i) => (
        <QuestionEditor
          key={q.id}
          question={q}
          index={i}
          total={def.questions.length}
          options={options}
          pickProducts={pickProducts}
          onChange={(next) => setQuestions(def.questions.map((x, j) => (j === i ? next : x)))}
          onMove={(dir) => setQuestions(move(def.questions, i, i + dir))}
          onRemove={() => setQuestions(def.questions.filter((_, j) => j !== i))}
        />
      ))}

      <s-section>
        <s-stack direction="inline" gap="small-200">
          <s-button icon="plus" onClick={() => addQuestion("single")}>Single choice question</s-button>
          <s-button icon="plus" onClick={() => addQuestion("multiple")}>Multiple choice question</s-button>
          <s-button icon="plus" onClick={() => addQuestion("email")}>Email step</s-button>
        </s-stack>
      </s-section>

      <s-section heading="Results page">
        <s-stack gap="base">
          <s-text-field
            label="Heading"
            value={def.results.heading}
            onInput={(e) => setDef({ ...def, results: { ...def.results, heading: val(e) } })}
          />
          <s-text-area
            label="Text"
            rows={2}
            value={def.results.text}
            onInput={(e) => setDef({ ...def, results: { ...def.results, text: val(e) } })}
          />
          <s-number-field
            label="Products to show"
            details="1 best match plus alternatives"
            value={String(def.results.maxProducts)}
            min={1}
            max={12}
            onChange={(e) =>
              setDef({
                ...def,
                results: { ...def.results, maxProducts: Math.min(12, Math.max(1, Math.round(Number(val(e)) || 1))) },
              })
            }
          />
          <s-checkbox
            label="Hide sold-out products"
            checked={def.results.hideOutOfStock}
            onChange={(e) => setDef({ ...def, results: { ...def.results, hideOutOfStock: checked(e) } })}
          />
          <s-checkbox
            label='Show "Add All to Cart" for the full setup'
            checked={def.results.showAddAll}
            onChange={(e) => setDef({ ...def, results: { ...def.results, showAddAll: checked(e) } })}
          />
          <s-stack gap="small-200">
            <s-heading>Fallback products</s-heading>
            <s-text color="subdued">Shown when no product matches the shopper&apos;s answers.</s-text>
            {def.results.fallbackProductLabels.length > 0 && (
              <s-unordered-list>
                {def.results.fallbackProductLabels.map((t) => (
                  <s-list-item key={t}>{t}</s-list-item>
                ))}
              </s-unordered-list>
            )}
            <s-box>
              <s-button
                onClick={async () => {
                  const picked = await pickProducts(true);
                  if (picked.length)
                    setDef({
                      ...def,
                      results: {
                        ...def.results,
                        fallbackProductIds: picked.map((p) => p.id),
                        fallbackProductLabels: picked.map((p) => p.title),
                      },
                    });
                }}
              >
                Choose fallback products
              </s-button>
            </s-box>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Klaviyo">
        <s-stack gap="base">
          {!klaviyoReady && (
            <s-banner tone="warning">
              KLAVIYO_PRIVATE_API_KEY is not set on the server, so nothing will sync yet. See the Setup page.
            </s-banner>
          )}
          <s-checkbox
            label="Send quiz answers to Klaviyo"
            details="Adds answers to the profile and sends an event you can use to trigger a flow"
            checked={def.klaviyo.enabled}
            onChange={(e) => setDef({ ...def, klaviyo: { ...def.klaviyo, enabled: checked(e) } })}
          />
          {def.klaviyo.enabled && (
            <s-grid gridTemplateColumns="1fr 1fr" gap="base">
              <s-text-field
                label="List ID"
                details="Shoppers who tick the consent box are subscribed to this list. Find it in Klaviyo → Lists → Settings."
                value={def.klaviyo.listId}
                onInput={(e) => setDef({ ...def, klaviyo: { ...def.klaviyo, listId: val(e).trim() } })}
              />
              <s-text-field
                label="Event name"
                details="Use this metric as your flow trigger"
                value={def.klaviyo.eventName}
                onInput={(e) => setDef({ ...def, klaviyo: { ...def.klaviyo, eventName: val(e) } })}
              />
            </s-grid>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Add to your store">
        <s-stack gap="base">
          <s-paragraph>
            Quiz ID: <s-text type="strong">{quiz.id}</s-text>
          </s-paragraph>
          <s-unordered-list>
            <s-list-item>
              On a page: Online Store → Customize → add the <s-text type="strong">Product quiz</s-text> app block
              and paste the quiz ID.
            </s-list-item>
            <s-list-item>
              As a popup: link any button to <s-text type="strong">#quiz-{quiz.id}</s-text>
            </s-list-item>
            <s-list-item>
              Hosted page for ads and emails: <s-link href={liveUrl} target="_blank">{liveUrl}</s-link>
            </s-list-item>
          </s-unordered-list>
          <s-text color="subdued">
            {options.productCount} products available for recommendations.
          </s-text>
          {quiz.status === "published" && (
            <s-box>
              <s-button tone="critical" loading={busyIntent === "unpublish"} onClick={() => submit("unpublish")}>
                Unpublish
              </s-button>
            </s-box>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}
