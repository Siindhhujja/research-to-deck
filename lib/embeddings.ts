import { getGemini, GEMINI_EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from "./gemini";

const BATCH_SIZE = 32;

/** Embeds a batch of strings, preserving input order. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const ai = getGemini();
  const out: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await ai.models.embedContent({
      model: GEMINI_EMBEDDING_MODEL,
      contents: batch,
      config: { outputDimensionality: EMBEDDING_DIMENSIONS },
    });
    if (!res.embeddings) {
      throw new Error("Gemini embedContent returned no embeddings");
    }
    out.push(...res.embeddings.map((e) => e.values!));
  }
  return out;
}

export async function embedText(text: string): Promise<number[]> {
  const [embedding] = await embedTexts([text]);
  return embedding;
}
