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

export async function createJobRecord(id: string, topic: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO jobs (id, topic, status) VALUES ($1, $2, 'queued')
     ON CONFLICT (id) DO NOTHING`,
    [id, topic]
  );
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
