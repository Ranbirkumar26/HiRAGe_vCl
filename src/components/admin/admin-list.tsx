"use client";

import { useActionState, useEffect, useState } from "react";

import { revokeAdminAction } from "@/lib/actions/admin";
import { EMPTY_STATE } from "@/lib/actions/types";
import { SUPER_ADMIN_EMAIL, type Profile } from "@/lib/types";
import { Modal } from "../modal";
import { SubmitButton } from "../submit-button";
import { Badge, Button, Card, FormMessage, SectionTitle } from "../ui";

/**
 * The admin roster, with a revoke control on every row except the fixed super
 * admin. Revoking is reversible by granting again, but it removes someone's
 * access to every job in the portal, so it asks first.
 */
export function AdminList({ admins }: { admins: Profile[] }) {
  const [state, action] = useActionState(revokeAdminAction, EMPTY_STATE);
  const [pending, setPending] = useState<Profile | null>(null);

  // Close the dialog once the server confirms, so the refreshed list shows.
  useEffect(() => {
    if (state.success) setPending(null);
  }, [state.success]);

  return (
    <Card>
      <SectionTitle
        title="Accounts with the admin role"
        description="Removing the role returns that account to the candidate portal."
      />

      {state.error ? <FormMessage status="error">{state.error}</FormMessage> : null}
      {state.success ? (
        <FormMessage status="success">{state.success}</FormMessage>
      ) : null}

      <ul className="mt-3 divide-y divide-[var(--border)] text-sm">
        {admins.map((profile) => {
          const isSuperAdmin = profile.email.toLowerCase() === SUPER_ADMIN_EMAIL;

          return (
            <li key={profile.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <span>{profile.email}</span>
              {isSuperAdmin ? <Badge tone="green">Super admin</Badge> : null}
              <span className="text-muted">{profile.full_name ?? "No name set"}</span>

              <span className="ml-auto">
                {isSuperAdmin ? (
                  <span className="text-xs text-muted">Cannot be removed</span>
                ) : (
                  <Button variant="outline" onClick={() => setPending(profile)}>
                    Remove admin
                  </Button>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Remove admin access?"
      >
        <p className="text-foreground">
          {pending?.email} will lose access to the admin portal and be routed to the
          candidate portal instead. Jobs they created are not affected. You can grant
          the role again at any time.
        </p>

        <form action={action} className="mt-5 flex justify-end gap-2">
          <input type="hidden" name="email" value={pending?.email ?? ""} />
          <Button type="button" variant="outline" onClick={() => setPending(null)}>
            Cancel
          </Button>
          <SubmitButton variant="danger" pendingLabel="Removing...">
            Remove admin
          </SubmitButton>
        </form>
      </Modal>
    </Card>
  );
}
