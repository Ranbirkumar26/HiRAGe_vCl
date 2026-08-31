"use client";

import { useActionState } from "react";

import { applyToJobAction, optOutAction } from "@/lib/actions/candidate";
import { EMPTY_STATE } from "@/lib/actions/types";
import { SubmitButton } from "../submit-button";
import { Card, Field, FormMessage, Input, SectionTitle } from "../ui";

export function ApplyPanel({
  jobId,
  frozen,
  applied,
}: {
  jobId: string;
  frozen: boolean;
  applied: boolean;
}) {
  const [applyState, apply] = useActionState(applyToJobAction, EMPTY_STATE);
  const [optOutState, optOut] = useActionState(optOutAction, EMPTY_STATE);

  if (frozen) {
    return (
      <Card>
        <SectionTitle
          title="This role is frozen"
          description="The job is still listed, but it is no longer accepting applications."
        />
      </Card>
    );
  }

  if (applied) {
    return (
      <Card>
        <SectionTitle
          title="You have applied"
          description="You can apply once per job. Opt out to withdraw your resume and upload a different one."
        />
        <form action={optOut}>
          <input type="hidden" name="job_id" value={jobId} />
          {optOutState.error ? (
            <div className="mb-3">
              <FormMessage status="error">{optOutState.error}</FormMessage>
            </div>
          ) : null}
          <SubmitButton variant="outline" pendingLabel="Opting out...">
            Opt out of this application
          </SubmitButton>
        </form>
      </Card>
    );
  }

  return (
    <Card>
      <SectionTitle title="Apply" description="Attach your resume as a PDF or Word (.docx) file." />
      <form action={apply} className="space-y-4">
        <input type="hidden" name="job_id" value={jobId} />
        {applyState.error ? (
          <FormMessage status="error">{applyState.error}</FormMessage>
        ) : null}
        {optOutState.success ? (
          <FormMessage status="success">{optOutState.success}</FormMessage>
        ) : null}
        <Field label="Resume">
          <Input type="file" name="resume" accept=".pdf,.docx" required />
        </Field>
        <SubmitButton variant="accent" pendingLabel="Submitting...">
          Apply with this resume
        </SubmitButton>
      </form>
    </Card>
  );
}
