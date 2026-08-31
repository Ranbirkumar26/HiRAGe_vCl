import { Card, EmptyState, SectionTitle } from "@/components/ui";
import { requireCandidate } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { NotificationRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const session = await requireCandidate();
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("notifications")
    .select("*")
    .eq("recipient_id", session.userId)
    .order("created_at", { ascending: false });

  const notifications = (rows ?? []) as NotificationRow[];

  return (
    <div className="mx-auto max-w-2xl">
      <SectionTitle
        title="Messages"
        description="Shortlist notifications from recruiters. These messages are one way and cannot be replied to."
      />

      {notifications.length === 0 ? (
        <EmptyState>No messages yet.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {notifications.map((notification) => (
            <li key={notification.id}>
              <Card>
                <p className="font-medium">{notification.body}</p>
                <dl className="mt-3 space-y-1 text-sm text-muted">
                  <div className="flex gap-2">
                    <dt>Recruiter</dt>
                    <dd className="text-foreground">{notification.recruiter_name}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt>Contact</dt>
                    <dd className="text-foreground">{notification.recruiter_email}</dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs text-muted">
                  {new Date(notification.created_at).toLocaleString()}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
