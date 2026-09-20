# Research-to-Deck Generator

RAG over 50+ academic papers (via the OpenAlex API) → synthesized
findings → an auto-generated, branded `.pptx` deck with per-slide citations.
Turns ~3 days of manual literature research into a ~5-minute automated job.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for why the system is split into a
Next.js API (Vercel) and a separate long-running worker.

## What runs where

| Piece | Runs on | Notes |
|---|---|---|
| Next.js API + UI | **Vercel** (or `npm run dev` locally) | Only enqueues jobs and reports status/downloads. Never runs the pipeline itself. |
| Worker (`worker/index.ts`) | **Anywhere with a persistent process + Python** — local machine, a container, Railway/Render/Fly.io | Runs ingestion → RAG → synthesis → PPTX generation. Cannot run on Vercel serverless functions. |
| Postgres + pgvector | Docker locally, or any managed Postgres with the `vector` extension | Stores paper metadata, chunk embeddings, and job status. |
| Redis | Docker locally, or any managed Redis | Backs the BullMQ job queue. |

## Local setup

1. **Start Postgres (pgvector) and Redis:**
   ```
   docker compose up -d
   ```

2. **Install Node dependencies:**
   ```
   npm install
   ```

3. **Install the Python dependency for slide rendering:**
   ```
   pip install -r scripts/requirements.txt
   ```

4. **Configure environment variables:**
   ```
   cp .env.example .env
   ```
   Fill in `GEMINI_API_KEY` (Google Gemini — used for query expansion,
   synthesis, AND embeddings; free tier, no card required, from
   https://aistudio.google.com/apikey). `OPENALEX_MAILTO` is optional —
   OpenAlex needs no API key, but setting a contact email joins its "polite
   pool" for faster, more consistent rate limits. Defaults for
   `DATABASE_URL`/`REDIS_URL` match the Docker Compose services above.

5. **Run the database migration** (creates `papers`, `chunks`, `jobs`, and
   enables the `vector` extension):
   ```
   npm run db:migrate
   ```

6. **Start the worker** (in its own terminal — this is the long-running
   process that actually does the work):
   ```
   npm run worker
   ```

7. **Start the Next.js app** (in another terminal):
   ```
   npm run dev
   ```
   Visit http://localhost:3000, enter a topic, and click Generate.

## Verifying the full pipeline end to end

Two ways to check everything works:

**A — through the UI/API (exercises the queue + worker):**
Start both `npm run worker` and `npm run dev`, submit a topic at
`http://localhost:3000`, and watch the status move
`queued → running → done`, then download the `.pptx`.

**B — direct pipeline smoke test (skips the queue, fastest signal):**
```
npm run test:pipeline -- "retrieval-augmented generation evaluation"
```
This runs ingestion → RAG → synthesis → PPTX generation in one process and
writes `generated/smoke-test.pptx`. It prints paper/chunk/slide/reference
counts at each stage and fails loudly if any step (including citation
validation) doesn't hold up.

Open the resulting `.pptx` and confirm: a title slide, several content
slides each with `[n]`-style citation markers and speaker notes, and a
references slide where every `[n]` in the deck resolves to a real cited
paper.

## API reference

- `POST /api/generate` — body `{ "topic": string }` → `202 { "jobId": string }`
- `GET /api/generate/:jobId` → `{ status, error, paperCount, downloadUrl }`
- `GET /api/download/:jobId` → streams the `.pptx` once `status` is `"done"`

## Deploying

This is deployed as three independent pieces, none of which need a paid
plan or a card on file:

- **Vercel** — the Next.js app. Needs `DATABASE_URL`, `REDIS_URL`, and
  `BLOB_READ_WRITE_TOKEN` (from a linked Vercel Blob store) as project env
  vars, plus `GH_WORKFLOW_TOKEN`/`GH_WORKFLOW_REPO` so it can trigger the
  worker (see below). `DATABASE_URL`/`REDIS_URL` point at managed
  Postgres+pgvector (this project uses Neon) and Redis (Upstash, via
  Vercel's own storage integration) reachable from Vercel.
- **GitHub Actions** — the worker. `.github/workflows/worker.yml` runs
  `npm run worker:once` (see ARCHITECTURE.md for why the worker can't run
  on Vercel itself), triggered via `workflow_dispatch` right after
  `POST /api/generate` enqueues a job (`lib/triggerWorker.ts`), and exits
  once the queue goes idle so each run only bills Actions minutes for
  actual work. Needs repo secrets: `DATABASE_URL`, `REDIS_URL`,
  `GEMINI_API_KEY`, `OPENALEX_MAILTO`, `BLOB_READ_WRITE_TOKEN`.
- **Vercel Blob** — generated `.pptx` files. `lib/storage.ts` uploads there
  (falling back to local disk if `BLOB_READ_WRITE_TOKEN` isn't set, e.g. in
  local dev), since the Vercel API and the GitHub Actions worker don't
  share a filesystem.
