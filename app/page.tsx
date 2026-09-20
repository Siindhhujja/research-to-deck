"use client";

import { useState, useRef, useEffect } from "react";

type Status = "idle" | "queued" | "running" | "done" | "failed";

export default function Home() {
  const [topic, setTopic] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus("queued");

    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic }),
    });

    if (!res.ok) {
      setError(await res.text());
      setStatus("failed");
      return;
    }

    const { jobId: id } = await res.json();
    setJobId(id);

    pollRef.current = setInterval(async () => {
      const statusRes = await fetch(`/api/generate/${id}`);
      const data = await statusRes.json();
      setStatus(data.status);
      if (data.status === "done" || data.status === "failed") {
        if (pollRef.current) clearInterval(pollRef.current);
        if (data.status === "failed") setError(data.error);
      }
    }, 3000);
  }

  return (
    <main style={{ maxWidth: 640, margin: "4rem auto", padding: "0 1.5rem" }}>
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
          style={{ flex: 1, padding: "0.6rem", fontSize: "1rem" }}
        />
        <button
          type="submit"
          disabled={status === "queued" || status === "running"}
          style={{ padding: "0.6rem 1.2rem", fontSize: "1rem" }}
        >
          Generate
        </button>
      </form>

      {jobId && (
        <div style={{ marginTop: "1.5rem" }}>
          <p>
            Job <code>{jobId}</code>: <strong>{status}</strong>
          </p>
          {status === "done" && (
            <a href={`/api/download/${jobId}`} download>
              Download deck (.pptx)
            </a>
          )}
          {error && <p style={{ color: "#B91C1C" }}>{error}</p>}
        </div>
      )}
    </main>
  );
}
