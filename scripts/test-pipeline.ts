import "dotenv/config";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ingestTopic } from "@/lib/ingest";
import { retrieveTopChunks } from "@/lib/rag";
import { synthesizeSlides } from "@/lib/synthesize";
import { getPool } from "@/db/client";

const TOPIC = process.argv[2] || "retrieval-augmented generation evaluation";
const THEME_PATH = join(process.cwd(), "lib", "theme.json");
const OUTPUT_PATH = join(process.cwd(), "generated", "smoke-test.pptx");

async function main() {
  console.log(`▶ Ingesting papers for topic: "${TOPIC}"`);
  const { paperCount, chunkCount } = await ingestTopic(TOPIC);
  console.log(`✅ Ingested ${paperCount} papers, ${chunkCount} chunks`);

  console.log("▶ Running multi-query RAG with RRF re-ranking");
  const chunks = await retrieveTopChunks(TOPIC);
  console.log(`✅ Retrieved ${chunks.length} re-ranked chunks from ${new Set(chunks.map((c) => c.paperId)).size} distinct papers`);

  console.log("▶ Synthesizing slide outline via Gemini");
  const synthesis = await synthesizeSlides(TOPIC, chunks);
  const totalBullets = synthesis.slides.reduce((n, s) => n + s.bullets.length, 0);
  console.log(
    `✅ Synthesized ${synthesis.slides.length} slides, ${totalBullets} bullets, ` +
      `${synthesis.references.length} cited references`
  );

  const workDir = await mkdtemp(join(tmpdir(), "deck-test-"));
  const synthesisPath = join(workDir, "synthesis.json");
  await writeFile(synthesisPath, JSON.stringify(synthesis, null, 2), "utf-8");

  console.log("▶ Building .pptx via python-pptx");
  const pythonBin = process.env.PYTHON_BIN || "python";
  const result = spawnSync(pythonBin, ["scripts/build_deck.py", synthesisPath, THEME_PATH, OUTPUT_PATH]);
  if (result.status !== 0) {
    throw new Error(`build_deck.py failed: ${result.stderr.toString()}`);
  }
  console.log(`✅ Deck written to ${OUTPUT_PATH}`);

  await rm(workDir, { recursive: true, force: true });
  await getPool().end();

  console.log("\n🎉 Full pipeline smoke test passed end to end.");
}

main().catch((err) => {
  console.error("❌ Smoke test failed:", err);
  process.exit(1);
});
