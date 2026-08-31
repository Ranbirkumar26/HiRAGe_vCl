"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { confirmShortlistAction, startShortlistAction } from "@/lib/actions/admin";
import { EMPTY_STATE } from "@/lib/actions/types";
import type { ShortlistEntry } from "@/lib/types";
import { Modal } from "../modal";
import { SubmitButton } from "../submit-button";
import { Badge, Button, Card, EmptyState, FormMessage, Input, SectionTitle } from "../ui";
import { isLive, usePipelineStatus, type PipelineStatus } from "./use-pipeline-status";

export function ShortlistPanel({
  jobId,
  k,
  entries,
  rankedCount,
  initialTask,
}: {
  jobId: string;
  k: number;
  entries: ShortlistEntry[];
  rankedCount: number;
  initialTask: PipelineStatus | null;
}) {
  const router = useRouter();
  const [requestedK, setRequestedK] = useState(k);
  const [state, action] = useActionState(startShortlistAction, EMPTY_STATE);
  const { task, setTask } = usePipelineStatus(jobId, "shortlist", initialTask);
  const [selected, setSelected] = useState<ShortlistEntry | null>(null);

  useEffect(() => {
    if (!state.success) return;
    // Keep k in the URL so the server render slices the stored ranking to it.
    router.replace(`/admin/jobs/${jobId}?k=${requestedK}`);
    if (!isLive(task)) {
      setTask({
        id: "pending",
        status: "queued",
        progressDone: 0,
        progressTotal: 0,
        message: "Queued",
        error: null,
      });
    }
    // `task` is intentionally excluded: this should fire once per successful start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  const running = isLive(task);
  const percent =
    task && task.progressTotal > 0
      ? Math.round((task.progressDone / task.progressTotal) * 100)
      : null;

  return (
    <Card>
      <SectionTitle
        title="Shortlist"
        description="Ranking is already stored, so changing k slices a different length from it. Only newly included candidates cost a generation."
      />

      <form action={action} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="job_id" value={jobId} />
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">
            Number of resumes required (k)
          </span>
          <Input
            name="k"
            type="number"
            min={1}
            max={1200}
            value={requestedK}
            onChange={(event) => setRequestedK(Number(event.target.value))}
            className="w-40"
            required
          />
        </label>
        <SubmitButton disabled={running} pendingLabel="Starting...">
          {running ? "Shortlisting" : "Shortlist"}
        </SubmitButton>
      </form>

      <div className="mt-3 space-y-2">
        {state.error ? <FormMessage status="error">{state.error}</FormMessage> : null}
        {task?.status === "failed" && task.error ? (
          <FormMessage status="error">Last run failed: {task.error}</FormMessage>
        ) : null}
        {rankedCount === 0 ? (
          <p className="text-sm text-muted">
            Run the parse first. Retrieval stores the ranked pool that the shortlist
            slices.
          </p>
        ) : null}
      </div>

      <div className="mt-5">
        {entries.length === 0 ? (
          <EmptyState>
            No ranked candidates yet for the current job description and resume pool.
          </EmptyState>
        ) : (
          <ol className="space-y-3">
            {entries.map((entry) => (
              <li key={entry.resumeId}>
                <button
                  type="button"
                  onClick={() => setSelected(entry)}
                  className="w-full rounded-xl border border-[var(--border)] bg-background p-4 text-left transition hover:border-[var(--border-strong)]"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-blue-soft text-sm font-semibold text-brand-blue">
                      {entry.rank}
                    </span>
                    <span className="font-medium">{entry.fileName}</span>
                    {entry.candidateEmail ? (
                      <span className="text-sm text-muted">{entry.candidateEmail}</span>
                    ) : (
                      <Badge tone="neutral">No email on resume</Badge>
                    )}
                    {entry.shortlisted ? <Badge tone="green">Shortlisted</Badge> : null}
                    <span className="ml-auto text-sm text-muted">
                      match {(entry.score * 100).toFixed(1)}
                    </span>
                  </div>

                  {entry.pros.length || entry.cons.length ? (
                    <div className="mt-3 grid gap-4 sm:grid-cols-2">
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-green">
                          Pros
                        </h4>
                        <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm">
                          {entry.pros.map((point, index) => (
                            <li key={index}>{point}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-blue">
                          Cons
                        </h4>
                        <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm">
                          {entry.cons.map((point, index) => (
                            <li key={index}>{point}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-muted">
                      Explanation not generated yet. Click Shortlist to generate it.
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      <Modal open={running} title="Generating explanations">
        <p>{task?.message ?? "Queued"}</p>
        {percent !== null ? (
          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-surface">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
        ) : null}
      </Modal>

      {selected ? (
        <ConfirmDialog
          jobId={jobId}
          entry={selected}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </Card>
  );
}

function ConfirmDialog({
  jobId,
  entry,
  onClose,
}: {
  jobId: string;
  entry: ShortlistEntry;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, action] = useActionState(confirmShortlistAction, EMPTY_STATE);

  useEffect(() => {
    if (state.success) router.refresh();
  }, [state.success, router]);

  return (
    <Modal open title="Confirm?" onClose={onClose}>
      <p className="text-foreground">
        Mark {entry.fileName} as shortlisted for this job
        {entry.candidateEmail ? ` and notify ${entry.candidateEmail}` : ""}?
      </p>

      {state.error ? (
        <div className="mt-3">
          <FormMessage status="error">{state.error}</FormMessage>
        </div>
      ) : null}
      {state.success ? (
        <div className="mt-3">
          <FormMessage status="success">{state.success}</FormMessage>
        </div>
      ) : null}

      <form action={action} className="mt-5 flex justify-end gap-2">
        <input type="hidden" name="job_id" value={jobId} />
        <input type="hidden" name="resume_id" value={entry.resumeId} />
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <SubmitButton pendingLabel="Confirming...">OK</SubmitButton>
      </form>
    </Modal>
  );
}
