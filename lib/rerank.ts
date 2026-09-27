const VOYAGE_RERANK_MODEL = process.env.VOYAGE_RERANK_MODEL || "rerank-2-lite";
const RETRY_DELAYS_MS = [2000, 5000, 10000];

export interface RerankResult {
  index: number;
  relevanceScore: number;
}

/**
 * Cross-encoder reranking via Voyage AI: scores each document directly
 * against the query (a real relevance judgment), rather than inferring
 * relevance from where cheap vector search happened to rank it.
 */
export async function rerankTexts(
  query: string,
  documents: string[],
  topK: number
): Promise<RerankResult[]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error("VOYAGE_API_KEY is not set");

  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.voyageai.com/v1/rerank", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, documents, model: VOYAGE_RERANK_MODEL, top_k: topK }),
    });

    if (res.ok) {
      const data = (await res.json()) as { data: { index: number; relevance_score: number }[] };
      return data.data.map((d) => ({ index: d.index, relevanceScore: d.relevance_score }));
    }

    if (res.status !== 429 || attempt >= RETRY_DELAYS_MS.length) {
      throw new Error(`Voyage rerank failed: ${res.status} ${await res.text()}`);
    }
    const delay = RETRY_DELAYS_MS[attempt];
    console.warn(`Voyage rate limit hit — retrying in ${delay}ms (attempt ${attempt + 1})`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
