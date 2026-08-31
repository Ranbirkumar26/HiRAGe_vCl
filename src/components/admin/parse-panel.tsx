"use client";

import { useActionState, useEffect } from "react";

import { startParseAction } from "@/lib/actions/admin";
import { EMPTY_STATE } from "@/lib/actions/types";
import { Modal } from "../modal";
import { SubmitButton } from "../submit-button";
import { Card, FormMessage, SectionTitle } from "../ui";
import { isLive, usePipelineStatus, type PipelineStatus } from "./use-pipeline-status";

export function ParsePanel({
  jobId,
  poolCount,
  parsedCount,
  rankedCount,
  initialTask,
}: {
  jobId: string;
  poolCount: number;
  parsedCount: number;
  rankedCount: number;
  initialTask: PipelineStatus | null;
}) {
  const [state, action] = useActionState(startParseAction, EMPTY_STATE);
  const { task, setTask } = usePipelineStatus(jobId, "parse", initialTask);

  useEffect(() => {
    // Start polling the moment the queue accepts the run, rather than waiting
    // for the next server render to hand over a task.
    if (state.success && !isLive(task)) {
      setTask({
        id: "pending",
        status: "queued",
        progressDone: 0,
        progressTotal: 0,
        message: "Queued",
        error: null,
      });
    }
  }, [state.success, task, setTask]);

  const running = isLive(task);
  const percent =
    task && task.progressTotal > 0
      ? Math.round((task.progressDone / task.progressTotal) * 100)
      : null;

  return (
    <Card>
      <SectionTitle
        title="Parse and embed"
        description="Runs parsing, chunking, embedding, storage and retrieval. Already parsed resumes are skipped."
      />

      <dl className="mb-4 grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-muted">In pool</dt>
          <dd className="text-lg font-semibold">{poolCount}</dd>
        </div>
        <div>
          <dt className="text-muted">Parsed</dt>
          <dd className="text-lg font-semibold">{parsedCount}</dd>
        </div>
        <div>
          <dt className="text-muted">Ranked</dt>
          <dd className="text-lg font-semibold">{rankedCount}</dd>
        </div>
      </dl>

      <form action={action} className="space-y-3">
        <input type="hidden" name="job_id" value={jobId} />
        {state.error ? <FormMessage status="error">{state.error}</FormMessage> : null}
        {task?.status === "failed" && task.error ? (
          <FormMessage status="error">Last run failed: {task.error}</FormMessage>
        ) : null}
        {task?.status === "succeeded" && task.message ? (
          <FormMessage status="success">{task.message}</FormMessage>
        ) : null}
        <SubmitButton variant="accent" disabled={running} pendingLabel="Starting...">
          {running ? "Parsing in progress" : "Parse resumes"}
        </SubmitButton>
      </form>

      <Modal open={running} title="Please wait, the resumes are being parsed">
        <p>{task?.message ?? "Queued"}</p>
        {percent !== null ? (
          <>
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-surface">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="mt-2 text-xs">
              {task?.progressDone} of {task?.progressTotal} documents
            </p>
          </>
        ) : null}
        <p className="mt-4 text-xs">
          You can leave this page open. Parsing continues in the background.
        </p>
      </Modal>
    </Card>
  );
}
