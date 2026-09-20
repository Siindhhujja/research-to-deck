/**
 * Fires a workflow_dispatch event on .github/workflows/worker.yml so a
 * freshly-queued job gets picked up close to immediately instead of
 * waiting on a schedule. No-ops (with a log) if GH_WORKFLOW_TOKEN isn't
 * configured, e.g. in local dev where you run `npm run worker` yourself.
 */
export async function triggerWorkerWorkflow(): Promise<void> {
  const token = process.env.GH_WORKFLOW_TOKEN;
  const repo = process.env.GH_WORKFLOW_REPO || "Siindhhujja/research-to-deck";
  const ref = process.env.GH_WORKFLOW_REF || "master";

  if (!token) {
    console.log("GH_WORKFLOW_TOKEN not set — skipping workflow_dispatch (assuming a worker is already running).");
    return;
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/worker.yml/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ ref }),
      }
    );
    if (!res.ok) {
      console.error(`Failed to dispatch worker workflow: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error("Failed to dispatch worker workflow:", err);
  }
}
