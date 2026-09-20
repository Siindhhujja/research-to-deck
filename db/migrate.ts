import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPool } from "./client";

async function migrate() {
  const sql = readFileSync(join(__dirname, "schema.sql"), "utf-8");
  const pool = getPool();
  await pool.query(sql);
  console.log("✅ Migration applied: papers, chunks, jobs tables ready (pgvector extension enabled).");
  await pool.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
