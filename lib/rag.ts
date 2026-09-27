import { getPool } from "@/db/client";
import { toSql } from "pgvector/pg";
import { embedText } from "./embeddings";
import { getGemini, GEMINI_MODEL, withGeminiRetry } from "./gemini";
import { rerankTexts } from "./rerank";

export interface RetrievedChunk {
  chunkId: number;
  paperId: string;
  content: string;
  title: string;
  year: number | null;
  url: string | null;
  authors: string[];
  score: number; // Voyage cross-encoder relevance score after re-ranking
}

const QUERY_VARIANTS = 4;
const TOP_K_PER_QUERY = 15;
const FINAL_TOP_N = 20;

// Voyage's free tier (no payment method on file) caps out at 10K tokens per
// *minute* — well under what deduping the full multi-query candidate pool
// (up to 60 chunks) would produce in a single rerank call. Capping here
// keeps a single call safely under that limit regardless of billing status.
const MAX_RERANK_CANDIDATES = 24;

/**
 * Asks Gemini for alternate phrasings of `topic` that would surface
 * different, complementary angles in a literature search (methodology,
 * results, applications, limitations, etc).
 */
async function generateQueryVariants(topic: string): Promise<string[]> {
  const ai = getGemini();
  const response = await withGeminiRetry(() =>
    ai.models.generateContent({
      model: GEMINI_MODEL,
      contents:
        `Generate ${QUERY_VARIANTS - 1} alternate search-query phrasings of the research topic ` +
        `below, each surfacing a different angle (e.g. methodology, results/findings, applications, ` +
        `limitations/critiques). Return ONLY a JSON array of strings, no other text.\n\n` +
        `Topic: "${topic}"`,
      config: {
        maxOutputTokens: 500,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 0 },
      },
    })
  );

  try {
    const variants = JSON.parse(response.text ?? "[]") as string[];
    return [topic, ...variants.filter((v) => typeof v === "string" && v.trim().length > 0)];
  } catch {
    return [topic];
  }
}

async function retrieveForQuery(
  query: string,
  topic: string,
  topK: number
): Promise<RetrievedChunk[]> {
  const embedding = await embedText(query);
  const pool = getPool();
  const res = await pool.query(
    `SELECT c.id AS chunk_id, c.paper_id, c.content, p.title, p.year, p.url, p.authors,
            (c.embedding <=> $1) AS distance
     FROM chunks c
     JOIN papers p ON p.id = c.paper_id
     WHERE p.topic = $2
     ORDER BY c.embedding <=> $1
     LIMIT $3`,
    [toSql(embedding), topic, topK]
  );

  return res.rows.map((row) => ({
    chunkId: row.chunk_id,
    paperId: row.paper_id,
    content: row.content,
    title: row.title,
    year: row.year,
    url: row.url,
    authors: row.authors,
    score: 0,
  }));
}

const RRF_K = 60; // standard RRF smoothing constant

/**
 * Reciprocal Rank Fusion: merges several ranked lists so chunks that rank
 * well across multiple query angles float to the top. Used as a free,
 * model-free fallback when no reranker API key is configured — it's a
 * heuristic inferred from rank position, not a real relevance judgment.
 */
function rrfFuse(rankLists: RetrievedChunk[][]): RetrievedChunk[] {
  const fused = new Map<number, { chunk: RetrievedChunk; score: number }>();

  for (const list of rankLists) {
    list.forEach((chunk, rank) => {
      const rrfScore = 1 / (RRF_K + rank + 1);
      const existing = fused.get(chunk.chunkId);
      if (existing) {
        existing.score += rrfScore;
      } else {
        fused.set(chunk.chunkId, { chunk, score: rrfScore });
      }
    });
  }

  return Array.from(fused.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, FINAL_TOP_N)
    .map(({ chunk, score }) => ({ ...chunk, score }));
}

/**
 * Multi-query RAG with cross-encoder re-ranking: run several query
 * variants independently through cheap pgvector search to cast a wide
 * net, then hand the deduplicated candidate pool to a Voyage cross-encoder
 * for a real relevance judgment against the original topic — a direct
 * (query, chunk) score, rather than inferring relevance from where cheap
 * vector search happened to rank something. Falls back to Reciprocal Rank
 * Fusion if VOYAGE_API_KEY isn't set, so retrieval still works without it.
 */
export async function retrieveTopChunks(topic: string): Promise<RetrievedChunk[]> {
  const queries = await generateQueryVariants(topic);
  // Sequential rather than Promise.all: each call embeds a query via
  // Gemini's free tier, and a burst of concurrent calls trips its
  // per-minute quota far more easily than the same calls spread out.
  const rankLists: RetrievedChunk[][] = [];
  for (const q of queries) {
    rankLists.push(await retrieveForQuery(q, topic, TOP_K_PER_QUERY));
  }

  if (!process.env.VOYAGE_API_KEY) {
    return rrfFuse(rankLists);
  }

  // The same chunk often surfaces for multiple query phrasings — dedupe by
  // chunkId, interleaving round-robin across query variants (rather than
  // draining one variant's list before the next) so every angle gets fair
  // representation once MAX_RERANK_CANDIDATES caps the pool.
  const seen = new Set<number>();
  const pool: RetrievedChunk[] = [];
  const maxListLength = Math.max(0, ...rankLists.map((list) => list.length));
  outer: for (let i = 0; i < maxListLength; i++) {
    for (const list of rankLists) {
      if (pool.length >= MAX_RERANK_CANDIDATES) break outer;
      const chunk = list[i];
      if (chunk && !seen.has(chunk.chunkId)) {
        seen.add(chunk.chunkId);
        pool.push(chunk);
      }
    }
  }

  const ranked = await rerankTexts(
    topic,
    pool.map((c) => c.content),
    FINAL_TOP_N
  );

  return ranked.map(({ index, relevanceScore }) => ({ ...pool[index], score: relevanceScore }));
}
