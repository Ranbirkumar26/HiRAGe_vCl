"use client";

import { useActionState } from "react";

import { createJobAction } from "@/lib/actions/admin";
import { EMPTY_STATE } from "@/lib/actions/types";
import { SubmitButton } from "../submit-button";
import { Card, Field, FormMessage, Input, SectionTitle, Textarea } from "../ui";

export function CreateJobForm() {
  const [state, action] = useActionState(createJobAction, EMPTY_STATE);

  return (
    <Card>
      <SectionTitle
        title="Create a job"
        description="Type the description or upload it as a PDF or Word file."
      />
      <form action={action} className="space-y-4">
        {state.error ? <FormMessage status="error">{state.error}</FormMessage> : null}

        <Field label="Job description">
          <Textarea
            name="description"
            placeholder="Paste the job description here."
          />
        </Field>

        <Field
          label="Or upload the job description"
          hint="PDF or Word (.docx). An uploaded file takes precedence over the text above."
        >
          <Input type="file" name="description_file" accept=".pdf,.docx" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name">
            <Input name="company_name" required />
          </Field>
          <Field label="Recruiter name">
            <Input name="recruiter_name" required />
          </Field>
        </div>

        <Field label="Recruiter email address">
          <Input name="recruiter_email" type="email" required />
        </Field>

        <Field
          label="Role tags"
          hint="Comma separated, for example: AI Engineer, ML Engineer, Software Developer."
        >
          <Input name="tags" placeholder="AI Engineer, ML Engineer" required />
        </Field>

        <SubmitButton pendingLabel="Creating...">Create job</SubmitButton>
      </form>
    </Card>
  );
}
