"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";

import {
  forgotPasswordAction,
  signInAction,
  signUpAction,
  updatePasswordAction,
} from "@/lib/actions/auth";
import { EMPTY_STATE } from "@/lib/actions/types";
import { PasswordInput } from "./password-input";
import { SubmitButton } from "./submit-button";
import { Card, Field, FormMessage, Input } from "./ui";

function Heading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-5">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted">{subtitle}</p>
    </div>
  );
}

function Result({ state }: { state: { error?: string; success?: string } }) {
  if (state.error) return <FormMessage status="error">{state.error}</FormMessage>;
  if (state.success) return <FormMessage status="success">{state.success}</FormMessage>;
  return null;
}

export function SignInForm({ notice }: { notice?: string }) {
  const [state, action] = useActionState(signInAction, EMPTY_STATE);
  const [email, setEmail] = useState("");

  // A form action resets its uncontrolled inputs, so the address is restored
  // from whatever the action echoed back.
  useEffect(() => {
    if (state.values?.email) setEmail(state.values.email);
  }, [state.values?.email]);

  return (
    <Card>
      <Heading title="Sign in" subtitle="Continue to your HiRAGe portal." />
      <form action={action} className="space-y-4">
        {notice ? <FormMessage status="error">{notice}</FormMessage> : null}
        <Result state={state} />
        <Field label="Email address">
          <Input
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>
        <Field label="Password">
          <PasswordInput name="password" autoComplete="current-password" required />
        </Field>
        <SubmitButton className="w-full" pendingLabel="Signing in...">
          Sign in
        </SubmitButton>
      </form>
      <div className="mt-4 flex items-center justify-between text-sm">
        <Link href="/forgot-password" className="text-brand-blue hover:underline">
          Forgot password
        </Link>
        <Link href="/sign-up" className="text-muted hover:text-foreground">
          Create an account
        </Link>
      </div>
    </Card>
  );
}

export function SignUpForm() {
  const [state, action] = useActionState(signUpAction, EMPTY_STATE);

  return (
    <Card>
      <Heading
        title="Create your account"
        subtitle="You will receive a confirmation link by email."
      />
      <form action={action} className="space-y-4">
        <Result state={state} />
        <Field label="Email address">
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password" hint="At least 8 characters.">
          <PasswordInput name="password" autoComplete="new-password" required />
        </Field>
        <SubmitButton className="w-full" pendingLabel="Sending link...">
          Sign up
        </SubmitButton>
      </form>
      <p className="mt-4 text-sm text-muted">
        Already have an account?{" "}
        <Link href="/sign-in" className="text-brand-blue hover:underline">
          Sign in
        </Link>
      </p>
    </Card>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState(forgotPasswordAction, EMPTY_STATE);

  return (
    <Card>
      <Heading
        title="Reset your password"
        subtitle="We will email you a link to choose a new one."
      />
      <form action={action} className="space-y-4">
        <Result state={state} />
        <Field label="Email address">
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
        <SubmitButton className="w-full" pendingLabel="Sending link...">
          Send reset link
        </SubmitButton>
      </form>
      <p className="mt-4 text-sm">
        <Link href="/sign-in" className="text-brand-blue hover:underline">
          Back to sign in
        </Link>
      </p>
    </Card>
  );
}

export function ResetPasswordForm({ authorised }: { authorised: boolean }) {
  const [state, action] = useActionState(updatePasswordAction, EMPTY_STATE);

  if (!authorised) {
    return (
      <Card>
        <Heading
          title="Link expired"
          subtitle="Reset links can only be used once and expire quickly."
        />
        <Link href="/forgot-password" className="text-brand-blue hover:underline">
          Request a new reset link
        </Link>
      </Card>
    );
  }

  return (
    <Card>
      <Heading title="Choose a new password" subtitle="Then sign in with it." />
      <form action={action} className="space-y-4">
        <Result state={state} />
        <Field label="New password" hint="At least 8 characters.">
          <PasswordInput name="password" autoComplete="new-password" required />
        </Field>
        <Field label="Confirm new password">
          <PasswordInput name="confirm_password" autoComplete="new-password" required />
        </Field>
        <SubmitButton className="w-full" pendingLabel="Saving...">
          Update password
        </SubmitButton>
      </form>
      {state.success ? (
        <p className="mt-4 text-sm">
          <Link href="/" className="text-brand-blue hover:underline">
            Continue to your portal
          </Link>
        </p>
      ) : null}
    </Card>
  );
}
