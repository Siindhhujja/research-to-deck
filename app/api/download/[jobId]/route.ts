import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { getJobRecord } from "@/lib/jobs";

const PPTX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const job = await getJobRecord(jobId);

  if (!job || job.status !== "done" || !job.filePath) {
    return NextResponse.json({ error: "Deck not ready" }, { status: 404 });
  }

  const isRemote = job.filePath.startsWith("http://") || job.filePath.startsWith("https://");
  const buffer = isRemote
    ? Buffer.from(await (await fetch(job.filePath)).arrayBuffer())
    : await readFile(job.filePath);

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": PPTX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${jobId}.pptx"`,
    },
  });
}
