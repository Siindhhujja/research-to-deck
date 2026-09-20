/**
 * Splits text into overlapping word-based chunks. Word count is used as a
 * cheap proxy for token count (~0.75 tokens/word for English) to avoid an
 * extra tokenizer dependency.
 */
export function chunkText(text: string, chunkWords = 220, overlapWords = 40): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + chunkWords, words.length);
    chunks.push(words.slice(start, end).join(" "));
    if (end === words.length) break;
    start = end - overlapWords;
  }
  return chunks;
}
