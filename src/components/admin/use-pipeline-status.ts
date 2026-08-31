"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export interface PipelineStatus {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progressDone: number;
  progressTotal: number;
  message: string | null;
  error: string | null;
}

const POLL_MS = 2000;

export function isLive(task: PipelineStatus | null): boolean {
  return task?.status === "queued" || task?.status === "running";
}

/**
 * Mirrors one queue entry into the UI. The server render seeds the state, and
 * polling takes over only while a run is actually in flight, so an idle job
 * detail page makes no requests at all.
 */
export function usePipelineStatus(
  jobId: string,
  kind: "parse" | "shortlist",
  initial: PipelineStatus | null,
) {
  const [task, setTask] = useState<PipelineStatus | null>(initial);
  const router = useRouter();

  useEffect(() => setTask(initial), [initial]);

  useEffect(() => {
    if (!isLive(task)) return;

    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(
          `/api/pipeline-status?jobId=${jobId}&kind=${kind}`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const { task: next } = (await response.json()) as {
          task: PipelineStatus | null;
        };
        if (cancelled) return;

        setTask(next);
        // The results themselves live in the server render, so a finished run
        // needs a refresh rather than more client state.
        if (!isLive(next)) router.refresh();
      } catch {
        // Transient network failure; the next tick retries.
      }
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [task, jobId, kind, router]);

  return { task, setTask };
}
