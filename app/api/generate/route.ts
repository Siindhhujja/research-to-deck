import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDeckQueue } from "@/lib/queue";
import { createJobRecord, countJobsByEmail } from "@/lib/jobs";
import { triggerWorkerWorkflow } from "@/lib/triggerWorker";

const RequestSchema = z.object({
  topic: z.string().trim().min(3).max(300),
  email: z.string().trim().toLowerCase().email(),
});

/** Comma-separated emails exempt from the one-generation gate (e.g. the
 * project owner's own address, for testing/demoing without burning the
 * one-time allowance). Configured via env, not hardcoded. */
const UNLIMITED_EMAILS = new Set(
  (process.env.UNLIMITED_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

/**
 * Enqueues a deck-generation job and returns immediately with a jobId.
 * The actual pipeline (ingestion → RAG → synthesis → PPTX) runs
 * asynchronously in worker/index.ts, not in this request.
 *
 * Each email gets exactly one generation, ever — self-reported, not
 * verified, so it's a demand gate on the shared API quota rather than a
 * real identity check.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { topic, email } = parsed.data;

  const priorCount = UNLIMITED_EMAILS.has(email) ? 0 : await countJobsByEmail(email);
  if (priorCount > 0) {
    return NextResponse.json(
      { error: "This email has already used its one free deck generation." },
      { status: 403 }
    );
  }

  const queue = getDeckQueue();
  const job = await queue.add("generate-deck", { topic });
  await createJobRecord(job.id!, topic, email);
  await triggerWorkerWorkflow();

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
