"use client";

import { useEffect, useRef, useState } from "react";

type Status = "idle" | "queued" | "running" | "done" | "failed";

interface JobState {
  jobId: string;
  status: Status;
  paperCount: number | null;
  error: string | null;
  startedAt: number;
}

const COLORS: Record<Status, string> = {
  idle: "#9CA3AF",
  queued: "#D97706",
  running: "#2563EB",
  done: "#16A34A",
  failed: "#DC2626",
};

function stageLabel(job: JobState): string {
  if (job.status === "queued") return "Queued — waiting for a worker to pick this up…";
  if (job.status === "running" && job.paperCount == null) {
    return "Searching the literature and ingesting papers…";
  }
  if (job.status === "running") {
    return `Found ${job.paperCount} papers — retrieving, synthesizing, and building your deck…`;
  }
  if (job.status === "done") return `Done — synthesized from ${job.paperCount} papers.`;
  return "Failed";
}

function stepIndex(job: JobState): number {
  if (job.status === "queued") return 0;
  if (job.status === "running") return job.paperCount == null ? 1 : 2;
  if (job.status === "done") return 3;
  return -1;
}

const STEPS = ["Queued", "Finding papers", "Writing your deck", "Ready"];

function Spinner() {
  return (
    <span
      style={{
        display: "inline-block",
        width: 14,
        height: 14,
        border: "2px solid rgba(37, 99, 235, 0.25)",
        borderTopColor: "#2563EB",
        borderRadius: "50%",
        animation: "rtd-spin 0.7s linear infinite",
      }}
    />
  );
}

function ElapsedTime({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return <span>{seconds}s elapsed</span>;
}

export default function Home() {
  const [topic, setTopic] = useState("");
  const [job, setJob] = useState<JobState | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pollRef.current) clearInterval(pollRef.current);

    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic }),
    });

    if (!res.ok) {
      const body = await res.text();
      setJob({
        jobId: "",
        status: "failed",
        paperCount: null,
        error: body,
        startedAt: Date.now(),
      });
      return;
    }

    const { jobId } = await res.json();
    setJob({ jobId, status: "queued", paperCount: null, error: null, startedAt: Date.now() });

    pollRef.current = setInterval(async () => {
      const statusRes = await fetch(`/api/generate/${jobId}`);
      const data = await statusRes.json();
      setJob((prev) =>
        prev
          ? { ...prev, status: data.status, paperCount: data.paperCount, error: data.error }
          : prev
      );
      if (data.status === "done" || data.status === "failed") {
        if (pollRef.current) clearInterval(pollRef.current);
      }
    }, 3000);
  }

  const isBusy = job?.status === "queued" || job?.status === "running";

  return (
    <main style={{ maxWidth: 640, margin: "4rem auto", padding: "0 1.5rem" }}>
      <style>{`
        @keyframes rtd-spin { to { transform: rotate(360deg); } }
        @keyframes rtd-indeterminate {
          0% { transform: translateX(-40%); }
          100% { transform: translateX(220%); }
        }
      `}</style>

      <h1 style={{ fontSize: "1.75rem", marginBottom: "0.25rem" }}>Research-to-Deck Generator</h1>
      <p style={{ color: "#6B7280", marginBottom: "2rem" }}>
        RAG over 50+ papers, synthesized into a branded, cited PPTX deck.
      </p>

      <form onSubmit={submit} style={{ display: "flex", gap: "0.5rem" }}>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. retrieval-augmented generation evaluation"
          required
          disabled={isBusy}
          style={{
            flex: 1,
            padding: "0.6rem 0.75rem",
            fontSize: "1rem",
            border: "1px solid #D1D5DB",
            borderRadius: 6,
          }}
        />
        <button
          type="submit"
          disabled={isBusy}
          style={{
            padding: "0.6rem 1.2rem",
            fontSize: "1rem",
            fontWeight: 600,
            color: "white",
            background: isBusy ? "#93C5FD" : "#2563EB",
            border: "none",
            borderRadius: 6,
            cursor: isBusy ? "default" : "pointer",
          }}
        >
          Generate
        </button>
      </form>
      <p style={{ color: "#9CA3AF", fontSize: "0.85rem", marginTop: "0.5rem" }}>
        Usually takes 1–3 minutes: it searches live academic sources, retrieves and re-ranks the
        most relevant passages, then writes and builds the deck.
      </p>

      {job && (
        <div
          style={{
            marginTop: "2rem",
            padding: "1.25rem",
            border: `1px solid ${COLORS[job.status]}33`,
            background: `${COLORS[job.status]}0D`,
            borderRadius: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            {isBusy && <Spinner />}
            <strong style={{ color: COLORS[job.status] }}>{stageLabel(job)}</strong>
          </div>

          {isBusy && (
            <>
              <div
                style={{
                  marginTop: "0.9rem",
                  height: 6,
                  borderRadius: 3,
                  background: "#E5E7EB",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: "40%",
                    height: "100%",
                    borderRadius: 3,
                    background: "#2563EB",
                    animation: "rtd-indeterminate 1.4s ease-in-out infinite",
                  }}
                />
              </div>

              <div
                style={{
                  marginTop: "0.6rem",
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "0.8rem",
                  color: "#6B7280",
                }}
              >
                <span>
                  Step {stepIndex(job) + 1} of {STEPS.length}: {STEPS[stepIndex(job)]}
                </span>
                <ElapsedTime since={job.startedAt} />
              </div>
            </>
          )}

          {job.status === "done" && (
            <a
              href={`/api/download/${job.jobId}`}
              download
              style={{
                display: "inline-block",
                marginTop: "1rem",
                padding: "0.55rem 1.1rem",
                background: "#16A34A",
                color: "white",
                fontWeight: 600,
                borderRadius: 6,
                textDecoration: "none",
              }}
            >
              Download deck (.pptx)
            </a>
          )}

          {job.status === "failed" && (
            <p style={{ color: "#991B1B", marginTop: "0.75rem", fontSize: "0.9rem" }}>
              {job.error ?? "Something went wrong."}
            </p>
          )}

          {job.jobId && (
            <p style={{ marginTop: "0.75rem", fontSize: "0.75rem", color: "#9CA3AF" }}>
              Job <code>{job.jobId}</code>
            </p>
          )}
        </div>
      )}
    </main>
  );
}
