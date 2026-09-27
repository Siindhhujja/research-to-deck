import { getPool } from "@/db/client";

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface JobRecord {
  id: string;
  topic: string;
  status: JobStatus;
  error: string | null;
  filePath: string | null;
  paperCount: number | null;
}

export async function createJobRecord(id: string, topic: string, email: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO jobs (id, topic, email, status) VALUES ($1, $2, $3, 'queued')
     ON CONFLICT (id) DO NOTHING`,
    [id, topic, email]
  );
}

/**
 * Counts prior generation attempts for `email`, regardless of outcome —
 * a failed job still used the one free generation, since the free tier is
 * meant to gate demand on the shared API quota, not guarantee a success.
 */
export async function countJobsByEmail(email: string): Promise<number> {
  const pool = getPool();
  const res = await pool.query(`SELECT COUNT(*)::int AS count FROM jobs WHERE email = $1`, [
    email,
  ]);
  return res.rows[0].count;
}

export async function updateJobStatus(
  id: string,
  status: JobStatus,
  fields: Partial<Pick<JobRecord, "error" | "filePath" | "paperCount">> = {}
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE jobs SET status = $2, error = $3, file_path = $4, paper_count = $5, updated_at = now()
     WHERE id = $1`,
    [id, status, fields.error ?? null, fields.filePath ?? null, fields.paperCount ?? null]
  );
}

export async function getJobRecord(id: string): Promise<JobRecord | null> {
  const pool = getPool();
  const res = await pool.query(
    `SELECT id, topic, status, error, file_path, paper_count FROM jobs WHERE id = $1`,
    [id]
  );
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return {
    id: row.id,
    topic: row.topic,
    status: row.status,
    error: row.error,
    filePath: row.file_path,
    paperCount: row.paper_count,
  };
}
