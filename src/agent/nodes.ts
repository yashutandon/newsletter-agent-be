import { RunnableConfig } from "@langchain/core/runnables";
import { interrupt } from "@langchain/langgraph";
import { EventEmitter } from "events";
import { callGroqStructured } from "../services/groq.js";
import { webSearch, fetchArticle, deduplicateArticles } from "./tools.js";
import {
  ResearchPlanSchema,
  SelectedArticlesResponseSchema,
  NewsletterContentSchema,
  ReviewResultSchema,
  RevisedNewsletterSchema,
  type ArticleSummary,
  type Newsletter,
} from "../schemas/newsletter.js";
import {
  PLANNER_SYSTEM,
  buildPlannerUser,
  SUMMARIZER_SYSTEM,
  buildSummarizerUser,
  WRITER_SYSTEM,
  buildWriterUser,
  REVIEWER_SYSTEM,
  buildReviewerUser,
  REVISER_SYSTEM,
  buildReviserUser,
} from "./prompts.js";
import type { NewsletterState } from "./state.js";
import { generateHTML, generateMarkdown } from "./formatter.js";

const MAX_REVISIONS = parseInt(process.env.MAX_REVISIONS ?? "2", 10);

// ─── Helper: get the session emitter from LangGraph config ───────────────────
function getEmitter(config?: RunnableConfig): EventEmitter | null {
  return (config?.configurable?.emitter as EventEmitter) ?? null;
}

function emit(
  config: RunnableConfig | undefined,
  event: string,
  data: Record<string, unknown>
): void {
  getEmitter(config)?.emit(event, data);
}

// ─── Planner Node ────────────────────────────────────────────────────────────

export async function plannerNode(
  state: NewsletterState,
  config?: RunnableConfig
): Promise<Partial<NewsletterState>> {
  emit(config, "progress", {
    step: "planning",
    message: "Analysing goal and creating research plan...",
  });

  const plan = await callGroqStructured(
    [
      { role: "system", content: PLANNER_SYSTEM },
      { role: "user", content: buildPlannerUser(state.goal) },
    ],
    ResearchPlanSchema
  );

  emit(config, "progress", {
    step: "planning",
    message: `Research plan ready. Will search for: ${plan.queries.slice(0, 3).join(", ")}...`,
  });
  emit(config, "step_complete", { step: "planning" });

  return {
    plan,
    searchQueries: plan.queries,
    status: "researching",
  };
}

// ─── Researcher Node ─────────────────────────────────────────────────────────

export async function researcherNode(
  state: NewsletterState,
  config?: RunnableConfig
): Promise<Partial<NewsletterState>> {
  emit(config, "progress", {
    step: "researching",
    message: `Executing ${state.searchQueries.length} search queries...`,
  });

  const allArticles: NewsletterState["searchResults"] = [];

  for (const query of state.searchQueries) {
    emit(config, "progress", {
      step: "researching",
      message: `Searching web for: "${query}"`,
    });
    try {
      const results = await webSearch(query);
      allArticles.push(...results);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit(config, "progress", { step: "researching", message: `Search failed for "${query}": ${msg}` });
    }
  }

  const unique = deduplicateArticles(allArticles);

  emit(config, "progress", {
    step: "researching",
    message: `Found ${unique.length} unique articles across all queries.`,
  });
  emit(config, "step_complete", { step: "researching" });

  return {
    searchResults: unique,
    status: "summarizing",
  };
}

// ─── Summarizer Node ─────────────────────────────────────────────────────────

export async function summarizerNode(
  state: NewsletterState,
  config?: RunnableConfig
): Promise<Partial<NewsletterState>> {
  // Limit to top 25 articles to avoid blowing past Groq's 8K free tier token limit
  const candidates = state.searchResults.slice(0, 25);

  emit(config, "progress", {
    step: "summarizing",
    message: `Evaluating ${candidates.length} articles to find the top 5–7...`,
  });

  const criteria = state.plan?.criteria ?? ["recent", "relevant", "credible"];

  // Ask Groq to select + summarise
  const response = await callGroqStructured(
    [
      { role: "system", content: SUMMARIZER_SYSTEM },
      {
        role: "user",
        content: buildSummarizerUser(candidates, criteria),
      },
    ],
    SelectedArticlesResponseSchema,
    { temperature: 0.2 }
  );

  // Optionally enrich each article with full text
  emit(config, "progress", {
    step: "summarizing",
    message: `Selected ${response.selected.length} articles. Fetching additional context...`,
  });

  const summaries: ArticleSummary[] = response.selected.map((s) => ({
    title: s.title,
    source: s.source,
    url: s.url,
    summary: s.summary,
    whyItMatters: s.whyItMatters,
  }));

  const selectedArticles = response.selected.map((s) => ({
    title: s.title,
    url: s.url,
    source: s.source,
    publishedAt: s.publishedAt,
    snippet: s.snippet,
  }));

  emit(config, "progress", {
    step: "summarizing",
    message: `${summaries.length} articles summarised successfully.`,
  });
  emit(config, "step_complete", { step: "summarizing" });

  return {
    selectedArticles,
    summaries,
    status: state.mode === "human" ? "awaiting_approval_1" : "writing",
  };
}

// ─── Human Approval Node 1 (post-summarization) ──────────────────────────────

export async function humanApproval1Node(
  state: NewsletterState,
  _config?: RunnableConfig
): Promise<Partial<NewsletterState>> {
  // In autonomous mode this node is skipped via conditional edge
  const decision = interrupt({
    stage: "post_summarization",
    message: "Please review the selected articles and summaries before newsletter generation.",
    summaries: state.summaries,
  });

  if (decision === "rejected") {
    return { status: "rejected", errors: ["Stage 1 rejected by user -workflow stopped."] };
  }

  return { status: "writing" };
}

// ─── Writer Node ─────────────────────────────────────────────────────────────

export async function writerNode(
  state: NewsletterState,
  config?: RunnableConfig
): Promise<Partial<NewsletterState>> {
  emit(config, "progress", {
    step: "writing",
    message: "Generating newsletter content...",
  });

  const content = await callGroqStructured(
    [
      { role: "system", content: WRITER_SYSTEM },
      {
        role: "user",
        content: buildWriterUser(state.goal, state.summaries),
      },
    ],
    NewsletterContentSchema,
    { temperature: 0.4 }
  );

  const newsletter: Newsletter = {
    subject: content.subject,
    title: content.title,
    introduction: content.introduction,
    articles: state.summaries,
    conclusion: content.conclusion,
    html: generateHTML(content, state.summaries),
    markdown: generateMarkdown(content, state.summaries),
    generatedAt: new Date().toISOString(),
  };

  emit(config, "progress", {
    step: "writing",
    message: `Newsletter "${content.subject}" generated.`,
  });
  emit(config, "step_complete", { step: "writing" });

  return {
    newsletter,
    status: "reviewing",
  };
}

// ─── Reviewer Node ────────────────────────────────────────────────────────────

export async function reviewerNode(
  state: NewsletterState,
  config?: RunnableConfig
): Promise<Partial<NewsletterState>> {
  if (!state.newsletter) {
    return { errors: ["Reviewer: no newsletter to review"], status: "failed" };
  }

  emit(config, "progress", {
    step: "reviewing",
    message: "Reviewing newsletter quality...",
  });

  const review = await callGroqStructured(
    [
      { role: "system", content: REVIEWER_SYSTEM },
      {
        role: "user",
        content: buildReviewerUser(
          state.newsletter.subject,
          state.newsletter.title,
          state.newsletter.introduction,
          state.newsletter.articles,
          state.newsletter.conclusion
        ),
      },
    ],
    ReviewResultSchema,
    { temperature: 0.1 }
  );

  emit(config, "progress", {
    step: "reviewing",
    message: `Review complete. Score: ${review.score}/10. Needs revision: ${review.needsRevision}.`,
  });
  emit(config, "step_complete", { step: "reviewing" });

  return { review };
}

// ─── Reviser Node ─────────────────────────────────────────────────────────────

export async function reviserNode(
  state: NewsletterState,
  config?: RunnableConfig
): Promise<Partial<NewsletterState>> {
  if (!state.newsletter || !state.review) {
    return { errors: ["Reviser: missing newsletter or review"], status: "failed" };
  }

  emit(config, "progress", {
    step: "revising",
    message: `Revising newsletter (attempt ${state.revisionCount + 1}/${MAX_REVISIONS})...`,
  });

  const revised = await callGroqStructured(
    [
      { role: "system", content: REVISER_SYSTEM },
      {
        role: "user",
        content: buildReviserUser(
          state.newsletter.subject,
          state.newsletter.title,
          state.newsletter.introduction,
          state.newsletter.articles,
          state.newsletter.conclusion,
          state.review
        ),
      },
    ],
    RevisedNewsletterSchema,
    { temperature: 0.3 }
  );

  const revisedSummaries: ArticleSummary[] = revised.revisedArticles.map((a) => ({
    title: a.title,
    source: a.source,
    url: a.url,
    summary: a.summary,
    whyItMatters: a.whyItMatters,
  }));

  const revisedNewsletter: Newsletter = {
    subject: revised.subject,
    title: revised.title,
    introduction: revised.introduction,
    articles: revisedSummaries,
    conclusion: revised.conclusion,
    html: generateHTML(
      { subject: revised.subject, title: revised.title, introduction: revised.introduction, conclusion: revised.conclusion },
      revisedSummaries
    ),
    markdown: generateMarkdown(
      { subject: revised.subject, title: revised.title, introduction: revised.introduction, conclusion: revised.conclusion },
      revisedSummaries
    ),
    generatedAt: new Date().toISOString(),
  };

  emit(config, "progress", {
    step: "revising",
    message: `Revision complete. Changes: ${revised.changesDescription}`,
  });

  return {
    newsletter: revisedNewsletter,
    summaries: revisedSummaries,
    revisionCount: state.revisionCount + 1,
    status: "reviewing",
  };
}

// ─── Human Approval Node 2 (post-review) ─────────────────────────────────────

export async function humanApproval2Node(
  state: NewsletterState,
  _config?: RunnableConfig
): Promise<Partial<NewsletterState>> {
  const decision = interrupt({
    stage: "post_review",
    message: "Newsletter has passed quality review. Approve to generate output files.",
    newsletter: state.newsletter,
    review: state.review,
  });

  if (decision === "rejected") {
    return { status: "rejected", errors: ["Stage 2 rejected by user -output not generated."] };
  }

  return { status: "saving" };
}

// ─── Output Node ──────────────────────────────────────────────────────────────

export async function outputNode(
  state: NewsletterState,
  config?: RunnableConfig
): Promise<Partial<NewsletterState>> {
  if (!state.newsletter) {
    return { errors: ["Output: no newsletter to save"], status: "failed" };
  }

  emit(config, "progress", { step: "saving", message: "Saving output files..." });

  const { saveNewsletterFiles } = await import("./formatter.js");
  const outputFiles = await saveNewsletterFiles(state.newsletter);

  emit(config, "progress", {
    step: "saving",
    message: `Saved: ${outputFiles.join(", ")}`,
  });
  emit(config, "step_complete", { step: "saving" });

  return {
    outputFiles,
    status: "completed",
  };
}

// ─── Routing Functions ────────────────────────────────────────────────────────

/** After summarizer: route to humanApproval1 (human mode) or writer (auto). */
export function routeAfterSummarizer(state: NewsletterState): string {
  return state.mode === "human" ? "humanApproval1" : "writer";
}

/** After humanApproval1: route to writer unless rejected. */
export function routeAfterApproval1(state: NewsletterState): string {
  return state.status === "rejected" ? "__end__" : "writer";
}

/** After reviewer: revise, human-approve, or output. */
export function routeAfterReviewer(state: NewsletterState): string {
  const { review, revisionCount, mode } = state;
  if (!review) return "output";

  if (review.needsRevision && revisionCount < MAX_REVISIONS) {
    return "reviser";
  }

  return mode === "human" ? "humanApproval2" : "output";
}

/** After humanApproval2: route to output unless rejected. */
export function routeAfterApproval2(state: NewsletterState): string {
  return state.status === "rejected" ? "__end__" : "output";
}
