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

## Why OpenAI for embeddings

Claude does not expose a first-party embeddings API. `text-embedding-3-small`
(1536 dimensions) was chosen as a small, cheap, widely-documented option that
pairs cleanly with `pgvector`. Swapping to a different embedding provider
only requires changing `lib/embeddings.ts` and the `vector(1536)` column
dimension in `db/schema.sql` to match the new model's output size.

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

Generated `.pptx` files are written to a local `GENERATED_DIR` and served by
`/api/download/[jobId]`, which requires the API and worker to share a
filesystem (true for local dev and for a single-container deployment). For a
production split where the API runs on Vercel and the worker runs elsewhere,
swap `lib/storage.ts`'s `saveDeck` for `@vercel/blob`'s `put()` and store the
returned URL in the `jobs.file_path` column instead of a local path — left
as a documented swap-in rather than wired up, since it requires a live
Vercel Blob token/project that this build doesn't have access to.

## Job state

Job status lives in a small `jobs` table in Postgres (not solely in BullMQ),
so `GET /api/generate/[jobId]` can report `queued | running | done | failed`,
an error message, and a download link without needing direct Redis/BullMQ
access from the Vercel-hosted API route.
