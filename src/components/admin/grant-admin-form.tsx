"use client";

import { useActionState } from "react";

import { grantAdminAction } from "@/lib/actions/admin";
import { EMPTY_STATE } from "@/lib/actions/types";
import { SubmitButton } from "../submit-button";
import { Card, Field, FormMessage, Input, SectionTitle } from "../ui";

export function GrantAdminForm() {
  const [state, action] = useActionState(grantAdminAction, EMPTY_STATE);

  return (
    <Card>
      <SectionTitle
        title="Grant admin access"
        description="The account must already exist and have confirmed its email address."
      />
      <form action={action} className="space-y-4">
        {state.error ? <FormMessage status="error">{state.error}</FormMessage> : null}
        {state.success ? (
          <FormMessage status="success">{state.success}</FormMessage>
        ) : null}
        <Field label="Email address">
          <Input name="email" type="email" required />
        </Field>
        <SubmitButton pendingLabel="Granting...">Grant admin role</SubmitButton>
      </form>
    </Card>
  );
}
