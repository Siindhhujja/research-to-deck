import { NextRequest, NextResponse } from "next/server";
import { getJobRecord } from "@/lib/jobs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const job = await getJobRecord(jobId);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({
    jobId: job.id,
    topic: job.topic,
    status: job.status,
    error: job.error,
    paperCount: job.paperCount,
    downloadUrl: job.status === "done" ? `/api/download/${job.id}` : null,
  });
}
