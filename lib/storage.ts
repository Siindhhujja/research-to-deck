import { mkdir, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Storage abstraction so the worker doesn't care where generated decks
 * end up. Local filesystem implementation for dev/self-hosted worker.
 *
 * To swap in Vercel Blob for production: replace the body of `saveDeck`
 * with `put(fileName, buffer, { access: "public" })` from `@vercel/blob`
 * and return its `url` instead of a local path. Left as local FS here
 * because wiring a real Blob store requires a live Vercel project/token,
 * which is an external-service decision outside this build's scope.
 */

const GENERATED_DIR = resolve(process.env.GENERATED_DIR || "./generated");

export async function saveDeck(jobId: string, sourcePath: string): Promise<string> {
  await mkdir(GENERATED_DIR, { recursive: true });
  const destPath = join(GENERATED_DIR, `${jobId}.pptx`);
  await copyFile(sourcePath, destPath);
  return destPath;
}

export function deckPathForJob(jobId: string): string {
  return join(GENERATED_DIR, `${jobId}.pptx`);
}
