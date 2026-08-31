import { AdminList } from "@/components/admin/admin-list";
import { GrantAdminForm } from "@/components/admin/grant-admin-form";
import { requireSuperAdmin } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AccessPage() {
  await requireSuperAdmin();

  const db = createAdminClient();
  const { data: admins } = await db
    .from("profiles")
    .select("*")
    .eq("role", "admin")
    .order("created_at");

  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <GrantAdminForm />
      <AdminList admins={(admins ?? []) as Profile[]} />
    </div>
  );
}
