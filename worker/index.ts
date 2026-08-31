/**
 * HiRAGe pipeline worker.
 *
 * Parsing 1,200 documents and generating explanations both run far past any
 * HTTP timeout, so the web app only ever enqueues a row in `pipeline_jobs` and
 * this process does the work. Run it alongside `next dev` with `npm run worker`.
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

import { runParse, runShortlist } from "../src/lib/rag/pipeline";
import type { PipelineJob } from "../src/lib/types";

config({ path: ".env.local" });
config({ path: ".env" });

const POLL_INTERVAL_MS = 2_000;
/** A task still marked running after this long belonged to a worker that died. */
const STALE_AFTER_MS = 30 * 60 * 1000;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[worker] ${name} is not set. Copy .env.example to .env.local.`);
    process.exit(1);
  }
  return value;
}

const db = createClient(
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  {
    // HiRAGe owns the `hirage` schema; `public` belongs to another app in this
    // Supabase project.
    db: { schema: "hirage" },
    auth: { autoRefreshToken: false, persistSession: false },
  },
);
requiredEnv("GEMINI_API_KEY");

let shuttingDown = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requeueStaleJobs(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  const { data, error } = await db
    .from("pipeline_jobs")
    .update({ status: "queued", started_at: null, message: "Restarted by the worker" })
    .eq("status", "running")
    .lt("started_at", cutoff)
    .select("id");

  if (error) {
    console.error("[worker] could not requeue stale tasks:", error.message);
    return;
  }
  if (data?.length) console.log(`[worker] requeued ${data.length} stale task(s)`);
}

async function claim(): Promise<PipelineJob | null> {
  const { data, error } = await db.rpc("claim_pipeline_job");
  if (error) {
    console.error("[worker] claim failed:", error.message);
    return null;
  }
  const task = data as PipelineJob | null;
  return task && task.id ? task : null;
}

async function finish(
  taskId: string,
  status: "succeeded" | "failed",
  error?: string,
): Promise<void> {
  await db
    .from("pipeline_jobs")
    .update({ status, error: error ?? null, finished_at: new Date().toISOString() })
    .eq("id", taskId);
}

async function handle(task: PipelineJob): Promise<void> {
  console.log(`[worker] ${task.kind} started for job ${task.job_id}`);
  const startedAt = Date.now();

  try {
    if (task.kind === "parse") {
      await runParse(db, task.id, task.job_id);
    } else {
      const k = Number(task.payload?.k ?? 10);
      await runShortlist(db, task.id, task.job_id, k);
    }
    await finish(task.id, "succeeded");
    console.log(
      `[worker] ${task.kind} finished in ${Math.round((Date.now() - startedAt) / 1000)}s`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[worker] ${task.kind} failed:`, message);
    await finish(task.id, "failed", message);
  }
}

async function main(): Promise<void> {
  console.log("[worker] polling pipeline_jobs");
  await requeueStaleJobs();

  while (!shuttingDown) {
    const task = await claim();
    if (!task) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    await handle(task);
  }

  console.log("[worker] stopped");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    console.log(`[worker] ${signal} received, finishing current task`);
  });
}

main().catch((error) => {
  console.error("[worker] fatal:", error);
  process.exit(1);
});
