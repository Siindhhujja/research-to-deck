import { getPool } from "@/db/client";
import { toSql } from "pgvector/pg";
import { embedText } from "./embeddings";
import { getClaude, CLAUDE_MODEL, textFromMessage } from "./claude";

export interface RetrievedChunk {
  chunkId: number;
  paperId: string;
  content: string;
  title: string;
  year: number | null;
  url: string | null;
  authors: string[];
  score: number; // reciprocal-rank-fusion score after re-ranking
}

const QUERY_VARIANTS = 4;
const TOP_K_PER_QUERY = 15;
const FINAL_TOP_N = 20;

/**
 * Asks Claude for alternate phrasings of `topic` that would surface
 * different, complementary angles in a literature search (methodology,
 * results, applications, limitations, etc).
 */
async function generateQueryVariants(topic: string): Promise<string[]> {
  const claude = getClaude();
  const message = await claude.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content:
          `Generate ${QUERY_VARIANTS - 1} alternate search-query phrasings of the research topic ` +
          `below, each surfacing a different angle (e.g. methodology, results/findings, applications, ` +
          `limitations/critiques). Return ONLY a JSON array of strings, no other text.\n\n` +
          `Topic: "${topic}"`,
      },
    ],
  });

  try {
    const variants = JSON.parse(textFromMessage(message)) as string[];
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

/**
 * Multi-query RAG with Reciprocal Rank Fusion re-ranking: run several
 * query variants independently, then combine their rankings so chunks
 * that surface consistently across angles outrank one-off hits.
 */
export async function retrieveTopChunks(topic: string): Promise<RetrievedChunk[]> {
  const queries = await generateQueryVariants(topic);
  const rankLists = await Promise.all(
    queries.map((q) => retrieveForQuery(q, topic, TOP_K_PER_QUERY))
  );

  const RRF_K = 60; // standard RRF smoothing constant
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
