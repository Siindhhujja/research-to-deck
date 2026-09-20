# Architecture

## Why this shape

Vercel's serverless functions (which host the Next.js API routes) cannot run
a long-lived BullMQ worker or invoke Python/python-pptx natively — functions
are short-lived and the deployment has no Python runtime alongside Node.
So the system is split into two independently-deployable pieces:

1. **Next.js app** (deployable to Vercel) — owns the HTTP surface only:
   `POST /api/generate` enqueues a job and returns immediately;
   `GET /api/generate/[jobId]` reports status; `GET /api/download/[jobId]`
   streams the finished file. It never runs the pipeline itself.
2. **Worker process** (`worker/index.ts`, run with `npm run worker`) — a
   long-running Node process that consumes the BullMQ queue and executes
   the full pipeline: ingestion, RAG, synthesis, and PPTX assembly. This
   must run somewhere with a persistent process and a Python interpreter —
   locally for development, or on a container host (Railway, Render, Fly.io,
   a Docker container, etc.) for production. It is intentionally *not* a
   Vercel serverless/edge function.

   This project's deployment avoids paying for an always-on host by
   running the worker as a **GitHub Actions job** instead: `worker/run-once.ts`
   (`npm run worker:once`) behaves like `worker/index.ts` but exits once the
   BullMQ queue has been idle for a few seconds, or if no job shows up within
   a startup grace window. `.github/workflows/worker.yml` runs it on
   `workflow_dispatch`, which `lib/triggerWorker.ts` fires right after
   `POST /api/generate` enqueues a job — so a GitHub Actions runner spins up,
   drains the queue, and shuts down, rather than a container idling 24/7.

Both processes talk to the same Postgres (pgvector) and Redis instances and
share code in `lib/`.

## Why Node for the pipeline, Python only for slide rendering

Every step — OpenAlex calls, PDF text extraction, chunking,
embeddings, pgvector queries, Claude calls, BullMQ — has a solid, idiomatic
Node/TypeScript path, and keeping the whole pipeline in one language avoids
a second process boundary for every step. **python-pptx has no Node
equivalent**, so that one step (`scripts/build_deck.py`) is the only place
Python appears. The worker calls it as a subprocess, handing it a JSON file
(the synthesis output) and getting back a `.pptx` file path.

## Why Google Gemini for everything

Both text generation (query expansion + synthesis, `lib/gemini.ts` +
`lib/rag.ts` + `lib/synthesize.ts`) and embeddings (`lib/embeddings.ts`) run
on Google Gemini — one provider, one free API key
(https://aistudio.google.com/apikey, no card required), instead of Claude
for generation and OpenAI for embeddings. `gemini-embedding-001` supports
configurable output dimensionality (Matryoshka representation learning), so
`lib/gemini.ts` pins it to 1536 dimensions to match the `vector(1536)`
column in `db/schema.sql` without needing a schema change. Swapping to a
different embedding provider only requires changing `lib/embeddings.ts` and
that column dimension to match the new model's output size.

## Multi-query RAG + re-ranking

`lib/rag.ts` asks Claude for 3 alternate phrasings of the topic (covering
methodology / results / applications / limitations angles), embeds and
retrieves the top-K chunks per phrasing independently from pgvector, then
merges the ranked lists with **Reciprocal Rank Fusion** (RRF) — chunks that
rank well across multiple query angles float to the top, rather than
over-indexing on whichever single query happened to match best.

## Citation traceability

`lib/synthesize.ts` requires Claude to attach a `paperId` to every bullet,
and hard-validates that every returned `paperId` was actually present in
the retrieved chunk set — if Claude cites something outside that set, the
job fails loudly instead of producing an untraceable deck. `references` are
then derived directly from the set of cited `paperId`s, so the PPTX
references slide and each bullet's `[n]` marker are generated from the same
source of truth.

## Storage

Generated `.pptx` files are uploaded to Vercel Blob (`lib/storage.ts`'s
`saveDeck`, via `@vercel/blob`'s `put()`), and the returned public URL is
stored in the `jobs.file_path` column. `/api/download/[jobId]` fetches from
that URL and streams it back with the right `Content-Type`/
`Content-Disposition` headers, rather than redirecting, so the browser gets
a clean download regardless of where the blob lives. This is required
because the API (Vercel) and the worker (GitHub Actions) run on different
hosts and don't share a filesystem. If `BLOB_READ_WRITE_TOKEN` isn't set —
e.g. local dev without a linked Blob store — `saveDeck` falls back to
writing under `GENERATED_DIR` on local disk.

## Job state

Job status lives in a small `jobs` table in Postgres (not solely in BullMQ),
so `GET /api/generate/[jobId]` can report `queued | running | done | failed`,
an error message, and a download link without needing direct Redis/BullMQ
access from the Vercel-hosted API route.
