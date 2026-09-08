import Groq from "groq-sdk";
import { z } from "zod";
import "dotenv/config";

const groqClient = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export const MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";

export interface GroqMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Call Groq and return the raw text response.
 */
export async function callGroq(
  messages: GroqMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const { temperature = 0.1, maxTokens = 4096 } = options;

  const completion = await groqClient.chat.completions.create({
    messages,
    model: MODEL,
    temperature,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Groq returned an empty response");
  }
  return content;
}

/**
 * Call Groq and validate the JSON response against a Zod schema.
 * Throws a descriptive error if parsing or validation fails.
 */
export async function callGroqStructured<T extends z.ZodTypeAny>(
  messages: GroqMessage[],
  schema: T,
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<z.infer<T>> {
  const raw = await callGroq(messages, options);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Groq returned invalid JSON:\n${raw.slice(0, 500)}`);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
    throw new Error(`Groq response failed Zod validation: ${errors}\nRaw: ${raw.slice(0, 500)}`);
  }

  return result.data;
}
