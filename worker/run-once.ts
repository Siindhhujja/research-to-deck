import "dotenv/config";
import { Worker, type Job } from "bullmq";
import { QUEUE_NAME, getRedisConnection, getDeckQueue, type DeckJobData } from "@/lib/queue";
import { updateJobStatus } from "@/lib/jobs";
import { runDeckPipeline } from "./pipeline";

/**
 * Entry point for running the worker as a one-shot GitHub Actions job
 * instead of a persistent process (see .github/workflows/worker.yml).
 * Behaves like worker/index.ts, but exits once the queue has been idle
 * for IDLE_EXIT_MS, or if no job ever shows up within STARTUP_GRACE_MS,
 * so each Actions run only bills for the time it's actually doing work.
 */

const IDLE_EXIT_MS = Number(process.env.WORKER_IDLE_EXIT_MS || 15_000);
const STARTUP_GRACE_MS = Number(process.env.WORKER_STARTUP_GRACE_MS || 30_000);

let idleTimer: NodeJS.Timeout | null = null;
let sawWork = false;
let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("Shutting down worker.");
  await worker.close();
  process.exit(0);
}

async function scheduleExitIfIdle() {
  const queue = getDeckQueue();
  const [waiting, active, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getDelayedCount(),
  ]);

  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  if (waiting + active + delayed === 0) {
    idleTimer = setTimeout(() => {
      console.log("Queue idle.");
      void shutdown();
    }, IDLE_EXIT_MS);
  }
}

const worker = new Worker<DeckJobData>(
  QUEUE_NAME,
  async (job: Job<DeckJobData>) => {
    sawWork = true;
    console.log(`▶ Processing job ${job.id} — topic: "${job.data.topic}"`);
    await runDeckPipeline(job.id!, job.data.topic);
    console.log(`✅ Job ${job.id} complete`);
  },
  { connection: getRedisConnection(), concurrency: 1 }
);

worker.on("completed", () => void scheduleExitIfIdle());
worker.on("failed", async (job, err) => {
  console.error(`❌ Job ${job?.id} failed:`, err.message);
  if (job?.id) await updateJobStatus(job.id, "failed", { error: err.message });
  await scheduleExitIfIdle();
});

console.log(`Worker (run-once mode) listening on queue "${QUEUE_NAME}"`);

setTimeout(() => {
  if (!sawWork) {
    console.log("No job appeared within the startup grace window.");
    void shutdown();
  }
}, STARTUP_GRACE_MS);
