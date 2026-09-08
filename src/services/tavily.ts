import { tavily } from "@tavily/core";
import "dotenv/config";

const tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY ?? "" });

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
  publishedDate?: string;
}

export interface TavilySearchResponse {
  results: TavilyResult[];
  query: string;
}

/**
 * Search the web using Tavily with advanced depth for richer snippets.
 */
export async function searchWeb(
  query: string,
  maxResults = 10
): Promise<TavilySearchResponse> {
  const response = await tavilyClient.search(query, {
    searchDepth: "advanced",
    maxResults,
    includeAnswer: false,
    includeRawContent: false,
  });

  return {
    query,
    results: response.results.map((r) => ({
      title: r.title,
      url: r.url,
      content: r.content,
      score: r.score,
      publishedDate: (r as { published_date?: string }).published_date,
    })),
  };
}
