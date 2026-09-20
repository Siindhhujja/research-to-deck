import { getClaude, CLAUDE_MODEL, textFromMessage } from "./claude";
import type { RetrievedChunk } from "./rag";

export interface Bullet {
  text: string;
  paperId: string; // must match a paperId present in the retrieved chunks
}

export interface Slide {
  title: string;
  bullets: Bullet[];
  speakerNotes: string;
}

export interface Reference {
  paperId: string;
  title: string;
  authors: string[];
  year: number | null;
  url: string | null;
}

export interface SynthesisResult {
  deckTitle: string;
  slides: Slide[];
  references: Reference[];
}

function buildSourceBlock(chunks: RetrievedChunk[]): string {
  return chunks
    .map(
      (c, i) =>
        `<source id="${i}" paperId="${c.paperId}" title="${c.title.replace(/"/g, "'")}" year="${c.year ?? "n/a"}">\n${c.content}\n</source>`
    )
    .join("\n\n");
}

const SYSTEM_PROMPT = `You are a research analyst producing a slide deck outline from literature-review excerpts.
Every bullet point you write MUST be grounded in one of the provided <source> blocks and MUST include that
source's exact paperId in the citation field. Never invent a paperId that is not present in the sources.
If you are not confident a claim is supported by a source, omit it rather than guessing.
Respond with ONLY a single JSON object matching this shape, no prose, no markdown fences:
{
  "deckTitle": string,
  "slides": [
    { "title": string, "bullets": [{ "text": string, "paperId": string }], "speakerNotes": string }
  ]
}
Produce between 6 and 10 content slides. Keep each bullet to one sentence.`;

/**
 * Turns re-ranked chunks into a structured slide outline. Every bullet
 * carries a paperId so citations can be traced back to a source paper.
 */
export async function synthesizeSlides(
  topic: string,
  chunks: RetrievedChunk[]
): Promise<SynthesisResult> {
  const claude = getClaude();
  const sourceBlock = buildSourceBlock(chunks);

  const message = await claude.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Topic: "${topic}"\n\nSources:\n\n${sourceBlock}`,
      },
    ],
  });

  const raw = textFromMessage(message);
  let parsed: { deckTitle: string; slides: Slide[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Synthesis step returned non-JSON output: ${raw.slice(0, 200)}`);
  }

  const validPaperIds = new Set(chunks.map((c) => c.paperId));
  const citedPaperIds = new Set<string>();

  for (const slide of parsed.slides) {
    for (const bullet of slide.bullets) {
      if (!validPaperIds.has(bullet.paperId)) {
        throw new Error(
          `Synthesis cited unknown paperId "${bullet.paperId}" not present in retrieved sources — ` +
            `refusing to build an untraceable deck.`
        );
      }
      citedPaperIds.add(bullet.paperId);
    }
  }

  const paperMeta = new Map(chunks.map((c) => [c.paperId, c]));
  const references: Reference[] = Array.from(citedPaperIds).map((paperId) => {
    const c = paperMeta.get(paperId)!;
    return { paperId, title: c.title, authors: c.authors, year: c.year, url: c.url };
  });

  return { deckTitle: parsed.deckTitle, slides: parsed.slides, references };
}
