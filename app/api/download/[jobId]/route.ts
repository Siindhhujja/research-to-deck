import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { getJobRecord } from "@/lib/jobs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const job = await getJobRecord(jobId);

  if (!job || job.status !== "done" || !job.filePath) {
    return NextResponse.json({ error: "Deck not ready" }, { status: 404 });
  }

  const buffer = await readFile(job.filePath);
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${jobId}.pptx"`,
    },
  });
}
