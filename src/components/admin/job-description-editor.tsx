"use client";

import { useActionState, useState } from "react";

import { updateJobDescriptionAction } from "@/lib/actions/admin";
import { EMPTY_STATE } from "@/lib/actions/types";
import { SubmitButton } from "../submit-button";
import { Button, Card, Field, FormMessage, Input, SectionTitle, Textarea } from "../ui";

export function JobDescriptionEditor({
  jobId,
  description,
  version,
}: {
  jobId: string;
  description: string;
  version: number;
}) {
  const [editing, setEditing] = useState(false);
  const [state, action] = useActionState(updateJobDescriptionAction, EMPTY_STATE);

  return (
    <Card>
      <SectionTitle
        title="Job description"
        description={`Version ${version}. Editing it clears the stored ranking and every cached explanation for this job.`}
        action={
          <Button variant="outline" onClick={() => setEditing((v) => !v)}>
            {editing ? "Cancel" : "Edit"}
          </Button>
        }
      />

      {state.error ? <FormMessage status="error">{state.error}</FormMessage> : null}
      {state.success ? <FormMessage status="success">{state.success}</FormMessage> : null}

      {editing ? (
        <form action={action} className="mt-4 space-y-4">
          <input type="hidden" name="job_id" value={jobId} />
          <Field label="Description text">
            <Textarea name="description" defaultValue={description} className="min-h-64" />
          </Field>
          <Field
            label="Or replace it with a file"
            hint="PDF or Word (.docx). An uploaded file takes precedence over the text above."
          >
            <Input type="file" name="description_file" accept=".pdf,.docx" />
          </Field>
          <SubmitButton pendingLabel="Saving...">Save description</SubmitButton>
        </form>
      ) : (
        <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap text-sm text-muted">
          {description}
        </p>
      )}
    </Card>
  );
}
