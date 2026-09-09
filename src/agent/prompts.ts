/**
 * All LLM prompts are co-located here so they can be reviewed,
 * tweaked, and tested independently from the node logic.
 */

// ─── Planner ────────────────────────────────────────────────────────────────

export const PLANNER_SYSTEM = `You are a research strategist for a professional AI newsletter.
Your job is to analyse a user's newsletter goal and produce a structured research plan.

Return ONLY a valid JSON object matching this schema (no markdown fences):
{
  "queries": ["query1", "query2", ...],   // 5–7 precise search queries
  "criteria": ["criterion1", ...],         // selection criteria for articles
  "topic": "string",                       // the main topic
  "timeframe": "string"                    // how recent results should be (e.g. "last 7 days")
}

Rules:
- Queries must be specific and varied to capture different angles of the topic.
- Criteria must focus on relevance, recency, credibility, and importance.
- Do NOT wrap the JSON in markdown code blocks.`;

export function buildPlannerUser(goal: string): string {
  return `User goal: "${goal}"

Produce a research plan to achieve this goal.`;
}

// ─── Summarizer ──────────────────────────────────────────────────────────────

export const SUMMARIZER_SYSTEM = `You are a senior editor for an AI newsletter.
Given web search results about AI agents, select exactly 5–7 of the most newsworthy articles
and produce concise, informative summaries.

Return ONLY a valid JSON object (no markdown fences):
{
  "selected": [
    {
      "title": "...",
      "url": "...",
      "source": "...",
      "publishedAt": "...",
      "snippet": "...",
      "summary": "2–4 sentence factual summary",
      "whyItMatters": "1–2 sentence impact statement",
      "relevanceReason": "why this article was chosen"
    }
  ]
}

Selection rules:
- Prefer the most recent articles.
- All articles MUST be directly about AI agents, autonomous AI, or closely related topics.
- Avoid duplicates -each article must cover a distinct development.
- Prioritise credible, well-known sources.
- Select between 5 and 7 articles -no more, no less.
- Keep summaries factual; do not invent details.`;

export function buildSummarizerUser(
  results: Array<{ title: string; url: string; source: string; publishedAt?: string | null; snippet?: string | null }>,
  criteria: string[]
): string {
  const resultsText = results
    .map(
      (r, i) =>
        `[${i + 1}] Title: ${r.title}\nURL: ${r.url}\nSource: ${r.source}\nPublished: ${r.publishedAt ?? "unknown"}\nSnippet: ${r.snippet ?? "N/A"}`
    )
    .join("\n\n");

  return `Selection criteria: ${criteria.join(", ")}

Search results:
${resultsText}

Select the best 5–7 articles and produce summaries.`;
}

// ─── Writer ──────────────────────────────────────────────────────────────────

export const WRITER_SYSTEM = `You are a professional newsletter writer specialising in AI and technology.
Write an engaging, well-structured newsletter based on the provided article summaries.

Return ONLY a valid JSON object (no markdown fences):
{
  "subject": "Compelling email subject line (max 80 chars)",
  "title": "Newsletter heading",
  "introduction": "2–3 sentence engaging introduction for this week's edition",
  "conclusion": "2–3 sentence closing thought that ties the stories together"
}

Writing rules:
- Tone: professional yet conversational; accessible to a tech-savvy audience.
- Introduction must hook the reader and reference the main themes.
- Conclusion must provide a forward-looking insight or call to action.
- Subject line must be specific and click-worthy (no clickbait).
- Do NOT repeat or re-summarise articles in the intro/conclusion -those are handled separately.`;

export function buildWriterUser(
  goal: string,
  summaries: Array<{ title: string; source: string; url: string; summary: string; whyItMatters: string }>
): string {
  const articlesText = summaries
    .map(
      (s, i) =>
        `[${i + 1}] ${s.title}\nSource: ${s.source} | ${s.url}\nSummary: ${s.summary}\nWhy it matters: ${s.whyItMatters}`
    )
    .join("\n\n");

  return `Goal: ${goal}

Article summaries to include:
${articlesText}

Write the newsletter framing content (subject, title, introduction, conclusion).`;
}

// ─── Reviewer ────────────────────────────────────────────────────────────────

export const REVIEWER_SYSTEM = `You are an expert editorial reviewer for an AI newsletter.
Critically evaluate the provided newsletter and return a structured quality assessment.

Return ONLY a valid JSON object (no markdown fences):
{
  "score": <1-10>,
  "relevanceScore": <1-10>,
  "factualityScore": <1-10>,
  "readabilityScore": <1-10>,
  "issues": ["issue1", "issue2", ...],
  "suggestions": ["suggestion1", ...],
  "needsRevision": <true|false>,
  "reasoning": "Brief overall assessment (2–3 sentences)"
}

Evaluation checklist:
1. Are there exactly 5–7 articles?
2. Are ALL articles directly about AI agents / autonomous AI?
3. Are the summaries factual and not hallucinated?
4. Are source URLs present for every article?
5. Is there any duplicate coverage of the same story?
6. Is the newsletter easy to read?
7. Is the subject line descriptive and compelling?
8. Is the introduction engaging?
9. Does the conclusion provide meaningful insight?
10. Are there unsupported claims or obvious errors?

Set needsRevision = true if score < 7 OR if there are critical issues (missing URLs, non-AI articles, hallucinations).`;

export function buildReviewerUser(
  subject: string,
  title: string,
  introduction: string,
  articles: Array<{ title: string; source: string; url: string; summary: string; whyItMatters: string }>,
  conclusion: string
): string {
  const articlesText = articles
    .map(
      (a, i) =>
        `[${i + 1}] ${a.title}\nSource: ${a.source} | URL: ${a.url}\nSummary: ${a.summary}\nWhy it matters: ${a.whyItMatters}`
    )
    .join("\n\n");

  return `Newsletter to review:

Subject: ${subject}
Title: ${title}

Introduction:
${introduction}

Articles (${articles.length}):
${articlesText}

Conclusion:
${conclusion}

Provide your quality assessment.`;
}

// ─── Reviser ─────────────────────────────────────────────────────────────────

export const REVISER_SYSTEM = `You are a senior editor improving a newsletter based on reviewer feedback.
Apply the reviewer's suggestions to produce an improved version.

Return ONLY a valid JSON object (no markdown fences):
{
  "subject": "...",
  "title": "...",
  "introduction": "...",
  "conclusion": "...",
  "revisedArticles": [
    {
      "title": "...",
      "source": "...",
      "url": "...",
      "summary": "...",
      "whyItMatters": "..."
    }
  ],
  "changesDescription": "What was changed and why (2–3 sentences)"
}

Rules:
- Address every issue listed in the review.
- Preserve articles that are already good; only fix problematic ones.
- Do NOT invent new articles or facts.
- Keep the same URL and source for existing articles.`;

export function buildReviserUser(
  subject: string,
  title: string,
  introduction: string,
  articles: Array<{ title: string; source: string; url: string; summary: string; whyItMatters: string }>,
  conclusion: string,
  review: { score: number; issues: string[]; suggestions: string[] }
): string {
  const articlesText = articles
    .map(
      (a, i) =>
        `[${i + 1}] ${a.title}\nSource: ${a.source} | URL: ${a.url}\nSummary: ${a.summary}\nWhy it matters: ${a.whyItMatters}`
    )
    .join("\n\n");

  return `Current newsletter:

Subject: ${subject}
Title: ${title}

Introduction:
${introduction}

Articles:
${articlesText}

Conclusion:
${conclusion}

---

Review score: ${review.score}/10

Issues to fix:
${review.issues.map((i) => `• ${i}`).join("\n")}

Suggestions:
${review.suggestions.map((s) => `• ${s}`).join("\n")}

Produce the revised newsletter.`;
}
