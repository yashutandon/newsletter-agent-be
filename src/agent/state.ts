import { Annotation } from "@langchain/langgraph";
import type { ResearchPlan, Article, ArticleSummary, Newsletter, ReviewResult } from "../schemas/newsletter.js";

export type AgentMode = "autonomous" | "human";

export type AgentStep =
  | "idle"
  | "planning"
  | "researching"
  | "summarizing"
  | "awaiting_approval_1"
  | "writing"
  | "reviewing"
  | "revising"
  | "awaiting_approval_2"
  | "saving"
  | "completed"
  | "failed"
  | "rejected";

// Re-export for convenience
export type { ResearchPlan, Article, ArticleSummary, Newsletter, ReviewResult };

/**
 * LangGraph state annotation -defines the shape of state that flows
 * through every node in the graph.
 */
export const NewsletterStateAnnotation = Annotation.Root({
  /** The plain-English goal entered by the user. */
  goal: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "",
  }),

  /** Execution mode: fully autonomous or human-in-the-loop. */
  mode: Annotation<AgentMode>({
    reducer: (_, y) => y,
    default: () => "autonomous",
  }),

  /** Structured research plan produced by the planner node. */
  plan: Annotation<ResearchPlan | null>({
    reducer: (_, y) => y,
    default: () => null,
  }),

  /** Search queries derived from the research plan. */
  searchQueries: Annotation<string[]>({
    reducer: (_, y) => y,
    default: () => [],
  }),

  /** Raw search results collected from Tavily. */
  searchResults: Annotation<Article[]>({
    reducer: (_, y) => y,
    default: () => [],
  }),

  /** Top 5–7 articles selected by the summarizer node. */
  selectedArticles: Annotation<Article[]>({
    reducer: (_, y) => y,
    default: () => [],
  }),

  /** Structured summaries for each selected article. */
  summaries: Annotation<ArticleSummary[]>({
    reducer: (_, y) => y,
    default: () => [],
  }),

  /** The generated newsletter (HTML + Markdown). */
  newsletter: Annotation<Newsletter | null>({
    reducer: (_, y) => y,
    default: () => null,
  }),

  /** Quality review produced by the reviewer node. */
  review: Annotation<ReviewResult | null>({
    reducer: (_, y) => y,
    default: () => null,
  }),

  /** Number of revision cycles completed. */
  revisionCount: Annotation<number>({
    reducer: (_, y) => y,
    default: () => 0,
  }),

  /** Current high-level status for UI display. */
  status: Annotation<AgentStep>({
    reducer: (_, y) => y,
    default: () => "idle",
  }),

  /** Accumulated non-fatal errors. */
  errors: Annotation<string[]>({
    reducer: (x, y) => [...x, ...y],
    default: () => [],
  }),

  /** Paths of saved output files. */
  outputFiles: Annotation<string[]>({
    reducer: (_, y) => y,
    default: () => [],
  }),

  /** Session ID used for SSE routing and human-in-the-loop resume. */
  sessionId: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "",
  }),
});

export type NewsletterState = typeof NewsletterStateAnnotation.State;
