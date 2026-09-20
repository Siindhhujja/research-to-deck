import { GoogleGenAI } from "@google/genai";

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
