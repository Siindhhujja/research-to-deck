import "dotenv/config";
import { Worker, type Job } from "bullmq";
import { QUEUE_NAME, getRedisConnection, type DeckJobData } from "@/lib/queue";
import { updateJobStatus } from "@/lib/jobs";
import { runDeckPipeline } from "./pipeline";

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY || 1);

const worker = new Worker<DeckJobData>(
  QUEUE_NAME,
  async (job: Job<DeckJobData>) => {
    console.log(`▶ Processing job ${job.id} — topic: "${job.data.topic}"`);
    await runDeckPipeline(job.id!, job.data.topic);
    console.log(`✅ Job ${job.id} complete`);
  },
  { connection: getRedisConnection(), concurrency: CONCURRENCY }
);

worker.on("failed", async (job, err) => {
  console.error(`❌ Job ${job?.id} failed:`, err.message);
  if (job?.id) {
    await updateJobStatus(job.id, "failed", { error: err.message });
  }
});

console.log(`Worker listening on queue "${QUEUE_NAME}" (concurrency=${CONCURRENCY})`);
