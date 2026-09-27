"use client";

import { useEffect, useRef, useState } from "react";
import {
  MagnifyingGlass,
  Sparkle,
  Presentation,
  DownloadSimple,
  Warning,
} from "@phosphor-icons/react";

type Status = "idle" | "queued" | "running" | "done" | "failed";

interface JobState {
  jobId: string;
  status: Status;
  paperCount: number | null;
  error: string | null;
  startedAt: number;
}

const STATUS_COLOR: Record<Status, string> = {
  idle: "var(--color-muted-foreground)",
  queued: "var(--color-queued)",
  running: "var(--color-running)",
  done: "var(--color-done)",
  failed: "var(--color-destructive)",
};

const FEATURES = [
  {
    icon: MagnifyingGlass,
    title: "Multi-query RAG",
    desc: "Retrieves and re-ranks the most relevant passages from 50+ papers via reciprocal rank fusion.",
  },
  {
    icon: Sparkle,
    title: "Gemini synthesis",
    desc: "Writes cited slide titles, bullets, and speaker notes grounded in the retrieved sources.",
  },
  {
    icon: Presentation,
    title: "Branded .pptx",
    desc: "Assembles a ready-to-present deck with a references slide traceable to every citation.",
  },
];

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
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "72px 24px 96px",
      }}
    >
      <span className="kicker">
        <span className="kicker-dot" aria-hidden="true" />
        RAG-powered
      </span>

      <h1 className="hero-title">Research-to-Deck Generator</h1>
      <p className="hero-tagline">
        Give it a research topic. It pulls 50+ papers from OpenAlex, runs multi-query RAG over
        them, and has Gemini assemble a cited, branded slide deck — automatically.
      </p>

      <div className="feature-grid">
        {FEATURES.map(({ icon: Icon, title, desc }) => (
          <div className="feature-card" key={title}>
            <span className="feature-icon">
              <Icon size={20} weight="regular" aria-hidden="true" />
            </span>
            <p className="feature-title">{title}</p>
            <p className="feature-desc">{desc}</p>
          </div>
        ))}
      </div>

      <form onSubmit={submit} className="generate-form">
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. retrieval-augmented generation evaluation"
          aria-label="Research topic"
          required
          disabled={isBusy}
          className="input"
        />
        <button type="submit" disabled={isBusy} className="btn-primary">
          Generate deck
        </button>
      </form>
      <p className="hint-text">
        Usually takes 1–3 minutes: it searches live academic sources, retrieves and re-ranks the
        most relevant passages, then writes and builds the deck.
      </p>

      {job && (
        <div className="status-card" style={{ marginTop: 40 }} role="status" aria-live="polite">
          <div className="status-header" style={{ color: STATUS_COLOR[job.status] }}>
            {isBusy && <span className="spinner" aria-hidden="true" />}
            {job.status === "failed" && <Warning size={18} weight="regular" aria-hidden="true" />}
            <span>{stageLabel(job)}</span>
          </div>

          {isBusy && (
            <>
              <div className="progress-track">
                <div className="progress-bar" />
              </div>
              <div className="step-row">
                <span>
                  Step {stepIndex(job) + 1} of {STEPS.length}: {STEPS[stepIndex(job)]}
                </span>
                <ElapsedTime since={job.startedAt} />
              </div>
            </>
          )}

          {job.status === "done" && (
            <a href={`/api/download/${job.jobId}`} download className="download-btn">
              <DownloadSimple size={18} weight="regular" aria-hidden="true" />
              Download deck (.pptx)
            </a>
          )}

          {job.status === "failed" && (
            <p className="error-text">{job.error ?? "Something went wrong."}</p>
          )}

          {job.jobId && <p className="job-id">Job {job.jobId}</p>}
        </div>
      )}
    </main>
  );
}
