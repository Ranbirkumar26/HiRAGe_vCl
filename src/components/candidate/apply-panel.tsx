"use client";

import { useRouter } from "next/navigation";
import { useActionState, useRef, useState } from "react";

import { optOutAction } from "@/lib/actions/candidate";
import { finaliseApplication } from "@/lib/actions/uploads";
import { EMPTY_STATE, type ActionState } from "@/lib/actions/types";
import { uploadResumeFiles } from "@/lib/upload-client";
import { SubmitButton } from "../submit-button";
import { Button, Card, Field, FormMessage, Input, SectionTitle } from "../ui";

export function ApplyPanel({
  jobId,
  frozen,
  applied,
}: {
  jobId: string;
  frozen: boolean;
  applied: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [applyState, setApplyState] = useState<ActionState>({});
  const [busy, setBusy] = useState(false);
  const [optOutState, optOut] = useActionState(optOutAction, EMPTY_STATE);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setApplyState({ error: "Attach your resume as a PDF or Word file." });
      return;
    }

    setApplyState({});
    setBusy(true);
    try {
      const result = await uploadResumeFiles(jobId, [file]);

      if (result.error) {
        setApplyState({ error: result.error });
        return;
      }
      if (!result.uploaded.length) {
        setApplyState({
          error: result.rejected[0]?.reason ?? "Your resume could not be uploaded.",
        });
        return;
      }

      setApplyState(await finaliseApplication(jobId, result.uploaded[0]));
      router.refresh();
    } catch (error) {
      setApplyState({
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }

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
      <SectionTitle
        title="Apply"
        description="Attach your resume as a PDF or Word (.docx) file."
      />
      <form onSubmit={onSubmit} className="space-y-4">
        {applyState.error ? (
          <FormMessage status="error">{applyState.error}</FormMessage>
        ) : null}
        {applyState.success ? (
          <FormMessage status="success">{applyState.success}</FormMessage>
        ) : null}
        {optOutState.success ? (
          <FormMessage status="success">{optOutState.success}</FormMessage>
        ) : null}

        <Field label="Resume">
          <Input
            ref={inputRef}
            type="file"
            name="resume"
            accept=".pdf,.docx"
            required
            disabled={busy}
          />
        </Field>

        <Button type="submit" variant="accent" disabled={busy}>
          {busy ? "Submitting..." : "Apply with this resume"}
        </Button>
      </form>
    </Card>
  );
}
