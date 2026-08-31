"use client";

import { useState } from "react";

import { deleteJobAction, freezeJobAction } from "@/lib/actions/admin";
import { Modal } from "../modal";
import { SubmitButton } from "../submit-button";
import { Button, Card, SectionTitle } from "../ui";

/**
 * Freeze and delete both change what candidates can see, so each one asks
 * before it fires.
 */
export function JobControls({
  jobId,
  frozen,
}: {
  jobId: string;
  frozen: boolean;
}) {
  const [pending, setPending] = useState<"freeze" | "delete" | null>(null);

  return (
    <Card>
      <SectionTitle
        title="Job controls"
        description="Freezing keeps the job visible but closed to new applications. Deleting removes it from the portal."
      />

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={frozen}
          onClick={() => setPending("freeze")}
        >
          {frozen ? "Frozen" : "Freeze job"}
        </Button>
        <Button variant="danger" onClick={() => setPending("delete")}>
          Delete job
        </Button>
      </div>

      <Modal
        open={pending === "freeze"}
        onClose={() => setPending(null)}
        title="Freeze this job?"
      >
        <p className="text-foreground">
          Candidates will still see it, but nobody will be able to apply.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setPending(null)}>
            Cancel
          </Button>
          <form action={freezeJobAction}>
            <input type="hidden" name="job_id" value={jobId} />
            <SubmitButton pendingLabel="Freezing...">Freeze</SubmitButton>
          </form>
        </div>
      </Modal>

      <Modal
        open={pending === "delete"}
        onClose={() => setPending(null)}
        title="Delete this job?"
      >
        <p className="text-foreground">
          The job disappears from both portals, including candidates&apos; application
          lists.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setPending(null)}>
            Cancel
          </Button>
          <form action={deleteJobAction}>
            <input type="hidden" name="job_id" value={jobId} />
            <SubmitButton variant="danger" pendingLabel="Deleting...">
              Delete
            </SubmitButton>
          </form>
        </div>
      </Modal>
    </Card>
  );
}
