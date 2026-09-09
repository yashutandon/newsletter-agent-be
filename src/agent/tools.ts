import axios from "axios";
import * as cheerio from "cheerio";
import { searchWeb } from "../services/tavily.js";
import type { Article } from "../schemas/newsletter.js";

/**
 * Execute a single Tavily search query and map results to Article objects.
 */
export async function webSearch(query: string): Promise<Article[]> {
  const response = await searchWeb(query, 10);

  return response.results.map((r) => ({
    title: r.title,
    url: r.url,
    source: extractDomain(r.url),
    publishedAt: r.publishedDate,
    snippet: r.content.slice(0, 500),
  }));
}

/**
 * Fetch the full text of an article URL.
 * Returns null on any failure -a single bad URL must not crash the workflow.
 */
export async function fetchArticle(url: string): Promise<string | null> {
  try {
    const response = await axios.get<string>(url, {
      timeout: 8000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; NewsletterBot/1.0; +https://example.com/bot)",
        Accept: "text/html,application/xhtml+xml",
      },
      maxRedirects: 5,
    });

    const $ = cheerio.load(response.data);

    // Remove noise elements
    $("script, style, nav, header, footer, aside, .ad, .ads, .advertisement").remove();

    // Try to extract the main article body
    const selectors = ["article", "main", ".article-body", ".post-content", ".entry-content"];
    let text = "";

    for (const selector of selectors) {
      const el = $(selector);
      if (el.length > 0) {
        text = el.text();
        break;
      }
    }

    // Fallback to all paragraph text
    if (!text) {
      text = $("p").text();
    }

    // Normalise whitespace and truncate to 3000 chars to avoid token overflow
    return text.replace(/\s+/g, " ").trim().slice(0, 3000) || null;
  } catch {
    // Silently discard -the caller will continue without this article's full text
    return null;
  }
}

/**
 * Deduplicate articles by URL -preserves first occurrence.
 */
export function deduplicateArticles(articles: Article[]): Article[] {
  const seen = new Set<string>();
  return articles.filter((a) => {
    if (seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });
}

/** Extract domain name from a URL for use as the source label. */
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}
