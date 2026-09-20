const API_BASE = "https://api.openalex.org";

export interface OpenAlexPaper {
  paperId: string;
  title: string;
  abstract: string | null;
  year: number | null;
  venue: string | null;
  url: string | null;
  authors: { name: string }[];
  openAccessPdf: { url: string } | null;
}

interface OpenAlexWork {
  id: string;
  title: string | null;
  display_name: string | null;
  abstract_inverted_index: Record<string, number[]> | null;
  publication_year: number | null;
  doi: string | null;
  primary_location: {
    source?: { display_name: string | null } | null;
    landing_page_url?: string | null;
  } | null;
  authorships: { author: { display_name: string } }[];
  open_access: { oa_url: string | null } | null;
  best_oa_location: { pdf_url: string | null } | null;
}

const SELECT = [
  "id",
  "title",
  "display_name",
  "abstract_inverted_index",
  "publication_year",
  "doi",
  "primary_location",
  "authorships",
  "open_access",
  "best_oa_location",
].join(",");

/**
 * OpenAlex stores abstracts as a word → positions inverted index (to keep
 * response sizes small). Rebuild the plain-text abstract from it.
 */
function reconstructAbstract(index: Record<string, number[]> | null): string | null {
  if (!index) return null;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const pos of positions) words[pos] = word;
  }
  const text = words.filter((w) => w !== undefined).join(" ");
  return text.trim().length > 0 ? text : null;
}

function toPaper(work: OpenAlexWork): OpenAlexPaper {
  const doi = work.doi?.replace(/^https?:\/\/doi\.org\//, "") ?? null;
  return {
    paperId: work.id.replace("https://openalex.org/", ""),
    title: work.title ?? work.display_name ?? "Untitled",
    abstract: reconstructAbstract(work.abstract_inverted_index),
    year: work.publication_year,
    venue: work.primary_location?.source?.display_name ?? null,
    url: doi ? `https://doi.org/${doi}` : work.primary_location?.landing_page_url ?? work.id,
    authors: (work.authorships ?? []).map((a) => ({ name: a.author.display_name })),
    openAccessPdf: work.best_oa_location?.pdf_url
      ? { url: work.best_oa_location.pdf_url }
      : work.open_access?.oa_url
        ? { url: work.open_access.oa_url }
        : null,
  };
}

function buildUrl(topic: string, cursor: string, pageSize: number): URL {
  const url = new URL(`${API_BASE}/works`);
  url.searchParams.set("search", topic);
  url.searchParams.set("per-page", String(pageSize));
  url.searchParams.set("cursor", cursor);
  url.searchParams.set("select", SELECT);
  // OpenAlex's "polite pool" gives faster, more consistent rate limits to
  // requests that identify a contact email — no API key required.
  const mailto = process.env.OPENALEX_MAILTO;
  if (mailto) url.searchParams.set("mailto", mailto);
  return url;
}

/**
 * Fetches up to `limit` papers matching `topic` via OpenAlex's cursor
 * pagination (works reliably past the offset-based 10k-result cap).
 */
export async function searchPapers(topic: string, limit = 50): Promise<OpenAlexPaper[]> {
  const results: OpenAlexPaper[] = [];
  let cursor = "*";
  const pageSize = 100;

  while (results.length < limit && cursor) {
    const url = buildUrl(topic, cursor, Math.min(pageSize, limit - results.length));

    const res = await fetch(url);
    if (res.status === 429) {
      // Rate limited — back off and retry once.
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    if (!res.ok) {
      throw new Error(`OpenAlex search failed: ${res.status} ${await res.text()}`);
    }

    const body = (await res.json()) as {
      results?: OpenAlexWork[];
      meta?: { next_cursor?: string | null };
    };
    const page = body.results ?? [];
    if (page.length === 0) break;

    results.push(...page.map(toPaper));
    cursor = body.meta?.next_cursor ?? "";
  }

  return results.slice(0, limit);
}

/**
 * Downloads the PDF for a paper if an open-access URL is available.
 * Returns null when no open-access PDF exists (caller should fall back
 * to the abstract).
 */
export async function fetchPdfBuffer(paper: OpenAlexPaper): Promise<Buffer | null> {
  if (!paper.openAccessPdf?.url) return null;
  try {
    const res = await fetch(paper.openAccessPdf.url);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("pdf")) return null;
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}
