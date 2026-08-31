"use client";

import { useActionState } from "react";

import { uploadResumesAction } from "@/lib/actions/admin";
import { EMPTY_STATE } from "@/lib/actions/types";
import { SubmitButton } from "../submit-button";
import { Card, Field, FormMessage, Input, SectionTitle } from "../ui";

export function ResumeUploader({ jobId }: { jobId: string }) {
  const [state, action] = useActionState(uploadResumesAction, EMPTY_STATE);

  return (
    <Card>
      <SectionTitle
        title="Upload resumes"
        description="PDF or Word (.docx). Uploading the same file twice costs nothing, it is recognised by content. Upload very large pools in batches of about 200 files."
      />
      <form action={action} className="space-y-4">
        <input type="hidden" name="job_id" value={jobId} />
        {state.error ? <FormMessage status="error">{state.error}</FormMessage> : null}
        {state.success ? (
          <FormMessage status="success">{state.success}</FormMessage>
        ) : null}
        <Field label="Resume files">
          <Input type="file" name="resumes" accept=".pdf,.docx" multiple required />
        </Field>
        <SubmitButton pendingLabel="Uploading...">Upload</SubmitButton>
      </form>
    </Card>
  );
}
