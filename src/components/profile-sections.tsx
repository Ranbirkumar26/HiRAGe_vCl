"use client";

import { useActionState, useState } from "react";

import {
  deleteAccountAction,
  updatePasswordAction,
  updateProfileAction,
} from "@/lib/actions/auth";
import { EMPTY_STATE } from "@/lib/actions/types";
import type { Profile } from "@/lib/types";
import { Modal } from "./modal";
import { PasswordInput } from "./password-input";
import { SubmitButton } from "./submit-button";
import { Button, Card, Field, FormMessage, Input, SectionTitle } from "./ui";

/** Name, email and phone, plus roles of interest on the candidate side. */
export function ProfileDetailsCard({ profile }: { profile: Profile }) {
  const [state, action] = useActionState(updateProfileAction, EMPTY_STATE);
  const isCandidate = profile.role === "candidate";

  return (
    <Card>
      <SectionTitle title="Profile" description="Your details in HiRAGe." />
      <form action={action} className="space-y-4">
        {state.error ? <FormMessage status="error">{state.error}</FormMessage> : null}
        {state.success ? (
          <FormMessage status="success">{state.success}</FormMessage>
        ) : null}

        <Field label="Name">
          <Input name="full_name" defaultValue={profile.full_name ?? ""} />
        </Field>

        <Field label="Email address" hint="The address you sign in with.">
          <Input value={profile.email} readOnly disabled />
        </Field>

        <Field label="Phone number">
          <Input name="phone" type="tel" defaultValue={profile.phone ?? ""} />
        </Field>

        {isCandidate ? (
          <Field
            label="Roles of interest"
            hint="Comma separated. Jobs tagged with these roles surface in your feed."
          >
            <Input
              name="roles_of_interest"
              defaultValue={profile.roles_of_interest.join(", ")}
              placeholder="AI Engineer, ML Engineer"
            />
          </Field>
        ) : null}

        <SubmitButton pendingLabel="Saving...">Save profile</SubmitButton>
      </form>
    </Card>
  );
}

export function ChangePasswordCard() {
  const [state, action] = useActionState(updatePasswordAction, EMPTY_STATE);

  return (
    <Card>
      <SectionTitle title="Change password" />
      <form action={action} className="space-y-4">
        {state.error ? <FormMessage status="error">{state.error}</FormMessage> : null}
        {state.success ? (
          <FormMessage status="success">{state.success}</FormMessage>
        ) : null}
        <Field label="New password" hint="At least 8 characters.">
          <PasswordInput name="password" autoComplete="new-password" required />
        </Field>
        <Field label="Confirm new password">
          <PasswordInput name="confirm_password" autoComplete="new-password" required />
        </Field>
        <SubmitButton pendingLabel="Updating...">Change password</SubmitButton>
      </form>
    </Card>
  );
}

export function DeleteAccountCard() {
  const [confirming, setConfirming] = useState(false);

  return (
    <Card>
      <SectionTitle
        title="Delete account"
        description="This removes your account, your profile and everything attached to it."
      />
      <Button variant="danger" onClick={() => setConfirming(true)}>
        Delete account
      </Button>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Delete your account?"
      >
        <p className="text-foreground">
          This cannot be undone. Your applications and messages are deleted with it.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <form action={deleteAccountAction}>
            <SubmitButton variant="danger" pendingLabel="Deleting...">
              Delete account
            </SubmitButton>
          </form>
        </div>
      </Modal>
    </Card>
  );
}
