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

/**
 * Fetches papers for `topic` from OpenAlex, extracts text
 * (full PDF where available, abstract otherwise), chunks, embeds, and
 * upserts everything into Postgres/pgvector.
 */
export async function ingestTopic(topic: string, targetPaperCount = 50): Promise<IngestResult> {
  const papers = await searchPapers(topic, targetPaperCount);
  const pool = getPool();

  let chunkCount = 0;
  let ingestedPapers = 0;

  for (const paper of papers) {
    const text = await extractPaperText(paper);
    if (!text || text.trim().length < 50) continue; // skip papers with no usable text

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

      const chunks = chunkText(text);
      if (chunks.length > 0) {
        const embeddings = await embedTexts(chunks);
        for (let i = 0; i < chunks.length; i++) {
          await client.query(
            `INSERT INTO chunks (paper_id, chunk_index, content, embedding)
             VALUES ($1, $2, $3, $4)`,
            [paper.paperId, i, chunks[i], toSql(embeddings[i])]
          );
        }
        chunkCount += chunks.length;
      }

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
