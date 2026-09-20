import pdfParse from "pdf-parse";
import { getPool } from "@/db/client";
import { toSql } from "pgvector/pg";
import { searchPapers, fetchPdfBuffer, type OpenAlexPaper } from "./openAlex";
import { chunkText } from "./chunk";
import { embedTexts } from "./embeddings";

export interface IngestResult {
  topic: string;
  paperCount: number;
  chunkCount: number;
}

async function extractPaperText(paper: OpenAlexPaper): Promise<string> {
  const pdfBuffer = await fetchPdfBuffer(paper);
  if (pdfBuffer) {
    try {
      const parsed = await pdfParse(pdfBuffer);
      if (parsed.text && parsed.text.trim().length > 200) {
        return parsed.text;
      }
    } catch {
      // Fall through to abstract on parse failure.
    }
  }
  return paper.abstract ?? "";
}

interface ChunkedPaper {
  paper: OpenAlexPaper;
  chunks: string[];
}

// Gemini's free embedding tier caps out at 1000 requests/day, and a run
// that fully chunks 50 real papers can easily need more than that. Capping
// chunks per paper bounds worst-case embedding volume to
// targetPaperCount * MAX_CHUNKS_PER_PAPER, leaving headroom for retries and
// the multi-query retrieval embeddings in lib/rag.ts.
const MAX_CHUNKS_PER_PAPER = 12;

/**
 * Fetches papers for `topic` from OpenAlex, extracts text
 * (full PDF where available, abstract otherwise), chunks, embeds, and
 * upserts everything into Postgres/pgvector.
 *
 * If this exact topic string was already ingested (e.g. a repeat request),
 * skips straight to returning the existing counts instead of re-fetching
 * and re-embedding everything — both to avoid burning the daily embedding
 * quota twice for the same content, and because `chunks` has no unique
 * constraint on (paper_id, chunk_index), so re-ingesting would duplicate
 * rows rather than update them.
 */
export async function ingestTopic(topic: string, targetPaperCount = 50): Promise<IngestResult> {
  const pool = getPool();

  const existing = await pool.query<{ paper_count: string; chunk_count: string }>(
    `SELECT COUNT(DISTINCT p.id)::text AS paper_count, COUNT(c.id)::text AS chunk_count
     FROM papers p LEFT JOIN chunks c ON c.paper_id = p.id
     WHERE p.topic = $1`,
    [topic]
  );
  const existingPaperCount = Number(existing.rows[0].paper_count);
  if (existingPaperCount >= 5) {
    return {
      topic,
      paperCount: existingPaperCount,
      chunkCount: Number(existing.rows[0].chunk_count),
    };
  }

  const papers = await searchPapers(topic, targetPaperCount);

  // Extract + chunk text for every paper before embedding anything. This
  // lets every chunk from every paper go through embedTexts' batching in
  // one pass, instead of one embedding API call per paper — the free-tier
  // Gemini quota is per-minute and easy to trip with 50 back-to-back calls.
  const chunkedPapers: ChunkedPaper[] = [];
  for (const paper of papers) {
    const text = await extractPaperText(paper);
    if (!text || text.trim().length < 50) continue; // skip papers with no usable text
    const chunks = chunkText(text).slice(0, MAX_CHUNKS_PER_PAPER);
    if (chunks.length > 0) chunkedPapers.push({ paper, chunks });
  }

  const allChunks = chunkedPapers.flatMap((p) => p.chunks);
  const allEmbeddings = await embedTexts(allChunks);

  let chunkCount = 0;
  let ingestedPapers = 0;
  let cursor = 0;

  for (const { paper, chunks } of chunkedPapers) {
    const embeddings = allEmbeddings.slice(cursor, cursor + chunks.length);
    cursor += chunks.length;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO papers (id, topic, title, authors, year, venue, url, abstract)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET topic = EXCLUDED.topic`,
        [
          paper.paperId,
          topic,
          paper.title,
          paper.authors.map((a) => a.name),
          paper.year,
          paper.venue,
          paper.url,
          paper.abstract,
        ]
      );

      for (let i = 0; i < chunks.length; i++) {
        await client.query(
          `INSERT INTO chunks (paper_id, chunk_index, content, embedding)
           VALUES ($1, $2, $3, $4)`,
          [paper.paperId, i, chunks[i], toSql(embeddings[i])]
        );
      }
      chunkCount += chunks.length;

      await client.query("COMMIT");
      ingestedPapers++;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  if (ingestedPapers < 5) {
    throw new Error(
      `Only ${ingestedPapers} papers had usable text for topic "${topic}" — ` +
        `OpenAlex may not have enough open-access coverage for this topic.`
    );
  }

  return { topic, paperCount: ingestedPapers, chunkCount };
}
