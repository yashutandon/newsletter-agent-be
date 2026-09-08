import { z } from "zod";

// ─── Research Plan ──────────────────────────────────────────────────────────
export const ResearchPlanSchema = z.object({
  queries: z.array(z.string()).min(3).max(8).describe("Search queries to execute"),
  criteria: z.array(z.string()).describe("Criteria for article selection"),
  topic: z.string().describe("Main topic of the newsletter"),
  timeframe: z.string().describe("How recent articles should be, e.g. 'last 7 days'"),
});
export type ResearchPlan = z.infer<typeof ResearchPlanSchema>;

// ─── Article ─────────────────────────────────────────────────────────────────
export const ArticleSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  source: z.string(),
  publishedAt: z.string().optional(),
  snippet: z.string().optional(),
  fullText: z.string().optional(),
});
export type Article = z.infer<typeof ArticleSchema>;

// ─── Article Summary ─────────────────────────────────────────────────────────
export const ArticleSummarySchema = z.object({
  title: z.string(),
  source: z.string(),
  url: z.string().url(),
  summary: z.string().min(50),
  whyItMatters: z.string().min(20),
});
export type ArticleSummary = z.infer<typeof ArticleSummarySchema>;

// ─── Selected Articles Response ──────────────────────────────────────────────
export const SelectedArticlesResponseSchema = z.object({
  selected: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      source: z.string(),
      publishedAt: z.string().optional(),
      snippet: z.string().optional(),
      summary: z.string(),
      whyItMatters: z.string(),
      relevanceReason: z.string(),
    })
  ).min(5).max(7),
});

// ─── Newsletter ───────────────────────────────────────────────────────────────
export const NewsletterContentSchema = z.object({
  subject: z.string().describe("Email subject line"),
  title: z.string().describe("Newsletter title"),
  introduction: z.string().describe("2–3 sentence introduction"),
  conclusion: z.string().describe("2–3 sentence conclusion"),
});
export type NewsletterContent = z.infer<typeof NewsletterContentSchema>;

export interface Newsletter {
  subject: string;
  title: string;
  introduction: string;
  articles: ArticleSummary[];
  conclusion: string;
  html: string;
  markdown: string;
  generatedAt: string;
}

// ─── Review Result ───────────────────────────────────────────────────────────
export const ReviewResultSchema = z.object({
  score: z.number().min(1).max(10).describe("Overall quality score 1-10"),
  relevanceScore: z.number().min(1).max(10),
  factualityScore: z.number().min(1).max(10),
  readabilityScore: z.number().min(1).max(10),
  issues: z.array(z.string()).describe("List of identified issues"),
  suggestions: z.array(z.string()).describe("Concrete improvement suggestions"),
  needsRevision: z.boolean().describe("Whether the newsletter requires revision"),
  reasoning: z.string().describe("Brief overall assessment"),
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

// ─── Revised Newsletter ───────────────────────────────────────────────────────
export const RevisedNewsletterSchema = z.object({
  subject: z.string(),
  title: z.string(),
  introduction: z.string(),
  conclusion: z.string(),
  revisedArticles: z.array(
    z.object({
      title: z.string(),
      source: z.string(),
      url: z.string(),
      summary: z.string(),
      whyItMatters: z.string(),
    })
  ),
  changesDescription: z.string().describe("What was changed and why"),
});
