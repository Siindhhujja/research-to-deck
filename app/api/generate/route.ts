import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDeckQueue } from "@/lib/queue";
import { createJobRecord } from "@/lib/jobs";
import { triggerWorkerWorkflow } from "@/lib/triggerWorker";

const RequestSchema = z.object({
  topic: z.string().trim().min(3).max(300),
});

/**
 * Enqueues a deck-generation job and returns immediately with a jobId.
 * The actual pipeline (ingestion → RAG → synthesis → PPTX) runs
 * asynchronously in worker/index.ts, not in this request.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { topic } = parsed.data;
  const queue = getDeckQueue();
  const job = await queue.add("generate-deck", { topic });
  await createJobRecord(job.id!, topic);
  await triggerWorkerWorkflow();

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
