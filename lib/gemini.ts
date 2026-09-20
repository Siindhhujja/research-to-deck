import { ApiError, GoogleGenAI } from "@google/genai";

let client: GoogleGenAI | null = null;

export function getGemini(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
export const GEMINI_EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";

// gemini-embedding-001 supports configurable output dimensionality (768/1536/3072)
// via Matryoshka representation learning — pinned to 1536 to match the
// `vector(1536)` column in db/schema.sql.
export const EMBEDDING_DIMENSIONS = 1536;

const RETRY_DELAYS_MS = [2000, 5000, 10000, 20000, 30000];

/**
 * Retries a Gemini call with backoff on 429 (RESOURCE_EXHAUSTED) responses.
 * The free tier's per-minute quota is easy to trip with back-to-back calls
 * and recovers within seconds, so a short backoff loop turns transient
 * rate-limit errors into a brief pause instead of failing the whole job.
 *
 * A per-*day* quota (quotaId containing "PerDay") won't recover within any
 * reasonable backoff window, so those fail fast with a clear message
 * instead of burning ~70s of retries per call for no benefit.
 */
export async function withGeminiRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 429) throw err;
      if (/PerDay/i.test(err.message)) {
        throw new Error(
          "Gemini free-tier daily quota is exhausted for today (resets ~24h from when it was " +
            `first hit). Original error: ${err.message}`
        );
      }
      if (attempt >= RETRY_DELAYS_MS.length) throw err;
      const delay = RETRY_DELAYS_MS[attempt];
      console.warn(`Gemini rate limit hit — retrying in ${delay}ms (attempt ${attempt + 1})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
