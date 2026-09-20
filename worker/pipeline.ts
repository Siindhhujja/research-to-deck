import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { ingestTopic } from "@/lib/ingest";
import { retrieveTopChunks } from "@/lib/rag";
import { synthesizeSlides } from "@/lib/synthesize";
import { saveDeck } from "@/lib/storage";
import { updateJobStatus } from "@/lib/jobs";

const THEME_PATH = join(process.cwd(), "lib", "theme.json");

function runPython(args: string[]): Promise<string> {
  const pythonBin = process.env.PYTHON_BIN || "python";
  return new Promise((resolve, reject) => {
    const proc = spawn(pythonBin, args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`build_deck.py exited with code ${code}: ${stderr}`));
    });
  });
}

/**
 * Full pipeline for one job: ingest papers for the topic, retrieve +
 * re-rank the highest-signal chunks, synthesize a cited slide outline,
 * render it to a branded .pptx via the Python step, and persist the
 * result. Updates the jobs table at each stage so the status endpoint
 * reflects real progress.
 */
export async function runDeckPipeline(jobId: string, topic: string): Promise<string> {
  await updateJobStatus(jobId, "running");

  const { paperCount } = await ingestTopic(topic);
  await updateJobStatus(jobId, "running", { paperCount });

  const chunks = await retrieveTopChunks(topic);
  if (chunks.length === 0) {
    throw new Error("RAG retrieval returned no chunks — ingestion may have failed silently");
  }

  const synthesis = await synthesizeSlides(topic, chunks);

  const workDir = await mkdtemp(join(tmpdir(), "deck-"));
  const synthesisPath = join(workDir, "synthesis.json");
  const outputPath = join(workDir, "deck.pptx");
  await writeFile(synthesisPath, JSON.stringify(synthesis, null, 2), "utf-8");

  try {
    await runPython(["scripts/build_deck.py", synthesisPath, THEME_PATH, outputPath]);
    const finalPath = await saveDeck(jobId, outputPath);
    await updateJobStatus(jobId, "done", { filePath: finalPath, paperCount });
    return finalPath;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
